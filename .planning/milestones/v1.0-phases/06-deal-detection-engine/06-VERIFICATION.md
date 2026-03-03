---
phase: 06-deal-detection-engine
verified: 2026-03-03T11:25:00Z
status: passed
score: 19/19 must-haves verified
re_verification: false
---

# Phase 6: Deal Detection Engine — Verification Report

**Phase Goal:** Every new listing is evaluated for deal worthiness — checked against user-defined price thresholds and enriched with an estimated profit margin from Tradera sold comparables — and only genuinely cheap listings reach the next layer as DealAlert structs.

**Verified:** 2026-03-03T11:25:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All truths are drawn from the three plan `must_haves` blocks covering plans 06-01, 06-02, and 06-03.

#### Plan 06-01 Truths (parseAuctionEnd utility)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A raw Swedish date string '15 mars 13:00' is parsed to a millisecond timestamp for the correct date | VERIFIED | `parseAuctionEnd.js` line 24: regex + month map + Date constructor. Test "parseAuctionEnd("15 mars 13:00") returns a number" PASSES. |
| 2 | A null or malformed auctionEndsAt returns null from parseAuctionEnd | VERIFIED | Lines 22, 25, 33 return null on falsy, no-match, and unknown-month cases. 3 passing tests cover this. |
| 3 | An auction ending within 2 hours passes the filter; one ending in 3 hours is filtered out | VERIFIED | `passesAuctionFilter` line 69: `endsAt > now && (endsAt - now) <= TWO_HOURS_MS`. Tests "90 minutes returns true" and "3 hours returns false" both PASS. |
| 4 | A buy_now listing always passes the auction filter regardless of auctionEndsAt value | VERIFIED | Line 61: `if (listing.listingType === 'buy_now') return true`. Test PASSES. |
| 5 | A year-boundary case (e.g. December date parsed in January) resolves to next year | VERIFIED | Lines 42-45: candidate pushed to year+1 when >60s in the past. Test for '31 december 23:50' from January PASSES. Note: plan clarified that December-in-January stays in current year (future date), not next year — implementation is correct. |

#### Plan 06-02 Truths (detectDeals engine)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | A listing priced below threshold.max_price (and matching category/keywords/marketplace) produces a DealAlert | VERIFIED | `matchesThreshold` checks max_price, category, keywords, marketplace. Test "price 1000 matches threshold max_price 1500 => one DealAlert" PASSES. |
| 7 | A listing priced above threshold.max_price is silently dropped | VERIFIED | `matchesThreshold` line 17: returns false when `listing.price_sek > threshold.max_price`. Test PASSES. |
| 8 | A listing matching no thresholds produces no DealAlert | VERIFIED | The `matchesThreshold` loop simply produces no alerts. Tests with keyword mismatch and marketplace mismatch confirm this. |
| 9 | A mid-auction listing (auction, auctionEndsAt null or beyond 2h) is filtered before any sold-comps HTTP call | VERIFIED | `detectDeals.js` line 85: `listings.filter(passesAuctionFilter)` runs before the inner loop that calls `buildAlert` (which calls `lookupFn`). Test "auction with auctionEndsAt=null is filtered before threshold check" PASSES. |
| 10 | DealAlert includes estimatedMargin = medianSoldPrice - price_sek when comps are available | VERIFIED | `buildAlert` line 37: `medianPrice - listing.price_sek`. Test asserts `alerts[0].estimatedMargin === 1000` for medianPrice=3000, price=2000. PASSES. |
| 11 | DealAlert has estimatedMargin: null and sampleCount: 0 when sold-comps unavailable | VERIFIED | `buildAlert` line 37: ternary returns null when medianPrice is null. Test PASSES with both fields confirmed. |
| 12 | min_margin check is SKIPPED (listing passes) when sold-comps are unavailable | VERIFIED | `buildAlert` line 40: `if (threshold.min_margin !== null && medianPrice !== null)` — guard requires both conditions. Test "min_margin skipped when comps unavailable" PASSES. |
| 13 | min_margin check fails (listing dropped) when comps exist and margin is below threshold.min_margin * medianPrice | VERIFIED | Lines 40-43: `requiredMargin = threshold.min_margin * medianPrice; if (estimatedMargin < requiredMargin) return null`. Test for margin 800 < required 900 PASSES. |
| 14 | detectDeals returns [] and never throws when thresholds table is empty | VERIFIED | Lines 79-82: logger.warn + return []. Test "listing with empty threshold DB returns []" PASSES. |
| 15 | detectDeals returns [] and never throws on unexpected internal error | VERIFIED | Lines 108-110: outer try/catch returns []. Test "detectDeals never throws when lookupSoldPrice throws" PASSES. |
| 16 | No thresholds configured logs a warn-level message once per call | VERIFIED | Line 80: `logger.warn('detectDeals: no active thresholds configured — returning []')`. Test stubs `logger.warn` and asserts it was called. PASSES. |
| 17 | Empty listings input returns [] immediately without DB or HTTP calls | VERIFIED | Line 76: `if (listings.length === 0) return []` before any DB query. Test "empty listings returns [] without querying DB" PASSES. |

