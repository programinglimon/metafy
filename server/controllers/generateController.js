import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { decrypt } from '../utils/crypto.js';
import { buildBatchPrompt, ICON_OPTIMAL_KW_COUNT } from '../utils/prompt.js';
import { CATEGORIES } from '../utils/categories.js';
import { PROVIDERS, ALL_KEY_FIELDS } from '../utils/providers.js';
import {
  apiKeysMap,
  beginUse,
  endUse,
  parseQuotaFailure,
  recordUse,
  secondsUntilReset,
  todayKey,
} from '../utils/keyUsage.js';

// Max images per request. Billing/limits are per request, not per image, so
// batching stretches every provider's daily quota. 6 is the quality sweet
// spot; raise via GEMINI_BATCH_SIZE (1-10) if needed.
const MAX_BATCH = Math.max(1, Math.min(10, Number(process.env.GEMINI_BATCH_SIZE) || 6));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fire one request at the provider and return everything the caller needs: the
// response, its body text (already read) and any quota information on it.
//
// Transient failures (429 rate limit, 5xx) are retried with exponential backoff
// so a momentary per-minute limit bump doesn't fail the whole batch. A *daily*
// quota error is never retried — waiting doesn't refill it, so the caller
// rotates to the next saved key right away.
async function fetchWithRetry(url, init, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      // no body
    }
    const quota = parseQuotaFailure(bodyText, res.status);
    last = { res, bodyText, quota };

    if (res.ok) return last;
    if (!(res.status === 429 || res.status >= 500)) return last;
    if (quota.exhaustedDaily) return last; // spent for the day → let the caller rotate
    if (i === attempts - 1) break;

    const retryAfter = Number(res.headers.get('Retry-After'));
    const base = 2000 * Math.pow(2, i); // 2s, 4s
    const delay = retryAfter > 0 ? Math.max(retryAfter * 1000, base) : Math.min(base, 16000);
    console.log(`[ai] ${res.status} — retrying in ${Math.round(delay / 1000)}s (attempt ${i + 1}/${attempts})`);
    await sleep(delay);
  }
  return last;
}

// Extract a human-readable message from any provider's OpenAI-compatible error
// body. Shapes differ between Gemini (native + openai-compat), Mistral and
// OpenRouter, so try several layouts.
export function extractErrorText(errJson) {
  if (!errJson || typeof errJson !== 'object') return '';
  const e = errJson.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    // Prioritise detailed messages over generic ones.
    const candidates = [];
    if (e.details && Array.isArray(e.details)) {
      for (const d of e.details) {
        if (typeof d === 'string' && d) candidates.push(d);
        if (d && typeof d === 'object' && typeof d.message === 'string' && d.message) candidates.push(d.message);
      }
    }
    if (typeof e.message === 'string' && e.message) candidates.push(e.message);
    if (typeof e.status === 'string' && e.status) candidates.push(`status=${e.status}`);
    if (typeof e.code !== 'undefined' && e.code !== null) candidates.push(`code=${e.code}`);
    return candidates.join('; ');
  }
  if (typeof errJson.message === 'string' && errJson.message) return errJson.message;
  if (typeof errJson.status === 'string' && errJson.status) return errJson.status;
  return JSON.stringify(errJson);
}

// Build the error text the user sees, including Retry-After / reset context for
// 429 rate limits, and returns the full raw body for the server log.
// The caller often already read the body (fetchWithRetry does), so accept it and
// only fall back to reading the stream when it wasn't passed in.
export async function describeAiError(providerLabel, res, rawBody = null) {
  if (rawBody === null) {
    rawBody = '';
    try {
      rawBody = await res.text();
    } catch {
      // no body
    }
  }

  let errJson = null;
  try {
    errJson = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // not JSON
  }

  const optional = providerLabel && !rawBody.includes(providerLabel) ? `${providerLabel}: ` : '';
  let message = `${optional}AI request failed (${res.status}).`;
  const extracted = extractErrorText(errJson);
  if (extracted) message = extracted;

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const hints = [];
    if (retryAfter > 0 && Number.isFinite(retryAfter)) hints.push(`retry in ~${Math.ceil(retryAfter)}s`);
    // RPD quotas reset at midnight Pacific = ~13:00 +06 (Bangladesh).
    hints.push('daily quota resets midnight PT (~noon BDT)');
    message += ` — ${hints.join(', ')}`;
  }

  return { message, rawBody: rawBody.slice(0, 2000) };
}

