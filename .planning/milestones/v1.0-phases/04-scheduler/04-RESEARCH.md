# Phase 4: Scheduler - Research

**Researched:** 2026-03-02
**Domain:** Node.js autonomous polling loop — node-cron v4, overlap prevention, SQLite live config reads, scan_log writes
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Keywords:** Defined as `KEYWORDS=rtx 3080,rtx 3090,...` in `.env`, parsed once at startup into a string array, shared across all marketplaces.
- **Poll interval:** Configured via `SCAN_INTERVAL_MINUTES` in `.env` (default: 15). `node-cron` expression built from this value at startup. DB-controlled interval deferred to Phase 8.
- **Startup behavior:** First scan fires immediately on process start via `task.execute()`. Subsequent scans fire on the cron schedule.
- **Cycle sequencing:** No overlap. When a cron tick fires while a cycle is still running, skip that tick and log a warning.
- **Pause mechanism:** `user_config` table key `'{marketplace}.paused'` with value `'true'`/`'false'`. Checked live at the start of each scraper's turn within the cycle — no caching, no restart needed. On pause: skip scraper, log skipped, write scan_log row with `error = 'paused'` and `listings_found = 0`.
- **Error isolation:** Each scraper call wrapped in individual try/catch. One failure does not abort remaining scrapers. scan_log row written per marketplace per cycle with `error` column populated on failure.
- **scan_log writes:** One row per marketplace per cycle. Fields: `marketplace`, `started_at`, `completed_at`, `listings_found`, `new_listings`, `deals_alerted = 0`, `error` (null on success).
- **Entry point:** `index.js` (currently a stub) becomes the scheduler bootstrap: dotenv load, DB init check, build scraper array, start scheduler loop.
- **blocketRunner.js refactor:** Must export `runBlocket(keywords)` function under `if (require.main === module)` guard — same pattern as `traderaRunner.js`.
- **CONTEXT.md specifies p-queue with concurrency:1** for cycle management. See research finding below for important update.

### Claude's Discretion

- Exact `node-cron` expression format for minute-based intervals.
- Whether to expose a `MARKETPLACES` env var to enable/disable scrapers at the array level, or always include all scrapers and rely solely on `user_config` pause state.
- Log message wording for cycle start/end/skip events.
- Whether to seed-check all marketplaces before the first cycle or rely on each runner's existing seed detection.

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHD-01 | Bot automatically scans all enabled marketplaces every 5–15 minutes on a configurable interval | node-cron v4.2.1 `cron.schedule('*/{n} * * * *', fn, { noOverlap: true })` with `SCAN_INTERVAL_MINUTES` env var; `task.execute()` for immediate first run; `noOverlap:true` prevents concurrent cycles natively |
</phase_requirements>

## Summary

Phase 4 wires together the scrapers built in Phases 2–3 into an autonomous polling loop. The core mechanism is `node-cron` v4.2.1 (already installed at `^4.2.1`), which fires a callback on a configurable cron schedule and — critically — provides built-in overlap prevention via the `noOverlap: true` option. This eliminates the need for `p-queue` entirely: when a cron tick fires while the previous cycle is still running, `node-cron` skips the tick and fires an `execution:overlap` event, which the scheduler can use to emit a custom log warning.

The CONTEXT.md specifies `p-queue` for cycle sequencing. Research reveals this is unnecessary and problematic: `p-queue` v7+ is ESM-only and cannot be `require()`-d from this project's CommonJS codebase without a dynamic `import()` shim. The installed `node-cron` v4.2.1 already provides identical skip-if-busy semantics via `noOverlap: true`, confirmed by reading the compiled source in `node_modules/node-cron/dist/cjs/scheduler/runner.js` lines 111–118. The planner should use `noOverlap: true` and skip any `p-queue` installation.

Three pieces of existing work need integration: (1) `traderaRunner.js` is already a reusable `runTradera(keywords)` export; (2) `blocketRunner.js` must be split to export `runBlocket(keywords)` under an `if (require.main === module)` guard; (3) `index.js` (currently a two-line stub) becomes the scheduler bootstrap. The `user_config` and `scan_log` tables already exist in the schema — they just need thin query helpers or inline `db.prepare()` calls added in the scheduler.

