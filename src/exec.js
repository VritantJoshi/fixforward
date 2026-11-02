import { spawnSync } from 'node:child_process';

// Runs a shell command (shell:true so sf.cmd / agentia.cmd resolve on Windows).
export function runCmd(command, cwd = process.cwd()) {
  const r = spawnSync(command, { shell: true, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// CLIs sometimes print warnings before their --json payload; find the JSON object.
export function parseJsonOutput(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = text.lastIndexOf('}');
  for (const slice of [text.slice(start), text.slice(start, end + 1)]) {
    try { return JSON.parse(slice); } catch { /* try next */ }
  }
  return null;
}
