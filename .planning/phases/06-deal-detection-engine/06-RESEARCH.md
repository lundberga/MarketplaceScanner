# Phase 6: Deal Detection Engine - Research

**Researched:** 2026-03-03
**Domain:** Pure evaluation logic — threshold matching, Swedish date parsing, sold-comps enrichment, DealAlert struct construction
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Single exported function `detectDeals(listings, db)` at `src/deals/detectDeals.js`
- Never throws contract — catches all errors, returns `[]`
- `module.exports = { detectDeals }` (CommonJS, consistent with project)

**Threshold matching criteria (ALL must be true to match):**
1. `threshold.category` matches `listing.category`, OR `threshold.category` is NULL (wildcard)
2. `listing.price_sek <= threshold.max_price`, OR `threshold.max_price` is NULL
3. If `threshold.keywords` is set: at least one keyword must appear in `listing.title` (case-insensitive substring match)
4. If `threshold.marketplace` is set: `listing.marketplace` must match exactly
5. `threshold.active = 1`

- Multiple thresholds can match one listing — emit one DealAlert per matched threshold
- `min_margin`: if set, require `estimatedMargin >= threshold.min_margin * medianPrice`; if sold-comps unavailable, SKIP the min_margin check (do not discard)
- No thresholds configured: log `warn`-level once per cycle, return `[]`

**Auction filter (runs BEFORE sold-comps lookup):**
- `listingType === 'buy_now'` → always passes
- `listingType === 'auction'` with `auctionEndsAt !== null` → parse Swedish date string; pass only if ends within 2 hours
- `listingType === 'auction'` with `auctionEndsAt === null` (parse failure or null) → filter out

**Swedish month mapping (0-indexed):**
`januari=0, februari=1, mars=2, april=3, maj=4, juni=5, juli=6, augusti=7, september=8, oktober=9, november=10, december=11`

**DealAlert struct shape:**
```js
{
  listing: Listing,           // full Listing object from IScraper
  threshold: {                // matched threshold row
    id: number,
    name: string,
    max_price: number|null,
    min_margin: number|null,
  },
  estimatedMargin: number|null,  // medianPrice - listing.price_sek, or null if no comps
  sampleCount: number,           // number of sold comps (0 if no comps)
  medianSoldPrice: number|null,  // raw median for Phase 7 to display
}
```
- `estimatedMargin` is absolute SEK integer, not percentage

**Sold-comps query key:**
- Use threshold `keywords` first entry (e.g. `"rtx 3080"`) if available
- Fall back to first 3 words of `listing.title.toLowerCase().trim()`

**Integration point:**
- `runCycle.js` line 47: after `const novel = await scraper.run(keywords)`, add `const alerts = await detectDeals(novel, db)`
- `scan_log.deals_alerted` = `alerts.length` (fixes the Phase 4 placeholder that hardcodes 0)

### Claude's Discretion

- Exact Swedish month-name parser implementation
- Whether to batch sold-comps lookups or run serially (serial is fine for Phase 6)
- Error handling granularity within threshold iteration

### Deferred Ideas (OUT OF SCOPE)

- Parallel sold-comps HTTP fetches — Phase 9 optimization
- Percentage-based margin display — Phase 7 formatting concern
- Deduplication when multiple thresholds match same listing — Phase 7 concern
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEAL-01 | Bot evaluates each new listing against user-defined price thresholds per hardware category or specific item name | Threshold schema verified in init.js; `db.prepare(...).all()` sync query pattern established; matching logic fully specified in CONTEXT.md |
| DEAL-02 | Bot fetches recent Tradera sold prices for similar items and includes estimated profit margin in alerts | `lookupSoldPrice(queryKey)` in soldCache.js is ready to consume — returns `{ medianPrice, sampleCount }`, never throws; DealAlert struct carries margin fields |
| DEAL-03 | Bot only alerts on buy-now listings or auctions ending within 2 hours — never on current bid prices mid-auction | `auctionEndsAt` raw string format confirmed in tradera.js ("15 mars 13:00"); Swedish month parser needed; filter runs before sold-comps to avoid unnecessary HTTP |
</phase_requirements>

---

## Summary

