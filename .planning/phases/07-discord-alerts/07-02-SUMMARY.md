---
phase: 07-discord-alerts
plan: 02
subsystem: discord
tags: [discord, alertSender, runCycle, cron, async-iife, fire-and-forget]

# Dependency graph
requires:
  - phase: 07-01
    provides: alertSender.js Discord module with init(), enqueue(), sendStartupMessage()
  - phase: 06-03
    provides: runCycle.js with detectDeals integration
provides:
  - Full Discord alerts pipeline: index.js inits Discord before cron, runCycle enqueues alerts fire-and-forget
  - Startup message posted to Discord channel before first scan cycle
  - Restart safety: alerted_at prevents re-posting already-alerted listings
affects: [08-dashboard, 09-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Async IIFE in index.js — awaits Discord ready before scheduling cron
    - Fire-and-forget enqueue — runCycle does not await Discord sends, preserving noOverlap semantics
    - Injected dependency pattern — alertSender passed as 4th param, null-safe for tests

key-files:
  created: []
  modified:
    - src/scheduler/runCycle.js
    - index.js

key-decisions:
  - "Discord init placed in async IIFE in index.js — ensures client.ready fires before cron.schedule"
  - "alertSender passed as injected 4th param to runCycle — null-safe, keeps tests working without Discord"
  - "enqueue called without await inside runCycle — queue drains async, cycle returns immediately (noOverlap: true preserved)"

patterns-established:
  - "Pattern: async IIFE wraps startup sequence requiring await at top-level CJS entry point"
  - "Pattern: injected optional dependency (alertSender|null) for Discord — enables backward-compatible testing"

requirements-completed:
  - ALRT-01
  - ALRT-02
  - ALRT-03

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 7 Plan 02: Wire alertSender into Live Process Summary

**index.js async IIFE awaits Discord init before cron schedule; runCycle accepts alertSender as fire-and-forget injected dependency — full pipeline connected: scrape -> detectDeals -> Discord embeds**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T11:02:43Z
- **Completed:** 2026-03-03T11:04:30Z
- **Tasks:** 3 (2 auto + 1 human-verify — all approved)
- **Files modified:** 2

## Accomplishments
- runCycle.js accepts alertSender as optional 4th param — fire-and-forget enqueue with null guard for backward compat
- index.js startup converted to async IIFE — Discord init and startup message sent before cron is scheduled
- Full pipeline connected: scrapers -> detectDeals -> alertSender.enqueue -> Discord channel embeds
- Cron cycle not blocked by Discord send queue — noOverlap: true semantics preserved

## Task Commits

Each task was committed atomically:

1. **Task 1: Update runCycle.js to accept and call alertSender** - `b363d12` (feat)
2. **Task 2: Update index.js to init Discord and send startup message** - `92e5c0b` (feat)
3. **Task 3: Human verify Discord embeds in channel** - approved by user (no code changes — verification-only)

## Files Created/Modified
- `src/scheduler/runCycle.js` - Added alertSender 4th param, fire-and-forget enqueue with null guard, updated JSDoc
- `index.js` - Converted startup to async IIFE, added alertSender.init/sendStartupMessage, pass discord to runCycle

## Decisions Made
- Async IIFE used in index.js because top-level await is not available in CommonJS modules — wraps all startup requiring async (Discord init, cron schedule) cleanly
- alertSender injected as 4th parameter to runCycle (not global) — existing tests calling runCycle(scrapers, keywords, db) continue working without Discord, null-safe guard
- enqueue called without await — ensures runCycle returns immediately after scrape, prevents Discord 30s throttle from blocking noOverlap: true cron behavior

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
Discord credentials must be configured in `.env` before running:
- `DISCORD_TOKEN` — Bot token from Discord Developer Portal
- `DISCORD_CHANNEL_ID` — Target channel ID for alerts

## Next Phase Readiness
- Full Discord pipeline connected, verified, and approved
- Startup message confirmed in Discord channel on `node index.js`
- Deal embeds confirmed appearing with correct fields (title, price, marketplace, category, margin)
- Restart confirmed: alerted_at prevents re-posting already-alerted listings
- Ready to proceed to Phase 8 (Discord Commands)

---
*Phase: 07-discord-alerts*
*Completed: 2026-03-03*
