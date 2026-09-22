# Sheet — Adobe Stock Metadata Generator (MERN)

A multi-user MERN app that generates Adobe Stock metadata (title, keywords,
category) for a batch of images using the Gemini API, and exports a CSV
ready for Adobe Stock Contributor's bulk upload.

## Structure

```
client/     React + Vite frontend
server/
  server.js       the one file that builds the Express app, mounts all routes, and listens
  models/         Mongoose schemas
  routes/         Express routers
  controllers/    request handlers
  middleware/     auth middleware
  config/         MongoDB connection
  utils/          crypto, JWT, prompt building, category list
```

This project is split into two deployments:

- **Backend (Express)** → **Render** (`server/server.js`, started with `npm start`). Render does not
  run Vercel's serverless path, so `app.listen()` runs normally.
- **Frontend (React + Vite)** → **Vercel** (the `client/` folder, built with `npm run build`). In
  production the client calls the Render backend through the `VITE_API_URL` environment variable (see
  `client/.env.example` and `client/src/api.js`). In local dev `VITE_API_URL` is left empty and the
  Vite proxy (`client/vite.config.js`) forwards `/api/*` to Express on :5000.

- **Auth:** email + password, JWT, bcrypt password hashing
- Each user's Gemini API key is encrypted (AES-256-GCM) and stored on their
  account (MongoDB). It's only decrypted server-side, inside
  `generateController.js`, to call Gemini — it never goes back to the
  browser after saving.
- No generation history is stored — only the CSV is produced, on demand, in
  the browser from that session's results.

## 1. Create the two things you need first

**MongoDB Atlas** (free tier is enough)
1. Create a cluster at https://www.mongodb.com/atlas
2. Create a database user, and allow network access from anywhere (0.0.0.0/0).
3. Copy the connection string — this is `MONGODB_URI`.

**Two secrets**
```bash
# JWT_SECRET — any long random string
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ENCRYPTION_KEY — must be exactly 64 hex characters (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Run it locally

```bash
npm install                  # Express server dependencies (project root)
npm install --prefix client  # React frontend dependencies

cp .env.example .env         # fill in MONGODB_URI, JWT_SECRET, ENCRYPTION_KEY

