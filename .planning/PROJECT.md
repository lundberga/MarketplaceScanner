# Hardware Flip Scanner

## What This Is

A Discord bot that continuously monitors four Swedish second-hand marketplaces (Blocket, Tradera, Vinted, Sweclockers) for computer hardware listings priced below market value, then posts rich deal alerts to Discord so the operator can act fast and flip for profit. The operator controls everything — thresholds, pause states, dismissals — via Discord slash commands.

## Core Value

Surface flip-worthy hardware deals the moment they appear — before anyone else buys them.

## Requirements

### Validated

- ✓ Scrape Blocket for GPU, CPU, RAM/Storage listings — v1.0 (SSR HTML + cheerio)
- ✓ Scrape Tradera for GPU, CPU, RAM/Storage listings — v1.0 (cheerio + sold-comps cache)
- ✓ Scrape Vinted for GPU, CPU, RAM/Storage listings — v1.0 (internal JSON API)
- ✓ Scrape Sweclockers köp/sälj for GPU, CPU, RAM/Storage listings — v1.0 (RSS feed)
- ✓ Detect deals using price thresholds + Tradera sold-price comparison — v1.0
- ✓ Post rich Discord embed alerts with title, price, marketplace, estimated profit, and direct link — v1.0
- ✓ Discord commands to set/update price thresholds per category/item — v1.0
- ✓ Discord commands to pause/resume scanning per marketplace — v1.0
- ✓ Discord commands to mark deals as checked/dismissed — v1.0
- ✓ Scan every 5-15 minutes without duplicating already-seen listings — v1.0

### Active

- [ ] Bot runs as a persistent Windows background process using pm2, surviving terminal closes and reboots (SCHD-02 — Phase 9)

### Out of Scope

- Facebook Marketplace — requires authenticated browser session, too fragile for v1
- Retail price sites (Prisjakt etc.) — Tradera sold listings are the market reference
- Mobile app or web dashboard — Discord is the entire interface
- Automated buying — alerts only, human decides
- Multi-user support — single-operator tool
- Auction sniping — legally and ethically problematic

## Context

**Shipped v1.0 with ~2,900 LOC JavaScript (CommonJS, Node.js).**

Tech stack: Node.js + better-sqlite3 + discord.js 14 + cheerio + node-cron + pino + zod.

Architecture: Five-layer pipeline — SQLite schema → scrapers → scheduler → deal engine → Discord surface. Each layer is independently testable.

Known tech debt from v1.0:
- Embed title not hyperlinked (no `.setURL()`) — link accessible via Button component only
- Live Blocket/Vinted/Sweclockers smoke-tests not confirmed against real network
- Live Discord slash command invocations not confirmed with real credentials

v2 enhancements to consider: alert freshness field, sold-comp confidence score, per-category Discord channels, on-demand `/price` lookup, seen-listing ID purge after 30 days.

## Constraints

- **Platform**: Windows local machine — no assumption of Linux/server environment
- **Runtime**: Node.js CommonJS — discord.js 14 and better-sqlite3 require CJS; no type:module
- **Anti-bot**: Blocket and Vinted may rate-limit; polite scraping with per-keyword jitter implemented
- **No auth required**: All scraped marketplaces have public listing pages or public APIs
- **Tradera sold data**: Fetched from public itemStatus=Ended search endpoint — no ToS breach

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Node.js over Python | discord.js 14 is dominant; single-language avoids orchestration overhead | ✓ Good |
| CommonJS throughout (no type:module) | discord.js 14 + better-sqlite3 work cleanly with require(); ESM interop adds friction | ✓ Good |
| Tradera sold listings as market reference | Most accurate for Swedish local pricing; public endpoint, no auth | ✓ Good |
| WAL journal mode set first before DDL | Cannot toggle after first write; ordering is required | ✓ Good |
| Absolute DB_PATH via path.resolve(__dirname) | Prevents SQLITE_CANTOPEN under pm2 or Task Scheduler CWD changes | ✓ Good |
| INSERT OR IGNORE for dedup | Preserves first_seen timestamp on re-insert; atomic batch inserts | ✓ Good |
| noOverlap:true (node-cron v4) for sequencing | p-queue is ESM-only — incompatible with CJS without dynamic import hack | ✓ Good |
| Blocket SSR HTML (not __NEXT_DATA__) | __NEXT_DATA__ structure changed; sf-search-ad-link selector is stable | ✓ Good |
| Vinted internal JSON API (v2/catalog/items) | Public endpoint; avoids full browser automation | ✓ Good — Cloudflare handling still unconfirmed |
| Sweclockers RSS feed | More stable than HTML scraping; covers all köp/sälj categories | ✓ Good |
| lookupSoldPrice injected into detectDeals | Enables unit-testable sold-comps enrichment without monkey-patching | ✓ Good |
| Guild-scoped slash command registration | Instant propagation vs 1-hour global delay | ✓ Good |
| Lazy require() inside command switch cases | Startup never fails on missing command module files | ✓ Good |
| Discord as sole UI | No need for separate dashboard — operator is always in Discord | ✓ Good |
| Skip Facebook Marketplace v1 | Anti-bot measures too unreliable | ✓ Good |

---
*Last updated: 2026-03-03 after v1.0 milestone*