function cleanResult(raw, assetType = 'photo') {
  // Icon mode: title capped at 200 chars (aim for ~70 via the prompt),
  // keywords capped at the research-proven 35 sweet spot for icon ranking.
  const titleMax = 200;
  const kwMax = assetType === 'icon' ? ICON_OPTIMAL_KW_COUNT : 60;
  const title = String(raw?.title ?? '').trim().slice(0, titleMax);
  const keywords = Array.isArray(raw?.keywords)
    ? raw.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, kwMax)
    : [];
  if (!title || !keywords.length) return null;
  const category = CATEGORIES.some(([n]) => n === Number(raw.category)) ? Number(raw.category) : 13;
  return { title, keywords, category };
}

// Tolerant JSON extraction: some providers wrap the JSON in ``` fences or add
// commentary despite being told not to.
function extractJsonArray(text) {
  const t = String(text || '').trim();
  const unFenced = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  for (const s of [t, unFenced]) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
    } catch {
      // keep trying
    }
  }
  return null;
}

// Build an OpenAI-compatible chat completion request for the given provider.
// Gemini, Mistral and OpenRouter all speak this shape.
function buildChatBody(provider, { model, images, kwCount, titleMin, titleMax, assetType = 'photo' }) {
  const prompt = buildBatchPrompt({ count: images.length, kwCount, titleMin, titleMax, assetType });
  const dataUrl = (img) => `data:${img.mimeType};base64,${img.imageBase64}`;
  const content = [
    { type: 'text', text: prompt },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: provider.imageUrlObject ? { url: dataUrl(img) } : dataUrl(img),
    })),
  ];
  return {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.4,
    max_tokens: 12288, // 6 images x (title + 45 keywords + category)
  };
}

// Every saved key for this provider, ordered the way generation should try them:
// keys with quota left first (in saved order), then keys that already ran out
// today as a last resort. That way a spent key never costs a wasted request
// before the healthy ones get a chance, but it is still used if it's all we have
// (e.g. the learned limit was optimistic).
function generationKeys(user, provider, model) {
  const today = todayKey();
  const pool = Array.isArray(user[provider.poolField]) ? user[provider.poolField] : [];

  const list = pool
    .map((entry, index) => {
      const key = typeof entry?.toObject === 'function' ? entry.toObject() : entry || {};
      if (!key.encrypted) return null;
      const usedToday = (key.dayKey || '') === today ? Number(key.uses) || 0 : 0;
      const learnedLimit = Number(key.limit) || 0;
      const spentForToday =
        (key.exhaustedDayKey || '') === today ||
        (learnedLimit > 0 && (key.limitModel || model) === model && usedToday >= learnedLimit);
      return { id: key.id, enc: key.encrypted, index, exhausted: spentForToday };
    })
    .filter(Boolean);

  // Safety net for accounts not yet migrated: include the legacy single key too
  // (unless it duplicates one already in the pool).
  if (user[provider.keyField]) {
    try {
      const legacyPlain = decrypt(user[provider.keyField]);
      const dup = list.some((k) => {
        try { return decrypt(k.enc) === legacyPlain; } catch { return false; }
      });
      if (!dup) list.push({ id: 'legacy', enc: user[provider.keyField], index: null, exhausted: false });
    } catch {
      // corrupt legacy key — skip it
    }
  }

  return [...list.filter((k) => !k.exhausted), ...list.filter((k) => k.exhausted)];
}

