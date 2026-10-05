// Rotation logic test: runs the real generate() handler against a local fake
// provider and a stubbed User model, so nothing touches MongoDB or the network.
//
// Covers: the strict key1 -> key2 -> key3 cascade on failure (key 1 is always
// tried first, rotation happens only when a key fails), no wasted retry wait on a
// spent key, spent keys pushed to the back of the rotation, per-minute
// rate-limit retry, per-key usage recording and the response payload.
import http from 'node:http';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
global._mongooseCache = { conn: { ok: true }, promise: Promise.resolve({ ok: true }) };

const { encrypt } = await import('../utils/crypto.js');
const { todayKey, parseQuotaFailure } = await import('../utils/keyUsage.js');
const { PROVIDERS } = await import('../utils/providers.js');
const User = (await import('../models/User.js')).default;

// ---- fake provider ---------------------------------------------------------
const seen = []; // { key }
let responder = () => ({ status: 200, body: okBody() });

function okBody() {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify([{ title: 'Red apple on a table', keywords: ['apple', 'fruit'], category: 13 }]) } }],
  });
}
const dailyQuotaBody = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, model: gemini-2.5-flash',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '250' }] }],
  },
});
const minuteQuotaBody = JSON.stringify({
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '10' }] }],
  },
});
// What the Gemini OpenAI-compatible endpoint really sends when a key is out of
// daily quota: NO details[].violations[], just Google's wording with the metric
// and the limit inside the message text.
function messageOnlyBody(limits, { retryIn = '2.5' } = {}) {
  const lines = limits.map(([metric, limit]) => `* Quota exceeded for metric: ${metric}, limit: ${limit}, model: gemini-2.5-flash`).join('\n');
  return JSON.stringify({
    error: {
      code: 429,
      message:
        'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n' +
        `${lines}\nPlease retry in ${retryIn}s.`,
      status: 'RESOURCE_EXHAUSTED',
    },
  });
}
const M_REQ = 'generativelanguage.googleapis.com/generate_content_free_tier_requests';
const M_TOKENS = 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count';
const messageOnlyDailyBody = messageOnlyBody([[M_REQ, 250]]);
const messageOnlyMinuteBody = messageOnlyBody([[M_REQ, 10]]);
// Both windows reported in one body (a real-world sample).
const messageOnlyBothBody = messageOnlyBody([[M_TOKENS, 250000], [M_REQ, 250], [M_REQ, 10]], { retryIn: '32.36' });


const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const key = (req.headers.authorization || '').replace('Bearer ', '');
    seen.push({ key });
    const r = responder(seen.length, raw, key);
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(r.body);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PROVIDERS.gemini.endpoint = `http://127.0.0.1:${server.address().port}/chat`;

// ---- stubbed persistence ---------------------------------------------------
// A tiny Mongo stand-in: it matches "still the same Pacific day?" filters the
// same way the real $inc/$set pair relies on, applies patches in place and
// records every call so the test can assert on them.
const updates = [];
let fakeUser = null;

function poolPath(path) {
  const m = /^(encrypted\w+)\.(\d+)\.(\w+)$/.exec(path);
  return m ? { field: m[1], index: Number(m[2]), prop: m[3] } : null;
}

function applyUpdate(user, update) {
  for (const [path, value] of Object.entries(update.$set || {})) {
    const p = poolPath(path);
    if (!p) continue;
    const arr = user[p.field] || (user[p.field] = []);
    arr[p.index] = { ...arr[p.index], [p.prop]: value };
  }
  for (const [path, value] of Object.entries(update.$inc || {})) {
    const p = poolPath(path);
    if (!p) continue;
    const arr = user[p.field] || (user[p.field] = []);
    const cur = arr[p.index] || (arr[p.index] = {});
    cur[p.prop] = (cur[p.prop] || 0) + value;
  }
}

User.updateOne = async (filter, update) => {
  updates.push({ filter, update });
  const dayFilter = Object.keys(filter).find((k) => /\.\d+\.dayKey$/.test(k));
  if (dayFilter) {
    const p = poolPath(dayFilter);
    const doc = fakeUser.encryptedApiKeys?.[p.index];
    if (doc?.dayKey !== filter[dayFilter]) return { matchedCount: 0 };
  }
  applyUpdate(fakeUser, update);
  return { matchedCount: 1 };
};
User.findById = () => ({ select: async () => fakeUser });

function makeUser(keys) {
  return { email: 't@t', encryptedApiKey: null, encryptedApiKeys: keys };
}
const poolKey = (label, extra = {}) => ({ id: label, encrypted: encrypt(label), ...extra });

const { generate } = await import('../controllers/generateController.js');

