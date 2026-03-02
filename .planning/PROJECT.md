# Hardware Flip Scanner

## What This Is

A Discord bot that continuously monitors Swedish second-hand marketplaces (Blocket, Tradera, Vinted) for computer hardware listings priced below market value, then posts deal alerts to Discord so the operator can act fast and flip for profit.

## Core Value

Surface flip-worthy hardware deals the moment they appear — before anyone else buys them.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Scrape Blocket for GPU, CPU, RAM/Storage listings
- [ ] Scrape Tradera for GPU, CPU, RAM/Storage listings
- [ ] Scrape Vinted for GPU, CPU, RAM/Storage listings
- [ ] Detect deals using price thresholds + Tradera sold-price comparison
- [ ] Post rich Discord embed alerts with title, price, marketplace, estimated profit, and direct link
- [ ] Discord commands to set/update price thresholds per category/item
- [ ] Discord commands to pause/resume scanning per marketplace or category
- [ ] Discord commands to mark deals as checked/dismissed
- [ ] Scan every 5-15 minutes without duplicating already-seen listings

### Out of Scope

- Facebook Marketplace — requires authenticated browser session, too fragile for v1
- Retail price sites (Prisjakt etc.) — Tradera sold listings are the market reference
- Mobile app or web dashboard — Discord is the entire interface
- Automated buying — alerts only, human decides

## Context

- Target marketplaces: Blocket (HTML scraping), Tradera (has a public API/search), Vinted (public listing pages)
- Market value reference: Tradera recently-sold listings for the same/similar item — used to estimate profit margin
- Thresholds are per-item or per-category (e.g. "RTX 3080 under 2500 SEK", "any GPU under 1000 SEK")
- Deduplication needed — bot must not re-alert on the same listing across scan cycles
- Runs on user's local Windows machine (always-on PC)
- Discord is both the alert surface and the control interface (slash commands or prefix commands)

## Constraints

- **Platform**: Windows local machine — no assumption of Linux/server environment
- **Runtime**: Node.js or Python (whichever scrapes best) — TBD during research
- **Anti-bot**: Blocket and Vinted may rate-limit; need polite scraping with delays
- **No auth required**: All scraped marketplaces have public listing pages (no login needed for Blocket/Vinted)
- **Tradera sold data**: Must be fetched without breaking Tradera ToS where possible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tradera sold listings as market reference | Most accurate for Swedish local pricing | — Pending |
| Skip Facebook Marketplace v1 | Anti-bot measures too unreliable | — Pending |
| Discord as sole UI | No need for separate dashboard — operator is always in Discord | — Pending |

---
*Last updated: 2026-03-02 after initialization*
