# Phase 7: Discord Alerts - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver DealAlert objects produced by detectDeals as rich Discord embeds, rate-controlled at 1 msg/1.5s, with no re-posting after Windows restart and no historical flood on cold start. Discord slash commands are Phase 8.

</domain>

<decisions>
## Implementation Decisions

### Embed color
- Color by marketplace: Tradera=blue, Blocket=green, Vinted=teal, Sweclockers=orange
- Instant visual source identification at a glance

### Embed fields
- Show: listing title, listed price (SEK), marketplace, category, estimated margin ("~1 400 SEK margin, 8 comps"), URL button
- When no sold-comp data: omit margin line entirely (do not show "no data")
- No auction end time field in this phase

### Alert deduplication (restart safety)
- Add `alerted_at` column to existing `seen_listings` table (INTEGER epoch, nullable)
- On startup: skip posting any alert where `alerted_at IS NOT NULL`
- On post: set `alerted_at = unixepoch()` immediately after successful Discord send
- Keeps deduplication in one table — no new table needed

### Startup message
- Post to Discord channel on bot startup: "Bot online — N thresholds active, next scan in X min"
- Threshold count read from `thresholds` table (active=1); next scan time from cron schedule
- Single message, no embed — plain text is fine

### Queue overflow / rate control
- No cap on queue size — send all alerts, throttled at 1 msg per 1.5s
- If a cycle produces 20 alerts they all go out over ~30s — acceptable
- Dropped/failed sends logged via pino at warn level; no silent discard

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `detectDeals.js`: produces `{ listing, threshold, estimatedMargin, sampleCount, medianSoldPrice }` — all embed fields already present
- `IScraper.js` Listing shape: `{ id, marketplace, title, price_sek, url, category, listingType, auctionEndsAt }` — fully mapped
- `src/utils/logger.js`: pino logger — use for warn/error on failed sends
- `discord.js` v14.25.1: already installed — use `EmbedBuilder`, `WebhookClient` or `Client`

### Established Patterns
- All modules are CommonJS (`'use strict'`, `module.exports`) — Discord module must follow same pattern
- Never-throw pattern: errors are caught internally, logged, and function returns gracefully (see detectDeals, runCycle)
- DB access via `better-sqlite3` singleton from `src/db/index.js`

### Integration Points
- `runCycle.js:55` — `const alerts = await detectDeals(novel, db)` — Phase 7 wires Discord posting here; alerts are currently discarded after counting
- `seen_listings` table: needs `alerted_at INTEGER` column added (migration in Phase 7 init)
- `.env` / `user_config`: Discord bot token and channel ID come from environment — follow existing dotenv pattern

</code_context>

<specifics>
## Specific Ideas

- No specific references — open to standard discord.js EmbedBuilder approaches

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-discord-alerts*
*Context gathered: 2026-03-03*
