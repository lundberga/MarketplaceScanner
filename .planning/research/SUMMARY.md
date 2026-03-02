# Project Research Summary

**Project:** Hardware Flip Scanner (Swedish Marketplace Scraper + Discord Bot)
**Domain:** Marketplace monitoring bot for hardware arbitrage (Blocket, Tradera, Vinted)
**Researched:** 2026-03-02
**Confidence:** MEDIUM-HIGH (stack HIGH, architecture HIGH, features MEDIUM, pitfalls MEDIUM)

---

## Executive Summary

This is a single-process Node.js bot that polls three Swedish secondhand marketplaces on a cron schedule, deduplicates listings against a SQLite store, evaluates each new listing against user-configured price thresholds and Tradera sold-price comps, and posts deal alerts as Discord embeds. The architecture is a five-layer pipeline (Scheduler → Scraper → Deduplication → Deal Engine → Discord) running entirely in one process on a local Windows machine. No cloud infrastructure, no message queues, no microservices — the correct choice for a single-operator personal tool.

The recommended stack is Node.js with discord.js 14, cheerio for HTML parsing, better-sqlite3 for persistence, node-cron for scheduling, and p-queue for per-domain rate limiting. The decisive technical choice is Node.js over Python: discord.js is the dominant Discord bot library with superior embed and slash command APIs, and combining it with cheerio in a single process avoids cross-language orchestration complexity. Blocket is confirmed SSR (server-rendered HTML) via live HTTP probe — cheerio is sufficient and Playwright is not needed for initial build. Vinted's API returns 401 without auth — HTML scraping of `__NEXT_DATA__` JSON is required.

The two highest risks are alert fatigue from poor deduplication and scraper fragility from marketplace HTML changes. Both are solvable with established patterns: SQLite-backed seen-ID store (survives Windows restarts), canary checks on every scrape cycle, and parsing `__NEXT_DATA__` JSON blobs rather than CSS class selectors. The market-value component (Tradera sold comps) is the primary differentiator over a basic threshold bot, but depends on sold listings being accessible without auth — this must be verified on day one of Phase 2 development. Build a threshold-only fallback so the bot is never fully broken if sold data is unavailable.

---

## Key Findings

### Recommended Stack

Node.js is the clear choice: discord.js 14 is the de facto standard for Discord bots, Blocket's SSR HTML makes cheerio sufficient (no headless browser), and a single-language codebase avoids process orchestration overhead. All versions are verified live from the npm registry.

**Core technologies:**
- **discord.js 14.25.1**: Discord bot framework — slash commands, EmbedBuilder, REST gateway. De facto standard; superior embed/command APIs over alternatives.
- **cheerio 1.2.0**: HTML parsing — jQuery-like selectors on SSR HTML. Blocket confirmed SSR via live probe. No Playwright needed for initial build.
- **better-sqlite3 12.6.2**: Persistence — synchronous SQLite bindings. Zero-config, single-file DB, survives Windows restarts. Strictly preferred over async `sqlite3` or JSON files.
- **node-cron 4.2.1**: Scheduling — cron-syntax in-process job runner. Each marketplace gets its own independent schedule slot.
- **p-queue 9.1.0**: Rate limiting — concurrency=1 per marketplace queue with 2-3s intervals prevents ban risk.
- **undici 7.22.0**: HTTP client — ships with Node 18+, zero install cost. Use native `fetch` for straightforward GET requests.
- **dotenv 17.3.1**: Configuration — Discord token and channel IDs from `.env`. Never commit token to git.
- **zod 4.3.6**: Input validation — validates Discord slash command inputs before DB writes.
- **pino 10.3.1**: Logging — structured JSON logging; pino-pretty for development readability.

**Windows note:** better-sqlite3 requires native compilation. Visual Studio Build Tools ("Desktop development with C++") must be installed before `npm install`. Use pm2 for always-on process management — configure via pm2 startup + Windows Task Scheduler.

Full details: `.planning/research/STACK.md`

---

### Expected Features

Alert fatigue is the #1 failure mode for deal bots. Every feature decision should filter toward higher signal, never more volume.

