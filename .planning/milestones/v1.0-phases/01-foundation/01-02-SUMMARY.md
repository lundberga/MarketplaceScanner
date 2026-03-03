---
phase: 01-foundation
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, wal, schema, singleton, commonjs]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: "better-sqlite3 installed, singleton logger (src/utils/logger.js) available"
provides:
  - "src/db/init.js — WAL-mode SQLite opener with all 5 tables, runnable standalone via node src/db/init.js"
  - "src/db/index.js — singleton better-sqlite3 Database instance shared by all modules"
  - "data/scanner.db — SQLite database file on disk with seen_listings, thresholds, sold_price_cache, user_config, scan_log tables"
  - "DB_PATH export — absolute path string to data/scanner.db for any module needing raw path"
affects:
  - "02-tradera-scraper"
  - "03-blocket-scraper"
  - "04-scheduler"
  - "05-additional-scrapers"
  - "06-discord-alerts"
  - "07-dedup"
  - "08-market-value"
  - "09-ops"

# Tech tracking
tech-stack:
  added:
    - "WAL journal mode on better-sqlite3 — concurrent reads during writes, crash-safe"
  patterns:
    - "Singleton DB pattern: require('./src/db/index') returns the single shared Database instance"
    - "Absolute path resolution: path.resolve(__dirname, '../../data/scanner.db') — survives CWD changes and pm2"
    - "Idempotent DDL: all CREATE TABLE/INDEX use IF NOT EXISTS — safe on every startup"
    - "initDb() exported from init.js for testing; singleton assembled in index.js"

key-files:
  created:
    - "src/db/init.js"
    - "src/db/index.js"
    - "data/scanner.db"
  modified: []

key-decisions:
  - "WAL journal mode — must be set before any writes; improves concurrent read performance and crash safety"
  - "Absolute DB_PATH via path.resolve(__dirname, ...) — prevents SQLITE_CANTOPEN when CWD differs from project root (pm2, Task Scheduler)"
  - "fs.mkdirSync with recursive: true — better-sqlite3 throws if parent directory does not exist"
  - "initDb() returns the db handle — enables direct use in index.js singleton and testability without global state"

patterns-established:
  - "Singleton DB: require('./src/db/index') — all modules share one connection, never open their own"
  - "Idempotent init: node src/db/init.js safe to call on every startup"
  - "WAL pragma first: db.pragma('journal_mode = WAL') before any exec/prepare"

requirements-completed: [DEUP-01, DEUP-02, DEUP-04]

# Metrics
duration: 1min
completed: 2026-03-02
---

# Phase 1 Plan 02: SQLite Schema Module Summary

**5-table SQLite schema with WAL mode, absolute-path DB_PATH, idempotent DDL, and singleton better-sqlite3 export powering all downstream layers**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-02T10:22:24Z
- **Completed:** 2026-03-02T10:23:37Z
- **Tasks:** 2
- **Files modified:** 2 created + 1 DB file on disk

## Accomplishments
- SQLite database created at absolute path with all 5 tables: seen_listings, thresholds, sold_price_cache, user_config, scan_log
- WAL journal mode confirmed active before any writes — concurrent reads enabled, crash-safe
- Idempotency verified: running `node src/db/init.js` twice produces no errors and preserves existing rows
- Singleton export from `src/db/index.js` verified: all 5 tables present, WAL mode active, row persistence confirmed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/db/init.js with full schema and WAL setup** - `efdcd41` (feat)
2. **Task 2: Create src/db/index.js singleton and verify schema** - `b92ea57` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/db/init.js` - DB opener, WAL pragma, CREATE TABLE IF NOT EXISTS DDL for all 5 tables; exports initDb and DB_PATH; runnable standalone
- `src/db/index.js` - Singleton better-sqlite3 Database instance; calls initDb() on first require; all modules should require this file
- `data/scanner.db` - SQLite database file on disk (4KB initial size; WAL shm/wal files created alongside)

## Decisions Made
- WAL journal mode set as first pragma before any DDL — this ordering is required; WAL mode cannot be toggled after the first write
- Absolute path via `path.resolve(__dirname, '../../data/scanner.db')` avoids SQLITE_CANTOPEN when pm2 or Task Scheduler changes the working directory
- `fs.mkdirSync({ recursive: true })` guards the `data/` directory creation — better-sqlite3 does not create parent directories
- `initDb()` returns the db handle rather than being void, enabling the index.js singleton pattern without global variables

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - better-sqlite3 WAL pragma, DDL exec, and singleton pattern all worked on first attempt.

## User Setup Required
None - no external service configuration required for this plan. The database file is created automatically on first run.

## Next Phase Readiness
- `require('./src/db/index')` returns a ready-to-use Database instance for any module in Phase 2+
- `seen_listings` table directly enables DEUP-01 (deduplication) and DEUP-02 (duplicate filtering)
- `thresholds` and `user_config` tables enable DEUP-04 (deal threshold configuration)
- `scan_log` table ready for Phase 4 scheduler to record scan history
- `sold_price_cache` table ready for Phase 8 market-value engine

## Self-Check: PASSED

All files confirmed present:
- FOUND: src/db/init.js
- FOUND: src/db/index.js
- FOUND: data/scanner.db
- FOUND: 01-02-SUMMARY.md

All commits confirmed:
- FOUND: efdcd41 (Task 1 - feat: create src/db/init.js with full schema and WAL setup)
- FOUND: b92ea57 (Task 2 - feat: create src/db/index.js singleton database export)

---
*Phase: 01-foundation*
*Completed: 2026-03-02*
