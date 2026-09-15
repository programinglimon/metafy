// Mirrors server/utils/providers.js — keep in sync when adding providers.
// The image format details only matter server-side; here we only need what the
// settings UI shows and what the generate call routes on.

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    keyHint: 'aistudio.google.com/apikey',
    freeNote: 'Free tier is limited per project — check aistudio.google.com/rate-limit',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.5-flash',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    keyHint: 'console.mistral.ai/api-keys',
    freeNote: 'Freemium tier with generous limits',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409'],
    defaultModel: 'mistral-small-latest',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyHint: 'openrouter.ai/keys',
    freeNote: 'Free vision models (low daily limits) — good as a backup',
    models: [
      'google/gemini-2.5-flash:free',
      'mistralai/pixtral-12b:free',
      'meta-llama/llama-3.2-11b-vision-instruct:free',
    ],
    defaultModel: 'google/gemini-2.5-flash:free',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

// True when the user has at least one key saved for any provider.
export function hasAnyKey(apiKeys) {
  return !!(apiKeys && Object.values(apiKeys).some((v) => v && v.count > 0));
}

// apiKeys[providerId] is `{ count, ids, keys }` where `keys` holds the live
// per-key stats (usage, limit, in-flight). Always returns that array — call it
// instead of indexing [providerId] directly, which is an object, not a list.
export function providerKeysOf(apiKeys, providerId) {
  const entry = apiKeys?.[providerId];
  const keys = Array.isArray(entry) ? entry : entry?.keys;
  return Array.isArray(keys) ? keys : [];
}