Phase 6 is pure evaluation logic with zero new npm dependencies. All integration points are already in place: the `thresholds` table is in SQLite, `lookupSoldPrice` is production-ready, the `Listing` schema is fixed, and `runCycle.js` has a clear injection point at line 47. The phase decomposes naturally into three tasks: (1) a Swedish date parser with its own unit tests, (2) the threshold matching engine, and (3) the DealAlert assembly and runCycle.js wiring.

The most technically subtle piece is the Swedish auction-end-time parser. The raw string format `"15 mars 13:00"` carries no year, so the parser must assume current year and handle year-boundary cases (a date that has already passed in the current year likely belongs to next year). The filter must run BEFORE the sold-comps HTTP call to avoid wasting network on mid-auction listings.

The threshold matching engine must handle five independent match conditions, `keywords` as a comma-separated string (not an array), and the `min_margin` skip rule when sold-comps are unavailable. The "never throws" contract is project-wide — every internal error should be caught and logged, returning `[]` from `detectDeals`.

**Primary recommendation:** Implement as three separate tasks — parseAuctionEnd (pure function, unit-tested), threshold matching logic (sync, DB-driven), and DealAlert assembly + runCycle.js wiring. Keep Swedish date parsing isolated because it has the most edge cases and needs independent testing.

---

## Standard Stack

### Core (no new dependencies needed)

| Module | Source | Purpose | Notes |
|--------|--------|---------|-------|
| `better-sqlite3` | Already installed (^12.6.2) | Sync DB reads for thresholds table | `db.prepare(...).all()` for threshold list |
| `src/scrapers/soldCache.js` | Already built (Phase 2) | `lookupSoldPrice(queryKey)` — median sold price + sample count | Never throws; handles cache |
| `src/utils/logger.js` | Already built (Phase 1) | `logger.warn` on no-threshold state; `logger.debug` per evaluation | pino structured logging |
| Node.js built-in `Date` | Built-in | Current timestamp for 2-hour auction window | No external date library needed |

**Installation:** No new packages required.

### Supporting (existing utilities)

| Module | Purpose | Usage in Phase 6 |
|--------|---------|-----------------|
| `src/utils/parsePrice.js` | Swedish price parser | NOT needed — prices already integers on Listing objects |
| `src/db/index.js` | Singleton DB handle | Passed in as `db` parameter to `detectDeals` — do not re-require |

### Alternatives Considered

| Standard | Alternative | Why Standard Wins |
|----------|-------------|-------------------|
| Native `Date` for time arithmetic | `date-fns` or `luxon` | No new dep needed; 2-hour window is simple ms arithmetic on `Date.now()` |
| Sync `db.prepare().all()` | Async SQLite | better-sqlite3 is synchronous throughout this project — do not introduce async DB |
| Serial sold-comps lookups | Parallel `Promise.all` | Deferred to Phase 9; serial keeps error isolation simple |

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── deals/
│   └── detectDeals.js     # exported detectDeals(listings, db) — main entry point
├── scheduler/
│   └── runCycle.js        # MODIFY: inject detectDeals after scraper.run(), update deals_alerted
```

The Swedish date parser lives as a private function inside `detectDeals.js` (or extracted to `src/utils/parseAuctionEnd.js` if testability requires it). Given the CONTEXT.md instruction to keep it as a "standalone pure function" for unit testing, extracting to `src/utils/parseAuctionEnd.js` and requiring it in `detectDeals.js` is the right call.

### Pattern 1: Auction Filter (Pure Function, Run First)

**What:** Parse the raw Swedish date string and determine if the auction ends within 2 hours.
**When to use:** Before any sold-comps HTTP call. Buy-now listings skip this entirely.

```js
// src/utils/parseAuctionEnd.js
'use strict';

const SWEDISH_MONTHS = {
  januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
  juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
};

/**
 * Parses a raw Swedish auction-end string to a Unix timestamp (ms).
 * Format: "15 mars 13:00" (day month HH:MM, no year — assumes current year).
 * Returns null if the string cannot be parsed.
 * @param {string|null} raw
 * @returns {number|null} millisecond timestamp, or null on parse failure
 */