**Must have (table stakes — bot is unusable without these):**
- Multi-marketplace scraping: Blocket + Tradera (Vinted optional in v1)
- Disk-persisted deduplication (SQLite seen-ID store; JSON file is not safe)
- Price threshold filtering per item/category — alerts without thresholds are pure noise
- Discord embed alerts: title, price, marketplace badge, direct link, timestamp
- Configurable scan interval (default 10 min) with sequential cycle scheduling
- Silent-failure alerting: bot posts to Discord if a scraper fails 3+ consecutive cycles

**Should have (differentiators — v1.5):**
- Tradera sold-comps lookup + median market value estimation — the biggest differentiator; turns a price alert into a quantified flip opportunity
- Estimated profit in embed ("~1 400 SEK margin, based on N comps") — eliminates mental arithmetic
- Discord slash commands: `/threshold add/remove/list`, `/scan pause/resume/status`
- Seed mode on first run — populate seen-IDs without alerting so the channel is not flooded with historical listings

**Defer (v2+):**
- Deal scoring with confidence indicator
- Per-category Discord channel routing
- Listing age display in embed
- On-demand `/price [model]` command
- Deal dismissal (`/deal dismiss`)
- Condition parsing from Swedish title text

**Deliberately never build:**
- Auto-buy/bid (legal liability, financial risk, ToS violation)
- Multi-user SaaS features (this is a personal operator tool)
- Email/SMS notifications (Discord-only; no redundancy needed)
- Full listing description storage (legally grey, DB bloat)
- Tradera auction sniping

Full details: `.planning/research/FEATURES.md`

---

### Architecture Approach

Five discrete layers, each with a single responsibility, communicating downward via typed interfaces. All layers run in one Node.js process — no microservices. The critical boundary is between scrapers (which return `Listing[]`) and the Discord layer (which receives `DealAlert[]`) — coupling these directly is the most common anti-pattern that makes the codebase untestable.

**Major components:**
1. **Scheduler Layer** — node-cron jobs per marketplace; reads pause state from DB; uses setTimeout-after-completion pattern (never setInterval for async work)
2. **Scraper Layer** — one class per marketplace implementing `IScraper`; normalizes all output to shared `Listing` schema; `BlocketScraper` and `VintedScraper` parse `__NEXT_DATA__` JSON, `TraderaScraper` uses public API with HTML fallback
3. **Deduplication Layer** — SQLite `seen_listings` table with composite key `marketplace:listing_id`; atomic insert before Discord send; 30-day TTL cleanup
4. **Deal Detection Engine** — threshold check + Tradera sold-price lookup (4-hour SQLite cache keyed on normalized model term like "rtx 3080"); builds `DealAlert` structs; degrades gracefully to threshold-only if sold data unavailable
5. **Discord Layer** — alert poster (embeds) and command handler (slash commands) as two separate sub-components; command handler is control-plane only, never calls scrapers
6. **Persistence Layer** — SQLite with WAL mode; tables: `seen_listings`, `thresholds`, `sold_price_cache`, `user_config`, `scan_log`

Full details: `.planning/research/ARCHITECTURE.md`

---

### Critical Pitfalls

1. **Blocket HTML structure changes silently** — Parse `__NEXT_DATA__` JSON blob in the page's `<script>` tag instead of CSS class selectors. Add a canary check: assert result count > 0 for a broad query ("dator") after every cycle. Build this from day one, not as a retrofit.

2. **Deduplication failure causes re-alert spam** — Use SQLite (not JSON file, not in-memory Set). Key on listing ID extracted from URL path, not the full URL. On Windows, use an absolute path for the DB file — relative paths change on restart. Load full seen-ID set into memory before the first scan cycle.

3. **Vinted is aggressively bot-hostile** — Parse `__NEXT_DATA__` JSON from page source rather than hitting API endpoints. Use 8-15 second jitter (not 2-3 seconds). Use realistic browser headers including `Accept-Language: sv-SE`. Implement 30-minute exponential backoff on 429 responses. Plan for Vinted to require the most maintenance of the three scrapers.

4. **Tradera sold listings may not be in the public API** — Tradera's public API was designed for sellers, not market researchers. Sold-price data likely requires scraping the HTML sold-search filter (`?status=sold` or Swedish equivalent). Verify this on day one of Phase 2. Build threshold-only fallback mode before building the sold-price path.

5. **Discord burst rate limiting on cold start** — On first run or after adding new keywords, the bot may find hundreds of "new" listings that all pass threshold. Implement seed mode (populate seen-IDs without alerting) and a message queue capped at 1 message per 1.5 seconds. Never send more than 5 embeds in a burst.