#### Plan 06-03 Truths (runCycle wiring)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 18 | After each scraper.run() call in runCycle, detectDeals is called with the novel listings and the db handle | VERIFIED | `runCycle.js` lines 55-56: `const alerts = await detectDeals(novel, db); dealsAlerted = alerts.length;` — inside the successful try block after `scraper.run()`. |
| 19 | scan_log.deals_alerted is populated with alerts.length, not hardcoded 0 | VERIFIED | Line 28: `VALUES (?, ?, ?, ?, ?, ?, ?)` — all seven `?` placeholders. Line 66: `stmtInsertLog.run(..., dealsAlerted, errorMsg)` — dealsAlerted is 6th positional argument. No hardcoded 0. |

**Score: 19/19 truths verified**

---

### Required Artifacts

| Artifact | Provides | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `src/utils/parseAuctionEnd.js` | parseAuctionEnd + passesAuctionFilter exports | Yes | Yes (72 lines, full implementation) | Yes — imported by detectDeals.js line 4 and used at line 85 | VERIFIED |
| `src/utils/parseAuctionEnd.test.js` | 11 unit tests covering all filter paths | Yes | Yes (109 lines, real assertions) | Yes — runs with node; all 11 pass | VERIFIED |
| `src/deals/detectDeals.js` | detectDeals(listings, db, _lookup) — async, never throws, returns DealAlert[] | Yes | Yes (114 lines, full logic) | Yes — imported by runCycle.js line 4 and called at line 55 | VERIFIED |
| `src/deals/detectDeals.test.js` | 18 unit tests using in-memory SQLite and injected lookupSoldPrice stubs | Yes | Yes (318 lines, real assertions across 10 groups) | Yes — runs with node; all 18 pass | VERIFIED |
| `src/scheduler/runCycle.js` | Modified runCycle with detectDeals injection and corrected deals_alerted in scan_log | Yes | Yes (72 lines, detectDeals wired) | Yes — loads cleanly; detectDeals called post-scrape | VERIFIED |

---

### Key Link Verification

| From | To | Via | Pattern | Status | Evidence |
|------|----|-----|---------|--------|----------|
| `src/deals/detectDeals.js` | `src/utils/parseAuctionEnd.js` | `require('../utils/parseAuctionEnd')` | `passesAuctionFilter` | WIRED | Line 4 imports; line 85 uses in `listings.filter(passesAuctionFilter)` |
| `src/deals/detectDeals.js` | `src/scrapers/soldCache.js` | `require('../scrapers/soldCache')` | `lookupSoldPrice` | WIRED | Line 3 imports as `_lookupSoldPrice`; line 73 assigns as default `lookupFn`; line 35 calls `lookupFn(queryKey)` |
| `src/deals/detectDeals.js` | `thresholds table` | `db.prepare(...).all()` | `SELECT.*FROM thresholds WHERE active = 1` | WIRED | Lines 8-10: exact SQL confirmed, returns all active rows |
| `src/scheduler/runCycle.js` | `src/deals/detectDeals.js` | `require('../deals/detectDeals')` | `detectDeals` | WIRED | Line 4 imports; line 55 calls `await detectDeals(novel, db)` |
| `src/scheduler/runCycle.js` | `scan_log table` | `stmtInsertLog.run(..., dealsAlerted, ...)` | `deals_alerted` | WIRED | Line 28: column listed; line 66: dealsAlerted passed as 6th positional argument |

