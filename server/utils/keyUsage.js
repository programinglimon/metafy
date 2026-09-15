// Per-API-key quota tracking + a live "which key is being used right now"
// registry that the settings UI polls.
//
// Why we count requests ourselves: none of the supported providers (Gemini,
// Mistral, OpenRouter) expose a "requests left today" endpoint for their
// OpenAI-compatible APIs, and Gemini applies its limits per *project*, not per
// key. So the truthful number we can show is how many requests this app sent
// with each key today, plus the exact daily limit learned from a provider's
// 429 quota payload (Gemini reports it as `quotaValue`, e.g. 250) — falling
// back to a configurable estimate. Daily quotas reset at midnight Pacific time.

import User from '../models/User.js';
import { PROVIDERS, PROVIDER_IDS } from './providers.js';

const PT_TIMEZONE = 'America/Los_Angeles';

// ---------------------------------------------------------------------------
// Day boundaries (Pacific time — when provider daily quotas reset)
// ---------------------------------------------------------------------------
const ptDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const ptClockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: PT_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// "2026-09-15" in Pacific time — the bucket the daily counters belong to.
export function todayKey(date = new Date()) {
  return ptDayFmt.format(date);
}

// Seconds until the next Pacific midnight (i.e. until the quota resets),
// derived from the current Pacific wall clock so it survives DST changes.
export function secondsUntilReset(date = new Date()) {
  const [h, m, s] = ptClockFmt.format(date).split(':').map(Number);
  const elapsed = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  return Math.max(0, 86400 - elapsed);
}

// ---------------------------------------------------------------------------
// Daily request limits
// ---------------------------------------------------------------------------
// Google's free-tier RPD numbers change often and differ per model/tier — see
// aistudio.google.com/rate-limit for your project's real value. These are only
// *estimates* used to draw the progress bar until a 429 teaches us the exact
// limit. Override per model or per provider in .env:
//   RPD_GEMINI_2_5_FLASH=1000   (model-specific)
//   RPD_GEMINI=1000             (every Gemini model)
const DEFAULT_RPD = {
  gemini: {
    'gemini-2.5-flash': 250,
    'gemini-2.5-pro': 100,
  },
  mistral: {}, // free tier is rate-limited per minute, not per day
  openrouter: {
    'google/gemini-2.5-flash:free': 50,
    'mistralai/pixtral-12b:free': 50,
    'meta-llama/llama-3.2-11b-vision-instruct:free': 50,
  },
};