Additional notable pitfalls: Tradera auction vs. buy-now price confusion (alert on buy-now only), Swedish price parsing fragility (`2 500 kr` must become `2500`), Discord embed character limits (title: 256 chars, total: 6000 chars), slash command registration quotas (register guild-only during dev, not on every startup).

Full details: `.planning/research/PITFALLS.md`

---

## Implications for Roadmap

Based on combined research, the architecture's suggested build order maps cleanly to phases. Each phase delivers something runnable and testable before the next starts.

---

### Phase 1: Foundation — Database + Project Setup

**Rationale:** Everything else reads and writes the DB. Schema is the contract. Also: `.env` and `.gitignore` must exist before any code is committed (Pitfall 17 — Discord token exposure).
**Delivers:** SQLite schema with all tables (seen_listings, thresholds, sold_price_cache, user_config, scan_log), thin DB wrapper with WAL mode enabled, project structure, dotenv config, pino logger, .gitignore.
**Addresses:** Deduplication table stakes; configuration infrastructure; Windows SQLite locking prevention.
**Avoids:** Token committed to git (Pitfall 17), SQLite locking on Windows (Pitfall 14).
**Research flag:** None — standard patterns, no research phase needed.

---

### Phase 2: Tradera Scraper + Deduplication

**Rationale:** Tradera first because it has a public API — less fragile than HTML parsing. Also provides the sold-price data the Deal Engine needs. The `Listing` schema and deduplication logic can be proven against a structured API before tackling Blocket's HTML. CRITICAL: Verify Tradera sold-listing access (authenticated or not) at the start of this phase — it determines whether market-value estimation is feasible.
**Delivers:** Working TraderaScraper (active listings) + TraderaSoldCache (sold comps, 4-hour TTL), full deduplication pipeline, Listing schema validated against real data.
**Uses:** undici (HTTP), cheerio (HTML fallback), better-sqlite3, zod (input validation).
**Implements:** Scraper Layer + Deduplication Layer.
**Avoids:** In-memory-only dedup (Pitfall 4), polling sold prices per listing per cycle (Pitfall from ARCHITECTURE.md anti-patterns).
**Research flag:** NEEDS VERIFICATION — confirm Tradera sold-listing URL filter (`?status=sold` or equivalent) works without auth before coding the market-value path.

---

### Phase 3: Blocket Scraper

**Rationale:** Blocket is the primary deal source (highest Swedish hardware inventory). HTML scraping, more fragile than Tradera's API. Must be isolated in its own module so breakage doesn't affect the rest of the pipeline.
**Delivers:** BlocketScraper parsing `__NEXT_DATA__` JSON, canary check asserting non-zero results, geographic location filter support, listing bump detection via ID-based dedup.
**Addresses:** Primary deal source; table-stakes scraping coverage.
**Avoids:** CSS class selector fragility (Pitfall 1), bump re-alerting, geographic mismatch (Pitfall 12).
**Research flag:** NEEDS LIVE INSPECTION — confirm `__NEXT_DATA__` key name and listing structure from actual Blocket HTML before writing selectors.

---

### Phase 4: Scheduler + Scan Loop

**Rationale:** Wrap the working scrapers in the autonomous polling loop. Produces a bot that runs silently, deduplicates, and logs — but does not alert yet. Validates the full scrape cycle end-to-end before Discord integration.
**Delivers:** node-cron jobs per marketplace with independent schedules, pause/resume state in user_config, sequential cycle scheduling (setTimeout-after-completion), scan_log recording, structured pino logging.
**Uses:** node-cron, p-queue, better-sqlite3.
**Implements:** Scheduler Layer.
**Avoids:** Scan interval creep (Pitfall 11), overlapping cycles, blocking the event loop (ARCHITECTURE anti-pattern 5).
**Research flag:** None — standard patterns.

---

### Phase 5: Vinted Scraper

**Rationale:** Vinted is the lowest-priority marketplace (low hardware inventory, highest maintenance burden). Deferred until core pipeline is proven to keep Phase 3/4 scope focused.
**Delivers:** VintedScraper parsing `__NEXT_DATA__` JSON with realistic browser headers, 8-15s jitter, exponential backoff on 429, clothing keyword blocklist post-filter.
**Addresses:** Third-marketplace coverage.
**Avoids:** Vinted anti-bot measures (Pitfall 2), category mismatch noise (Pitfall 16).
**Research flag:** HIGHEST FRAGILITY — Vinted's Cloudflare behavior may require iterative adjustment during implementation. May need Playwright as fallback if `__NEXT_DATA__` is not accessible.