function callGenerate() {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    generate(
      { userId: 'u1', body: { provider: 'gemini', model: 'gemini-2.5-flash', images: [{ imageBase64: 'AAA', mimeType: 'image/jpeg' }], kwCount: 10, titleMin: 5, titleMax: 12 } },
      res
    );
  });
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

// ---- 1. key 1 out of daily quota → auto-switch to key 2, instantly ---------
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('KEY-ONE'), poolKey('KEY-TWO')]);
  responder = (n) => (n === 1 ? { status: 429, body: dailyQuotaBody } : { status: 200, body: okBody() });

  const started = Date.now();
  const out = await callGenerate();
  const elapsed = Date.now() - started;

  check('spent key 1 -> key 2 returns 200 with metadata', () => {
    assert.equal(out.code, 200);
    assert.equal(out.body.results.length, 1);
    assert.equal(out.body.results[0].ok, true);
    assert.equal(out.body.results[0].title, 'Red apple on a table');
  });
  check('rotation order is key 1 then key 2', () => {
    assert.deepEqual(seen.map((s) => s.key), ['KEY-ONE', 'KEY-TWO']);
  });
  check('response reports key 2 as the one that served the batch', () => {
    assert.equal(out.body.usedKey.position, 2);
    assert.equal(out.body.usedKey.of, 2);
  });
  check('no retry wait when the daily quota is spent (<2s)', () => {
    assert.ok(elapsed < 2000, `took ${elapsed}ms — it retried a spent key`);
  });
  check('failed key marked spent for today + limit learned from the 429', () => {
    const u = updates.find((x) => 'encryptedApiKeys.0.exhaustedDayKey' in x.update.$set);
    assert.ok(u, 'no exhaustedDayKey write for key 1');
    assert.equal(u.update.$set['encryptedApiKeys.0.exhaustedDayKey'], todayKey());
    assert.equal(u.update.$set['encryptedApiKeys.0.limit'], 250);
    assert.equal(u.update.$set['encryptedApiKeys.0.limitModel'], 'gemini-2.5-flash');
    assert.equal(u.update.$inc['encryptedApiKeys.0.failures'], 1);
  });
  check('accepted request bumps key 2 usage', () => {
    const u = updates.find((x) => x.update.$inc?.['encryptedApiKeys.1.uses'] === 1);
    assert.ok(u, 'no uses increment for key 2');
    assert.equal(u.update.$inc['encryptedApiKeys.1.total'], 1);
    assert.equal(u.update.$set['encryptedApiKeys.1.exhaustedDayKey'], '');
  });
  check('response carries live stats for the settings panel', () => {
    const keys = out.body.apiKeys.gemini.keys;
    assert.equal(keys.length, 2);
    assert.equal(keys[0].exhausted, true);
    assert.equal(keys[0].limit, 250);
    assert.equal(keys[0].failures, 1);
    assert.equal(keys[0].limitSource, 'learned');
    assert.equal(keys[1].inFlight, 0);
    assert.equal(keys[1].uses, 1);
    assert.equal(keys[1].exhausted, false);
    assert.ok(out.body.secondsUntilReset > 0);
  });
}

// ---- 2. a spent key is skipped instead of being tried first ----------------
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('KEY-ONE', { exhaustedDayKey: todayKey() }), poolKey('KEY-TWO')]);
  responder = () => ({ status: 200, body: okBody() });

  const out = await callGenerate();
  check('spent key is skipped: only the healthy key is called', () => {
    assert.equal(out.code, 200);
    assert.deepEqual(seen.map((s) => s.key), ['KEY-TWO']);
  });
}

// ---- 3. per-minute rate limit is retried, not rotated away -----------------
{
  seen.length = 0;
  fakeUser = makeUser([poolKey('KEY-ONE')]);
  responder = (n) => (n === 1 ? { status: 429, body: minuteQuotaBody } : { status: 200, body: okBody() });

  const out = await callGenerate();
  check('per-minute 429 retries the same key and then succeeds', () => {
    assert.equal(out.code, 200);
    assert.deepEqual(seen.map((s) => s.key), ['KEY-ONE', 'KEY-ONE']);
    assert.equal(out.body.usedKey.position, 1);
  });
}

// ---- 4. every key spent → helpful error listing each key -------------------
{
  seen.length = 0;
  fakeUser = makeUser([
    poolKey('KEY-ONE', { exhaustedDayKey: todayKey() }),
    poolKey('KEY-TWO', { exhaustedDayKey: todayKey() }),
  ]);
  responder = () => ({ status: 429, body: dailyQuotaBody });

  const out = await callGenerate();
  check('all keys spent -> 502 that still tries every key and explains why', () => {
    assert.equal(out.code, 502);
    assert.match(out.body.error, /All 2 Gemini \(Google\) keys failed/);
    assert.equal(seen.length, 2);
    assert.equal(out.body.keysTried.length, 2);
    assert.ok(out.body.keysTried.every((k) => k.exhausted === true));
  });
}

