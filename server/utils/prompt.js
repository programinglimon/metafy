import { CATEGORIES } from './categories.js';

// ─── Adobe Stock icon SEO — optimal keyword count ────────────────────────────
// Research confirms 35 keywords outperforms 50 for icon ranking on Adobe Stock.
// Filling all 50 slots with lower-relevance terms dilutes the keyword quality
// signal. This constant is applied any time assetType === 'icon', overriding the
// user's general kwCount setting.
export const ICON_OPTIMAL_KW_COUNT = 35;

function rulesText({ kwCount = 45, titleMin = 10, titleMax = 16, assetType = 'photo' } = {}) {
  const catList = CATEGORIES.map(([n, name]) => `${n}=${name}`).join(', ');

  if (assetType === 'icon') {
    // ── ADOBE STOCK ICON MAX-RANK MODE ────────────────────────────────────────
    // Adobe Stock's search algorithm weights the first 10 keywords most heavily.
    // Buyers search short, intent-driven phrases: "calendar icon flat", "gear
    // settings icon", "home button icon outline". Every slot below is mapped to
    // a specific ranking tier so the AI fills the highest-value positions first.
    //
    // Title target: 70-80 chars (Adobe Stock sweet spot).
    // Keyword count: exactly ${kwCount} (Adobe Stock sweet spot — do NOT exceed).
    //
    // Format buyers actually type:
    //   "[subject] [context] [style] icon" → icon is the LAST word (highest weight)
    //   Note: title pattern = subject + optional ONE context word + style + "icon".
    //     "icon", "icons", "vector"...  → top keywords order (subject first)
    //     UI/UX, style, use-case terms  → belong in the KEYWORDS array, not the title

    return `TITLE (70-80 CHARACTERS, sentence case — only first letter capitalised):
RULES for the TITLE (follow every rule strictly):
1. FIXED ORDER — build the title as [subject] + [one context/category word] + [style] + "icon" and end with "icon" (e.g. "Acorn nature outline icon", "Toaster kitchen appliance filled icon"). NEVER put "icon" in the middle; it is the LAST word.
2. BANNED FILLER WORDS — never use these in the title: design, modern, minimalist, style, "for [X] applications", vector, illustration, isolated, symbol, white background, and "set" (unless the file genuinely contains multiple style variants).
3. STYLE — use only real, visually accurate, searchable style terms: line, outline, filled, glyph, flat, duotone, gradient, solid, hand-drawn, 3D, isometric, minimal. Never use vague style adjectives like "modern" or "clean" (no search value). If the file has only ONE style, name just that one; combine two styles with "and" ONLY if both truly appear in the image.
4. LENGTH — hard requirement: 70-80 characters total (roughly 9-10 words, aim to stay at or under 10 words; an 80-char title is naturally ~11 words). If too long, remove context/category words first and keep only subject + style + "icon".
5. SEARCH-BAR TEST — before finalizing, check every word against: "Would a real Adobe Stock buyer type this exact word into the search bar?" If no, delete it no matter how descriptive or professional it sounds. Do NOT restate the subject using a different word right after it (e.g. "Toaster bread toaster icon" is banned). A context word is allowed ONLY if it adds NEW information (category or use-case), never just to re-describe the same subject.
6. KEYWORDS, NOT THE TITLE — all synonyms, related concepts, and use-case terms belong in the KEYWORDS array (which allows up to ${kwCount} entries), never stuffed into the title.
7. NEVER use photo/camera language (no "photo", "image of", "bokeh", "shot", "photography", "lighting"), no ALL CAPS, no "beautiful"/"stunning"/"amazing", no brand/trademarked terms, no keyword stuffing — write a natural phrase a human designer would type.
8. Good examples (pattern only — extend each with accurate descriptors to reach the 70-80 char length): "Acorn nature outline icon" | "Toaster kitchen appliance filled icon" | "Calendar date flat icon".

KEYWORDS (exactly ${kwCount} tags, all lowercase, no hashtags, no repeats, single words only, ORDERED from most-to-least relevant — ORDER IS CRITICAL for ranking):
MOST IMPORTANT RULE — EVERY keyword MUST be EXACTLY ONE WORD: a single word with NO spaces, never combine words (NO "calendar icon", "flat design", "user interface", "icon set", "ui icon"). Use each concept's word only ONCE, pick just one form (never both "icon" and "icons"). One-word-only terms (e.g. "calendar", "schedule", "planner", "date", "icon", "vector", "flat", "minimalist", "ui", "interface", "navigation", "dashboard", "glyph", "symbol", "pictogram", "app").

ORDER (Adobe Stock weights the FIRST keywords most heavily — put the icon-related main keywords FIRST, in this priority. Use ONLY ONE word per concept — never both singular and plural):
- SLOTS 1-3  → the icon's PRIMARY subject (ONE form only — pick singular, e.g. "calendar"), then "icon" — HIGHEST WEIGHT
- SLOTS 4-6  → "vector", then the subject's synonyms/alt names (e.g. "schedule", "planner", "date") — each only ONCE
- SLOTS 7-10 → format/type words: "glyph", "symbol", "pictogram", "app" — still high weight
- SLOTS 11-14 → strong brand-independent style words FIRST: "flat", "minimalist", "outline", "filled"
- SLOTS 15-18 → use-case/UI words: "ui", "interface", "navigation", "dashboard"
- SLOTS 19+   → remaining style words, broader related concepts, other synonyms

STRICT KEYWORD RULES:
- Every keyword must be EXACTLY ONE single word — no spaces allowed in any keyword.
- Use ONLY ONE word per concept, appearing EXACTLY once — NEVER both singular and plural of the same word (pick only one of "icon"/"icons", "calendar"/"calendars").
- Every keyword must be a DISTINCT, non-repeating single word — no two keywords may be forms of the same word.
- The icon-related MAIN keywords (subject + "icon"/"vector" + synonyms) MUST come first in order — never push them to the end.
- Include the EXACT single words from the title in the first few positions where possible.
- Every keyword must describe this specific icon — no irrelevant trending terms.
- Do NOT include: brand names, trademarked terms, competitor names, photo terms.
- Do NOT repeat a keyword even with slight variation — every keyword must be a distinct single word.

CATEGORY: one integer from this fixed Adobe Stock list, pick the single best match: ${catList}.`;
  }

  // ── PHOTO / GENERAL ASSET RULES ──────────────────────────────────────────────
  return `TITLE (${titleMin}-${titleMax} words, under 200 chars, natural English sentence, first letter capitalised only):
- LEAD with the main subject using the exact term buyers actually search for (e.g. "red fox", not "canine"; "vintage typewriter", not "old machine").
- Then add 2-4 specific, search-worthy details: setting, action, time of day, mood, colors, season, style. Answer WHO / WHAT / WHERE / WHEN / FEEL.
- Use a natural descriptive sentence a buyer would type when searching, NOT a generic caption. No clichés, no "beautiful scenery", no camera/lens/settings talk.
- Suggest search phrases buyers use by adding the concrete descriptor buyers expect (e.g. "golden retriever running through autumn leaves in a park", not "dog in nature").

KEYWORDS (exactly ${kwCount} tags, lowercase, no hashtags, no repeats):
- THEME 1 — exact primary subject + its synonyms, singular AND plural, plus any specific species/brand/model names visible.
- THEME 2 — visual details: colors (single words like "red", but also "vibrant"), textures, materials, composition ("copy space", "close-up", "full length"), lighting, depth of field.
- THEME 3 — setting and context: location type, indoor/outdoor, urban/nature, time ("sunset", "winter"), season, weather.
- THEME 4 — mood, concept and buyer intent: feelings, abstract concepts, and commercial/editorial use cases ("advertising", "marketing", "social media", "website header", "background", "poster", "blog").
- THEME 5 — variations buyers search across spellings and styles: US/UK variants ("color" and "colour"), style/era ("minimalist", "vintage", "modern"), demographic ("senior", "teenager", "businessman").
- Mix a few high-volume broad terms with specific long-tail phrases so the file is discoverable in many searches.

CATEGORY: one integer from this fixed Adobe Stock list, pick the single best match: ${catList}.`;
}