npm run dev                  # runs the Express server (:5000) and Vite (:5173) together
```

Open http://localhost:5173 — the Vite dev server proxies `/api/*` straight
to Express on port 5000, so it behaves the same as production.

You can also run each side on its own:
```bash
npm run server   # just Express, on :5000
npm run client   # just Vite, on :5173
```

## 3. Deploy: backend on Render, frontend on Vercel

**Backend on Render**

1. Push this project to a GitHub repo.
2. Go to https://render.com → **New → Blueprint** and point it at the repo.
   Blueprint reads `render.yaml`, creates a web service with `npm start`. Or create
   a **New → Web Service** manually: Root Directory `.`, Build Command `npm install`,
   Start Command `npm start`.
3. In the service's **Environment** tab, add the three env vars from step 1:
   `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`.
4. Deploy. Note the URL Render gives you, e.g. `https://your-api.onrender.com`.
   Check it with `https://your-api.onrender.com/api/health`.

**Frontend on Vercel**

5. In Vercel → **Add New Project** → import the same repo.
6. Set **Root Directory** to `client` (it reads `client/vercel.json`, which builds
   the static site and adds the SPA rewrite to `index.html`).
7. In **Project Settings → Environment Variables**, add:
   `VITE_API_URL = https://your-api.onrender.com` (the Render URL from step 4).
   Rebuild/redeploy so it takes effect, since it's baked in at build time.
8. Deploy. Your app is live at `your-project.vercel.app` — sign up, save your
   Gemini key once, and it's ready to use any time from any device.

> The `api/` folder and root `vercel.json` were removed — the backend no longer
> runs as a Vercel serverless function; it runs as a persistent process on Render.

## 4. Using the app

1. Create an account (email + password).
2. In **Settings**, paste your Gemini API key (from
   https://aistudio.google.com/apikey) and save — it's encrypted and stored
   on your account, so you only do this once. Click **add another key** to save
   more keys for the same provider: they're pooled, your daily quota adds up
   (use keys from *separate* projects/accounts), and generation auto-switches to
   the next key when one runs out. Each key gets its own live usage bar, and the
   dot next to the key that is serving requests blinks while it works.
3. Drop in images, adjust keyword count / title length / model if you like,
   click **Generate all**.
4. Edit any title, keyword, or category inline if needed.
5. Click **Download CSV** — columns are `Filename, Title, Keywords,
   Category, Releases`, matching Adobe Stock Contributor's bulk CSV format.

## Notes and limits

- Images are resized client-side to a max dimension of 1280px (JPEG, quality
  0.85) before upload, both to keep Gemini calls fast/cheap and to stay under
  Vercel's ~4.5MB request body limit for serverless functions.
- **Generation is batched**: the client groups images into batches of 6
  (`BATCH_SIZE` in `Dashboard.jsx`) and sends each batch as **one** API
  request (`/api/generate` accepts an `images: []` array, batched on every
  provider). Because providers limit and bill per request — not per image — a
  free-tier key covers roughly 6x more images than images-per-request. To
  change the batch size, set the server env var `GEMINI_BATCH_SIZE` (1–10) and
  match the client constant.
- **Multiple providers**: users can save API keys for Google Gemini, Mistral
  AI and OpenRouter independently (Settings → Provider). All three are called
  through their OpenAI-compatible Chat Completions endpoints, so one request
  shape serves every provider. Add a new provider in `server/utils/providers.js`
  (and the mirrored `client/src/providers.js`) plus an encrypted key field on
  the User model. Each user's keys are stored per-provider, AES-256-GCM
  encrypted, and decrypted only server-side at request time.
- **Key rotation (auto-switch)**: saving several keys for one provider adds them
  to a pool that generation walks in order. A key that is rate limited or out of
  daily quota rotates to the next one automatically — the client only sees an
  error once every key has been tried (`key 1 → key 2 → key 3 …`), and the
  response reports which key served the batch (`usedKey`) and why each earlier
  key failed (`keysTried`). Notes:
  - Keys whose *daily* quota is spent are pushed to the back of the rotation, so
    a spent key never costs a wasted request before the healthy ones.
  - A daily-quota 429 rotates immediately; only per-minute rate limits are
    retried (2s → 4s backoff) before moving on.
  - Google applies Gemini's limits **per project, not per key** — keys must come
    from separate projects (separate AI Studio accounts) to actually multiply
    your daily quota. Keys from one project share one quota.
- **Live per-key usage**: Settings shows one row per saved key with a status dot
  that blinks while that key is serving a request, plus a progress bar for the
  requests used today against the key's daily limit and a countdown to the reset
  (midnight Pacific = ~noon Bangladesh). Nobody's API exposes "requests left", so
  the server counts the requests it sends per key per Pacific day
  (`server/utils/keyUsage.js`, counters on the key itself) and learns the real
  limit from the provider's 429 quota payload; until then it uses an estimate
  (`RPD_*` env vars, or the table in `keyUsage.js`) marked with `~`. The client
  polls `GET /api/user/key-stats` every 2s while generating.
- `npm test` runs the two plain-Node scripts in `server/tests` (no MongoDB, no
  network — they stub the User model and stand up a throwaway local provider):
  - `rotation.test.mjs` drives the real `generate` handler: key rotation when a
    daily quota is spent, spent keys being skipped, per-minute 429 retries,
    usage recording and the response payload.
  - `userKeys.test.mjs` drives the `/user` handlers: per-key stats in `/user/me`
    and `/user/key-stats`, Pacific-day bucket rollover, model-specific limits,
    and add/remove/duplicate key handling.
- The server retries transient failures (HTTP 429 rate limit, 5xx) with
  exponential backoff (2s → 4s) before rotating to the next key, so a momentary
  limit bump does not fail the whole batch.
- Every route under `/api/user` and `/api/generate` requires a valid JWT
  (issued at signup/login) via `server/middleware/auth.js`.
- This project ships with no admin panel or password-reset flow — add one if
  you plan to give accounts to other people.

## Google Sign-In

- "Continue with Google" is optional. Set `GOOGLE_CLIENT_ID` on the server (`.env`)
  and `VITE_GOOGLE_CLIENT_ID` on the client (`client/.env`, baked into the build).
  Without them only email + password sign-up is shown.
- Google accounts have no password; password sign-in on a Google-only account
  returns a hint to use Google instead. A Google sign-in whose email already has a
  password account links to that account (same email).
- The server verifies the Google id_token (RS256) against Google published keys
  in `server/utils/googleAuth.js` using Node built-ins - no extra dependency.
- Tested by `npm run test:auth`.