// ---- 5. sequential fallback down three keys: 1 fails → 2 fails → 3 works ----
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('A-KEY-1'), poolKey('B-KEY-2'), poolKey('C-KEY-3')]);
  responder = (n) => (n <= 2 ? { status: 429, body: dailyQuotaBody } : { status: 200, body: okBody() });

  const out = await callGenerate();
  check('key 1 fails -> key 2 fails -> key 3 serves (in saved order)', () => {
    assert.deepEqual(seen.map((s) => s.key), ['A-KEY-1', 'B-KEY-2', 'C-KEY-3']);
    assert.equal(out.body.usedKey.position, 3);
    assert.equal(out.body.usedKey.of, 3);
    assert.equal(out.body.results[0].ok, true);
  });
  check('both failed keys are marked spent, only keys 1 and 2 learn limits', () => {
    const e0 = updates.find((x) => 'encryptedApiKeys.0.exhaustedDayKey' in x.update.$set);
    const e1 = updates.find((x) => 'encryptedApiKeys.1.exhaustedDayKey' in x.update.$set);
    assert.ok(e0, 'key 1 not marked spent');
    assert.ok(e1, 'key 2 not marked spent');
    assert.equal(e0.update.$set['encryptedApiKeys.0.limit'], 250);
    assert.equal(e1.update.$set['encryptedApiKeys.1.limit'], 250);
  });
}
// ---- 6. strict cascade: while key 1 is healthy it serves every batch ---------
// The pool is NOT load-balanced. Key 1 is the primary key; keys 2 and 3 are only
// tried when an earlier key fails, so three healthy keys keep using key 1.
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('A-KEY-1'), poolKey('B-KEY-2'), poolKey('C-KEY-3')]);
  responder = () => ({ status: 200, body: okBody() });

  const r1 = await callGenerate();
  const r2 = await callGenerate();
  const r3 = await callGenerate();

  check('sequential batches all use key 1 while it stays healthy', () => {
    assert.deepEqual(seen.map((s) => s.key), ['A-KEY-1', 'A-KEY-1', 'A-KEY-1']);
  });
  check('usedKey.position stays on key 1 and reports the pool size', () => {
    assert.equal(r1.body.usedKey.position, 1);
    assert.equal(r2.body.usedKey.position, 1);
    assert.equal(r3.body.usedKey.position, 1);
    assert.equal(r3.body.usedKey.of, 3);
  });
}

// ---- 7. parallel batches all start at key 1 (no load spreading) -------------
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('P-KEY-1'), poolKey('P-KEY-2'), poolKey('P-KEY-3')]);
  responder = () => ({ status: 200, body: okBody() });

  const [a, b, c] = await Promise.all([callGenerate(), callGenerate(), callGenerate()]);
  check('concurrent batches all use key 1 while it stays healthy', () => {
    assert.deepEqual([...seen.map((s) => s.key)].sort(), ['P-KEY-1', 'P-KEY-1', 'P-KEY-1']);
  });
  check('each concurrent batch reports key 1 as its slot', () => {
    assert.deepEqual(
      [a.body.usedKey.position, b.body.usedKey.position, c.body.usedKey.position],
      [1, 1, 1]
    );
  });
// ---- 8. a message-only 429 is still a spent key, so the pool moves on --------
// Regression: the OpenAI-compatible endpoint sends no details[], so the daily
// quota went unrecognised. The key was never flagged spent, every batch paid the
// 2s+4s backoff on it and the rotation kept coming back to key 1 instead of
// settling on the first key that still has quota.
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('M-KEY-1'), poolKey('M-KEY-2')]);
  responder = (_, raw, key) => (key === 'M-KEY-1' ? { status: 429, body: messageOnlyDailyBody } : { status: 200, body: okBody() });

  const started = Date.now();
  const first = await callGenerate();
  const firstMs = Date.now() - started;

  check('message-only daily 429 marks the key spent for today', () => {
    assert.equal(first.code, 200);
    const u = updates.find((x) => 'encryptedApiKeys.0.exhaustedDayKey' in (x.update.$set || {}));
    assert.ok(u, 'key 1 was never marked spent');
    assert.equal(u.update.$set['encryptedApiKeys.0.exhaustedDayKey'], todayKey());
  });
  check('the daily limit is learned from the message text', () => {
    const u = updates.find((x) => 'encryptedApiKeys.0.limit' in (x.update.$set || {}));
    assert.ok(u, 'no limit learned from the message');
    assert.equal(u.update.$set['encryptedApiKeys.0.limit'], 250);
    assert.equal(u.update.$set['encryptedApiKeys.0.limitModel'], 'gemini-2.5-flash');
  });
  check('a spent key rotates instantly instead of sitting out the backoff', () => {
    assert.deepEqual(seen.map((s) => s.key), ['M-KEY-1', 'M-KEY-2']);
    assert.equal(first.body.usedKey.position, 2);
    assert.ok(firstMs < 2000, `took ${firstMs}ms — it retried the spent key`);
  });

  // Second batch: the spent key must be skipped, not tried again first.
  seen.length = 0;
  const second = await callGenerate();
  check('the next batch skips the spent key (no return to key 1)', () => {
    assert.deepEqual(seen.map((s) => s.key), ['M-KEY-2']);
    assert.equal(second.body.usedKey.position, 2);
    assert.equal(second.body.apiKeys.gemini.keys[0].exhausted, true);
  });
}