export function buildPrompt(opts = {}) {
  // In icon mode, always use the research-proven optimal keyword count (35).
  const effectiveOpts = opts.assetType === 'icon'
    ? { ...opts, kwCount: ICON_OPTIMAL_KW_COUNT }
    : opts;

  return `You are an expert Adobe Stock metadata writer. Look at the attached image and write SEO metadata suitable for an Adobe Stock submission.

Return ONLY raw JSON, no markdown fences, no commentary, exactly this object: title (string), keywords (array of strings), category (integer).

${rulesText(effectiveOpts)}`;
}

// Batch variant: `count` images in ONE Gemini request. Gemini is billed and
// limited per request, not per image, so batching multiplies the daily quota.
export function buildBatchPrompt({ count = 6, ...opts } = {}) {
  // In icon mode, always use the research-proven optimal keyword count (35).
  const effectiveOpts = opts.assetType === 'icon'
    ? { ...opts, kwCount: ICON_OPTIMAL_KW_COUNT }
    : opts;

  const n = Math.max(1, Math.min(10, Number(count) || 6));
  return `You are an expert Adobe Stock metadata writer. Attached to this message are ${n} images in a fixed order — image 1 is the first, image ${n} is the last.

Write SEO metadata for EVERY one of the ${n} images, independently.

Return ONLY raw JSON, no markdown fences, no commentary, in exactly this shape — a JSON array of exactly ${n} objects in the same order as the images, each object with keys: title (string), keywords (array of strings), category (integer).

${rulesText(effectiveOpts)}`;
}