**Primary recommendation:** Use `node-cron` v4.2.1 `cron.schedule('*/{n} * * * *', cycleHandler, { noOverlap: true })` plus `task.execute()` for the immediate first run. No new npm packages needed.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | 4.2.1 (installed) | Cron-based scheduler with overlap prevention | Already in package.json; CommonJS-native (`type: "commonjs"`); `noOverlap` built-in; `task.execute()` for immediate first-run |
| better-sqlite3 | ^12.6.2 (installed) | Synchronous SQLite — reads `user_config`, writes `scan_log` | Already the project DB; synchronous API fits naturally in async cycle loop |
| pino | ^10.3.1 (installed) | Structured JSON logging | Already configured in `src/utils/logger.js` |
| dotenv | ^17.3.1 (installed) | Load `KEYWORDS` and `SCAN_INTERVAL_MINUTES` from `.env` | Already pattern in all runners |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | — | No new packages required for Phase 4 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node-cron noOverlap:true` | `p-queue` concurrency:1 (from CONTEXT.md) | p-queue v7+ is ESM-only — cannot `require()` in CJS project without dynamic import shim. noOverlap:true is built into the already-installed node-cron and provides identical skip semantics. **Use noOverlap.** |
| `node-cron` | `setInterval` + manual overlap flag | setInterval does not handle drift; noOverlap+execute() gives cleaner API |
| Inline `db.prepare()` in scheduler | Separate `src/db/config.js` helper module | Either works; separate module is cleaner for future phases. Discretion of planner. |

**Installation:**

```bash
# No new packages needed — all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure

```
index.js                          # Scheduler bootstrap (replaces stub)
src/
├── scheduler/
│   └── runCycle.js               # Optional: extracted cycle logic
├── scrapers/
│   ├── traderaRunner.js          # Already exports runTradera(keywords) — no change
│   └── blocketRunner.js          # ADD: export runBlocket(keywords); keep CLI under require.main guard
└── db/
    ├── index.js                  # Already: DB singleton
    ├── init.js                   # Already: schema with scan_log + user_config tables
    └── seenListings.js           # Already: filterAndMarkSeen, countSeen — no change
```

The cycle logic may live entirely in `index.js` (simpler, fewer files) or be extracted to `src/scheduler/runCycle.js` (testable in isolation). Both are valid; the planner should choose based on test coverage goals.

### Pattern 1: Scheduler Bootstrap (index.js)

**What:** Load config, initialize DB, build scraper list, fire immediate first cycle, then schedule recurring cycles.

**When to use:** Entry point — runs when `node index.js` is executed.

**Example:**
```javascript
// Source: verified against node-cron v4.2.1 installed API
'use strict';
require('dotenv').config();

const cron = require('node-cron');
const db = require('./src/db/index');
const logger = require('./src/utils/logger');
const { runTradera } = require('./src/scrapers/traderaRunner');
const { runBlocket } = require('./src/scrapers/blocketRunner');

const KEYWORDS = (process.env.KEYWORDS || 'rtx 3080,rtx 3090').split(',').map(k => k.trim());
const INTERVAL = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);

const scrapers = [
  { name: 'tradera', run: runTradera },
  { name: 'blocket', run: runBlocket },
];

logger.info({ keywords: KEYWORDS, interval_minutes: INTERVAL }, 'Scheduler starting');

const task = cron.schedule(`*/${INTERVAL} * * * *`, async () => {
  await runCycle(scrapers, KEYWORDS);
}, { noOverlap: true, name: 'scanner' });

task.on('execution:overlap', () => {
  logger.warn('Cron tick skipped — previous cycle still running');
});

// Fire immediately on startup, do not wait for first cron tick
task.execute();
```

### Pattern 2: Cycle Loop with Error Isolation

**What:** Iterate over scrapers sequentially; check pause state live; wrap each in try/catch; write scan_log row unconditionally.

**When to use:** Inside the cron callback and the immediate `task.execute()` call.

