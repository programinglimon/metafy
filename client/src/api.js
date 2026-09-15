const TOKEN_KEY = 'sheet_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Base URL for backend requests.
// - Local dev: leave VITE_API_URL empty in client/.env, and requests go to
//   `/api` (relative) which the Vite dev-server proxy (vite.config.js) forwards
//   to Express on http://localhost:5000.
// - Production (Vercel): set VITE_API_URL in Vercel's env vars to the Render
//   backend URL, e.g. https://your-api.onrender.com. It's baked in at build time.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

export const api = {
  signup: (email, password) => request('/auth/signup', { method: 'POST', body: { email, password }, auth: false }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/user/me'),
  saveApiKey: (provider, apiKey) => request('/user/api-key', { method: 'PUT', body: { provider, apiKey } }),
  removeApiKey: (provider, keyId) => request('/user/api-key', { method: 'DELETE', body: { provider, keyId } }),
  generate: (payload) => request('/generate', { method: 'POST', body: payload }),
  // Live per-key usage (used/limit today, which key is in flight). Polled while
  // generating so the Settings panel can blink the key that's being used.
  keyStats: (model) => request(`/user/key-stats${model ? `?model=${encodeURIComponent(model)}` : ''}`),
};
