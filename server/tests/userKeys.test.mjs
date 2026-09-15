// Temporary smoke test for the user/key routes: drives the real handlers with a
// stubbed User model (no MongoDB) and checks the JSON the client consumes.
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'b'.repeat(64);
global._mongooseCache = { conn: { ok: true }, promise: Promise.resolve({ ok: true }) };

const { encrypt } = await import('../utils/crypto.js');
const { todayKey } = await import('../utils/keyUsage.js');
const User = (await import('../models/User.js')).default;

let user = {
  email: 'me@example.com',
  encryptedApiKey: null,
  encryptedApiKeys: [
    { id: 'k1', encrypted: encrypt('AIza-KEY-ONE-LONG'), uses: 7, dayKey: todayKey(), total: 40, failures: 0, limit: 250, limitModel: 'gemini-2.5-flash', exhaustedDayKey: '' },
    { id: 'k2', encrypted: encrypt('AIza-KEY-TWO-LONG'), uses: 3, dayKey: '2000-01-01', total: 3, failures: 2, limit: 0, limitModel: '', exhaustedDayKey: '' },
  ],
  encryptedMistralKey: null,
  encryptedMistralKeys: [],
  encryptedOpenrouterKey: null,
  encryptedOpenrouterKeys: [],
};

const writes = [];
User.findById = () => ({ select: async () => user });
User.findByIdAndUpdate = async (_id, patch) => { writes.push(patch); Object.assign(user, patch); return user; };

const { getMe, getKeyStats, saveApiKey, removeApiKey } = await import('../controllers/userController.js');

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    handler(req, res);
  });
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

// ---- getMe -----------------------------------------------------------------
{
  const out = await call(getMe, { userId: 'u1' });
  check('getMe returns per-key stats + reset countdown', () => {
    assert.equal(out.code, 200);
    assert.equal(out.body.email, 'me@example.com');
    const keys = out.body.apiKeys.gemini.keys;
    assert.equal(keys.length, 2);
    assert.equal(keys[0].uses, 7);
    assert.equal(keys[0].limit, 250);
    assert.equal(keys[0].limitSource, 'learned');
    assert.equal(keys[0].exhausted, false);
    // Uses belong to a *Pacific-day* bucket: a stale dayKey reads as 0.
    assert.equal(keys[1].uses, 0);
    assert.equal(keys[1].failures, 2);
    assert.equal(keys[1].limitSource, 'estimated');
    assert.equal(out.body.dayKey, todayKey());
    assert.ok(out.body.secondsUntilReset > 0 && out.body.secondsUntilReset <= 86400);
  });
}

// ---- getKeyStats -----------------------------------------------------------
{
  const out = await call(getKeyStats, { userId: 'u1', query: { model: 'gemini-2.5-pro' } });
  check('getKeyStats honours the model query param (limits differ per model)', () => {
    assert.equal(out.code, 200);
    const keys = out.body.apiKeys.gemini.keys;
    // key 1 learned its limit on 2.5-flash, so 2.5-pro falls back to the estimate
    assert.equal(keys[0].limit, 100);
    assert.equal(keys[0].limitSource, 'estimated');
  });
}

// ---- saveApiKey ------------------------------------------------------------
{
  writes.length = 0;
  const out = await call(saveApiKey, { userId: 'u1', body: { provider: 'gemini', apiKey: 'AIza-THIRD-KEY-LONG' } });
  check('saveApiKey adds a third key to the pool', () => {
    assert.equal(out.code, 200);
    assert.equal(out.body.apiKeys.gemini.count, 3);
    assert.equal(user.encryptedApiKeys.length, 3);
    assert.equal(writes.length, 1);
  });

  const dup = await call(saveApiKey, { userId: 'u1', body: { provider: 'gemini', apiKey: 'AIza-KEY-ONE-LONG' } });
  check('saveApiKey rejects a duplicate key', () => {
    assert.equal(dup.code, 400);
    assert.match(dup.body.error, /already saved/);
  });

  const bad = await call(saveApiKey, { userId: 'u1', body: { provider: 'gemini', apiKey: 'short' } });
  check('saveApiKey rejects a too-short key', () => {
    assert.equal(bad.code, 400);
    assert.match(bad.body.error, /valid API key/);
  });

  const unknown = await call(saveApiKey, { userId: 'u1', body: { provider: 'nope', apiKey: 'AIza-1234567890' } });
  check('saveApiKey rejects an unknown provider', () => {
    assert.equal(unknown.code, 400);
  });
}

// ---- removeApiKey ----------------------------------------------------------
{
  const out = await call(removeApiKey, { userId: 'u1', body: { provider: 'gemini', keyId: 'k2' } });
  check('removeApiKey removes just that key', () => {
    assert.equal(out.code, 200);
    assert.equal(out.body.apiKeys.gemini.count, 2);
    assert.equal(out.body.apiKeys.gemini.ids.includes('k2'), false);
  });

  const missing = await call(removeApiKey, { userId: 'u1', body: { provider: 'gemini', keyId: 'ghost' } });
  check('removeApiKey 400s for an unknown key id', () => {
    assert.equal(missing.code, 400);
    assert.match(missing.body.error, /not found/);
  });

  const all = await call(removeApiKey, { userId: 'u1', body: { provider: 'gemini' } });
  check('removeApiKey without an id clears the provider pool', () => {
    assert.equal(all.code, 200);
    assert.equal(all.body.apiKeys.gemini.count, 0);
  });
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);