function parseAuctionEnd(raw) {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, monthStr, hour, minute] = match;
  const monthIndex = SWEDISH_MONTHS[monthStr.toLowerCase()];
  if (monthIndex === undefined) return null;

  const now = new Date();
  const candidate = new Date(
    now.getFullYear(), monthIndex, parseInt(day, 10),
    parseInt(hour, 10), parseInt(minute, 10), 0, 0
  );

  // If the date has already passed this year, assume it belongs to next year
  // (e.g. parsing "31 december 23:59" in January)
  if (candidate.getTime() < Date.now() - 60_000) {
    candidate.setFullYear(now.getFullYear() + 1);
  }

  return candidate.getTime();
}

/**
 * Returns true if the listing passes the auction filter.
 * buy_now always passes. auction passes only if it ends within 2 hours.
 * @param {import('../scrapers/IScraper').Listing} listing
 * @returns {boolean}
 */
function passesAuctionFilter(listing) {
  if (listing.listingType === 'buy_now') return true;
  const endsAt = parseAuctionEnd(listing.auctionEndsAt);
  if (endsAt === null) return false;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  return endsAt - Date.now() <= TWO_HOURS_MS;
}

module.exports = { parseAuctionEnd, passesAuctionFilter };
```

### Pattern 2: Threshold Matching (Sync, DB-Driven)

**What:** Load all active thresholds once per `detectDeals` call, then check each listing against each threshold.
**When to use:** After auction filter — only run on listings that passed.

```js
// Inside detectDeals.js — threshold loading and matching

function loadThresholds(db) {
  return db.prepare(
    'SELECT id, name, category, keywords, max_price, min_margin, marketplace FROM thresholds WHERE active = 1'
  ).all();
}

function matchesThreshold(listing, threshold) {
  // 1. Category check (NULL = wildcard)
  if (threshold.category !== null && threshold.category !== listing.category) return false;

  // 2. Price check (NULL = no limit)
  if (threshold.max_price !== null && listing.price_sek > threshold.max_price) return false;

  // 3. Keywords check — comma-separated string in DB
  if (threshold.keywords) {
    const keywords = threshold.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length > 0) {
      const titleLower = listing.title.toLowerCase();
      const anyMatch = keywords.some(kw => titleLower.includes(kw));
      if (!anyMatch) return false;
    }
  }

  // 4. Marketplace check (NULL = any)
  if (threshold.marketplace !== null && threshold.marketplace !== listing.marketplace) return false;

  return true;
}
```

### Pattern 3: DealAlert Assembly with Sold-Comps Enrichment

**What:** For each (listing, threshold) pair that passes matching, enrich with sold-comps data, apply min_margin check, build DealAlert struct.
**When to use:** After threshold matching confirms a candidate deal.

```js
// Inside detectDeals.js — DealAlert construction

async function buildAlert(listing, threshold) {
  // Determine query key per locked decision
  const firstKeyword = threshold.keywords
    ? threshold.keywords.split(',')[0].trim().toLowerCase()
    : null;
  const queryKey = firstKeyword || listing.title.toLowerCase().trim().split(/\s+/).slice(0, 3).join(' ');

  const { medianPrice, sampleCount } = await lookupSoldPrice(queryKey);

  const estimatedMargin = (medianPrice !== null)
    ? medianPrice - listing.price_sek
    : null;

  // min_margin check — skip if no sold-comps (do not discard listing)
  if (threshold.min_margin !== null && medianPrice !== null) {
    const requiredMargin = threshold.min_margin * medianPrice;
    if (estimatedMargin < requiredMargin) return null; // does not meet margin requirement
  }

  return {
    listing,
    threshold: {
      id: threshold.id,
      name: threshold.name,
      max_price: threshold.max_price,
      min_margin: threshold.min_margin,
    },
    estimatedMargin,
    sampleCount,
    medianSoldPrice: medianPrice,
  };
}
```

### Pattern 4: detectDeals Top-Level Function

**What:** Orchestrates filter → match → enrich. Never throws.

```js
// src/deals/detectDeals.js
'use strict';

const { lookupSoldPrice } = require('../scrapers/soldCache');
const { passesAuctionFilter } = require('../utils/parseAuctionEnd');
const logger = require('../utils/logger');