---

### Phase 6: Deal Detection Engine

**Rationale:** All scrapers and dedup are working. Now add deal intelligence. Implement threshold loading and price comparison first (simpler), then wire in Tradera sold-price cache (more complex). Build threshold-only fallback before the market-value path.
**Delivers:** Threshold matching engine, Tradera sold-price cache integration with median calculation, Swedish price parser (`parsePrice()`) with unit tests, DealAlert struct construction, fallback to threshold-only when sold data unavailable, market value filtering (exclude "defekt"/"parti" listings from comps).
**Addresses:** Market value estimation differentiator; profit calculation in alerts.
**Avoids:** Price parsing fragility (Pitfall 6), market value false positives from broken/lot listings (Pitfall 10), confidence score without sample size display.
**Research flag:** NEEDS LIVE INSPECTION — verify Tradera sold-price URL parameter format before implementation.

---

### Phase 7: Discord Bot — Alert Embeds

**Rationale:** First end-to-end path: scrape → score → Discord message. Discord integration is deliberately deferred until deal scoring works so the embed format can be informed by real DealAlert data.
**Delivers:** discord.js client, EmbedBuilder templates with all fields (price, market value, profit estimate, marketplace badge, location, listing age, comp sample size), message queue at 1 message per 1.5 seconds, seed mode for cold-start flood prevention, startup message to #bot-status.
**Uses:** discord.js 14.25.1.
**Implements:** Discord Layer — Alert Poster sub-component.
**Avoids:** Burst rate limiting (Pitfall 5), embed character limit failures (Pitfall 7), Windows crash going undetected (Pitfall 9 — startup message).
**Research flag:** None — discord.js embed API is stable and well-documented.

---

### Phase 8: Discord Bot — Slash Commands

**Rationale:** Control-plane commands are separate from the alert path. Defer until alert embeds are validated, keeping scope focused.
**Delivers:** Slash commands registered guild-only during dev: `/threshold add/remove/list`, `/scan pause/resume/status`. Command handler reads/writes Persistence Layer only — does not call scrapers. Registration script runs manually, not in `ready` event.
**Implements:** Discord Layer — Command Handler sub-component.
**Avoids:** Slash command registration quota exhaustion (Pitfall 8), command handler coupled to scraper layer (ARCHITECTURE anti-pattern 4).
**Research flag:** None — standard discord.js slash command patterns.

---

### Phase 9: Hardening + Windows Process Management

**Rationale:** All functionality works; now make it resilient for always-on local operation.
**Delivers:** pm2 process management with startup hook, global unhandled rejection/exception handlers, rate-limit exponential backoff per marketplace, seen_listings 30-day TTL cleanup job, `.env.example` template, setup documentation for Windows Build Tools + pm2 startup.
**Avoids:** Undetected process crash (Pitfall 9), SQLite unbounded growth, Windows restart losing dedup state.
**Research flag:** None — pm2 on Windows is well-documented.

---

### Phase Ordering Rationale

- **DB before scrapers** — all pipeline layers share the schema as a contract; building it first prevents schema churn.
- **Tradera before Blocket** — API is more stable than HTML; proves the Listing schema and dedup logic before dealing with fragile CSS/JSON parsing; provides sold-price infrastructure needed by Phase 6.
- **Scrapers before scheduler** — manual invocation during Phases 2-3 makes debugging faster; scheduler adds the cron wrapper in Phase 4 without changing scraper logic.
- **Vinted last among scrapers** — lowest priority, highest maintenance; isolates its fragility from the proven pipeline.
- **Deal engine before Discord** — validates scoring logic independently; Discord embed format can be designed around real DealAlert data, not hypothetical fields.
- **Alerts before commands** — the core value path (deal alerts) should be working and validated before adding the control interface.
- **Hardening last** — pm2 and error hardening are straightforward once functionality is proven; doing them earlier wastes time hardening code that will change.

---

### Research Flags

Phases needing live verification before or during implementation:

