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
    // Title target: ~70 chars (200 allowed, but <70 chars = proven better rank).
    // Keyword count: exactly ${kwCount} (Adobe Stock sweet spot — do NOT exceed).
    //
    // Format buyers actually type:
    //   "[subject] icon"              → SLOT 1 (highest weight)
    //   "[subject] icon [style]"      → SLOT 2
    //   "[subject] [style] icon"      → SLOT 3
    //   "[synonym] icon"              → SLOTS 4-6
    //   "icon", "icons", "vector"...  → SLOTS 7-10 (still top-10 = high weight)
    //   UI/UX use-case terms          → SLOTS 11-18
    //   Style vocabulary              → SLOTS 19-25
    //   Broader related concepts      → SLOTS 26-35

    return `TITLE (target ~70 characters, maximum 200, sentence case — only first letter capitalised):
RULES for the TITLE (follow every rule strictly):
1. START with the exact noun buyers search: the thing the icon represents (e.g. "Calendar icon", "Shopping cart icon", "Settings gear icon").
2. The word "icon" MUST appear in the title, ideally as the 2nd or 3rd word.
3. After "[subject] icon" add 1-2 STYLE words buyers filter by: flat, line, outline, filled, bold, minimalist, rounded, thin line, solid, two tone, monochrome, simple, modern, gradient.
4. KEEP IT SHORT — aim for ~70 characters total (e.g. "Calendar icon flat design minimalist" = 36 chars, excellent).
5. DO NOT exceed 200 characters. DO NOT use ALL CAPS. DO NOT use "beautiful", "stunning", "amazing".
6. NEVER use photo/camera language: no "photo", "image of", "bokeh", "depth of field", "shot", "photography", "lighting".
7. NO keyword stuffing — write a natural phrase a human designer would type in the search box.
8. Good examples: "Settings gear icon flat minimalist" | "Home button icon outline thin line" | "Shopping cart icon bold filled style" | "Calendar icon flat design vector".

KEYWORDS (exactly ${kwCount} tags, all lowercase, no hashtags, no repeats, ORDERED from most-to-least relevant — ORDER IS CRITICAL for ranking):
SLOT 1  → [primary subject] icon                     (e.g. "calendar icon") — HIGHEST WEIGHT
SLOT 2  → [primary subject] icon [style]              (e.g. "calendar icon flat")
SLOT 3  → [primary subject] [style] icon              (e.g. "calendar flat icon")
SLOT 4  → [synonym/alt name] icon                     (e.g. "schedule icon", "date icon")
SLOT 5  → [synonym] icon [style]                      (e.g. "planner icon flat")
SLOT 6  → [synonym] [style] icon                      (e.g. "date flat icon")
SLOT 7  → "icon"                                      (standalone — high-traffic root term)
SLOT 8  → "vector icon"                               (format term buyers filter by)
SLOT 9  → "symbol"                                    (buyers often search [subject] symbol)
SLOT 10 → "pictogram"                                 (still top-10 = algorithm-boosted)
— SLOTS 1-10 above are the MOST IMPORTANT. Title words MUST appear in slots 1-3. —
SLOT 11 → "icons" (plural)
SLOT 12 → "vector"
SLOT 13 → "glyph"
SLOT 14 → "ui icon"
SLOT 15 → "app icon"
SLOT 16 → "web icon"
SLOT 17 → "interface icon"
SLOT 18 → "mobile icon"
SLOT 19 → [icon style full phrase] e.g. "flat design"
SLOT 20 → [style variant] e.g. "line icon" or "outline icon" or "filled icon"
SLOT 21 → "minimalist"
SLOT 22 → "simple icon"
SLOT 23 → "modern icon"
SLOT 24 → "clean icon"
SLOT 25 → another style variant (e.g. "solid icon", "bold icon", "rounded icon")
SLOT 26 → "user interface"
SLOT 27 → "ui design"
SLOT 28 → "ux"
SLOT 29 → "website icon"
SLOT 30 → "dashboard"
SLOT 31 → use-case context (e.g. "button icon", "navigation icon", "toolbar icon")
SLOT 32 → broader concept related to subject (e.g. for calendar: "time management")
SLOT 33 → second synonym/alt name (singular)
SLOT 34 → second synonym/alt name (plural or compound)
SLOT 35 → "icon set" or "set of icons" (many buyers search for sets)

STRICT KEYWORD RULES:
- Follow the slot order above as closely as the icon's actual subject allows.
- EVERY keyword must describe this specific icon — no irrelevant trending terms.
- Include BOTH singular and plural forms of the subject name.
- Include the EXACT words from the title in SLOTS 1-3.
- Do NOT include: brand names, trademarked terms, competitor names, photo terms.
- Do NOT repeat a keyword even with slight variation (e.g. "flat icon" and "flat icons" count as repeats — pick one).

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