export async function generate(req, res) {
  try {
    await connectDB();
    const { provider = 'gemini', model, titleMin, titleMax, assetType = 'photo', images, imageBase64, mimeType } = req.body || {};
    let { kwCount } = req.body || {};
    // Icon mode: always use the research-proven 35-keyword sweet spot for Adobe
    // Stock ranking, regardless of what the client sent. Filling all 50 slots
    // with lower-relevance terms dilutes the quality signal and reduces ranking.
    if (assetType === 'icon') kwCount = ICON_OPTIMAL_KW_COUNT;

    const p = PROVIDERS[provider] || PROVIDERS.gemini;

    const user = await User.findById(req.userId).select(`email ${p.keyField} ${p.poolField}`);
    if (!user) {
      return res.status(400).json({ error: 'Account not found.' });
    }

    const chosenModel = p.models.includes(model) ? model : p.defaultModel;

    // All saved keys, healthy ones first — generation walks this list and moves
    // to the next key automatically when one is rate limited or out of quota.
    const keys = generationKeys(user, p, chosenModel);
    if (!keys.length) {
      return res.status(400).json({ error: `Add your ${p.label} API key in settings first.` });
    }

    // Accept an array of images (batch), or backward-compat: one image.
    const batch = Array.isArray(images) && images.length
      ? images
      : imageBase64 ? [{ imageBase64, mimeType }] : [];

    if (!batch.length) {
      return res.status(400).json({ error: 'Missing image data.' });
    }
    if (batch.length > MAX_BATCH) {
      return res.status(400).json({
        error: `At most ${MAX_BATCH} images per request — raise server GEMINI_BATCH_SIZE env to increase.`,
      });
    }
    if (batch.some((img) => !img || !img.imageBase64 || !img.mimeType)) {
      return res.status(400).json({ error: 'Each image needs base64 data and a mime type.' });
    }

    const body = buildChatBody(p, { model: chosenModel, images: batch, kwCount, titleMin, titleMax, assetType });

    // Try each saved key in order. A rate-limited or out-of-quota key rotates to
    // the next one automatically; the client only sees an error once every key
    // has been tried. Every attempt is recorded against that key so Settings can
    // show live usage, and the key is flagged "in flight" while it's on the wire
    // (that's what makes its status dot blink).
    let lastError = '';
    const keysTried = [];

    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[ki];

      let apiKey;
      try {
        apiKey = decrypt(key.enc);
      } catch {
        lastError = `Key ${ki + 1}/${keys.length} could not be decrypted.`;
        keysTried.push({ position: ki + 1, id: key.id, status: 0, error: lastError });
        continue;
      }

      beginUse(key.id);
      let out;
      try {
        out = await fetchWithRetry(p.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        endUse(key.id, 'network-error');
        lastError = `Key ${ki + 1}/${keys.length}: ${err.message}`;
        console.error(`[ai] ${p.label} key ${ki + 1}/${keys.length} network error:`, err.message);
        await recordUse({
          userId: req.userId, poolField: p.poolField, index: key.index, ok: false,
          error: lastError, model: chosenModel,
        });
        keysTried.push({ position: ki + 1, id: key.id, status: 0, error: lastError });
        continue;
      }
      endUse(key.id, out.res.ok ? 'ok' : `http-${out.res.status}`);

      if (!out.res.ok) {
        const { message } = describeAiError(p.label, out.res, out.bodyText);
        const spent = out.quota.exhaustedDaily;
        lastError = message;
        console.error(
          `[ai] ${p.label} key ${ki + 1}/${keys.length} error ${out.res.status}:`,
          out.bodyText.slice(0, 2000) || '(no body)'
        );
        await recordUse({
          userId: req.userId, poolField: p.poolField, index: key.index, ok: false,
          error: message, limit: out.quota.limit, exhausted: spent, model: chosenModel,
        });
        keysTried.push({ position: ki + 1, id: key.id, status: out.res.status, error: message, exhausted: spent });
        if (ki < keys.length - 1) {
          console.log(
            `[ai] ${p.label}: rotating to next key (${keys.length - ki - 1} left, ${spent ? 'daily quota spent' : `http-${out.res.status}`})`
          );
        }
        continue; // try the next saved key
      }

      let data = null;
      try {
        data = JSON.parse(out.bodyText);
      } catch {
        data = null;
      }
      const text =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.message?.text ||
        (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');

      // The request went through, so it counts against this key's daily quota —
      // record it before anything else can bail out.
      await recordUse({
        userId: req.userId, poolField: p.poolField, index: key.index, ok: true, model: chosenModel,
      });

      // Re-read the key pool so the client gets the just-updated counters.
      const fresh = await User.findById(req.userId).select(`email ${ALL_KEY_FIELDS.join(' ')}`);
      const usedKey = { position: ki + 1, id: key.id, of: keys.length, model: chosenModel };

      const list = extractJsonArray(text);
      if (!list) {
        return res.status(502).json({
          error: 'Model response was not a JSON array.',
          usedKey, keysTried,
          apiKeys: apiKeysMap(fresh || user, chosenModel),
          secondsUntilReset: secondsUntilReset(),
        });
      }

      // Align results back to the input order; missing ones become per-image errors
      // so the client can retry just those instead of the whole batch.
      const results = batch.map((img, i) => {
        const r = cleanResult(list[i], assetType);
        return r ? { ok: true, ...r } : { ok: false, error: 'Model returned no valid metadata for this image.' };
      });

      return res.status(200).json({
        results,
        usedKey,
        keysTried,
        apiKeys: apiKeysMap(fresh || user, chosenModel),
        secondsUntilReset: secondsUntilReset(),
      });
    }

    // All saved keys failed.
    const fresh = await User.findById(req.userId).select(`email ${ALL_KEY_FIELDS.join(' ')}`);
    return res.status(502).json({
      error: `All ${keys.length} ${p.label} keys failed. Last error: ${lastError || 'unknown'}`,
      keysTried,
      apiKeys: apiKeysMap(fresh || user, chosenModel),
      secondsUntilReset: secondsUntilReset(),
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