function slug(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function envNumber(name) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Best guess of a key's daily request allowance for a model (0 = unknown; the
// UI then shows the raw count without a percentage).
export function estimatedDailyLimit(providerId, model) {
  return (
    envNumber(`RPD_${slug(model)}`) ||
    envNumber(`RPD_${slug(providerId)}`) ||
    DEFAULT_RPD[providerId]?.[model] ||
    0
  );
}

// ---------------------------------------------------------------------------
// Quota errors
// ---------------------------------------------------------------------------
// Gemini (native and OpenAI-compat) reports quota failures as
//   error.details[].violations[] = { quotaId, quotaMetric, quotaValue }
// where quotaId contains "PerDay"/"PerMinute" and quotaValue is the real limit.
// Mistral/OpenRouter just say "rate limit exceeded" — a per-minute limit, so we
// keep the key and retry instead of marking it spent for the day.
export function parseQuotaFailure(bodyText, status = 429) {
  const text = String(bodyText || '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  const out = { limit: 0, quotaId: '', metric: '', exhaustedDaily: false, status };

  const details = json?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (!Array.isArray(d?.violations)) continue;
      for (const v of d.violations) {
        const quotaId = String(v?.quotaId || '');
        const metric = String(v?.quotaMetric || '');
        const value = Number(v?.quotaValue);
        if (Number.isFinite(value) && value > 0) out.limit = Math.max(out.limit, Math.floor(value));
        if (/per[_ ]?day/i.test(`${quotaId} ${metric}`)) out.exhaustedDaily = true;
        if (!out.quotaId) out.quotaId = quotaId;
        if (!out.metric) out.metric = metric;
      }
    }
  }

  const message = String(json?.error?.message || json?.message || text);
  if (!out.limit) {
    const m = message.match(/limit[:=\s"]+(\d{2,})/i);
    if (m) out.limit = Number(m[1]);
  }
  if (/per[_ ]?day|daily/i.test(`${out.quotaId} ${out.metric}`)) out.exhaustedDaily = true;
  if (!out.exhaustedDaily && /(per day|daily limit|RPD)/i.test(message)) out.exhaustedDaily = true;

  return out;
}

// ---------------------------------------------------------------------------
// Live registry: what is being requested right this second (in-memory only)
// ---------------------------------------------------------------------------
const LIVE = new Map(); // keyId -> { inFlight, startedAt, lastStatus }
const LIVE_STALE_MS = 5 * 60 * 1000; // a hung request must not blink forever

export function beginUse(keyId) {
  if (!keyId) return;
  const cur = LIVE.get(keyId) || { inFlight: 0, startedAt: 0, lastStatus: '' };
  cur.inFlight += 1;
  cur.startedAt = Date.now();
  LIVE.set(keyId, cur);
}

export function endUse(keyId, status = '') {
  if (!keyId) return;
  const cur = LIVE.get(keyId);
  if (!cur) return;
  cur.inFlight = Math.max(0, cur.inFlight - 1);
  cur.lastStatus = status;
  LIVE.set(keyId, cur);
}

export function liveFor(keyId) {
  const cur = LIVE.get(keyId);
  if (!cur) return { inFlight: 0, lastStatus: '' };
  if (cur.inFlight > 0 && Date.now() - cur.startedAt > LIVE_STALE_MS) cur.inFlight = 0;
  return { inFlight: cur.inFlight, lastStatus: cur.lastStatus };
}

// ---------------------------------------------------------------------------
// Persisting usage counters
// ---------------------------------------------------------------------------
// Records one attempt against one pool key. `uses` counts requests the provider
// accepted today, `failures` counts rejected attempts, `total` is the all-time
// accepted count. The first request of a Pacific day resets `uses`; it is
// matched on `dayKey` so parallel batches can't clobber each other.
export async function recordUse({
  userId,
  poolField,
  index,
  ok,
  error = '',
  limit = 0,
  exhausted = false,
  model = '',
}) {
  // Legacy single keys aren't a pool slot, so they're live-only.
  if (!userId || !poolField || index === null || index === undefined || index < 0) return;

  const today = todayKey();
  const base = `${poolField}.${index}`;
  const now = new Date();

  const set = { [`${base}.lastUsedAt`]: now };
  if (ok) set[`${base}.exhaustedDayKey`] = ''; // a success disproves an earlier "spent" mark
  if (!ok && error) {
    set[`${base}.lastError`] = String(error).slice(0, 500);
    set[`${base}.lastErrorAt`] = now;
  }
  if (limit > 0) {
    set[`${base}.limit`] = limit; // the real limit, straight from the provider
    set[`${base}.limitModel`] = model || '';
  }
  if (exhausted) set[`${base}.exhaustedDayKey`] = today;

  const inc = ok
    ? { [`${base}.uses`]: 1, [`${base}.total`]: 1 }
    : { [`${base}.failures`]: 1 };

  try {
    // Still the same Pacific day: just bump the counters.
    const same = await User.updateOne(
      { _id: userId, [`${base}.dayKey`]: today },
      { $set: set, $inc: inc }
    );
    if (same.matchedCount) return;

    // First attempt of the day for this key: start today's counter from scratch
    // (a failure still has to be counted, hence the $inc in both branches).
    const resetInc = ok ? { [`${base}.total`]: 1 } : { [`${base}.failures`]: 1 };
    await User.updateOne(
      { _id: userId },
      {
        $set: { ...set, [`${base}.dayKey`]: today, [`${base}.uses`]: ok ? 1 : 0 },
        $inc: resetInc,
      }
    );
  } catch (err) {
    console.error('recordUse error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Stats for the UI
// ---------------------------------------------------------------------------
// Normalised view of one key: today's usage (0 after a Pacific-day rollover),
// its limit and where that number came from, whether it is spent for today, and
// whether a request is in flight right now (drives the blinking dot in
// Settings). `exhausted` is also true once the learned limit is reached, even
// before the provider has answered with a 429.
function keyRow(providerId, activeModel, key, index, legacy) {
  const today = todayKey();
  const live = liveFor(key.id);
  const sameDay = (key.dayKey || '') === today;
  const uses = sameDay ? Number(key.uses) || 0 : 0;
  const learned = Number(key.limit) || 0;
  const learnedForModel = !key.limitModel || key.limitModel === activeModel;
  const estimate = estimatedDailyLimit(providerId, activeModel);
  const limit = learned && learnedForModel ? learned : estimate;

  return {
    id: key.id || `key-${index ?? 'legacy'}`,
    index: index ?? null,
    legacy: !!legacy,
    model: (learnedForModel && key.limitModel) || activeModel,
    uses,
    limit,
    limitSource: learned && learnedForModel ? 'learned' : estimate ? 'estimated' : 'none',
    total: Number(key.total) || 0,
    failures: Number(key.failures) || 0,
    exhausted:
      (key.exhaustedDayKey || '') === today || (limit > 0 && learned > 0 && uses >= limit),
    inFlight: live.inFlight,
    lastStatus: live.lastStatus,
    lastUsedAt: key.lastUsedAt || null,
    lastError: key.lastError || '',
    lastErrorAt: key.lastErrorAt || null,
  };
}

// Every saved key for a provider, in the order generation tries them.
export function keyStatsFor(user, providerId, model) {
  const p = PROVIDERS[providerId];
  if (!p) return [];
  const activeModel = model || p.defaultModel;
  const pool = Array.isArray(user?.[p.poolField]) ? user[p.poolField] : [];

  const rows = pool.map((entry, index) => {
    const key = typeof entry?.toObject === 'function' ? entry.toObject() : entry || {};
    return keyRow(providerId, activeModel, key, index, false);
  });

  // Legacy single key (pre-pool accounts) — only shown when nothing is pooled.
  if (user?.[p.keyField] && !pool.length) {
    rows.push(keyRow(providerId, activeModel, { id: 'legacy' }, null, true));
  }

  return rows;
}

// The shape the client already uses, plus a `keys` array with the live stats.
export function apiKeysMap(user, model) {
  const out = {};
  for (const id of PROVIDER_IDS) {
    const keys = keyStatsFor(user, id, model);
    out[id] = { count: keys.length, ids: keys.map((k) => k.id), keys };
  }
  return out;
}
