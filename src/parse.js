// Turns sf / Agentia output (JSON or plain text) into a flat list of failures.
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (typeof v === 'string' ? v : null);

// "Failed to validate the deployment (...). Due To: A.b - System.X: msg,C.d - System.Y: msg" → one failure each.
export function splitDueTo(message) {
  const i = message.indexOf('Due To:');
  if (i < 0) return [{ kind: 'general', message }];
  return message.slice(i + 7).split(/,(?=\s*\w+\.\w+\s+-\s+)|\n/).map((m) => m.trim()).filter(Boolean)
    .map((m) => ({ kind: 'log', message: m }));
}

export function extractFailures(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { obj = null; }
  }
  const failures = [];

  if (obj && typeof obj === 'object') {
    const res = obj.result ?? obj.data ?? obj;
    const details = res?.details ?? res?.result?.details;

    for (const f of toArray(details?.componentFailures)) {
      failures.push({
        kind: 'component',
        type: str(f.componentType),
        name: str(f.fullName),
        file: str(f.fileName),
        line: f.lineNumber ?? null,
        message: str(f.problem) || '',
      });
    }
    const rtr = details?.runTestResult;
    for (const t of toArray(rtr?.failures)) {
      failures.push({
        kind: 'test',
        name: [str(t.name), str(t.methodName)].filter(Boolean).join('.'),
        message: str(t.message) || '',
        stack: str(t.stackTrace),
      });
    }
    for (const w of toArray(rtr?.codeCoverageWarnings)) {
      failures.push({ kind: 'coverage', name: str(w.name), message: str(w.message) || '' });
    }
    const general = !failures.length && (str(res?.errorMessage) || (obj.status && obj.status !== 0 && str(obj.message)));
    if (general) failures.push(...splitDueTo(general));
  }

  // Fallback for log text (e.g. Agentia job step logs): keep error-looking lines.
  if (!failures.length) {
    const text = (typeof input === 'string' ? input : JSON.stringify(input ?? ''))
      .replace(/\\n/g, '\n').replace(/\\"/g, '"');
    const pattern = /(error|failed|failure|exception|invalid|no such column|does not exist|coverage|not available)/i;
    const seen = new Set();
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (l && pattern.test(l) && !seen.has(l)) {
        seen.add(l);
        failures.push({ kind: 'log', message: l.slice(0, 500) });
      }
      if (failures.length >= 20) break;
    }
  }
  // Salesforce adds summary lines such as "3 component error(s)": counts, not errors of their own.
  const summaryOnly = /^\s*(\d+ component errors?(\(s\))?|failed to validate the deployment[^:]*\.?)\s*$/i;
  const real = failures.filter((f) => f.message && !summaryOnly.test(f.message));
  return real.length ? real : failures;
}