**Example:**
```javascript
// Source: verified against DB schema in src/db/init.js
async function runCycle(scrapers, keywords) {
  logger.info('Cycle started');
  for (const scraper of scrapers) {
    const startedAt = Math.floor(Date.now() / 1000);
    let completedAt = null;
    let listingsFound = 0;
    let newListings = 0;
    let errorMsg = null;

    // Live pause check — no caching, reads from user_config every cycle
    const pauseRow = db.prepare(
      'SELECT value FROM user_config WHERE key = ?'
    ).get(`${scraper.name}.paused`);
    const isPaused = pauseRow?.value === 'true';

    if (isPaused) {
      logger.info({ marketplace: scraper.name }, 'Scraper paused — skipping');
      errorMsg = 'paused';
    } else {
      try {
        const novel = await scraper.run(keywords);
        completedAt = Math.floor(Date.now() / 1000);
        // Note: scraper.run returns novel listings only (post-dedup)
        // Total scraped count is not exposed by current runner API — use novel.length
        newListings = novel.length;
        listingsFound = novel.length; // same until runners expose total count
        logger.info({ marketplace: scraper.name, novel: novel.length }, 'Scraper complete');
      } catch (err) {
        completedAt = Math.floor(Date.now() / 1000);
        errorMsg = err.message;
        logger.error({ marketplace: scraper.name, err: err.message }, 'Scraper error');
      }
    }

    // Write scan_log row — always, even on pause or error
    db.prepare(`
      INSERT INTO scan_log
        (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(scraper.name, startedAt, completedAt, listingsFound, newListings, errorMsg);
  }
  logger.info('Cycle complete');
}
```

### Pattern 3: blocketRunner.js Refactor

**What:** Add `runBlocket(keywords)` export without breaking existing CLI smoke-test behavior.

**When to use:** Prerequisite to scheduler — must be done before cycle loop can call blocket.

**Example:**
```javascript
// Source: mirrors traderaRunner.js pattern — verified in src/scrapers/traderaRunner.js
'use strict';
const { BlocketScraper } = require('./blocket');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const scraper = new BlocketScraper();

async function runBlocket(keywords) {
  const isSeedMode =
    process.env.SEED_MODE === 'true' || countSeen('blocket') === 0;

  if (isSeedMode) {
    logger.info({ reason: process.env.SEED_MODE === 'true' ? 'SEED_MODE env' : 'empty seen_listings' }, 'Blocket: seed mode active');
  }

  const listings = await scraper.scrape(keywords);

  if (isSeedMode) {
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Blocket seed mode: all listings marked seen, no alerts emitted');
    return [];
  }

  const novel = filterAndMarkSeen(listings);
  logger.info({ found: listings.length, novel: novel.length }, 'Blocket run complete');
  return novel;
}

module.exports = { runBlocket };

