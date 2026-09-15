import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { PROVIDERS, PROVIDER_IDS, ALL_KEY_FIELDS } from '../utils/providers.js';
import { apiKeysMap, secondsUntilReset, todayKey } from '../utils/keyUsage.js';
import { randomUUID } from 'crypto';

// Since keys are encrypted with a random IV each time, we can't compare
// ciphertexts — decrypt each pool entry and compare the plaintext to dedupe.
// A corrupt entry never crashes a request; it just doesn't count as a match.
function keyInPool(pool, plaintext) {
  return pool.some((k) => {
    try {
      return k?.encrypted && decrypt(k.encrypted) === plaintext;
    } catch {
      return false;
    }
  });
}

// apiKeysMap (how many keys each provider has + their live usage stats) lives in
// utils/keyUsage.js so the auth and generate controllers report the same shape.

// One-time migration: keys saved under the old single-field system live in
// encryptedXxxKey — invisible to the pool UI and unused by rotation once a
// pool exists. Pull every legacy key into its pool so ALL saved keys show in
// the list and participate in auto-switching. Mutates `user`, returns the DB
// patch to persist (or null when there is nothing to migrate).
export function migrateLegacyKeys(user) {
  const patch = {};
  for (const id of PROVIDER_IDS) {
    const p = PROVIDERS[id];
    if (!user[p.keyField]) continue;
    const pool = user[p.poolField] || [];
    if (!keyInPool(pool, user[p.keyField])) {
      pool.push({ id: randomUUID(), encrypted: user[p.keyField] });
      user[p.poolField] = pool;
      patch[p.poolField] = pool;
    }
    user[p.keyField] = null; // the key now lives in the pool
    patch[p.keyField] = null;
  }
  return Object.keys(patch).length ? patch : null;
}

export async function getMe(req, res) {
  try {
    await connectDB();
    const user = await User.findById(req.userId).select(`email ${ALL_KEY_FIELDS.join(' ')}`);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    // Move any legacy single key into its pool so every saved key shows in
    // the list and is used by rotation.
    const patch = migrateLegacyKeys(user);
    if (patch) await User.findByIdAndUpdate(req.userId, patch);

    // The `model` query param lets the client get limits for the model it has
    // selected (daily quotas differ per model).
    const model = typeof req.query?.model === 'string' ? req.query.model : '';
    return res.status(200).json({
      email: user.email,
      apiKeys: apiKeysMap(user, model),
      dayKey: todayKey(),
      secondsUntilReset: secondsUntilReset(),
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Lightweight poll target for the Settings panel: same apiKeys shape as
// /user/me, but it also carries the in-flight flags that make the key dots blink
// while a generation request is on the wire.
export async function getKeyStats(req, res) {
  try {
    await connectDB();
    const user = await User.findById(req.userId).select(`email ${ALL_KEY_FIELDS.join(' ')}`);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const patch = migrateLegacyKeys(user);
    if (patch) await User.findByIdAndUpdate(req.userId, patch);

    const model = typeof req.query?.model === 'string' ? req.query.model : '';
    return res.status(200).json({
      apiKeys: apiKeysMap(user, model),
      dayKey: todayKey(),
      secondsUntilReset: secondsUntilReset(),
    });
  } catch (err) {
    console.error('getKeyStats error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}

export async function saveApiKey(req, res) {
  try {
    const { provider = 'gemini', apiKey } = req.body || {};
    const p = PROVIDERS[provider];
    if (!p) {
      return res.status(400).json({ error: 'Unknown provider.' });
    }
    if (!apiKey || apiKey.trim().length < 10) {
      return res.status(400).json({ error: 'Enter a valid API key.' });
    }
    const plaintext = apiKey.trim();

    await connectDB();
    const user = await User.findById(req.userId).select(ALL_KEY_FIELDS.join(' '));
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    // Pull any legacy single key into the pool first so nothing gets lost.
    const migratePatch = migrateLegacyKeys(user);
    if (migratePatch) await User.findByIdAndUpdate(req.userId, migratePatch);

    const pool = user[p.poolField] || [];
    if (keyInPool(pool, plaintext)) {
      return res.status(400).json({ error: 'This API key is already saved.', apiKeys: apiKeysMap(user) });
    }
    pool.push({ id: randomUUID(), encrypted: encrypt(plaintext) });

    await User.findByIdAndUpdate(req.userId, { [p.poolField]: pool });
    user[p.poolField] = pool;
    return res.status(200).json({ apiKeys: apiKeysMap(user) });
  } catch (err) {
    console.error('saveApiKey error:', err);
    return res.status(500).json({ error: 'Something went wrong saving the key.' });
  }
}

export async function removeApiKey(req, res) {
  try {
    const { provider = 'gemini', keyId } = req.body || {};
    const p = PROVIDERS[provider];
    if (!p) {
      return res.status(400).json({ error: 'Unknown provider.' });
    }

    await connectDB();
    const user = await User.findById(req.userId).select(ALL_KEY_FIELDS.join(' '));
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const pool = user[p.poolField] || [];
    let next = [];
    if (!keyId) {
      // No specific key id: remove every key for this provider (incl. legacy).
      await User.findByIdAndUpdate(req.userId, { [p.poolField]: [], [p.keyField]: null });
      return res.status(200).json({ apiKeys: apiKeysMap({ ...user, [p.poolField]: [], [p.keyField]: null }) });
    }
    next = pool.filter((k) => k?.id !== keyId);
    if (next.length === pool.length) {
      return res.status(400).json({ error: 'Key not found.' });
    }

    await User.findByIdAndUpdate(req.userId, { [p.poolField]: next });
    return res.status(200).json({ apiKeys: apiKeysMap({ ...user, [p.poolField]: next }) });
  } catch (err) {
    console.error('removeApiKey error:', err);
    return res.status(500).json({ error: 'Something went wrong removing the key.' });
  }
}