async function detectDeals(listings, db) {
  try {
    const thresholds = loadThresholds(db);

    if (thresholds.length === 0) {
      logger.warn('detectDeals: no active thresholds configured — returning []');
      return [];
    }

    // Filter out mid-auction listings first (no HTTP calls yet)
    const auctionPassed = listings.filter(passesAuctionFilter);

    const alerts = [];
    for (const listing of auctionPassed) {
      for (const threshold of thresholds) {
        if (!matchesThreshold(listing, threshold)) continue;
        try {
          const alert = await buildAlert(listing, threshold);
          if (alert !== null) alerts.push(alert);
        } catch (innerErr) {
          logger.warn({ err: innerErr.message, listing: listing.id }, 'detectDeals: buildAlert error — skipping');
        }
      }
    }

    logger.info({ input: listings.length, auctionPassed: auctionPassed.length, alerts: alerts.length }, 'detectDeals complete');
    return alerts;
  } catch (err) {
    logger.error({ err: err.message }, 'detectDeals: unexpected error — returning []');
    return [];
  }
}

module.exports = { detectDeals };
```

### Pattern 5: runCycle.js Modification

**What:** Inject `detectDeals` call after each `scraper.run()` and populate `deals_alerted`.

```js
// runCycle.js diff — replace the stmtInsertLog that hardcodes 0 with dynamic count

// Add at top of file:
const { detectDeals } = require('../deals/detectDeals');

// Inside the for loop, replace:
//   const novel = await scraper.run(keywords);
// With:
const novel = await scraper.run(keywords);
const alerts = await detectDeals(novel, db);
const dealsAlerted = alerts.length;

