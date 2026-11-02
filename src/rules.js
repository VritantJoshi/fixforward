// Deterministic rules for common Salesforce deployment errors.
// Same input always gives the same diagnosis; only UNKNOWN errors go to the LLM.

function first(message, patterns) {
  for (const [re, map] of patterns) {
    const m = message.match(re);
    if (m) return map(m);
  }
  return null;
}

export const RULES = [
  {
    id: 'MISSING_FIELD',
    title: 'Custom field missing from the deployment',
    fixable: true,
    match(f) {
      const d = first(f.message, [
        [/No such column '(\w+)' on entity '(\w+)'/i, (m) => ({ field: m[1], object: m[2] })],
        [/Field does not exist: (\w+) on (\w+)/i, (m) => ({ field: m[1], object: m[2] })],
        [/Invalid field:?\s*'?(\w+)'? for (?:SObject|entity)?:?\s*'?(\w+)/i, (m) => ({ field: m[1], object: m[2] })],
        [/no CustomField named (\w+)\.(\w+) found/i, (m) => ({ object: m[1], field: m[2] })],
        [/Variable does not exist: (\w+__c)\b/i, (m) => ({ field: m[1], object: null })],
      ]);
      return d && /__c$/i.test(d.field) ? d : null;
    },
    explain: (d, f) =>
      `${f.name || 'Your code'} references the custom field ${d.object ? d.object + '.' : ''}${d.field}, ` +
      `which does not exist in the target org and is not part of this deployment.`,
    component: (d) => `CustomField:${d.object ? d.object + '.' : ''}${d.field}`,
  },
  {
    id: 'MISSING_TYPE',
    title: 'Apex class or object missing from the deployment',
    fixable: true,
    match(f) {
      const m = f.message.match(/Invalid type: (?:Schema\.)?(\w+)/i);
      if (!m) return null;
      return /__c$/i.test(m[1]) ? { metaType: 'CustomObject', name: m[1] } : { metaType: 'ApexClass', name: m[1] };
    },
    explain: (d, f) =>
      `${f.name || 'A component'} depends on ${d.metaType} ${d.name}, which is missing from the target org and from this deployment.`,
    component: (d) => `${d.metaType}:${d.name}`,
  },
  {
    id: 'LOW_COVERAGE',
    title: 'Apex test coverage below 75%',
    fixable: true,
    match(f) {
      if (!/coverage/i.test(f.message) || !/(75%|insufficient|at least)/i.test(f.message)) return null;
      const pct = f.message.match(/(\d+)%/);
      if (/average test coverage/i.test(f.message)) return { className: null, percent: pct ? Number(pct[1]) : null };
      const named = f.message.match(/Apex (?:Class|Trigger):\s*(\w+)/i) || f.message.match(/^\s*(\w+)\s+-\s+Test coverage/i);
      return { className: f.name || (named && named[1]) || null, percent: pct ? Number(pct[1]) : null };
    },
    explain: (d) =>
      d.className
        ? `${d.className} has ${d.percent ?? 'too little'}% test coverage, below what Salesforce requires to deploy.`
        : `Org-wide coverage is ${d.percent ?? 'below'}%; Salesforce requires at least 75% to deploy.`,
    component: (d) => (d.className ? `Apex:${d.className}` : 'Org-wide coverage'),
  },
  {
    id: 'API_VERSION',
    title: 'API version mismatch',
    fixable: true,
    match(f) {
      return /(api version|apiversion)/i.test(f.message) && f.file ? { file: f.file } : null;
    },
    explain: (d) => `${d.file} uses an API version the target org does not accept for this component.`,
    component: (d) => d.file,
  },
  {
    id: 'TEST_FAILURE',
    title: 'Apex test failed',
    fixable: false,
    match(f) {
      if (f.kind === 'test') return { test: f.name };
      const m = f.message.match(/^\s*(\w+\.\w+)\s+-\s+(System\.\w+Exception.*)$/);
      return m ? { test: m[1] } : null;
    },
    explain: (d, f) => `Test ${d.test} failed: ${f.message}`,
    component: (d) => `Test:${d.test}`,
  },
];

export function diagnose(failures) {
  const out = [];
  const seen = new Set();
  for (const f of failures) {
    let dx = null;
    for (const rule of RULES) {
      const d = rule.match(f);
      if (d) {
        dx = { rule: rule.id, title: rule.title, fixable: rule.fixable, details: d,
               component: rule.component(d), explanation: rule.explain(d, f), failure: f };
        break;
      }
    }
    if (!dx) {
      dx = { rule: 'UNKNOWN', title: 'Unrecognised error', fixable: false, details: {},
             component: f.name || f.file || 'unknown', explanation: f.message, failure: f };
    }
    const key = `${dx.rule}|${dx.component}`;
    if (!seen.has(key)) { seen.add(key); out.push(dx); }
  }
  return out;
}