if (require.main === module) {
  require('dotenv').config();
  // ... existing CLI smoke-test code ...
}
```

### Anti-Patterns to Avoid

- **Caching the pause state:** `user_config` must be read fresh each cycle. Do not store pause state in memory — the whole point is toggling without restart.
- **Using `p-queue` from CJS:** `p-queue` v7+ is pure ESM. `require('p-queue')` throws `ERR_REQUIRE_ESM`. Dynamic `import()` works but introduces async initialization complexity for no benefit — `noOverlap: true` is already installed.
- **Calling `cron.schedule()` then `task.start()` manually:** In node-cron v4, `schedule()` calls `task.start()` internally. Calling `start()` again is a no-op but confusing. Use `schedule()` directly.
- **Using `runOnInit` option:** Removed in node-cron v4. The v4 replacement is `task.execute()` called immediately after `cron.schedule()`.
- **Using `scheduled: false` option:** Removed in node-cron v4. Use `cron.createTask()` instead if you need a stopped-at-creation task.
- **`*/1 * * * *` for 1-minute interval:** Valid but use `* * * * *` instead — it is the standard form and clearer.
- **Hardcoding marketplace list:** Construct the `scrapers` array from imports rather than deriving from `user_config` — pause state controls skipping, not array membership. The `MARKETPLACES` env var (Claude's discretion) is not needed if all installed scrapers are always in the array.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression tick timing | Custom `setInterval` with drift correction | `node-cron` | Handles DST, month-end edge cases, missed-execution detection |
| Overlap prevention | Manual `isRunning` boolean flag | `node-cron` `noOverlap: true` | Already installed; fires `execution:overlap` event for logging; zero extra code |
| Cron expression validation | Regex against cron syntax | `cron.validate(expr)` | One-line runtime check; catches invalid `SCAN_INTERVAL_MINUTES` values at startup |

**Key insight:** The hardest part of a scheduler is overlap prevention under async workloads. `node-cron` v4.2.1 provides this natively with a single option — there is no reason to build or import a separate queue.

## Common Pitfalls

### Pitfall 1: p-queue ESM Import Error
**What goes wrong:** `const PQueue = require('p-queue')` throws `Error [ERR_REQUIRE_ESM]: require() of ES Module`. Process crashes on startup.
**Why it happens:** `p-queue` v7+ is native ESM. This project is CommonJS (`type` not set / implicitly CJS). `require()` cannot load ESM.
**How to avoid:** Do not install or `require` p-queue. Use `noOverlap: true` in `cron.schedule()` — it is already in the installed `node-cron` package.
**Warning signs:** `package.json` has no `"p-queue"` in dependencies — confirms it was not installed; CONTEXT.md mentions it as an intention but it was not added to the project.

### Pitfall 2: runOnInit / scheduled Options (node-cron v3 Holdovers)
**What goes wrong:** `cron.schedule('...', fn, { runOnInit: true })` — option is silently ignored in v4. First cycle never fires immediately.
**Why it happens:** These options were removed in node-cron v4.0.0. The v4 migration guide documents this change.
**How to avoid:** Use `task.execute()` immediately after `cron.schedule()` for the first run.
**Warning signs:** Scan log shows no row for the first 15 minutes after startup.

### Pitfall 3: scan_log Row Missing `listings_found` vs `new_listings` Distinction
**What goes wrong:** `listings_found` and `new_listings` are populated with the same value (novel count). The schema intends `listings_found` = total scraped (before dedup) and `new_listings` = after dedup.
**Why it happens:** `runTradera(keywords)` and `runBlocket(keywords)` return only novel listings — the total-before-dedup count is not exposed by their current API.
**How to avoid:** Accept this limitation for Phase 4 — populate both with `novel.length` and document it. Phase 5 can extend runner return shape if needed. The scan_log schema supports both; populating both with the same value is correct behavior for Phase 4.
**Warning signs:** DB queries on `scan_log` show `listings_found = new_listings` always — this is expected.

### Pitfall 4: Cron Expression Built at Runtime from Env Var
**What goes wrong:** `SCAN_INTERVAL_MINUTES=60` produces `*/60 * * * *` which is technically invalid (minute field is 0–59). Process starts but cron never fires.
**Why it happens:** cron minute field accepts 0–59. `*/60` means "every 60 minutes" but `60` is out of range.
**How to avoid:** Validate at startup with `cron.validate(expression)`. For intervals > 59 minutes, clamp or convert to hourly expression. For Phase 4, log an error and fall back to default 15 if invalid.
**Warning signs:** `cron.validate('*/60 * * * *')` returns `false` — confirmed by live test in this project's Node.js runtime.

### Pitfall 5: DB Singleton Not Initialized Before First Cycle
**What goes wrong:** `require('./src/db/index')` opens the DB lazily on first require. If `index.js` calls the scraper before any DB operation, `filterAndMarkSeen` inside the runner will be the first DB access — this is fine. But if `initDb()` fails (e.g., `data/` directory permission), the error surfaces inside the first scraper call, not at startup.
**Why it happens:** The singleton pattern defers initialization to first require.
**How to avoid:** `require('./src/db/index')` at the top of `index.js` (before scheduling). This forces DB initialization at startup and surfaces errors before the first cycle fires.
**Warning signs:** DB error logged during first scraper run, not at "Scheduler starting" log line.

## Code Examples

Verified patterns from live inspection of `node_modules/node-cron/dist/cjs/` and existing project source files:

### node-cron v4 Schedule with noOverlap + Immediate Execute
```javascript
// Source: verified against node_modules/node-cron/dist/cjs/node-cron.js and runner.js
const cron = require('node-cron');

const INTERVAL = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);
const expression = `*/${INTERVAL} * * * *`;

if (!cron.validate(expression)) {
  logger.error({ expression }, 'Invalid cron expression — check SCAN_INTERVAL_MINUTES');
  process.exit(1);
}

const task = cron.schedule(expression, async () => {
  await runCycle(scrapers, keywords);
}, {
  noOverlap: true,   // skip tick if previous cycle still running
  name: 'scanner',   // appears in node-cron internal logs
});

task.on('execution:overlap', () => {
  logger.warn({ expression }, 'Cron tick skipped — cycle still running');
});

// Fire immediately — do not wait for first cron tick
task.execute();
```

### Reading user_config Pause State (live, no cache)
```javascript
// Source: verified against src/db/init.js schema (user_config table)
// db = require('./src/db/index')
function isPaused(marketplace) {
  const row = db.prepare(
    'SELECT value FROM user_config WHERE key = ?'
  ).get(`${marketplace}.paused`);
  return row?.value === 'true';
}
```

### Writing a scan_log Row
```javascript
// Source: verified against src/db/init.js schema (scan_log table)
db.prepare(`
  INSERT INTO scan_log
    (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
  VALUES (?, ?, ?, ?, ?, 0, ?)
`).run(
  marketplace,                      // TEXT NOT NULL
  Math.floor(startTime / 1000),     // started_at: unix timestamp
  Math.floor(Date.now() / 1000),    // completed_at: unix timestamp
  novel.length,                     // listings_found
  novel.length,                     // new_listings (same as found — Phase 4 limitation)
  errorMessage                      // null on success, string on error/pause
);
```

### Keyword Parsing from Env
```javascript
// Source: mirrors pattern used in blocketRunner.js CLI section
const KEYWORDS = (process.env.KEYWORDS || 'rtx 3080,rtx 3090,rtx 4080,rx 6800')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);
```

### blocketRunner.js Export Pattern (mirrors traderaRunner.js)
```javascript
// Source: verified against src/scrapers/traderaRunner.js — same pattern
module.exports = { runBlocket };

