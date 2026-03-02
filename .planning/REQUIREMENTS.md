# Requirements: Hardware Flip Scanner

**Defined:** 2026-03-02
**Core Value:** Surface flip-worthy hardware deals the moment they appear — before anyone else buys them.

## v1 Requirements

### Scraping

- [ ] **SCRP-01**: Bot scrapes Blocket for GPU, CPU, RAM, and Storage listings matching search keywords
- [ ] **SCRP-02**: Bot scrapes Tradera for GPU, CPU, RAM, and Storage listings (buy-now and ending-soon auctions)
- [ ] **SCRP-03**: Bot scrapes Vinted for GPU, CPU, RAM, and Storage listings
- [ ] **SCRP-04**: Bot scrapes Sweclockers marketplace (köp/sälj) for GPU, CPU, RAM, and Storage listings

### Deal Detection

- [ ] **DEAL-01**: Bot evaluates each new listing against user-defined price thresholds per hardware category or specific item name
- [ ] **DEAL-02**: Bot fetches recent Tradera sold prices for similar items and includes estimated profit margin in alerts
- [ ] **DEAL-03**: Bot only alerts on buy-now listings or auctions ending within 2 hours — never on current bid prices mid-auction

### Deduplication & Persistence

- [ ] **DEUP-01**: Bot tracks all seen listing IDs in SQLite to prevent duplicate alerts across scan cycles
- [ ] **DEUP-02**: Bot survives Windows process restarts without re-alerting on previously seen listings
- [ ] **DEUP-03**: Bot performs a seed-mode scan on cold start — populates seen-IDs from current listings without sending alerts
- [ ] **DEUP-04**: Bot stores price thresholds, marketplace pause states, and dismissed deal IDs in SQLite

### Discord Alerts

- [ ] **ALRT-01**: Bot posts a rich Discord embed with listing title and direct link to the marketplace listing
- [ ] **ALRT-02**: Bot includes listed price and estimated profit margin (derived from Tradera sold comps) in the embed
- [ ] **ALRT-03**: Bot includes marketplace source (Blocket / Tradera / Vinted / Sweclockers) and hardware category (GPU / CPU / RAM / Storage) in the embed

### Discord Commands

- [ ] **CMND-01**: User can set or update a price threshold per category or specific item (e.g. `/threshold set GPU 2500`)
- [ ] **CMND-02**: User can view all currently active price thresholds
- [ ] **CMND-03**: User can pause and resume scanning per marketplace (e.g. `/pause vinted`, `/resume vinted`)
- [ ] **CMND-04**: User can dismiss a specific deal alert to prevent the bot from re-alerting on that listing

### Scheduling & Process

- [ ] **SCHD-01**: Bot automatically scans all enabled marketplaces every 5–15 minutes on a configurable interval
- [ ] **SCHD-02**: Bot runs as a persistent Windows background process using pm2, surviving terminal closes and reboots

## v2 Requirements

### Enhanced Alerts

- **ALRT-V2-01**: Alert embed includes listing age (how long since posted — detects freshness vs bumped)
- **ALRT-V2-02**: Deal alerts include a confidence score based on comp data quality (n=1 vs n=10 sold comps)
- **ALRT-V2-03**: Alerts routed to different Discord channels by hardware category (GPU channel, CPU channel, etc.)

### Discord Commands

- **CMND-V2-01**: On-demand `/price <item name>` command performs a Tradera sold-comps lookup and returns median sold price

### Maintenance

- **MAINT-V2-01**: Bot automatically purges seen-listing IDs older than 30 days to keep SQLite from growing unbounded
- **MAINT-V2-02**: Bot sends a Discord notification when it crashes and is restarted by pm2

## Out of Scope

| Feature | Reason |
|---------|--------|
| Facebook Marketplace | Requires authenticated browser session — too fragile, too likely to break |
| Auto-buying / auto-bidding | Out of scope by design — human decides every purchase |
| Mobile app or web dashboard | Discord is the entire interface for v1 |
| Multi-user support | Single-operator tool — no auth layer needed |
| Auction sniping | Legally and ethically problematic |
| Tradera official API (SOAP) | Registration required; scraping public HTML achieves same result |
| Retail price sites (Prisjakt etc.) | Tradera sold comps are the market reference — retail adds noise |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCRP-01 | Phase ? | Pending |
| SCRP-02 | Phase ? | Pending |
| SCRP-03 | Phase ? | Pending |
| SCRP-04 | Phase ? | Pending |
| DEAL-01 | Phase ? | Pending |
| DEAL-02 | Phase ? | Pending |
| DEAL-03 | Phase ? | Pending |
| DEUP-01 | Phase ? | Pending |
| DEUP-02 | Phase ? | Pending |
| DEUP-03 | Phase ? | Pending |
| DEUP-04 | Phase ? | Pending |
| ALRT-01 | Phase ? | Pending |
| ALRT-02 | Phase ? | Pending |
| ALRT-03 | Phase ? | Pending |
| CMND-01 | Phase ? | Pending |
| CMND-02 | Phase ? | Pending |
| CMND-03 | Phase ? | Pending |
| CMND-04 | Phase ? | Pending |
| SCHD-01 | Phase ? | Pending |
| SCHD-02 | Phase ? | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 0
- Unmapped: 20 ⚠️

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*
