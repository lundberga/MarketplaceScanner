---
plan: 04-01
phase: 04-scheduler
status: complete
completed_at: "2026-03-02"
tasks_completed: 3
files_modified: 3
---

# Plan 04-01 Summary: Scheduler Bootstrap

## Files Modified / Created

| File | Action | Exports |
|------|--------|---------|
| `src/scrapers/blocketRunner.js` | Refactored | `runBlocket(keywords)` |
| `src/scheduler/runCycle.js` | Created | `runCycle(scrapers, keywords, db)` |
| `index.js` | Replaced stub | (entry point, no exports) |

## Key Implementation Notes

### Overlap Prevention
- **Mechanism**: `noOverlap: true` in `cron.schedule()` options (node-cron v4 built-in)
- **NOT used**: p-queue (ESM-only package — throws ERR_REQUIRE_ESM from CJS; not installed)
- **Overlap event**: `task.on('execution:overlap', ...)` logs a warn when a tick is skipped

### Cron Expression Validation
- `cron.validate(expression)` runs before scheduling
- Invalid `SCAN_INTERVAL_MINUTES` (e.g. 60 → `*/60 * * * *`, which is out of range) logs an error and falls back to `*/15 * * * *`
- Process does NOT crash on invalid interval — scheduler resilience is a requirement

### scan_log Field Population (Phase 4 limitation)
- `listings_found` and `new_listings` are both set to `novel.length`
- Runners currently return only novel listings; total-before-dedup count is not available until Phase 6 wires back counts
- `deals_alerted` is always 0 (Phase 6 will update this)
- `error` is NULL on success, `'paused'` on skip, or the error message on throw

### blocketRunner.js Refactor
- `dotenv.config()` moved inside `require.main === module` guard — scheduler's `index.js` handles dotenv at process entry point
- `scraper` instance promoted to module-level singleton (mirrors traderaRunner.js pattern)
- `module.exports = { runBlocket }` placed before the `require.main` block

### index.js Bootstrap
- `require('dotenv').config()` is absolute first statement (project convention from [01-01])
- `require('./src/db/index')` at module level forces DB init at startup — surfaces permission errors before first cycle
- `KEYWORDS` env var: comma-separated string, defaults to `'rtx 3080,rtx 3090,rtx 4080,rx 6800'`
- `SCAN_INTERVAL_MINUTES` defaults to `15`
- `task.execute()` fires first cycle immediately without waiting for cron tick (v4 API)

## Verification Results

1. `runBlocket` export: **OK** — `typeof runBlocket === 'function'`
2. `runCycle` export: **OK** — `typeof runCycle === 'function'`
3. `index.js` structure check: **OK** — noOverlap present, task.execute present, no p-queue, no runOnInit
4. No dotenv side-effect on require: **OK** — `require('./src/scrapers/blocketRunner')` does not trigger dotenv or network calls

## Deviations from Plan

None. All tasks implemented exactly as specified.