// Update scan_log INSERT to use dealsAlerted instead of hardcoded 0:
// stmtInsertLog already has deals_alerted column — update the VALUES to pass dealsAlerted
```

Note: The existing `stmtInsertLog` in runCycle.js hardcodes `0` for `deals_alerted`. The modification must change the prepared statement to accept `dealsAlerted` as a parameter and pass it in `stmtInsertLog.run(...)`.

### Anti-Patterns to Avoid

- **Re-opening DB in detectDeals:** Never `require('../db/index')` inside detectDeals — accept `db` as parameter, consistent with testability pattern used in seenListings.test.js (monkey-patches `db/index`).
- **Throwing on no thresholds:** Return `[]` + warn, not throw. The "never throws" contract is absolute.
- **Running sold-comps before auction filter:** Wastes network on listings that will be filtered. Filter first.
- **Parsing `threshold.keywords` as array:** It is stored as a comma-separated string in SQLite. Always split by comma before use.
- **Year assumption for auction dates:** If the parsed date is in the past (more than 60 seconds ago), increment the year — handles end-of-year scrapes where December listings appear in January.
- **Discarding listing when min_margin check fails due to missing comps:** The contract says "if sold-comps unavailable, skip the min_margin check (do not discard)." Only discard when comps exist AND margin is insufficient.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sold price lookup with caching | Custom HTTP + cache logic | `lookupSoldPrice` from `src/scrapers/soldCache.js` | Already handles 4-hour SQLite cache, MIN_SAMPLES guard, network errors, never throws |
| DB singleton | Opening a new connection | `db` parameter passed in | better-sqlite3 is single-connection; all modules share the singleton from `src/db/index.js` |
| Swedish price parsing | Custom regex | `src/utils/parsePrice.js` | Already handles all marketplace formats; prices are integers on Listing objects anyway |
| Median calculation | Custom sort | Not needed — medianPrice is pre-computed by soldCache | soldCache already returns the median |

**Key insight:** Every hard problem in this phase is already solved. The phase is purely about orchestrating existing infrastructure correctly.

---

## Common Pitfalls

### Pitfall 1: keywords Column is a Comma-Separated String, Not an Array

**What goes wrong:** Treating `threshold.keywords` as `string[]` and calling `.some()` directly on it.
**Why it happens:** The DB schema stores `TEXT` (comma-separated), not a JSON array. `better-sqlite3` returns raw SQL types.
**How to avoid:** Always `threshold.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)` before matching.
**Warning signs:** All keyword-filtered thresholds matching everything, or matching nothing.

### Pitfall 2: auctionEndsAt Year Boundary

**What goes wrong:** A listing ending "31 december 23:50" is scraped on 2 January — the parser creates a date in January's current year (the past), and filters it out as already-ended.
**Why it happens:** The raw string has no year; naive `new Date(currentYear, ...)` always uses the current year.
**How to avoid:** After constructing the candidate Date, if it's more than ~60 seconds in the past, set year to `currentYear + 1`.
**Warning signs:** Zero auction listings passing the filter in December/January.

### Pitfall 3: min_margin Semantics — Ratio vs. Absolute

**What goes wrong:** Treating `threshold.min_margin` as an absolute SEK value instead of a ratio (0.0–1.0) of the median price.
**Why it happens:** The CONTEXT.md states "require `estimatedMargin >= threshold.min_margin * medianPrice`" — the field is a ratio stored as REAL.
**How to avoid:** `requiredMarginSek = threshold.min_margin * medianPrice` then compare `estimatedMargin >= requiredMarginSek`.
**Warning signs:** Deals rejected even when margin is healthy, or deals accepted with tiny margins.

### Pitfall 4: runCycle.js scan_log INSERT Uses Hardcoded 0

**What goes wrong:** Phase 4 inserted `deals_alerted = 0` in `stmtInsertLog`. If only the `run` call is updated without touching the prepared statement, `deals_alerted` stays 0.
**Why it happens:** The stmtInsertLog is prepared once before the loop with `0` hardcoded in VALUES. Need to either re-prepare the statement to accept a parameter or restructure.
**How to avoid:** Re-examine the exact SQL in runCycle.js. Current code: `VALUES (?, ?, ?, ?, ?, 0, ?)` — the `0` must become `?` and `dealsAlerted` passed in `stmtInsertLog.run(...)`.
**Warning signs:** `scan_log.deals_alerted` always stays 0 even when alerts are generated.

### Pitfall 5: detectDeals Called with Empty listings Array

**What goes wrong:** Attempting sold-comps lookup for empty array — no crash but wasted cycles.
**Why it happens:** `runCycle.js` calls `scraper.run()` which may return `[]` on pause, error, or zero novel listings.
**How to avoid:** Early-exit if `listings.length === 0` — return `[]` immediately. Also skip sold-comps lookup if no thresholds match a listing.

### Pitfall 6: Inner Loop Error Isolation

**What goes wrong:** An error in `buildAlert` (e.g. unexpected `lookupSoldPrice` behavior) crashes the entire cycle via the outer `detectDeals` try/catch, returning `[]` for ALL listings.
**Why it happens:** Single try/catch wrapping the nested loops loses partial results.
**How to avoid:** Wrap `buildAlert` call in its own try/catch inside the inner loop. Only skip the current (listing, threshold) pair on error, not the entire batch.

---

## Code Examples

Verified patterns from existing codebase:

### DB Threshold Query (Sync Pattern)
```js
// Source: established pattern from seenListings.js and runCycle.js
const thresholds = db.prepare(
  'SELECT id, name, category, keywords, max_price, min_margin, marketplace FROM thresholds WHERE active = 1'
).all();
```

### lookupSoldPrice Usage (Async, Never Throws)
```js
// Source: src/scrapers/soldCache.js - public API
const { lookupSoldPrice } = require('../scrapers/soldCache');

// Returns { medianPrice: number|null, sampleCount: number }
// medianPrice is null when fewer than MIN_SAMPLES=3 comps found
const { medianPrice, sampleCount } = await lookupSoldPrice('rtx 3080');
```

### Existing Test Pattern (Node assert, no test framework)
```js
// Source: src/scrapers/blocket.test.js, src/db/seenListings.test.js
'use strict';
const assert = require('assert');

