---
phase: 08-discord-commands
plan: "04"
subsystem: discord
tags: [discord.js, better-sqlite3, slash-commands, sqlite-migration]

# Dependency graph
requires:
  - phase: 08-01
    provides: commandHandler routing scaffold with switch case for 'dismiss'
  - phase: 07-discord-alerts
    provides: alertSender.js with filterUnalerted and seen_listings schema
provides:
  - dismiss slash command that marks seen_listings.dismissed=1 permanently
  - migrateDismissed idempotent migration for seen_listings.dismissed column
  - filterUnalerted updated to exclude dismissed=1 listings from future alerts
affects: [alertSender.js, commandHandler.js, seen_listings schema]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - pragma table_info guard for idempotent SQLite column migrations
    - Ephemeral replies for all slash command responses
    - dismissed=0/null double-guard for defensive null safety after migration

key-files:
  created:
    - src/discord/commands/dismiss.js
  modified:
    - src/discord/alertSender.js

key-decisions:
  - "dismissed=0 || dismissed===null double-guard in filterUnalerted — SQLite ALTER TABLE ADD COLUMN DEFAULT 0 applies retroactively, but null guard covers rows inserted before migration ran on cold start"
  - "migrateDismissed called inside alertSender.init() alongside migrateAlertedAt — both columns guaranteed present before any command handler fires"
  - "handleDismiss checks not-found and already-dismissed before UPDATE — surfaces clear messages rather than silent no-ops"

patterns-established:
  - "Pragma guard pattern: db.pragma('table_info(seen_listings)') check before ALTER TABLE — idempotent column migration, same as migrateAlertedAt"
  - "All slash command replies use MessageFlags.Ephemeral — operator-only visibility"

requirements-completed: [CMND-04]

# Metrics
duration: 1min
completed: 2026-03-03
---

# Phase 8 Plan 04: Dismiss Command Summary

**`/dismiss` slash command with idempotent dismissed column migration, filtering dismissed=1 listings permanently from future alert cycles via updated filterUnalerted**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-03T11:58:43Z
- **Completed:** 2026-03-03T12:00:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/discord/commands/dismiss.js` with `migrateDismissed` (idempotent pragma-guarded column migration) and `handleDismiss` (ephemeral slash command with not-found/already-dismissed checks)
- Updated `alertSender.js` to call `migrateDismissed(db)` in `init()` so the dismissed column is guaranteed present before any command fires
- Updated `filterUnalerted` to SELECT and check the dismissed column — dismissed listings never enter the alert queue

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/discord/commands/dismiss.js with migrateDismissed** - `40e6e5b` (feat)
2. **Task 2: Update alertSender.js — call migrateDismissed and update filterUnalerted** - `27512b8` (feat)

## Files Created/Modified

- `src/discord/commands/dismiss.js` - migrateDismissed + handleDismiss exported; handles not-found, already-dismissed, and success cases with ephemeral replies
- `src/discord/alertSender.js` - Added migrateDismissed require, init() call, and updated filterUnalerted to exclude dismissed=1 rows

## Decisions Made

- `dismissed === 0 || dismissed === null` double-guard in filterUnalerted: SQLite's ALTER TABLE ADD COLUMN with DEFAULT 0 applies the default retroactively via schema metadata, so existing rows return 0; the null guard is defensive for rows inserted on a cold start before migration ran
- migrateDismissed called in alertSender.init() alongside migrateAlertedAt — consistent migration pattern, both columns ensured before any command handler invokes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/dismiss` command fully wired: dismiss.js exports handleDismiss, commandHandler routing (08-01) already has the switch case
- Dismissed listings are permanently filtered from future enqueue() calls
- Phase 08 plans 08-02 (status), 08-03 (pause/resume) and this plan (08-04, dismiss) are all complete

## Self-Check: PASSED

- FOUND: src/discord/commands/dismiss.js
- FOUND: .planning/phases/08-discord-commands/08-04-SUMMARY.md
- FOUND commit: 40e6e5b (feat: create dismiss.js)
- FOUND commit: 27512b8 (feat: update alertSender)

---
*Phase: 08-discord-commands*
*Completed: 2026-03-03*
