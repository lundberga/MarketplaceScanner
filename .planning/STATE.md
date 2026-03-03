---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-03-03T10:26:36.938Z"
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-02)

**Core value:** Surface flip-worthy hardware deals the moment they appear — before anyone else buys them.
**Current focus:** Phase 7 — Discord Alerts — IN PROGRESS

## Current Position

Phase: 7 of 9 (Discord Alerts) — IN PROGRESS
Plan: 1 of 2 in current phase — COMPLETE (alertSender.js Discord module created)
Status: Plan 07-01 complete — alertSender.js with embed builder, throttled queue, alerted_at migration
Last activity: 2026-03-03 — Plan 07-01 complete: Discord alertSender module created

Progress: [████████████████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 1.5 min
- Total execution time: 0.05 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | 3 min | 1.5 min |
| 02-tradera-scraper | 2 | 14 min | 7 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 01-02 (1 min), 02-01 (10 min)
- Trend: -

*Updated after each plan completion*
| Phase 02-tradera-scraper P02 | 4 | 2 tasks | 3 files |
| Phase 02-tradera-scraper P03 | 3 | 1 tasks | 2 files |
| Phase 03-blocket-scraper P01 | 8 | 2 tasks | 3 files |
| Phase 05-vinted-and-sweclockers-scrapers P01 | 2 | 2 tasks | 2 files |
| Phase 05-vinted-and-sweclockers-scrapers P02 | 2 | 2 tasks | 2 files |
| Phase 05-vinted-and-sweclockers-scrapers P03 | 5 | 2 tasks | 1 files |
| Phase 06-deal-detection-engine P01 | 3 | 1 tasks | 2 files |
| Phase 06-deal-detection-engine P02 | 5 | 1 tasks | 2 files |
| Phase 06-deal-detection-engine P03 | 1 | 1 tasks | 1 files |
| Phase 07-discord-alerts P01 | 4 | 1 tasks | 1 files |

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
- [Phase 02-01]: Tradera href regex fixed to not require trailing slash — URLs use /item/{catId}/{listingId}/{title-slug} format
- [Phase 02-01]: Dedup moved after kr-text check so empty image anchors do not consume listing ID slots
- [Phase 02-01]: parsePrice comma fix: comma-decimal vs comma-thousands distinguished via lookahead
- [Phase 02-02]: INSERT OR IGNORE used instead of upsert to avoid overwriting first_seen timestamp on re-insert
- [Phase 02-02]: db.transaction wraps all novel inserts atomically for consistent partial-batch failure handling
- [Phase 02-03]: Swedish thousand-separator regex used in _parseSoldPrices to avoid capturing model numbers as prices
- [Phase 02-03]: Cache write skipped when sampleCount < MIN_SAMPLES=3 to avoid caching stale insufficient-data entries
- [Phase 03-01]: Blocket uses SSR HTML with a.sf-search-ad-link selector — no __NEXT_DATA__ parsing required; price from div.font-bold span within closest article
- [Phase 03-01]: Canary check guards deduped.length (post-dedup) not allListings.length to avoid false negatives from duplicate keywords
- [Phase 03-01]: Async test wrapper used in blocket.test.js to prevent promise timing race in assert-based test runner
- [Phase 04-01]: noOverlap: true (node-cron v4 built-in) used for cycle sequencing instead of p-queue (p-queue is ESM-only, throws ERR_REQUIRE_ESM from CJS)
- [Phase 04-01]: task.execute() fires first cycle immediately on startup (v4 API; runOnInit was removed in v4)
- [Phase 04-01]: scan_log listings_found = new_listings = novel.length in Phase 4 — total-before-dedup not available until Phase 6
- [Phase 05-02]: classifyCategory(title) called on listing title — Sweclockers has no per-keyword loop unlike Blocket; single RSS covers all categories
- [Phase 05-02]: guid element used as fallback when <link> is empty — confirmed permaLink in live Sweclockers RSS
- [Phase 05-02]: parsePrice(description) ?? 0 — CDATA text contains price prose; fallback to 0 ensures price_sek is always an integer, never null
- [Phase 05-01]: Session cookie uses dual-fallback: res.headers.get('set-cookie') first, then getSetCookie()[0] for undici compatibility
- [Phase 05-01]: No smoke-test block in vintedRunner.js — scheduler integration (05-03) handles integration testing
- [Phase 05-03]: No runCycle.js changes needed — existing per-scraper try/catch and pause-state lookup handle new scrapers by name automatically
- [Phase 06-deal-detection-engine]: nowMs parameter injected into parseAuctionEnd and passesAuctionFilter for deterministic testing — avoids Date.now() non-determinism
- [Phase 06-deal-detection-engine]: Year-boundary fix: candidate incremented to next year when it falls >60s in the past — handles January dates parsed in December
- [Phase 06-02]: lookupSoldPrice injected as optional third arg to detectDeals for testability — production path defaults to real implementation without monkey-patching
- [Phase 06-02]: min_margin check skipped (listing passes) when medianPrice is null — never discard listing due to unavailable comps
- [Phase 06-02]: Sold-comps query key uses threshold.keywords first entry; falls back to first 3 words of listing.title
- [Phase 06-03]: detectDeals called only in successful scraper branch — paused/errored scrapers write 0 deals_alerted via let dealsAlerted = 0 initialization
- [Phase 06-03]: No extra try/catch around detectDeals call site — detectDeals guarantees it never throws, so outer scraper catch handles scraper errors
- [Phase 07-01]: EmbedBuilder imported from discord.js not @discordjs/builders — full ColorResolvable support including hex integers
- [Phase 07-01]: enqueue is fire-and-forget — _drain() called without await, so callers (runCycle) return immediately
- [Phase 07-01]: Client.channels.fetch() used instead of channels.cache.get() — cache may be empty at startup before GUILD_CREATE
- [Phase 07-01]: alerted_at set only after successful channel.send — prevents permanent mark on failed delivery
- [Phase 07-01]: filterUnalerted called inside enqueue before pushing to _queue — already-alerted listings never enter queue

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: Tradera sold-listing URL filter must be verified on the live site before coding the market-value path — if auth is required, sold-comps need an alternative source
- [Phase 3]: Blocket `__NEXT_DATA__` blocker resolved — SSR HTML approach with sf-search-ad-link selector used instead (no JSON parsing needed)
- [Phase 5]: Vinted Cloudflare behavior may require Playwright as a fallback — assess at Phase 5 kickoff

## Session Continuity

Last session: 2026-03-03
Stopped at: Completed 07-01-PLAN.md — Discord alertSender.js module created, Phase 7 Plan 1 complete
Resume file: None