// ---- 9. key 1 and key 2 spent -> key 3 takes over and keeps the work ---------
{
  seen.length = 0;
  updates.length = 0;
  fakeUser = makeUser([poolKey('S-KEY-1'), poolKey('S-KEY-2'), poolKey('S-KEY-3')]);
  responder = (_, raw, key) => (key === 'S-KEY-3' ? { status: 200, body: okBody() } : { status: 429, body: messageOnlyDailyBody });

  const started = Date.now();
  const r1 = await callGenerate();
  const r2 = await callGenerate();
  const r3 = await callGenerate();
  const elapsed = Date.now() - started;

  check('key 1 spent -> key 2 spent -> key 3 serves the batch', () => {
    assert.deepEqual(seen.slice(0, 3).map((s) => s.key), ['S-KEY-1', 'S-KEY-2', 'S-KEY-3']);
    assert.equal(r1.body.usedKey.position, 3);
    assert.equal(r1.body.results[0].ok, true);
  });
  check('both spent keys are remembered for the day', () => {
    const spent = [0, 1].every((i) =>
      updates.some((x) => x.update.$set?.[`encryptedApiKeys.${i}.exhaustedDayKey`] === todayKey())
    );
    assert.ok(spent, 'a spent key was not flagged');
  });
  check('later batches go straight to key 3 — no wasted requests on 1 or 2', () => {
    assert.deepEqual(seen.slice(3, 4).map((s) => s.key), ['S-KEY-3']);
    assert.deepEqual(seen.slice(4).map((s) => s.key), ['S-KEY-3']);
    assert.equal(r2.body.usedKey.position, 3);
    assert.equal(r3.body.usedKey.position, 3);
  });
  check('the whole three-batch run is quick (no per-key retry storms)', () => {
    assert.ok(elapsed < 3000, `took ${elapsed}ms`);
  });
}

// ---- 10. 429 body classification (day vs minute, limit learning) ------------
{
  const daily = parseQuotaFailure(messageOnlyDailyBody, 429);
  check('message-only body with limit 250 reads as a spent daily quota', () => {
    assert.equal(daily.exhaustedDaily, true);
    assert.equal(daily.limit, 250);
    assert.match(daily.metric, /_requests$/);
  });

  const minute = parseQuotaFailure(messageOnlyMinuteBody, 429);
  check('message-only body with limit 10 stays a per-minute limit', () => {
    assert.equal(minute.exhaustedDaily, false);
    assert.equal(minute.limit, 10);
  });

  const both = parseQuotaFailure(messageOnlyBothBody, 429);
  check('a body listing token + day + minute limits learns the daily request limit', () => {
    assert.equal(both.exhaustedDaily, true);
    assert.equal(both.limit, 250);
  });

  const detailed = parseQuotaFailure(dailyQuotaBody, 429);
  check('the detailed (quotaId) shape still works', () => {
    assert.equal(detailed.exhaustedDaily, true);
    assert.equal(detailed.limit, 250);
  });

  const mistral = parseQuotaFailure(JSON.stringify({ message: 'Rate limit exceeded' }), 429);
  check('providers without quota details are not treated as daily-spent', () => {
    assert.equal(mistral.exhaustedDaily, false);
    assert.equal(mistral.limit, 0);
  });

  const serverError = parseQuotaFailure('{"error":{"message":"internal"}}', 500);
  check('a 5xx body is not a quota failure at all', () => {
    assert.equal(serverError.exhaustedDaily, false);
    assert.equal(serverError.status, 500);
  });
}

server.close();
}
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);