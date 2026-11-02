import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Groq exposes an OpenAI-compatible API, so another provider only needs a different URL/model.
const URL = process.env.FIXFORWARD_LLM_URL || 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const aiAvailable = () => Boolean(process.env.GROQ_API_KEY);

function cachePath(root) { return path.join(root, '.fixforward', 'cache.json'); }
function readCache(root) {
  try { return JSON.parse(fs.readFileSync(cachePath(root), 'utf8')); } catch { return {}; }
}
function writeCache(root, cache) {
  fs.mkdirSync(path.dirname(cachePath(root)), { recursive: true });
  fs.writeFileSync(cachePath(root), JSON.stringify(cache, null, 2));
}

async function chat(system, user) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (res.status === 429) { await sleep(4000 * (attempt + 1)); continue; } // rate limit: wait, retry
    if (!res.ok) throw new Error(`LLM API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  }
  throw new Error('LLM API rate limit: try again in a minute.');
}

async function cached(root, kind, input, fn) {
  const cache = readCache(root);
  const key = kind + ':' + crypto.createHash('sha1').update(input).digest('hex');
  if (cache[key]) return cache[key];
  const value = await fn();
  if (value) { cache[key] = value; writeCache(root, cache); }
  return value;
}

export function explainError(root, failure) {
  const msg = `${failure.name ? failure.name + ': ' : ''}${failure.message}`.slice(0, 1500);
  return cached(root, 'explain', msg, () =>
    chat(
      'You are a Salesforce deployment expert. Explain the cause of this deployment error in at most two short sentences, then give one concrete fix starting with "Fix:". No markdown.',
      msg,
    ));
}

export function generateTestClass(root, className, source, testName) {
  return cached(root, 'test', testName + source, async () => {
    const out = await chat(
      'You write Salesforce Apex unit tests. Return ONLY the Apex code of one test class, no explanation, no markdown fences. ' +
      'Use @isTest, Test.startTest()/Test.stopTest(), System.assert* statements, and create any records the code needs. ' +
      'Cover every branch so line coverage is well above 75%. Do not use SeeAllData.',
      `Write a test class named ${testName} for this Apex class:\n\n${source.slice(0, 12000)}`,
    );
    if (!out) return null;
    const code = out.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    return /@istest/i.test(code) ? code : null;
  });
}
