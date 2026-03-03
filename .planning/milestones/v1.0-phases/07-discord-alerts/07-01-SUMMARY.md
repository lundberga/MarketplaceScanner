---
phase: 07-discord-alerts
plan: 01
subsystem: discord
tags: [discord.js, sqlite, migration, embed, rate-limit, queue]

# Dependency graph
requires:
  - phase: 06-deal-detection-engine
    provides: DealAlert objects with listing, estimatedMargin, sampleCount from detectDeals()
  - phase: 01-foundation
    provides: pino logger (src/utils/logger.js), better-sqlite3 singleton (src/db/index.js)
provides:
  - src/discord/alertSender.js — Discord client lifecycle, embed builder, throttled queue, alerted_at migration
  - init(db) returns { enqueue, sendStartupMessage }
  - alerted_at migration on seen_listings (idempotent, PRAGMA guard)
  - Per-marketplace Discord embeds (Tradera=blue, Blocket=green, Vinted=teal, Sweclockers=orange)
  - Fire-and-forget throttled queue at 1 msg/1.5s
affects: [07-02-wire-discord, 08-discord-commands]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Discord Client ready-event promise wrapper (await new Promise with client.once ready/error, login inside promise)
    - Idempotent SQLite migration via PRAGMA table_info guard (no IF NOT EXISTS support in SQLite)
    - Fire-and-forget AlertQueue class with setTimeout drain loop (avoids p-queue ESM issue)
    - markAlerted only after successful channel.send (never in catch branch)
    - filterUnalerted in enqueue before pushing to queue (dedup at intake)

key-files:
  created:
    - src/discord/alertSender.js
  modified: []

key-decisions:
  - "EmbedBuilder imported from discord.js not @discordjs/builders — full ColorResolvable support including hex integers"
  - "enqueue is fire-and-forget — _drain() called without await, so callers (runCycle) return immediately"
  - "Client.channels.fetch() used instead of channels.cache.get() — cache may be empty at startup before GUILD_CREATE"
  - "alerted_at set only after successful channel.send — prevents permanent mark on failed delivery"
  - "filterUnalerted called inside enqueue before pushing to _queue — already-alerted listings never enter queue"

patterns-established:
  - "Pattern: Discord ready-event wrapping — login inside new Promise, resolve on ready, reject on error"
  - "Pattern: SQLite idempotent migration — db.pragma('table_info') check before ALTER TABLE"
  - "Pattern: AlertQueue.enqueue is synchronous and fire-and-forget — _drain() runs asynchronously in background"

requirements-completed: [ALRT-01, ALRT-02, ALRT-03]

# Metrics
duration: 4min
completed: 2026-03-03
---

# Phase 7 Plan 01: Discord alertSender Module Summary

**Discord output layer with throttled embed queue, marketplace-colored embeds, and idempotent alerted_at migration using PRAGMA guard**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-03T11:19:30Z
- **Completed:** 2026-03-03T11:23:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `src/discord/alertSender.js` exporting `init(db)` — full Discord output layer in one CommonJS module
- Implemented idempotent `migrateAlertedAt` using PRAGMA table_info guard (SQLite has no ADD COLUMN IF NOT EXISTS)
- Built `buildEmbed` with per-marketplace hex colors, conditional Marginal field, and 256-char title truncation
- Implemented fire-and-forget `AlertQueue` at 1 msg/1.5s with `filterUnalerted` dedup at enqueue time
- `markAlerted` (UPDATE seen_listings SET alerted_at) called only after successful `channel.send` — never on failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/discord/alertSender.js** - `799f4d3` (feat)

**Plan metadata:** (docs commit — see final_commit step)

## Files Created/Modified
- `src/discord/alertSender.js` - Discord client lifecycle, embed builder, throttled queue, alerted_at migration, filterUnalerted dedup

## Decisions Made
- EmbedBuilder imported from `discord.js` not `@discordjs/builders` — full ColorResolvable support
- `client.login()` called inside the ready-event promise (not awaited separately) — login resolves before ready fires
- `channels.fetch()` used instead of `channels.cache.get()` — cache may be empty before GUILD_CREATE at startup
- `enqueue` returns synchronously; `_drain()` runs as fire-and-forget async loop
- `filterUnalerted` called at enqueue time — already-alerted listings never enter queue, preventing redundant DB lookups at send time

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
Environment variables required before running:
- `DISCORD_TOKEN` — Bot token from Discord Developer Portal
- `DISCORD_CHANNEL_ID` — Target channel snowflake ID

These will be documented in Phase 7 Plan 02 USER-SETUP.md when the module is wired into index.js.

## Next Phase Readiness
- `alertSender.js` is complete and ready to wire into `index.js` (await `alertSender.init(db)` before cron starts) and `runCycle.js` (call `alertSender.enqueue(alerts)` after `detectDeals`)
- Plan 07-02 handles the wiring

---
*Phase: 07-discord-alerts*
*Completed: 2026-03-03*

## Self-Check: PASSED

- FOUND: src/discord/alertSender.js
- FOUND: commit 799f4d3 (feat(07-01): create Discord alertSender module)