if (require.main === module) {
  require('dotenv').config();
  // existing CLI smoke-test code here
  main().catch(err => {
    logger.error({ err: err.message }, 'Blocket runner failed');
    process.exit(1);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `{ runOnInit: true }` option | `task.execute()` after `cron.schedule()` | node-cron v4.0.0 (May 2025) | Code using v3 options will silently fail to fire immediately |
| `{ scheduled: false }` then `task.start()` | `cron.createTask()` returns stopped task | node-cron v4.0.0 | Minor API change; not needed for this phase |
| `p-queue` for sequential execution | `noOverlap: true` in node-cron options | node-cron v4.0.0 | Eliminates ESM import problem entirely for CJS projects |

**Deprecated/outdated:**
- `node-cron` `{ runOnInit: true }`: Removed in v4 — use `task.execute()`
- `node-cron` `{ scheduled: true/false }`: Removed in v4 — tasks start immediately; use `createTask()` for deferred start
- `p-queue` v7+ in CJS projects: ESM-only — do not install; use `noOverlap: true` instead

## Open Questions

1. **`listings_found` vs `new_listings` in scan_log**
   - What we know: Current runner API (`runTradera`, `runBlocket`) returns only novel listings after dedup. Total-before-dedup count is not surfaced.
   - What's unclear: Whether the planner should extend runner return shape to expose total count, or just populate both fields with `novel.length`.
   - Recommendation: Populate both with `novel.length` for Phase 4 and document the limitation. Runners can be extended when a consumer (e.g., Discord alerts in Phase 7) needs the total count.

2. **`MARKETPLACES` env var (Claude's Discretion)**
   - What we know: CONTEXT.md leaves it to Claude's discretion whether to filter scrapers via env var or rely solely on pause state.
   - What's unclear: Whether any users need to permanently exclude a marketplace without pausing (pause state can be set manually in DB via sqlite3 CLI).
   - Recommendation: Do not add `MARKETPLACES` env var in Phase 4. Always include all installed scrapers in the array; pause state in `user_config` is sufficient control. Simplicity wins.

## Sources

### Primary (HIGH confidence)
- `node_modules/node-cron/dist/cjs/scheduler/runner.js` — live source inspection confirming `noOverlap` behavior (lines 111–118), `execute()` implementation (lines 144–166)
- `node_modules/node-cron/dist/cjs/tasks/scheduled-task.d.ts` — authoritative `TaskOptions` type: `{ timezone?, name?, noOverlap?, maxExecutions?, maxRandomDelay? }`
- `node_modules/node-cron/dist/cjs/node-cron.js` — confirmed `schedule()` calls `task.start()` internally; `validate()` function
- `src/db/init.js` — authoritative scan_log and user_config DDL
- `src/scrapers/traderaRunner.js` — authoritative export pattern for runner refactor
- Live Node.js execution: `cron.validate('*/15 * * * *')` → `true`; `cron.validate('foo')` → `false`; `task.execute()` fires synchronously

### Secondary (MEDIUM confidence)
- [node-cron/node-cron GitHub README](https://github.com/node-cron/node-cron) — confirmed CommonJS `require('node-cron')` support; v4 released May 2025
- [WebSearch: node-cron v4 breaking changes](https://github.com/node-cron/node-cron) — confirmed `runOnInit` and `scheduled` options removed in v4; `task.execute()` is the v4 replacement

### Tertiary (LOW confidence)
- [WebSearch: p-queue ESM-only issue](https://github.com/sindresorhus/p-queue/issues/144) — p-queue ESM-only confirmed by multiple sources; v6 was last CJS version; not installed in this project anyway

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified by live npm install inspection and Node.js execution in project environment
- Architecture: HIGH — patterns derived from existing project source files and live API inspection
- Pitfalls: HIGH for p-queue/ESM and noOverlap (live-verified); MEDIUM for scan_log distinction (design decision, not a runtime failure)

**Research date:** 2026-03-02
**Valid until:** 2026-09-02 (node-cron v4 API is stable; no breaking changes expected in patch versions)
