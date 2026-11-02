import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { runCmd, parseJsonOutput } from './exec.js';
import { extractFailures } from './parse.js';
import { diagnose } from './rules.js';
import { applyFix, findFiles, GENERATED_MARK } from './fixes.js';
import { explainError, aiAvailable } from './llm.js';
import { recordRun, readHistory, insights } from './history.js';

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const HELP = `
${c.bold('FixForward')}: diagnose failed Salesforce deployments, fix them in source, re-validate.

Usage:
  fixforward run --org <alias> [options]       Validate, diagnose, fix and re-validate until green
  fixforward diagnose --org <alias>            Validate and diagnose only (no changes)
  fixforward diagnose --file <log.json|txt>    Diagnose a saved sf or Agentia log
  fixforward diagnose --agentia "<command>"    Run an Agentia command (e.g. job logs) and diagnose its output
  fixforward insights                          Show recurring failures and time-to-green

Options:
  --manifest <path>      package.xml to validate (default: manifest/package.xml if present)
  --source-dir <path>    Source folder when no manifest is used (default: force-app)
  --test-level <level>   sf test level (default: RunLocalTests)
  --source-org <alias>   Org to retrieve missing components from
  --max-rounds <n>       Fix rounds before giving up (default: 3)
  --yes                  Apply fixes without asking
  --commit               git commit the fixes once validation passes
  --push                 Also run "agentia cicd work push" after committing
  --no-ai                Never call the LLM
  --json                 Machine-readable output (for AI agents and CI)
`;

const BOOLEAN = new Set(['yes', 'json', 'commit', 'push', 'no-ai', 'help']);

export function parseArgs(argv) {
  const flags = {};
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOLEAN.has(key)) flags[key] = true;
      else { flags[key] = argv[i + 1]; i++; }
    } else if (!cmd) cmd = a;
  }
  return { cmd, flags };
}

function context(flags) {
  const root = process.cwd();
  let manifest = flags.manifest || (fs.existsSync(path.join(root, 'manifest', 'package.xml')) ? 'manifest/package.xml' : null);
  if (manifest) manifest = path.resolve(root, manifest);
  return {
    root, manifest,
    sourceDir: flags['source-dir'] || 'force-app',
    org: flags.org, sourceOrg: flags['source-org'],
    testLevel: flags['test-level'] || 'RunLocalTests',
    maxRounds: Number(flags['max-rounds'] || 3),
    noAi: Boolean(flags['no-ai']),
  };
}

function validate(ctx) {
  const target = ctx.manifest ? `--manifest "${ctx.manifest}"` : `--source-dir "${ctx.sourceDir}"`;
  const cmd = `sf project deploy validate ${target} --target-org ${ctx.org} --test-level ${ctx.testLevel} --json`;
  const r = runCmd(cmd, ctx.root);
  const json = parseJsonOutput(r.stdout) ?? parseJsonOutput(r.stderr);
  const result = json?.result ?? json?.data;
  const success = r.code === 0 && json?.status === 0 && result?.success !== false;
  return { success, input: json ?? (r.stdout + '\n' + r.stderr) };
}

function markInheritedDebt(dx, ctx) {
  const inChange = new Set(findFiles(ctx.root, (p) => /\.(cls|trigger)$/.test(p))
    .map((f) => path.basename(f).replace(/\.(cls|trigger)$/, '')));
  const hasTestFailure = dx.some((d) => d.rule === 'TEST_FAILURE' || d.rule === 'GENERATED_TEST_FAILURE');
  for (const d of dx) {
    if (d.rule !== 'LOW_COVERAGE') continue;
    if (d.details.className && !inChange.has(d.details.className)) {
      d.fixable = false;
      d.title = 'Existing org code without test coverage (not caused by this change)';
      d.explanation += ' This component is not in your project, so the target org already had this coverage debt.';
    } else if (!d.details.className && hasTestFailure) {
      d.fixable = false;
      d.explanation += ' A failing test is also pulling coverage down; fix the failing test first.';
    }
  }
  return dx;
}

