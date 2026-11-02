import fs from 'node:fs';
import path from 'node:path';

const file = (root) => path.join(root, '.fixforward', 'history.json');

export function readHistory(root) {
  try { return JSON.parse(fs.readFileSync(file(root), 'utf8')); } catch { return []; }
}

export function recordRun(root, entry) {
  const all = readHistory(root);
  all.push(entry);
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify(all, null, 2));
}

export function insights(history) {
  const runs = history.filter((h) => h.command === 'run');
  const ruleCounts = {};
  const componentCounts = {};
  for (const h of history) {
    for (const round of h.rounds || []) {
      for (const f of round.failures || []) {
        ruleCounts[f.rule] = (ruleCounts[f.rule] || 0) + 1;
        componentCounts[f.component] = (componentCounts[f.component] || 0) + 1;
      }
    }
  }
  const autoFixed = runs.filter((r) => r.result === 'passed' && (r.rounds || []).some((x) => (x.fixes || []).length));
  const avgMs = autoFixed.length ? autoFixed.reduce((s, r) => s + r.durationMs, 0) / autoFixed.length : 0;
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    totalRuns: runs.length,
    passed: runs.filter((r) => r.result === 'passed').length,
    autoFixed: autoFixed.length,
    needsHuman: runs.filter((r) => r.result !== 'passed').length,
    avgTimeToGreenSec: Math.round(avgMs / 1000),
    topErrors: top(ruleCounts),
    topComponents: top(componentCounts),
  };
}
