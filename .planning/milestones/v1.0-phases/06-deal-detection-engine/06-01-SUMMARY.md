---
phase: 06-deal-detection-engine
plan: 01
subsystem: utils
tags: [auction, date-parsing, swedish, filter, unit-tests, tdd]

# Dependency graph
requires:
  - phase: 02-tradera-scraper
    provides: Listing typedef with auctionEndsAt field (string|null, Swedish format)
provides:
  - parseAuctionEnd(raw, nowMs) — parses Swedish "DD månadsnamn HH:MM" to ms timestamp
  - passesAuctionFilter(listing, nowMs) — buy_now always passes; auction passes only if within 2h
affects:
  - 06-02-detectDeals (consumes passesAuctionFilter before sold-comps HTTP calls)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure utility with optional nowMs injection for deterministic testing
    - Node assert + async test runner pattern (blocket.test.js convention)
    - CommonJS module.exports with 'use strict'

key-files:
  created:
    - src/utils/parseAuctionEnd.js
    - src/utils/parseAuctionEnd.test.js
  modified: []

key-decisions:
  - "nowMs parameter injected into both functions for deterministic time-based tests — avoids Date.now() non-determinism"
  - "Year-boundary fix: if constructed candidate is in the past (>60s), year incremented by 1 — handles January dates parsed in December (e.g. '5 januari' in December gives next year)"
  - "TWO_HOURS_MS constant (7200000 ms) — auction passes if endsAt > now AND endsAt - now <= 2h"
  - "Regex: /^(\\d{1,2})\\s+(\\w+)\\s+(\\d{2}):(\\d{2})$/ on trimmed input — returns null on any mismatch"

patterns-established:
  - "Pattern 1: Swedish month map (januari..december) → JS month index 0-11"
  - "Pattern 2: TDD with RED commit then GREEN commit for utilities"

requirements-completed:
  - DEAL-03

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 6 Plan 01: parseAuctionEnd Utility Summary

**Pure Swedish auction-end-time parser (no deps) with passesAuctionFilter, covering null/malformed inputs, year-boundary, and 2-hour auction window — 11 tests all passing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T09:59:40Z
- **Completed:** 2026-03-03T10:02:34Z
- **Tasks:** 1 (TDD: 2 commits — RED then GREEN)
- **Files modified:** 2

## Accomplishments
- `parseAuctionEnd(raw, nowMs)` parses Swedish "15 mars 13:00" format to Unix ms timestamp with year-boundary handling
- `passesAuctionFilter(listing, nowMs)` correctly passes buy_now unconditionally and filters auctions to 2-hour window
- 11 unit tests covering all edge cases: null/empty/malformed inputs, valid parse, year-boundary, all filter paths

## Task Commits

Each task committed atomically with TDD protocol:

1. **RED — failing test file** - `a38063e` (test)
2. **GREEN — implementation** - `28bd466` (feat)

## Files Created/Modified
- `src/utils/parseAuctionEnd.js` — exports parseAuctionEnd + passesAuctionFilter; pure CommonJS, no external deps
- `src/utils/parseAuctionEnd.test.js` — 11 unit tests using node assert + async runner matching project convention

## Decisions Made
- `nowMs` parameter injected into both functions so tests are deterministic and free of `Date.now()` coupling
- Year-boundary fix triggers when candidate timestamp is >60s in the past — handles "5 januari" in December correctly
- Filter window: strictly `endsAt > now AND endsAt - now <= 7_200_000` (auction must be ongoing and end within 2 hours)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test year-boundary assertion corrected from 2027 to 2026**
- **Found during:** Task 1 (TDD RED — writing tests)
- **Issue:** Initial test for "31 december 23:50" called in January asserted year 2027. However the plan's algorithm constructs the candidate using `nowYear` (2026), and December 31 2026 is in the future from January 5 2026 — the 60-second-past check does not fire, correctly leaving the year as 2026. The must_haves truth "December date parsed in January resolves to next year" refers to "next year from last December" = 2026, not 2027.
- **Fix:** Updated test assertion to `d.getFullYear() === 2026` with explanation in comment. The year-boundary algorithm in the implementation is correct as specced — it handles the real boundary (January date in December) not December-in-January.
- **Files modified:** src/utils/parseAuctionEnd.test.js
- **Verification:** All 11 tests pass, node exits 0
- **Committed in:** 28bd466 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug in initial test assertion)
**Impact on plan:** Clarification only — implementation matches plan algorithm exactly; test was initially incorrect.

## Issues Encountered
- None — algorithm and tests aligned after clarifying the year-boundary case direction (January-in-December, not December-in-January)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `passesAuctionFilter` is ready to be imported by `src/deals/detectDeals.js` via `require('../utils/parseAuctionEnd')`
- Plan 06-02 can proceed immediately — no blockers

---
*Phase: 06-deal-detection-engine*
*Completed: 2026-03-03*