// A failing test that FixForward itself generated is FixForward's own mistake, so it may repair it.
function markGeneratedTests(dx, ctx) {
  const out = [];
  const merged = new Map();
  for (const d of dx) {
    const cls = d.rule === 'TEST_FAILURE' && d.details.testClass;
    const file = cls && findFiles(ctx.root, (p) => p.endsWith(`/classes/${cls}.cls`))[0];
    if (file && fs.readFileSync(file, 'utf8').startsWith(GENERATED_MARK)) {
      const line = `${d.details.test}: ${d.details.detail}`;
      if (merged.has(cls)) { merged.get(cls).details.failures += '\n' + line; continue; }
      const g = { ...d, rule: 'GENERATED_TEST_FAILURE', fixable: true,
        title: 'A test FixForward generated has a wrong assertion', component: `Apex:${cls}`,
        details: { testClass: cls, testFile: file, failures: line },
        explanation: `${cls} was written by FixForward and does not match the code's real behaviour; FixForward will rewrite it from the failures.` };
      merged.set(cls, g); out.push(g);
    } else out.push(d);
  }
  return out;
}

async function analyse(input, ctx, log) {
  const dx = markInheritedDebt(markGeneratedTests(diagnose(extractFailures(input)), ctx), ctx);
  if (!ctx.noAi && aiAvailable()) {
    for (const d of dx.filter((x) => x.rule === 'UNKNOWN' || x.rule === 'TEST_FAILURE')) {
      try { d.aiExplanation = await explainError(ctx.root, d.failure); }
      catch (e) { log(c.dim(`  (AI explanation unavailable: ${e.message})`)); }
    }
  }
  return dx;
}

function printDiagnoses(dx, log) {
  if (!dx.length) { log(c.yellow('  No specific errors found in the output.')); return; }
  dx.forEach((d, i) => {
    const tag = d.fixable ? c.green('[auto-fixable]') : c.yellow('[needs a human]');
    log(`  ${i + 1}. ${c.bold(d.title)} ${tag}`);
    log(`     ${c.dim('Component:')} ${d.component}`);
    log(`     ${c.dim('Why:')} ${d.explanation}`);
    if (d.aiExplanation) log(`     ${c.cyan('AI suggestion:')} ${d.aiExplanation}`);
  });
}

