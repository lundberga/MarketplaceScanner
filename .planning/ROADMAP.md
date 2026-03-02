# Roadmap: Hardware Flip Scanner

## Overview

Nine phases deliver a single-process Node.js bot that monitors Swedish secondhand marketplaces for below-market hardware, scores each listing against user-defined thresholds and Tradera sold-price comparables, and surfaces deal alerts as Discord embeds. The build order follows the five-layer pipeline architecture: database schema first (all layers share it as a contract), then scrapers from most stable to most fragile, then the scheduling wrapper, then deal intelligence, then the Discord surfaces, and finally Windows process hardening. Each phase produces something runnable and independently testable before the next starts.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - SQLite schema, project structure, logging, dotenv, .gitignore
- [ ] **Phase 2: Tradera Scraper** - Tradera active listing scraper + sold-comps cache + deduplication pipeline
- [ ] **Phase 3: Blocket Scraper** - Blocket `__NEXT_DATA__` HTML parser with canary checks
- [ ] **Phase 4: Scheduler** - node-cron polling loop with pause state, p-queue rate limiting, scan logging
- [ ] **Phase 5: Vinted and Sweclockers Scrapers** - Two lower-priority marketplace scrapers added to the proven pipeline
- [ ] **Phase 6: Deal Detection Engine** - Threshold matching + Tradera sold-comps integration + auction filter
- [ ] **Phase 7: Discord Alerts** - discord.js embed posting with message queue and seed mode
- [ ] **Phase 8: Discord Commands** - Slash commands for threshold management, scan control, and deal dismissal
- [ ] **Phase 9: Hardening** - pm2 Windows process management, global error handlers, restart survival

## Phase Details

### Phase 1: Foundation
**Goal**: The project has a runnable Node.js environment with a fully initialized SQLite database that all downstream layers can read and write without schema changes
**Depends on**: Nothing (first phase)
**Requirements**: DEUP-01, DEUP-02, DEUP-04
**Success Criteria** (what must be TRUE):
  1. Running `node src/db/init.js` creates the SQLite file at an absolute Windows path with all tables present (seen_listings, thresholds, sold_price_cache, user_config, scan_log)
  2. The SQLite file persists across process restarts and retains all rows written in a previous session
  3. A `.env.example` file exists and `.gitignore` excludes `.env`, the SQLite file, and `node_modules` — no secrets can be accidentally committed
  4. Structured pino logs appear in the terminal when any module runs
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md — Project scaffold, npm dependencies, .gitignore, .env.example, pino logger
- [ ] 01-02-PLAN.md — SQLite schema (all 5 tables, WAL mode, absolute path) and singleton DB wrapper

### Phase 2: Tradera Scraper
**Goal**: The bot can fetch active Tradera listings for hardware keywords, normalize them to the shared Listing schema, persist seen listing IDs to SQLite, and populate the seen-ID store on cold start without sending any alerts
**Depends on**: Phase 1
**Requirements**: SCRP-02, DEUP-03
**Success Criteria** (what must be TRUE):
  1. Running the Tradera scraper for a hardware keyword returns a non-empty array of Listing objects with title, price (numeric SEK), listing ID, URL, and marketplace fields populated
  2. Running the scraper twice in a row produces zero duplicate listing IDs in the second run's output (deduplication is working)
  3. On cold-start seed mode, all current Tradera listing IDs are written to seen_listings and no alert is emitted for any of them
  4. Tradera sold-price lookup for a hardware term (e.g. "rtx 3080") returns a median sold price from recent completed listings, or gracefully returns null if sold data is unavailable without crashing
**Plans**: TBD

Plans:
- [ ] 02-01: TraderaScraper (active listings) — IScraper interface, Listing schema, cheerio HTML parsing
- [ ] 02-02: Deduplication pipeline — seen_listings table writes, seed mode, composite key logic
- [ ] 02-03: TraderaSoldCache — sold-comps HTTP fetch, 4-hour SQLite cache, median calculation

### Phase 3: Blocket Scraper
**Goal**: The bot can scrape Blocket for hardware listings by parsing the `__NEXT_DATA__` JSON blob, plugging into the existing deduplication and Listing schema without any changes to Phase 2 code
**Depends on**: Phase 2
**Requirements**: SCRP-01
**Success Criteria** (what must be TRUE):
  1. Running the Blocket scraper for a hardware keyword returns a non-empty array of Listing objects in the same schema as Tradera output
  2. A canary check fires after every Blocket scrape cycle and logs a warning if result count is zero (indicating a page structure change)
  3. Blocket listing IDs feed into the same seen_listings deduplication table used by Tradera — no separate store
**Plans**: TBD

Plans:
- [ ] 03-01: BlocketScraper — live `__NEXT_DATA__` structure inspection, cheerio parser, canary check

### Phase 4: Scheduler
**Goal**: The bot runs autonomously, polling all enabled marketplaces on a configurable interval, reading pause state from the database, logging each cycle, and never overlapping concurrent scan cycles
**Depends on**: Phase 3
**Requirements**: SCHD-01
**Success Criteria** (what must be TRUE):
  1. The bot starts and begins scanning all enabled marketplaces without any manual invocation after startup
  2. Scan cycles complete sequentially — a new cycle does not start until the previous one finishes, regardless of how long scraping takes
  3. Pausing a marketplace in the user_config table causes the scheduler to skip that marketplace in subsequent cycles without restarting the process
  4. Each completed scan cycle produces a row in the scan_log table with marketplace, start time, end time, and listing count
**Plans**: TBD

Plans:
- [ ] 04-01: node-cron scheduler, p-queue rate limiting, cycle sequencing, scan_log writes

