// Central registry of AI providers supported by the app. Gemini, Mistral and
// OpenRouter all expose OpenAI-compatible Chat Completions endpoints, so the
// same request shape works everywhere — adding a provider is just a new entry
// here plus an encrypted key field on the User model.

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    keyField: 'encryptedApiKey',
    poolField: 'encryptedApiKeys',
    keyHint: 'aistudio.google.com/apikey',
    freeNote: 'Free tier is limited per project — check aistudio.google.com/rate-limit',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.5-flash',
    // OpenAI-style image_url object: { url: "data:..." }
    imageUrlObject: true,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    keyField: 'encryptedMistralKey',
    poolField: 'encryptedMistralKeys',
    keyHint: 'console.mistral.ai/api-keys',
    freeNote: 'Freemium tier with generous limits',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409'],
    defaultModel: 'mistral-small-latest',
    // Mistral takes image_url as a plain string data URL.
    imageUrlObject: false,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyField: 'encryptedOpenrouterKey',
    poolField: 'encryptedOpenrouterKeys',
    keyHint: 'openrouter.ai/keys',
    freeNote: 'Free vision models (low daily limits) — good as a backup',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      'google/gemini-2.5-flash:free',
      'mistralai/pixtral-12b:free',
      'meta-llama/llama-3.2-11b-vision-instruct:free',
    ],
    defaultModel: 'google/gemini-2.5-flash:free',
    imageUrlObject: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

// Maps a provider id to its (legacy) single key field on the User model.
export const PROVIDER_KEY_FIELDS = {
  gemini: 'encryptedApiKey',
  mistral: 'encryptedMistralKey',
  openrouter: 'encryptedOpenrouterKey',
};

// Maps a provider id to its key-pool array field (own documents with id+encrypted).
export const PROVIDER_POOL_FIELDS = {
  gemini: 'encryptedApiKeys',
  mistral: 'encryptedMistralKeys',
  openrouter: 'encryptedOpenrouterKeys',
};

// All key-related fields, for selects that need to read every saved key once.
export const ALL_KEY_FIELDS = [...Object.values(PROVIDER_KEY_FIELDS), ...Object.values(PROVIDER_POOL_FIELDS)];