const slim = (dx) => dx.map((d) => ({ rule: d.rule, component: d.component, fixable: d.fixable,
  explanation: d.explanation, aiExplanation: d.aiExplanation }));

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} (y/N) `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function cmdRun(flags, log) {
  const ctx = context(flags);
  if (!ctx.org) throw new Error('--org <alias> is required (the org to validate against).');
  const started = Date.now();
  const entry = { command: 'run', time: new Date().toISOString(), org: ctx.org, rounds: [], result: null };
  log(c.bold(`\nFixForward → validating against ${ctx.org}`) + c.dim(`  (${ctx.manifest ? path.relative(ctx.root, ctx.manifest) : ctx.sourceDir}, ${ctx.testLevel})`));

  for (let round = 1; ; round++) {
    log(c.cyan(`\n▶ Validation ${round}…`));
    const v = validate(ctx);
    if (v.success) { log(c.green('✔ Validation passed.')); entry.result = 'passed'; break; }

    log(c.red('✘ Validation failed. Diagnosis:'));
    const dx = await analyse(v.input, ctx, log);
    printDiagnoses(dx, log);
    const roundLog = { failures: slim(dx), fixes: [] };
    entry.rounds.push(roundLog);

    if (round > ctx.maxRounds) { log(c.yellow(`\nStopped after ${ctx.maxRounds} fix rounds.`)); entry.result = 'max-rounds'; break; }
    const fixable = dx.filter((d) => d.fixable);
    if (!fixable.length) { log(c.yellow('\nNothing here can be fixed automatically. Handing over to you.')); entry.result = 'needs-human'; break; }
    if (!flags.yes && !(await confirm(`\nApply ${fixable.length} fix(es) in source?`))) { entry.result = 'declined'; break; }

    for (const d of fixable) {
      const r = await applyFix(d, ctx);
      log(`  ${r.applied ? c.green('✔') : c.yellow('•')} ${d.rule}: ${r.summary}`);
      if (r.applied) roundLog.fixes.push({ rule: d.rule, component: d.component, summary: r.summary });
    }
    if (!roundLog.fixes.length) { log(c.yellow('\nNo fix could be applied. Handing over to you.')); entry.result = 'needs-human'; break; }
  }

  entry.durationMs = Date.now() - started;
  const fixesApplied = entry.rounds.flatMap((r) => r.fixes);
  if (entry.result === 'passed' && fixesApplied.length && flags.commit) {
    runCmd('git add -A', ctx.root);
    const msg = `FixForward: ${fixesApplied.map((f) => f.rule).join(', ')}`;
    const commit = runCmd(`git commit -m "${msg}"`, ctx.root);
    log(commit.code === 0 ? c.green(`✔ Committed: ${msg}`) : c.yellow(`git commit: ${commit.stderr || commit.stdout}`));
    if (flags.push && commit.code === 0) {
      const push = runCmd('agentia cicd work push', ctx.root);
      log(push.code === 0 ? c.green('✔ Pushed to the user story with agentia cicd work push.') : c.yellow(`agentia cicd work push: ${push.stderr || push.stdout}`));
    }
  }
  recordRun(ctx.root, entry);
  log(c.bold(`\nResult: ${entry.result}`) + c.dim(` in ${Math.round(entry.durationMs / 1000)}s, ${fixesApplied.length} fix(es) applied.`));
  return entry;
}

async function cmdDiagnose(flags, log) {
  const ctx = context(flags);
  let input;
  if (flags.file) {
    const text = fs.readFileSync(path.resolve(flags.file), 'utf8');
    input = parseJsonOutput(text) ?? text;
  } else if (flags.agentia) {
    const command = /--json\b/.test(flags.agentia) ? flags.agentia : `${flags.agentia} --json`;
    const r = runCmd(command, ctx.root);
    input = parseJsonOutput(r.stdout) ?? (r.stdout + '\n' + r.stderr);
  } else if (ctx.org) {
    const v = validate(ctx);
    if (v.success) { log(c.green('✔ Validation passed, nothing to diagnose.')); return { result: 'passed', diagnoses: [] }; }
    input = v.input;
  } else {
    throw new Error('Give --org <alias>, --file <log> or --agentia "<command>".');
  }
  const dx = await analyse(input, ctx, log);
  log(c.bold('\nDiagnosis:'));
  printDiagnoses(dx, log);
  recordRun(ctx.root, { command: 'diagnose', time: new Date().toISOString(), rounds: [{ failures: slim(dx) }] });
  return { result: 'diagnosed', diagnoses: slim(dx) };
}

function cmdInsights(log) {
  const s = insights(readHistory(process.cwd()));
  log(c.bold('\nFixForward insights'));
  log(`  Runs: ${s.totalRuns}   Passed: ${s.passed}   Auto-fixed: ${s.autoFixed}   Needed a human: ${s.needsHuman}`);
  log(`  Average time to green (auto-fixed runs): ${s.avgTimeToGreenSec}s`);
  log(c.bold('\n  Most common errors:'));
  s.topErrors.forEach(([k, v]) => log(`    ${String(v).padStart(3)} × ${k}`));
  log(c.bold('\n  Components that fail most:'));
  s.topComponents.forEach(([k, v]) => log(`    ${String(v).padStart(3)} × ${k}`));
  return s;
}

export async function main(argv) {
  const { cmd, flags } = parseArgs(argv);
  // In --json mode, human-readable progress goes to stderr so stdout stays valid JSON.
  const log = flags.json ? (s) => process.stderr.write(s + '\n') : (s) => console.log(s);
  let out;
  if (flags.help || !cmd) { console.log(HELP); return; }
  if (cmd === 'run') out = await cmdRun(flags, log);
  else if (cmd === 'diagnose') out = await cmdDiagnose(flags, log);
  else if (cmd === 'insights') out = cmdInsights(log);
  else { console.log(HELP); process.exit(1); }
  if (flags.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (out?.result && !['passed', 'diagnosed'].includes(out.result)) process.exitCode = 2;
}