// For async tests, use async function wrapper:
async function runTests() {
  let passed = 0;
  let failed = 0;

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${name} — ${err.message}`);
      failed++;
    }
  }
  // ...
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
runTests().catch(err => { console.error(err); process.exit(1); });
```

### DB Injection for Unit Tests (Monkey-Patch Pattern)
```js
// Source: src/db/seenListings.test.js — inject in-memory DB
const testDb = new Database(':memory:');
testDb.exec(`CREATE TABLE thresholds (...); CREATE TABLE sold_price_cache (...);`);

// detectDeals accepts db as parameter — no monkey-patching needed for unit tests
// Just pass testDb directly:
const alerts = await detectDeals(listings, testDb);
```

### runCycle.js stmtInsertLog Fix
```js
// Current (Phase 4):
const stmtInsertLog = db.prepare(`
  INSERT INTO scan_log (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
  VALUES (?, ?, ?, ?, ?, 0, ?)
`);
// stmtInsertLog.run(scraper.name, startedAt, completedAt, listingsFound, newListings, errorMsg);

// Phase 6 fix — change 0 to ? and pass dealsAlerted:
const stmtInsertLog = db.prepare(`
  INSERT INTO scan_log (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
// stmtInsertLog.run(scraper.name, startedAt, completedAt, listingsFound, newListings, dealsAlerted, errorMsg);
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `deals_alerted = 0` hardcoded in runCycle.js (Phase 4 placeholder) | Phase 6 populates from `detectDeals` result length | scan_log becomes accurate |
| No deal evaluation | `detectDeals(novel, db)` inserted after each `scraper.run()` | Every novel listing evaluated |
| Sold-comps cache never consumed by deal logic | `lookupSoldPrice` called per matched threshold | Margin data flows into DealAlert |

**Deprecated/outdated patterns in this codebase:**
- None for Phase 6 — all existing code remains valid. Phase 6 only adds new files and modifies runCycle.js.

---

## Open Questions

1. **What happens when the same listing matches two thresholds with different query keys?**
   - What we know: One DealAlert is emitted per matched threshold (locked decision). Each threshold generates its own sold-comps lookup with its own query key.
   - What's unclear: If two thresholds share the same keyword, `lookupSoldPrice` is called twice for the same query key — but soldCache handles this via SQLite cache hit (near-zero cost).
   - Recommendation: No special handling needed. Cache absorbs duplicate lookups.

2. **Can `estimatedMargin` be negative?**
   - What we know: `estimatedMargin = medianPrice - listing.price_sek`. If the listing price is above the median sold price, the margin is negative.
   - What's unclear: Should negative margins be suppressed or passed through?
   - Recommendation: Pass through as-is. The `min_margin` check already filters out insufficient margins when configured. Phase 7 formats the number; the engine should not apply silent filtering beyond what thresholds dictate.

3. **Does `detectDeals` need the `novel` array or the full scraped array?**
   - What we know: CONTEXT.md and runCycle.js both confirm `detectDeals(novel, db)` where `novel` is the deduplication-filtered output (truly new listings only).
   - What's unclear: Nothing — this is confirmed.
   - Recommendation: Always pass `novel` (post-dedup). Running against already-seen listings wastes work and would alert on previously dismissed items.

---

## Sources

### Primary (HIGH confidence)

- `src/scrapers/soldCache.js` — direct code inspection; `lookupSoldPrice` API, never-throws contract, query format, return shape confirmed
- `src/db/init.js` — direct code inspection; `thresholds` table schema, `scan_log` columns (including `deals_alerted`), `keywords` as TEXT
- `src/scheduler/runCycle.js` — direct code inspection; injection point at line 47, stmtInsertLog with hardcoded 0 confirmed at line 24-28
- `src/scrapers/IScraper.js` — direct code inspection; `Listing` typedef confirmed including `auctionEndsAt: string|null`
- `src/scrapers/tradera.js` — direct code inspection; `auctionEndsAt` raw format `"15 mars 13:00"` via regex `Sluttid\s*(\d+\s+\w+\s+\d+:\d+)` confirmed
- `.planning/phases/06-deal-detection-engine/06-CONTEXT.md` — all locked decisions read verbatim
- `package.json` — no test runner configured; Node `assert` + direct script execution is the project's test pattern

### Secondary (MEDIUM confidence)

- Node.js `Date` constructor behavior for year-boundary edge cases — well-documented, built-in; recommendation to use `+1 year` fallback is standard practice for this pattern

### Tertiary (LOW confidence)

- None. All findings are grounded in direct code inspection of the existing codebase.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all modules inspected directly
- Architecture: HIGH — all integration points confirmed from source code
- Pitfalls: HIGH — identified from actual code (hardcoded 0 in stmtInsertLog, comma-separated keywords in TEXT column, year boundary in date parser)

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain — pure logic, no external APIs introduced)