All 5 key links: WIRED.

---

### Requirements Coverage

| Requirement | Phase 6 Plans | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| DEAL-01 | 06-02, 06-03 | Bot evaluates each new listing against user-defined price thresholds per hardware category or specific item name | SATISFIED | `matchesThreshold()` in detectDeals.js checks category, max_price, keywords, marketplace against thresholds table; 5 threshold-match tests pass |
| DEAL-02 | 06-02, 06-03 | Bot fetches recent Tradera sold prices for similar items and includes estimated profit margin in alerts | SATISFIED | `buildAlert()` calls `lookupSoldPrice(queryKey)` and computes `estimatedMargin = medianPrice - price_sek`; DealAlert carries estimatedMargin, sampleCount, medianSoldPrice |
| DEAL-03 | 06-01, 06-02, 06-03 | Bot only alerts on buy-now listings or auctions ending within 2 hours — never on current bid prices mid-auction | SATISFIED | `passesAuctionFilter()` enforces buy_now-always-pass and auction-within-2h rule; auction filter runs before sold-comps HTTP calls in detectDeals |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps only DEAL-01, DEAL-02, DEAL-03 to Phase 6. No requirements assigned to Phase 6 are absent from the plan `requirements` fields.

All 3 requirements: SATISFIED.

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| All three implementation files | `return null` / `return []` occurrences | Info | All are legitimate guard clauses (parse failure, empty input, error recovery) — not stubs |
| All files | No TODO/FIXME/placeholder strings | — | None found |
| All files | No console.log-only implementations | — | None found — logger (pino) used throughout |

No blockers. No warnings. All anti-pattern checks clear.

---

### Commits Verified

All commits documented in SUMMARYs confirmed present in git log:

| Commit | Description |
|--------|-------------|
| `a38063e` | test(06-01): add failing tests for parseAuctionEnd and passesAuctionFilter |
| `28bd466` | feat(06-01): implement parseAuctionEnd and passesAuctionFilter utility |
| `7df3c89` | test(06-02): add failing tests for detectDeals engine |
| `611e241` | feat(06-02): implement detectDeals engine |
| `5c0b779` | feat(06-03): wire detectDeals into runCycle and fix deals_alerted |

---

### Human Verification Required

None. All behaviors verifiable programmatically:

- Test suites run with node (no browser, no network required — in-memory SQLite + stubbed HTTP)
- Wiring verified by static grep of require paths and call sites
- The production `lookupSoldPrice` makes real HTTP calls but that is Phase 2 scope — its contract is tested in soldCache tests and injected as a stub here

---

### Gaps Summary

No gaps found. Phase 6 goal is fully achieved:

1. `parseAuctionEnd.js` correctly parses Swedish auction-end strings and filters auctions to the 2-hour window (11/11 tests pass).
2. `detectDeals.js` correctly evaluates every novel listing against active thresholds, runs the auction filter before any HTTP calls, enriches matched listings with sold-comp margin data, skips listings with insufficient margin, and never throws (18/18 tests pass).
3. `runCycle.js` correctly calls `detectDeals(novel, db)` after each successful `scraper.run()` and writes the real alert count to `scan_log.deals_alerted` (no hardcoded 0 remaining).

The pipeline from scrape to deal to DealAlert struct is complete and ready for Phase 7 (Discord notifier).

---

_Verified: 2026-03-03T11:25:00Z_
_Verifier: Claude (gsd-verifier)_