### Phase 5: Vinted and Sweclockers Scrapers
**Goal**: The bot scrapes two additional marketplaces, each isolated in its own module so that one scraper breaking does not affect the others
**Depends on**: Phase 4
**Requirements**: SCRP-03, SCRP-04
**Success Criteria** (what must be TRUE):
  1. Running the Vinted scraper returns Listing objects in the shared schema, or catches a 429/Cloudflare block and backs off without crashing the process
  2. Running the Sweclockers scraper returns Listing objects from the köp/sälj section in the shared schema
  3. Both scrapers' listing IDs flow into the same deduplication table used by Tradera and Blocket
  4. A failure in the Vinted scraper does not prevent the Blocket or Tradera cycle from completing in the same scan loop
**Plans**: TBD

Plans:
- [ ] 05-01: VintedScraper — `__NEXT_DATA__` parsing, realistic headers, jitter, 429 backoff
- [ ] 05-02: SweclockersScraper — köp/sälj HTML parsing, shared IScraper interface

### Phase 6: Deal Detection Engine
**Goal**: Every new listing is evaluated for deal worthiness — checked against user-defined price thresholds and enriched with an estimated profit margin from Tradera sold comparables — and only genuinely cheap listings reach the next layer as DealAlert structs
**Depends on**: Phase 5
**Requirements**: DEAL-01, DEAL-02, DEAL-03
**Success Criteria** (what must be TRUE):
  1. A listing priced below the configured threshold for its category is classified as a deal; a listing above the threshold is silently dropped
  2. Each DealAlert struct includes estimated profit margin (listed price subtracted from median sold comp price) when sold-comp data is available, and omits the field gracefully when it is not
  3. An auction listing mid-run (not buy-now, not ending within 2 hours) is filtered out and never reaches Discord
  4. Swedish price strings with space-thousands separators ("2 500 kr", "1 200:-") are parsed to integers correctly for all listing sources
**Plans**: TBD

Plans:
- [ ] 06-01: Swedish price parser with unit tests covering all marketplace formats
- [ ] 06-02: Threshold matching engine — category and item-specific thresholds loaded from SQLite
- [ ] 06-03: DealAlert struct construction — sold-comps enrichment, auction filter, fallback to threshold-only

### Phase 7: Discord Alerts
**Goal**: Users see rich Discord embed alerts for every deal the engine surfaces, delivered at a controlled rate, with no flood of historical listings on cold start
**Depends on**: Phase 6
**Requirements**: ALRT-01, ALRT-02, ALRT-03
**Success Criteria** (what must be TRUE):
  1. A DealAlert produced by the engine appears in the Discord channel as an embed containing the listing title, direct URL, listed price, marketplace source, and hardware category
  2. When sold-comp data is available, the embed includes the estimated profit margin ("~1 400 SEK margin, N comps")
  3. After a Windows restart, the bot comes back up and does not re-post alerts for listings it already alerted on in the previous session
  4. When the bot starts for the first time on a channel with existing listings, it sends zero historical alerts (seed mode populated seen-IDs on cold start in Phase 2)
**Plans**: TBD

Plans:
- [ ] 07-01: discord.js client setup, EmbedBuilder templates, message queue (1 msg/1.5s cap)
- [ ] 07-02: Wire DealAlert output into embed poster, seed mode integration, startup status message

### Phase 8: Discord Commands
**Goal**: The operator can control the bot entirely from Discord — adjusting thresholds, pausing marketplaces, and dismissing dealt-with alerts — without touching code or config files
**Depends on**: Phase 7
**Requirements**: CMND-01, CMND-02, CMND-03, CMND-04
**Success Criteria** (what must be TRUE):
  1. `/threshold set GPU 2500` writes the threshold to SQLite and subsequent scan cycles use the updated value without restarting the process
  2. `/threshold list` returns all currently active thresholds in a readable Discord reply
  3. `/pause vinted` causes the Vinted scraper to be skipped in subsequent cycles; `/resume vinted` re-enables it — both confirmed by the bot's reply
  4. `/dismiss <listing-id>` adds the listing ID to SQLite dismissed state and the bot never re-alerts on that listing
**Plans**: TBD

Plans:
- [ ] 08-01: Slash command registration script (guild-only, manual run), command handler scaffold
- [ ] 08-02: `/threshold` commands — set, remove, list — with zod input validation and SQLite writes
- [ ] 08-03: `/pause` and `/resume` commands with marketplace validation
- [ ] 08-04: `/dismiss` command — dismissed deal ID persistence and dedup integration

### Phase 9: Hardening
**Goal**: The bot runs indefinitely on a Windows machine as a persistent background process, surviving reboots, terminal closes, and unhandled errors without human intervention
**Depends on**: Phase 8
**Requirements**: SCHD-02
**Success Criteria** (what must be TRUE):
  1. After a Windows reboot, the bot restarts automatically without any manual action from the operator
  2. An unhandled exception or promise rejection in any scraper is caught, logged, and reported to the Discord status channel — the process does not exit silently
  3. Closing the terminal window that started the bot does not stop the bot
**Plans**: TBD

Plans:
- [ ] 09-01: pm2 setup, Windows Task Scheduler startup hook, global exception/rejection handlers

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/2 | Not started | - |
| 2. Tradera Scraper | 0/3 | Not started | - |
| 3. Blocket Scraper | 0/1 | Not started | - |
| 4. Scheduler | 0/1 | Not started | - |
| 5. Vinted and Sweclockers Scrapers | 0/2 | Not started | - |
| 6. Deal Detection Engine | 0/3 | Not started | - |
| 7. Discord Alerts | 0/2 | Not started | - |
| 8. Discord Commands | 0/4 | Not started | - |
| 9. Hardening | 0/1 | Not started | - |