- **Phase 2 (Tradera):** Verify Tradera sold-listing URL filter works without auth. If auth is required, market-value estimation needs an alternative source.
- **Phase 3 (Blocket):** Inspect live Blocket HTML to confirm `__NEXT_DATA__` key name and listing object structure before writing the parser.
- **Phase 5 (Vinted):** Vinted's Cloudflare behavior is the most uncertain element in the entire stack — plan for iteration.
- **Phase 6 (Deal Engine):** Verify Tradera sold-price search URL parameter format during implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1:** SQLite schema setup — textbook.
- **Phase 4:** node-cron + p-queue scheduling — well-documented.
- **Phase 7/8:** discord.js embeds and slash commands — stable API with extensive documentation.
- **Phase 9:** pm2 Windows process management — well-documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified live from npm registry; Blocket SSR confirmed by live HTTP probe; Vinted API 401 confirmed by live probe |
| Features | MEDIUM | Based on training knowledge of Discord deal bot community patterns (no live feature validation); table stakes and anti-features are well-established; v1.5+ features are well-reasoned but unvalidated |
| Architecture | HIGH | Standard five-layer pipeline for this class of application; IScraper interface, SQLite dedup, and Deal Engine patterns are established; Tradera API sold-data access is MEDIUM confidence |
| Pitfalls | MEDIUM | Discord limits and SQLite WAL are HIGH confidence (documented); Blocket `__NEXT_DATA__` structure and Tradera sold-API access are MEDIUM confidence (training data through Aug 2025); Vinted anti-bot specifics are MEDIUM confidence |

**Overall confidence:** MEDIUM-HIGH — stack is on solid ground, architecture is clear, features are well-scoped. The main uncertainty is Tradera sold-price access without auth, which determines whether the primary differentiator (market value estimation) is straightforward or requires a workaround.

---

### Gaps to Address

- **Tradera sold-listing access:** Research suggests sold data is not in the public developer API and requires HTML scraping of the sold-search filter. The exact URL parameter for sold listings must be verified on the live site. If sold search requires authentication, the market-value component needs an alternative source (possibly Pricespy/Prisjakt for Swedish retail reference, though that measures new prices not secondhand).

- **Blocket `__NEXT_DATA__` structure:** The `__NEXT_DATA__` JSON key and listing schema inside it must be inspected from a live Blocket search results page before Phase 3. The shape of listing objects (field names, price format, ID location) cannot be assumed from training data.

- **Vinted `__NEXT_DATA__` accessibility:** Vinted's Cloudflare protection may block requests before `__NEXT_DATA__` can be extracted. This may require Playwright as a fallback even for Phase 5. Assess during Phase 5 kickoff.

- **Swedish price edge cases:** While `parsePrice()` patterns are well-understood (space as thousand separator, `kr`/`SEK`/`:-` suffixes), each marketplace should be sampled for edge cases (e.g., price listed as a range, "Pris kan diskuteras", free listings at 0 kr). Unit tests must cover real samples from each site.

- **pm2 startup on Windows:** `pm2 startup` on Windows requires an elevated PowerShell prompt and Task Scheduler configuration. This should be documented during Phase 9 setup so the operator can reproduce it after a Windows reinstall.

---

## Sources

### Primary (HIGH confidence — live verified)
- npm registry (live query 2026-03-02) — discord.js 14.25.1, cheerio 1.2.0, better-sqlite3 12.6.2, node-cron 4.2.1, p-queue 9.1.0, undici 7.22.0, zod 4.3.6, pino 10.3.1, dotenv 17.3.1
- Blocket live HTTP probe — confirmed SSR HTML with listing data at `/recommerce/forsale/search?q=rtx`; 698KB response
- Vinted API live probe — confirmed HTTP 401 `invalid_authentication_token` at `/api/v2/catalog/items`
- Tradera developer portal — live HTTP 200 at `api.tradera.com` confirming portal existence

### Secondary (MEDIUM confidence — training knowledge Aug 2025)
- Blocket HTML structure and `__NEXT_DATA__` pattern — training knowledge; must be verified live in Phase 3
- Tradera sold-listing URL filter — training knowledge; must be verified live in Phase 2
- Vinted Cloudflare anti-bot behavior — training knowledge; behavior may have changed
- Discord deal bot community patterns (r/buildapcsales, tech Discord servers, GPU monitor bots 2021-2025)

### Tertiary (LOW confidence — inference)
- Tradera public API sold-data access — research strongly suggests unavailable without auth; verify before implementation
- Swedish hardware flip margin conventions and market dynamics

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
