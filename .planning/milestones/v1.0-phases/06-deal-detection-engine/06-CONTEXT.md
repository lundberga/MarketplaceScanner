# Phase 6: Deal Detection Engine - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Evaluate every novel listing against configured price thresholds, optionally enrich with a Tradera sold-price margin estimate, filter mid-run auctions, and emit `DealAlert` structs for Phase 7 (Discord Alerts) to post. No UI, no Discord, no scraping changes — pure evaluation logic that sits between the scraper output and the alert layer.

</domain>

<decisions>
## Implementation Decisions

### Threshold matching criteria
- A listing matches a threshold when ALL of the following are true:
  1. `threshold.category` matches `listing.category`, OR `threshold.category` is NULL (wildcard — matches any category)
  2. `listing.price_sek <= threshold.max_price`, OR `threshold.max_price` is NULL
  3. If `threshold.keywords` is set (non-empty, non-null): at least one keyword must appear in `listing.title` (case-insensitive substring match)
  4. If `threshold.marketplace` is set: `listing.marketplace` must match exactly
  5. `threshold.active = 1`
- Multiple thresholds can match the same listing — emit one `DealAlert` per matching threshold (Phase 7 deduplicates by listing ID before posting if needed)
- `min_margin` threshold field: if set, also require `estimatedMargin >= threshold.min_margin * medianPrice` (i.e. minimum absolute margin derived from the ratio). If sold-comps are unavailable, skip the `min_margin` check (do not discard the listing on unavailable data)
- No thresholds configured (empty table): log a `warn`-level message per cycle and return `[]` — do not crash

### Auction filter
- `listingType === 'buy_now'` → always passes the auction filter
- `listingType === 'auction'` with `auctionEndsAt !== null` → parse the raw Swedish date string (e.g. "15 mars 13:00") to a timestamp; allow through only if auction ends within 2 hours from now
- `listingType === 'auction'` with `auctionEndsAt === null` (parse failure or null) → treat as mid-run, filter out
- Swedish month names: januari, februari, mars, april, maj, juni, juli, augusti, september, oktober, november, december — mapped to month indices 0–11
- Auction filter runs BEFORE sold-comps lookup to avoid unnecessary HTTP fetches on filtered listings

### DealAlert struct shape
```js
{
  listing: Listing,           // full Listing object from IScraper
  threshold: {                // the matched threshold row
    id: number,
    name: string,
    max_price: number|null,
    min_margin: number|null,
  },
  estimatedMargin: number|null,  // medianPrice - listing.price_sek, or null if no comps
  sampleCount: number,           // number of sold comps the margin is based on (0 if no comps)
  medianSoldPrice: number|null,  // raw median for Phase 7 to display
}
```
- `estimatedMargin` is absolute SEK integer (e.g. 1400), not a percentage
- Phase 7 formats it as "~1 400 SEK margin, N comps" — the engine just provides the numbers

### Sold-comps query key
- Use `listing.title.toLowerCase().trim()` truncated to first 40 chars as the `lookupSoldPrice` query key — avoids overly specific queries that return no results
- Alternative: use the matched threshold's `keywords` first entry if available (more predictable query)
- **Decision:** Use threshold `keywords` first entry (e.g. "rtx 3080") if available; fall back to first 3 words of title. This keeps sold-comp queries consistent across cycles.

### Integration point in runCycle.js
- `runCycle.js` calls `scraper.run(keywords)` → gets `novel[]`
- Phase 6 inserts `detectDeals(novel, db)` after each scraper's `novel` return
- `detectDeals` is async, returns `DealAlert[]`
- `scan_log.deals_alerted` = `dealAlerts.length` (fixes the Phase 4 placeholder)
- `detectDeals` never throws — catches all errors and returns `[]`

### Claude's Discretion
- Exact Swedish month-name parser implementation
- Whether to batch sold-comps lookups or run serially (serial is fine for Phase 6 — parallel HTTP is Phase 9 optimization)
- Error handling granularity within threshold iteration

</decisions>

<specifics>
## Specific Ideas

- The engine should be a single exported function `detectDeals(listings, db)` living at `src/deals/detectDeals.js` — one clear entry point, easy to unit test
- Keep the Swedish date parser as a standalone pure function — it needs its own unit tests

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lookupSoldPrice(queryKey)` in `src/scrapers/soldCache.js`: returns `{ medianPrice, sampleCount }` — plug in directly, already handles cache and errors
- `thresholds` table schema: `category`, `keywords` (comma-sep string), `max_price`, `min_margin`, `marketplace`, `active` — query with `db.prepare(...).all()`
- `IScraper.Listing` schema: `id`, `marketplace`, `title`, `price_sek`, `url`, `category`, `listingType ('buy_now'|'auction')`, `auctionEndsAt` (raw string or null)
- `tradera.js` `auctionEndsAt` format: `"15 mars 13:00"` (day month HH:MM, no year — assume current year)
- `parsePrice()` in `src/utils/parsePrice.js`: not needed here — prices are already integers on Listing objects
- `logger` in `src/utils/logger.js`: use for warn on no-threshold state and debug on each evaluation

### Established Patterns
- Sync DB queries via `db.prepare(...).get/all/run()` — `detectDeals` can be async (for `lookupSoldPrice`) but DB reads are sync
- `never throws` contract — all scrapers return `[]` on error; `detectDeals` must follow same contract
- Module-level exports: `module.exports = { detectDeals }`

### Integration Points
- `src/scheduler/runCycle.js` line 47: `const novel = await scraper.run(keywords)` — Phase 6 adds `const alerts = await detectDeals(novel, db)` immediately after, then passes `alerts.length` to `scan_log.deals_alerted`
- `scan_log.deals_alerted` column: currently always 0 — Phase 6 populates it correctly
- Phase 7 will `import { DealAlert }` type and call `detectDeals` indirectly through `runCycle`

</code_context>

<deferred>
## Deferred Ideas

- Parallel sold-comps HTTP fetches — serial is sufficient for Phase 6; parallelization is Phase 9 hardening
- Percentage-based margin display — Phase 7 can add this formatting; engine provides raw SEK
- Deduplication of alerts when multiple thresholds match same listing — Phase 7 concern, not Phase 6

</deferred>

---

*Phase: 06-deal-detection-engine*
*Context gathered: 2026-03-03*
