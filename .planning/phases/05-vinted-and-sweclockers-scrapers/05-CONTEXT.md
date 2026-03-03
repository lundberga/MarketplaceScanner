# Phase 5: Vinted and Sweclockers Scrapers - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add two new marketplace scrapers (Vinted and Sweclockers) that plug into the existing deduplication pipeline, runner pattern, and scheduler without modifying any Phase 2–4 code. Each scraper is isolated so a failure in one does not affect the other or any existing scraper.

</domain>

<decisions>
## Implementation Decisions

### Vinted — anti-bot approach
- Use Vinted's internal JSON API (`https://www.vinted.se/api/v2/catalog/items`) — bypasses Cloudflare entirely, no Playwright required
- Add realistic headers (User-Agent, Accept, Accept-Language) + per-keyword jitter (1–3 s random delay)
- On 429 or 5xx: log a warn-level event and return `[]` — do NOT throw, do NOT retry in Phase 5 (retry logic is Phase 6+ concern)
- On Cloudflare challenge (403 + CF headers): same as 429 — warn + return `[]`

### Sweclockers — section and post type
- Target the Hardware köp/sälj section only: `https://www.sweclockers.com/forum/lista/123` (Säljes subsection)
- Only scrape `Säljes` (for-sale) posts — skip `Köpes` (wanted) posts
- Title is taken directly from the forum thread title (first 250 chars)
- `listingType` is always `'buy_now'` (forum posts are fixed-price by convention)

### Price extraction — Sweclockers
- Run thread title through existing `parsePrice()` — it already handles Swedish formats (`3500kr`, `3 500 SEK`, `3.500:-`)
- If `parsePrice()` returns `null`: set `price_sek = 0` (consistent with existing BlocketScraper behavior)
- Do NOT attempt regex extraction on post body — title-only for Phase 5

### Runner pattern
- Both scrapers get dedicated runner files: `vintedRunner.js` and `sweclockersRunner.js`
- Identical pattern to `traderaRunner.js` — seed mode via `countSeen(marketplace) === 0 || SEED_MODE=true`, `filterAndMarkSeen`, return `[]` in seed mode
- Module-level scraper singleton, `module.exports = { runVinted }` / `module.exports = { runSweclockers }`

### Scheduler integration
- Add both scrapers to the `scrapers` array in `index.js` exactly as Tradera and Blocket are registered
- Pause state (`vinted.paused`, `sweclockers.paused`) read from `user_config` by existing `runCycle.js` — no changes needed to scheduler

### Claude's Discretion
- Exact Vinted API query parameters (category IDs, sort order, per-page count)
- Sweclockers forum thread ID for the Säljes hardware subsection (to be verified via research)
- Inter-keyword delay values (follow Blocket's 3 s pattern)

</decisions>

<specifics>
## Specific Ideas

- No Playwright — keep the stack Node-only, no headless browser dependencies in Phase 5
- Failure isolation is already guaranteed by `runCycle.js` error catch — scrapers only need to return `[]` on error, not handle scheduler concerns

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `IScraper.js` Listing schema: `marketplace` field already includes `'vinted'` and `'sweclockers'` as valid values
- `parsePrice.js`: handles all Swedish price formats — reuse directly in Sweclockers title parsing
- `blocketRunner.js` / `traderaRunner.js`: copy seed-mode + dedup pattern verbatim for both new runners
- `seenListings.js` `filterAndMarkSeen(listings)` + `countSeen(marketplace)`: shared dedup store, no changes needed
- `classifyCategory(keyword)` in `blocket.js`: copy into both new scrapers (same keyword-based classification logic)

### Established Patterns
- undici `fetch` + explicit headers (User-Agent, Accept-Language, Accept) — used by both existing scrapers
- `sleep(ms)` helper + per-keyword delay between requests
- `logger.info/warn/error` with structured object first arg
- Scraper class with `scrape(keywords)` public method + private `_fetchKeyword` / `_parse` methods
- `module.exports = { ClassName }` at bottom of scraper file

### Integration Points
- `index.js` scrapers array: add `{ name: 'vinted', run: runVinted }` and `{ name: 'sweclockers', run: runSweclockers }`
- `runCycle.js`: no changes — already handles any scraper that returns `Listing[]`
- `src/scrapers/` directory: all scraper files live here

</code_context>

<deferred>
## Deferred Ideas

- Playwright headless fallback for Vinted — deferred; plain HTTP + JSON API is sufficient for Phase 5
- Retry logic / exponential backoff on rate limiting — Phase 6+ concern
- Sweclockers `Köpes` (wanted) post scraping — out of scope; only for-sale posts are relevant to deal detection

</deferred>

---

*Phase: 05-vinted-and-sweclockers-scrapers*
*Context gathered: 2026-03-03*
