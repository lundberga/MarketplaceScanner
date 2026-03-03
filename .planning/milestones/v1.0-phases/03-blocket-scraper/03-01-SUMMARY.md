---
phase: 03-blocket-scraper
plan: 01
subsystem: scrapers
tags: [blocket, cheerio, scraper, canary, dedup]
dependency_graph:
  requires: [src/utils/parsePrice.js, src/db/seenListings.js, src/utils/logger.js]
  provides: [BlocketScraper, blocketRunner]
  affects: [src/index.js (future integration)]
tech_stack:
  added: []
  patterns: [cheerio SSR HTML parsing, canary check pattern, seed-mode runner]
key_files:
  created:
    - src/scrapers/blocket.js
    - src/scrapers/blocketRunner.js
    - src/scrapers/blocket.test.js
  modified: []
decisions:
  - "Price selector: div.font-bold span — matches research-verified live structure"
  - "Canary check placed in scrape() after dedup loop, guards on deduped.length === 0 && keywords.length > 0"
  - "Test runner uses async/await wrapper to avoid promise timing race with assert"
metrics:
  duration: "8 min"
  completed: "2026-03-02"
  tasks_completed: 2
  files_created: 3
---

# Phase 03 Plan 01: BlocketScraper Implementation Summary

**One-liner:** Cheerio SSR scraper for Blocket using `a.sf-search-ad-link` selector with canary warn and seed-mode CLI runner.

## What Was Built

### src/scrapers/blocket.js
Exports `BlocketScraper` class implementing the IScraper interface:
- `scrape(keywords)`: Sequential keyword loop with 3s delay, batch dedup by ID, canary check
- `_fetchKeyword(keyword)`: undici fetch with browser User-Agent headers, non-200 and network error handling
- `_parse(html, keyword)`: Cheerio-based parser targeting `a.sf-search-ad-link` elements

### src/scrapers/blocket.test.js
4 assert-based unit tests (no Jest/Vitest):
1. `_parse()` on empty HTML returns `[]`
2. `_parse()` on valid HTML fixture returns correct Listing with all required fields
3. `scrape([])` returns `[]` without firing canary warn
4. Canary: `logger.warn` fires with 'Blocket canary' when `_fetchKeyword` returns `[]` with keywords present

### src/scrapers/blocketRunner.js
CLI smoke-test runner mirroring `traderaRunner.js`:
- `dotenv.config()` as absolute first statement
- Schema assertions on every returned listing
- Seed mode via `countSeen('blocket') === 0`
- Logs first 3 sample listings for visual inspection

## Cheerio Selector Strategy

Primary selector: `a.sf-search-ad-link`
- `id` attribute: numeric listing ID (e.g. `21205286`)
- `href` attribute: must contain `/recommerce/forsale/item/` (URL guard)
- Title: strip `span[aria-hidden="true"]` then `$a.text().trim().substring(0, 250)`
- Price: `$a.closest('article').find('div.font-bold span').first().text()`

No `__NEXT_DATA__` parsing anywhere. No `.card--cardShadow` or `.sf-result-list` selectors.

## Canary Check Location

In `scrape()` after the dedup loop:
```javascript
if (deduped.length === 0 && keywords.length > 0) {
  logger.warn({ keywords }, 'Blocket canary FAIL: zero results — possible structure change');
}
```

## Selector Deviations from Research

None. The `sf-search-ad-link` selector and `div.font-bold span` price selector matched the research-verified structure exactly.

## Test Results

```
PASS: _parse() on empty HTML string returns []
PASS: _parse() returns one Listing with correct fields from valid HTML
PASS: scrape() with empty keywords returns [] without canary warn
PASS: canary: logger.warn fires with Blocket canary when results empty with keywords

Results: 4 passed, 0 failed
```

## Decisions Made

1. **Async test runner:** Used `async function runTests()` wrapper instead of `Promise.resolve().then()` to avoid race condition where the summary printed before async test 4 completed.
2. **Price selector:** `div.font-bold span` within `closest('article')` — matches live-verified structure from research.
3. **Canary guards deduped count:** Canary fires on `deduped.length === 0` (not `allListings.length === 0`) to handle the edge case where all results are duplicates across keywords — though in practice Blocket IDs are unique per item.

## Deviations from Plan

None — plan executed exactly as written. The only auto-fix was the test structure (async wrapper) which was a test implementation detail, not a behavioral change.

## Self-Check

- [x] src/scrapers/blocket.js exists and exports BlocketScraper
- [x] src/scrapers/blocket.test.js exists and passes 4/4 tests
- [x] src/scrapers/blocketRunner.js exists and loads without syntax errors
- [x] No __NEXT_DATA__ in blocket.js
- [x] Commits: 6bc43b8 (Task 1), 6a4c740 (Task 2)

## Self-Check: PASSED
