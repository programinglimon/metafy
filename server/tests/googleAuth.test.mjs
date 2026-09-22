// Google sign-in tests: verify id_token verification and the auth handler flow
// (create new account / link to existing email) using a locally generated RSA
// signing key and an in-memory User stub - no network, no MongoDB.
import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
global._mongooseCache = { conn: { ok: true }, promise: Promise.resolve({ ok: true }) };

const { verifyGoogleIdToken } = await import('../utils/googleAuth.js');
const { googleAuth } = await import('../controllers/authController.js');
const User = (await import('../models/User.js')).default;

// Pretend our generated RSA key is Google's signing key.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubJwk = publicKey.export({ format: 'jwk' });

global.fetch = async () => ({
  ok: true,
  json: async () => ({
    keys: [{ kty: 'RSA', kid: 'test-key', alg: 'RS256', n: pubJwk.n, e: pubJwk.e }],
  }),
});

function signedToken(overrides = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = enc({
    iss: 'accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: 'google-user-1',
    email: 'person@gmail.com',
    email_verified: true,
    name: 'Test Person',
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function callGoogle(body) {
  return new Promise((resolve) => {
    const res = {
      code: 0, body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    googleAuth({ body }, res);
  });
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (err) { failures += 1; console.log('FAIL  ' + name + ' - ' + err.message); }
}

// ---- verifyGoogleIdToken ----
{
  let err = null, out = null;
  try { out = await verifyGoogleIdToken(signedToken()); } catch (e) { err = e; }
  check('verifies a valid Google id_token', () => {
    assert.equal(err, null);
    assert.equal(out.email, 'person@gmail.com');
    assert.equal(out.sub, 'google-user-1');
  });

  let tamper = 'resolved';
  try { const t = signedToken(); const bad = t.slice(0, -4) + (t.endsWith('AAA') ? 'BBB' : 'AAA'); tamper = await verifyGoogleIdToken(bad); } catch { tamper = null; }
  check('rejects a tampered signature', () => assert.equal(tamper, null));

  let aud = 'resolved';
  try { aud = await verifyGoogleIdToken(signedToken({ aud: 'other-app' })); } catch { aud = null; }
  check('rejects a token for another audience', () => assert.equal(aud, null));

  let unverified = 'resolved';
  try { unverified = await verifyGoogleIdToken(signedToken({ email_verified: false })); } catch { unverified = null; }
  check('rejects an unverified email', () => assert.equal(unverified, null));
}

// ---- googleAuth handler: create + link ----
{
  const users = [];
  User.findOne = async (q) => users.find((u) => {
    if (q.googleId !== undefined && u.googleId !== q.googleId) return false;
    if (q.email !== undefined && u.email !== q.email) return false;
    return true;
  }) || null;
  User.create = async (data) => { const u = { ...data, _id: 'id-1' }; users.push(u); return u; };
  User.findByIdAndUpdate = async (id, patch) => { const u = users[0]; if (u) Object.assign(u, patch); return u; };

  const out = await callGoogle({ idToken: signedToken({ sub: 'g-create', email: 'new@gmail.com' }) });
  check('creates a new Google account (no password)', () => {
    assert.equal(out.code, 200);
    assert.equal(out.body.email, 'new@gmail.com');
    assert.ok(out.body.token);
    assert.equal(users.length, 1);
    assert.equal(users[0].googleId, 'g-create');
    assert.equal(users[0].passwordHash, null);
  });

  const existing = { _id: 'u1', email: 'link@gmail.com', passwordHash: 'hashed', googleId: null, saved: false, save: async function () { this.saved = true; } };
  const users2 = [existing];
  User.findOne = async (q) => users2.find((u) => {
    if (q.googleId !== undefined && u.googleId !== q.googleId) return false;
    if (q.email !== undefined && u.email !== q.email) return false;
    return true;
  }) || null;
  User.create = async () => { throw new Error('should not create'); };
  User.findByIdAndUpdate = async (id, patch) => { const u = users2[0]; if (u) Object.assign(u, patch); return u; };

  const out2 = await callGoogle({ idToken: signedToken({ sub: 'g-link', email: 'link@gmail.com' }) });
  check('links Google sign-in to an existing account by email', () => {
    assert.equal(out2.code, 200);
    assert.equal(existing.googleId, 'g-link');
    assert.equal(existing.saved, true);
  });
}

// ---- failure paths ----
const noToken = await callGoogle({ idToken: '' });
check('missing idToken -> 400', () => assert.equal(noToken.code, 400));

const badSig = await callGoogle({ idToken: signedToken({ aud: 'nope' }) });
check('bad idToken -> 401', () => assert.equal(badSig.code, 401));

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
