// Rotation logic test: runs the real generate() handler against a local fake
// provider and a stubbed User model, so nothing touches MongoDB or the network.
//
// Covers: auto-switch key1 -> key2 on a spent daily quota, no wasted retry wait
// on a spent key, spent keys pushed to the back of the rotation, per-minute
// rate-limit retry, per-key usage recording and the response payload.
import http from 'node:http';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
global._mongooseCache = { conn: { ok: true }, promise: Promise.resolve({ ok: true }) };

const { encrypt } = await import('../utils/crypto.js');
const { todayKey } = await import('../utils/keyUsage.js');
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

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    seen.push({ key: (req.headers.authorization || '').replace('Bearer ', '') });
    const r = responder(seen.length, raw);
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

server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);