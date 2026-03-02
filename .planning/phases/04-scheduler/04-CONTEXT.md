# Phase 4: Scheduler - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

An autonomous polling loop that starts when `node index.js` runs and continues indefinitely. On each cycle it scrapes all enabled marketplaces sequentially, reads pause state live from SQLite, writes a `scan_log` row per marketplace, and never starts a new cycle while the previous one is still running. No UI. No deal detection (Phase 6). No Discord output (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Keywords configuration
- Defined as a comma-separated `.env` variable: `KEYWORDS=rtx 3080,rtx 3090,rtx 4080,rx 6800`
- Parsed once at startup into a string array shared across all marketplaces
- All scrapers scrape the same keyword list (no per-marketplace keyword sets in this phase)

### Poll interval
- Configured via `SCAN_INTERVAL_MINUTES` in `.env` (default: 15)
- `node-cron` expression built from this value at startup
- The `user_config` table already hints at `scan_interval_minutes` as a future DB-controlled key — leave that for Phase 8 slash commands, not Phase 4

### Startup behavior
- First scan fires **immediately** on process start (do not wait for first cron tick)
- Subsequent scans fire on the cron schedule
- Seed mode is already handled per-scraper in `runTradera` / `blocketRunner` — the scheduler calls those and respects their existing seed logic

### Cycle sequencing — no overlap
- `p-queue` with `concurrency: 1` manages the cycle queue
- When a cron tick fires: if a cycle is still running, **skip that tick** (enqueue nothing, log a warning)
- This satisfies: "a new cycle does not start until the previous one finishes"

### Pause mechanism
- `user_config` table key-value store (already in schema): `key = '{marketplace}.paused'`, `value = 'true'` | `'false'`
- Checked **live at the start of each scraper's turn** within the cycle — no caching, no restart needed
- If `value = 'true'`: skip that marketplace's scraper, log that it was skipped, write a scan_log row with `error = 'paused'` and `listings_found = 0`
- Example keys: `'tradera.paused'`, `'blocket.paused'`

### Error isolation
- Each scraper call wrapped in individual try/catch inside the cycle loop
- One scraper throwing does **not** abort remaining scrapers in the cycle
- `scan_log` row written per marketplace per cycle — `error` column populated on failure, `completed_at` and `listings_found` set to what completed before the error
- Scheduler itself (the cron loop) never crashes on scraper errors

### scan_log writes
- One row per marketplace per cycle (matches `scan_log.marketplace NOT NULL` schema)
- Fields: `marketplace`, `started_at` (unix ts), `completed_at` (unix ts), `listings_found` (total from scraper), `new_listings` (novel after dedup), `deals_alerted = 0` (Phase 6 wires this), `error` (null on success)
- Written at the end of each scraper run within the cycle

### Entry point
- `index.js` (currently a stub) becomes the scheduler entry point
- Replaces the stub with: dotenv load, DB init check, build scraper array, start scheduler loop

### Claude's Discretion
- Exact `node-cron` expression format for minute-based intervals
- Whether to expose a `MARKETPLACES` env var to enable/disable scrapers at the array level, or always include all scrapers and rely solely on `user_config` pause state
- Log message wording for cycle start/end/skip events
- Whether to seed-check all marketplaces before the first cycle or rely on each runner's existing seed detection

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scrapers/traderaRunner.js` → `runTradera(keywords)`: returns novel listings, handles seed mode internally — scheduler calls this directly
- `src/scrapers/blocketRunner.js`: currently a CLI smoke-test script, not a reusable function — needs a `runBlocket(keywords)` export added (or refactored) for the scheduler to call
- `src/db/seenListings.js` → `filterAndMarkSeen`, `countSeen`: already used by runners, no changes needed
- `src/utils/logger.js`: pino logger, already configured for dev/prod — use throughout scheduler

### Established Patterns
- Seed mode: `countSeen(marketplace) === 0 || SEED_MODE=true` → insert all, return [] — already in traderaRunner, blocketRunner follows same pattern
- dotenv: loaded at the top of each runner file via `require('dotenv').config()` — scheduler entry point does the same
- DB singleton: `require('../db/index')` returns the single better-sqlite3 instance

### Integration Points
- `index.js` is the entry point — currently `logger.info('Scanner starting')` only, this becomes the scheduler bootstrap
- `user_config` table: scheduler reads pause keys live each cycle; no existing read helper exists — needs a small `getConfig(key)` helper or inline query
- `scan_log` table: no existing write helper — scheduler writes directly via `db.prepare(...).run(...)`
- `blocketRunner.js` must export a `runBlocket(keywords)` function; currently it's a self-executing CLI script

</code_context>

<specifics>
## Specific Ideas

- `blocketRunner.js` needs to be split: keep the CLI smoke-test behavior under `if (require.main === module)`, but export `runBlocket(keywords)` for the scheduler — same pattern `traderaRunner.js` already uses with `runTradera`
- The scheduler's cycle loop is essentially: `for (const scraper of enabledScrapers) { if paused: skip; else: run, write scan_log }`
- p-queue with concurrency=1 ensures sequential execution; the cron callback checks `queue.size + queue.pending > 0` before enqueuing a new cycle

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-scheduler*
*Context gathered: 2026-03-02*
