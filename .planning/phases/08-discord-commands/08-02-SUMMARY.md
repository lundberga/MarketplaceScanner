---
phase: 08-discord-commands
plan: 02
subsystem: discord
tags: [discord.js, slash-commands, zod, sqlite, better-sqlite3]

# Dependency graph
requires:
  - phase: 08-01
    provides: commandHandler.js with lazy-require routing for 'threshold' case
  - phase: 01-foundation
    provides: thresholds table DDL in src/db/init.js
  - phase: 06-deal-detection-engine
    provides: detectDeals.js loadThresholds() that reads from the same thresholds table
affects: [08-03-pause-resume-command, 08-04-dismiss-command]

provides:
  - src/discord/commands/threshold.js exporting handleThreshold(interaction, db)
  - thresholdSet: Zod-validated INSERT into thresholds (active=1) with ephemeral confirmation
  - thresholdRemove: soft-delete (active=0) with name-not-found handling
  - thresholdList: ephemeral code-block reply of active thresholds or "No active thresholds."
  - src/discord/commands/threshold.test.js — 14 passing tests covering all behaviors

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod safeParse + flatten().fieldErrors for field-level error messages — never thrown exceptions"
    - "INSERT always (no upsert) — two rows with same name both stay active; update = remove + set"
    - "soft-delete via active=0, not DELETE — preserves history; loadThresholds() WHERE active=1 continues to work"
    - "MessageFlags.Ephemeral (64) on every interaction.reply — invoker-only visibility"

key-files:
  created:
    - src/discord/commands/threshold.js
    - src/discord/commands/threshold.test.js
  modified: []

key-decisions:
  - "INSERT always (no ON CONFLICT/upsert) — two rows with same name is acceptable; update pattern is remove + set"
  - "Soft-delete via active=0 (not DELETE) — detectDeals.loadThresholds() uses WHERE active=1, no other code change needed"
  - "Zod schema rejects max_price=0 (must be positive int) and min_margin>1.0 (0..1 range) — field errors in reply content, never thrown"
  - "MessageFlags.Ephemeral on every reply path including error paths — invoker-only visibility enforced at module level"

patterns-established:
  - "TDD with in-memory SQLite + interaction stub: makeDb() + makeInteraction(subcommand, opts) pattern for testing Discord command handlers without discord.js client"

requirements-completed: [CMND-01, CMND-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 8 Plan 02: Threshold Command Summary

**`/threshold set|remove|list` slash command with Zod validation, soft-delete SQLite writes, and ephemeral replies — fully TDD with 14 passing tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T11:58:36Z
- **Completed:** 2026-03-03T12:01:19Z
- **Tasks:** 1 (TDD: test + feat commits)
- **Files modified:** 2

## Accomplishments

- `src/discord/commands/threshold.js` created with `handleThreshold` router and three subcommand handlers
- thresholdSet inserts a new active row (active=1) into thresholds with Zod validation; rejects invalid max_price and min_margin with field-level error messages
- thresholdRemove soft-deletes (active=0) by name; replies gracefully when name not found (changes===0)
- thresholdList returns all active rows as a formatted code block or "No active thresholds." when empty
- All replies use `flags: MessageFlags.Ephemeral` — only the invoker sees them
- 14-test suite covers all behaviors using in-memory SQLite and interaction stubs

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for threshold command** - `f984281` (test)
2. **Task 1 (GREEN): Implement threshold slash command** - `0ed312f` (feat)

**Plan metadata:** (docs: complete plan — in progress)

## Files Created/Modified

- `src/discord/commands/threshold.js` - handleThreshold router; thresholdSet/thresholdRemove/thresholdList subcommand handlers; Zod schemas; ephemeral replies throughout
- `src/discord/commands/threshold.test.js` - 14 tests covering valid insert, Zod rejection, soft-delete, not-found handling, list code block, empty list, inactive row exclusion, unknown subcommand

## Decisions Made

- **INSERT always, no upsert:** Two rows with the same name can coexist as active. Operator workflow to update: `/threshold remove <name>` then `/threshold set <name>`. Avoids complexity of UPSERT semantics.
- **Soft-delete (active=0):** `detectDeals.loadThresholds()` reads `WHERE active = 1` — no changes needed to the deal detection engine. History preserved.
- **Zod rejects max_price=0:** Schema uses `.positive()` which requires > 0. Zero price would be semantically invalid (any listing would match).
- **Zod rejects min_margin > 1.0:** Schema uses `.max(1)` — min_margin is a fraction (0.0 to 1.0). Values above 1.0 indicate a misunderstanding of the field.
- **MessageFlags.Ephemeral on all paths:** Error replies, success replies, and not-found replies all use ephemeral. No command output is visible to other users.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required during this plan. The `/threshold` command is ready to use once `npm run register` has been run with valid DISCORD_CLIENT_ID and GUILD_ID.

## Next Phase Readiness

- `src/discord/commands/threshold.js` is live — commandHandler.js lazy-require for 'threshold' case will now succeed
- Plans 08-03 (pause/resume) and 08-04 (dismiss) can proceed independently
- No changes needed to detectDeals.js or runCycle.js — threshold table writes are the only integration needed

---
*Phase: 08-discord-commands*
*Completed: 2026-03-03*

## Self-Check: PASSED

- FOUND: src/discord/commands/threshold.js
- FOUND: src/discord/commands/threshold.test.js
- FOUND: .planning/phases/08-discord-commands/08-02-SUMMARY.md
- FOUND commit: f984281 (test - RED)
- FOUND commit: 0ed312f (feat - GREEN)
