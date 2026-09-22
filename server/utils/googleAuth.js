import { createPublicKey, verify } from 'node:crypto';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
function b64url(value) {
  return Buffer.from(value, 'base64url');
}
export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set on the server.');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token.');
  const [h, p, s] = parts;
  let header;
  try {
    header = JSON.parse(b64url(h).toString('utf8'));
  } catch {
    throw new Error('Invalid token.');
  }
  const certRes = await fetch(GOOGLE_CERTS_URL);
  if (!certRes.ok) throw new Error('Could not reach Google.');
  const { keys } = await certRes.json();
  const key = (keys || []).find((k) => k.kid === header.kid && (k.alg || 'RS256') === 'RS256');
  if (!key) throw new Error('No matching signing key.');
  const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
  const data = Buffer.from((h + '.' + p), 'utf8');
  if (!verify('sha256', data, publicKey, b64url(s))) throw new Error('Invalid signature.');
  let payload;
  try {
    payload = JSON.parse(b64url(p).toString('utf8'));
  } catch {
    throw new Error('Invalid token.');
  }
  if (payload.aud !== clientId) throw new Error('Wrong audience.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Wrong issuer.');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) throw new Error('Expired token.');
  if (!payload.email_verified) throw new Error('Email not verified.');
  const email = String(payload.email || '').toLowerCase();
  if (!(/^[^@]+@[^@]+[.][^@]+$/).test(email)) throw new Error('No email on account.');
  return { sub: payload.sub, email, name: String(payload.name || '') };
}
