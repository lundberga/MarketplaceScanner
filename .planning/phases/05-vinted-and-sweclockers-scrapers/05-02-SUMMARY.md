---
phase: 05-vinted-and-sweclockers-scrapers
plan: 02
subsystem: scraper
tags: [rss, cheerio, undici, sweclockers, scraping, seed-mode, dedup]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: logger, parsePrice, IScraper interface
  - phase: 03-blocket-scraper
    provides: blocketRunner.js seed-mode + dedup pattern, classifyCategory function

provides:
  - SweclockersScraper class — RSS XML fetch with cheerio xmlMode, [Säljes] filter, Listing[] normalization
  - runSweclockers() — seed-mode detection and filterAndMarkSeen dedup wrapper

affects:
  - 05-03-vinted-and-sweclockers-integration
  - index.js (scheduler integration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - RSS xmlMode parsing with cheerio (load xml with xmlMode:true, iterate $('item'))
    - guid fallback for RSS link extraction
    - Title-based category classification (no per-keyword loop — single RSS covers all)
    - parsePrice(description) ?? 0 price fallback for CDATA descriptions

key-files:
  created:
    - src/scrapers/sweclockers.js
    - src/scrapers/sweclockersRunner.js
  modified: []

key-decisions:
  - "classifyCategory(title) called on listing title — Sweclockers has no per-keyword loop unlike Blocket"
  - "guid element used as fallback when <link> is empty — confirmed permaLink in Sweclockers RSS"
  - "No smoke-test block in sweclockersRunner.js — integration testing deferred to plan 05-03"
  - "Price: parsePrice(description) ?? 0 — CDATA text contains price prose; fallback to 0 never null"

patterns-established:
  - "RSS scraper pattern: single fetch, xmlMode cheerio, item iteration, prefix filter, guid fallback"
  - "Title classification pattern: classifyCategory on listing title not keyword for single-feed sources"

requirements-completed: [SCRP-04]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 5 Plan 02: SweclockersScraper Summary

**SweclockersScraper with RSS xmlMode parse, [Säljes] filter, and seed-mode dedup runner — mirrors BlocketScraper pattern adapted for single-feed RSS source**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-03T10:05:54Z
- **Completed:** 2026-03-03T10:07:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- SweclockersScraper class fetches RSS from sweclockers.com/feeds/marknad, parses with cheerio xmlMode, filters to [Säljes] only, and normalizes to Listing objects
- Price extracted via parsePrice(description) on CDATA description text with ?? 0 fallback ensuring price_sek is always an integer
- sweclockersRunner.js is a direct mirror of blocketRunner.js with seed-mode (SEED_MODE env or cold DB) and filterAndMarkSeen dedup

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement SweclockersScraper (sweclockers.js)** - `6d33ec4` (feat)
2. **Task 2: Implement sweclockersRunner.js (seed-mode + dedup wrapper)** - `55e1cb4` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/scrapers/sweclockers.js` - SweclockersScraper class: RSS fetch, xmlMode parse, [Säljes] filter, guid fallback, classifyCategory(title)
- `src/scrapers/sweclockersRunner.js` - runSweclockers(): seed-mode detection + filterAndMarkSeen dedup wrapper

## Decisions Made

- classifyCategory is called on listing title (not keyword) — unlike Blocket which classifies per keyword, Sweclockers is a single RSS feed covering all categories, so per-title classification is the correct approach
- guid element used as fallback when `<link>` is empty — confirmed permaLink in the live RSS feed
- No `if (require.main === module)` smoke-test block in runner — integration/live testing happens in plan 05-03

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SweclockersScraper and runSweclockers are ready for integration in plan 05-03 (live smoke test + index.js wiring)
- No blockers — RSS feed was live-verified during planning phase

## Self-Check: PASSED

- FOUND: src/scrapers/sweclockers.js
- FOUND: src/scrapers/sweclockersRunner.js
- FOUND: .planning/phases/05-vinted-and-sweclockers-scrapers/05-02-SUMMARY.md
- FOUND commit: 6d33ec4 (feat(05-02): SweclockersScraper)
- FOUND commit: 55e1cb4 (feat(05-02): sweclockersRunner)

---
*Phase: 05-vinted-and-sweclockers-scrapers*
*Completed: 2026-03-03*
