# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Surface flip-worthy hardware deals the moment they appear — before anyone else buys them.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 9 (Foundation)
Plan: 2 of 2 in current phase
Status: In progress
Last activity: 2026-03-02 — Plan 01-02 complete: SQLite schema, WAL mode, 5 tables, singleton DB export

Progress: [██░░░░░░░░] 10%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 1.5 min
- Total execution time: 0.05 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 3 min | 1.5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 01-02 (1 min)
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Node.js chosen over Python — discord.js 14 is dominant, single-language avoids orchestration overhead
- [Roadmap]: Tradera scraped before Blocket — API is more stable, proves Listing schema and dedup before fragile HTML parsing
- [Roadmap]: Vinted and Sweclockers deferred to Phase 5 — isolates highest-maintenance scrapers from core pipeline
- [01-01]: CommonJS throughout (no type:module) — discord.js 14 and better-sqlite3 work cleanly with require(); p-queue ESM deferred to Phase 4 dynamic import()
- [01-01]: pino selected as logger — structured JSON, production-ready, pino-pretty for dev
- [01-01]: dotenv.config() placed as absolute first statement in index.js before any other require
- [01-02]: WAL journal mode set as first pragma before any DDL — ordering is required; cannot toggle after first write
- [01-02]: Absolute DB_PATH via path.resolve(__dirname, ...) — prevents SQLITE_CANTOPEN under pm2 or Task Scheduler CWD changes
- [01-02]: fs.mkdirSync with recursive: true guards data/ creation — better-sqlite3 does not create parent directories
- [01-02]: initDb() returns db handle — enables singleton in index.js and testability without global state

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: Tradera sold-listing URL filter must be verified on the live site before coding the market-value path — if auth is required, sold-comps need an alternative source
- [Phase 3]: Blocket `__NEXT_DATA__` key name and listing object structure must be inspected from a live page before writing the parser
- [Phase 5]: Vinted Cloudflare behavior may require Playwright as a fallback — assess at Phase 5 kickoff

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 01-02-PLAN.md — SQLite schema, WAL mode, 5 tables, singleton DB export all committed
Resume file: None
