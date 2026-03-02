# Feature Landscape: Hardware Flip Scanner Bot

**Domain:** Marketplace monitoring / deal-alert bot for hardware arbitrage
**Researched:** 2026-03-02
**Confidence:** MEDIUM — based on training knowledge of Discord deal bots (e.g. SNKRS bots, GPU monitors, SteamDB wishlist bots, community flip bots), hardware arbitrage community patterns, and scraping ecosystem conventions. WebSearch unavailable; marked where claims are from training only.

---

## Table Stakes

Features without which the bot is useless. If any of these are missing, the operator abandons it within a day.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-marketplace scraping (Blocket + Tradera + Vinted) | Each marketplace has different inventory; missing one means missing deals | Medium | Three separate scrapers with different HTML structures and rate limit profiles |
| Deduplication across scan cycles | Without this, every re-scan spams the same listings — unusable within hours | Low-Medium | Persist seen listing IDs; a simple Set in memory fails on restart, must be on disk |
| Price threshold filtering | Only alert when price is below a configured value — otherwise noise is unbearable | Low | Per-category OR per-specific-item thresholds (e.g. "RTX 3080 < 2500 SEK") |
| Discord embed alerts with direct link | Alerts must be actionable in under 5 seconds — link to listing is non-negotiable | Low | Rich embed with: title, price, marketplace badge, link, timestamp |
| Scan interval 5-15 minutes | Anything slower means deals are gone before you see them; anything faster triggers rate limits | Low | Configurable per marketplace |
| Graceful error handling / silent failure prevention | Bot must not silently stop scraping when a marketplace changes its HTML | Medium | Alert the operator on repeated failures; don't crash the process |
| Persist state across restarts | Bot runs on a local Windows machine that reboots — seen-listing IDs must survive restarts | Low | JSON or SQLite file on disk |
| Keyword/category search terms | Must support "RTX 3080", "RX 6700 XT", "GTX 1080" as separate watchlist entries | Low | Simple list of search strings sent as query params or matched post-scrape |

**Why deduplication is table stakes, not optional:**
Hardware flip bots in communities (Reddit r/buildapcsales, Swedish Facebook flip groups, Discord servers) universally cite alert spam as the #1 reason people mute or abandon bots. A bot that re-posts seen listings is worse than no bot — it destroys trust immediately.

---

## Differentiators

Features that separate a great flip bot from a basic one. Not expected on day one, but high leverage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Market value estimation via Tradera sold listings | Quantifies the flip opportunity — "listed at 1800 SEK, comps show 3200 SEK sold" turns an uncertain listing into a clear BUY signal | Medium-High | Must scrape Tradera's recently-sold filter; cache results to avoid hammering it; accuracy depends on recency and sample size |
| Estimated profit in alert embed | Operator sees "~1400 SEK margin" without mental arithmetic — directly reduces decision time | Low (once market value works) | Derived from (comps median - listed price - shipping estimate); shipping estimate is a flat constant |
| Per-item alert channel routing | Route GPU alerts to #gpus, CPU to #cpus — keeps alerts organized when watchlist grows | Low | Discord channel ID per category config |
| Deal scoring / confidence indicator | "8/10 deal" based on: discount %, comp sample size, listing age, marketplace reliability — helps triage quickly | Medium | Needs tuned weighting; bad scoring erodes trust faster than no scoring |
| Listing age detection | Show how long the listing has been up — a 3-minute-old listing at 70% off is very different from a 6-day-old one | Low | Parse listing timestamp; most marketplaces expose this |
| Condition parsing | Parse condition from title/description ("mint", "slightly used", "broken") to surface risk | Medium | Regex/NLP over Swedish text; false positives are likely — display extracted text, not a score |
| Discord slash command to query market value on demand | `/price rtx 3080` returns recent sold comps without waiting for an alert | Medium | Useful for evaluating listings seen elsewhere |
| Watchlist management via Discord commands | Add/remove/list keywords without touching config files | Low-Medium | `/watch add gpu rtx-3080 2500` — requires command parsing and persistent config |
| Pause/resume per marketplace | If Blocket is rate-limiting, pause it without restarting the bot | Low | Flag in config/state |
| Deal dismissal (mark as checked) | `/checked [listing-id]` — marks a deal so it doesn't re-surface as a "new" alert if the listing gets bumped | Low | Store dismissed IDs separately from seen IDs |

**Why market value estimation is the biggest differentiator:**
Basic monitors exist everywhere — setting up a price threshold is trivial. What's genuinely hard and valuable is knowing *how good* a deal is. A GPU at 2000 SEK means nothing without context. Tradera's sold listing data provides that context and is specific to the Swedish market, which matters because international price references (e.g. eBay.com) are often 30-50% off from Swedish local market prices due to shipping, customs, and currency.

---

## Anti-Features

Features that seem valuable but create more problems than they solve. Deliberately avoid.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-buy / auto-bid | Introduces legal liability, financial risk, ToS violations; a misfire buys the wrong item | Alerts only — human decides. This is not negotiable. |
| ML-based deal detection without fallback | Black-box scoring that can't explain why it flagged something destroys trust; model drift means the bot degrades silently | Use transparent threshold + comp-based logic; show the math |
| Full description scraping + storage | Storing full listing text is unnecessary, legally grey (copyright/GDPR in Swedish context), and bloats the DB | Store only: ID, title, price, URL, timestamp, marketplace |
| Real-time webhook for every new listing (no threshold filter) | Without filtering, a busy marketplace generates dozens of embeds per hour — alert fatigue kills usage | Always filter before alerting; threshold is mandatory, not optional |
| Multiple notification channels simultaneously (Discord + email + SMS) | Adds complexity, multiple surfaces to maintain, and splits attention — operators don't need redundancy for a local tool | Discord only; the operator is already there |
| Price history graphs per listing | A given listing is usually sold within hours of a good deal post — historical charts have near-zero ROI for flipping | Use comps (what similar items sold for), not charts of the specific listing's price |
| User accounts / multi-user auth inside the bot | Adds massive complexity; this is a personal operator tool, not a SaaS product | Single-operator model; Discord role-based access is sufficient if sharing |
| Tradera auction sniping (auto last-minute bid) | Fragile, ToS violation, requires authenticated session, high failure rate | Watch Tradera buy-it-now listings and Tradera sold comps only |
| Confidence scores shown without sample size | A "90% confidence" based on 2 sold listings is misleading and will cause bad buys | Always show "n=X comps" alongside any market value estimate |
| Category catch-all with no keyword specificity | "Alert me on all GPUs" on Blocket generates hundreds of listings per day, most not flip-worthy | Require specific model keywords; support wildcard categories only as an opt-in with explicit acknowledgment |

---

## Feature Dependencies

```
Deduplication (disk-persisted seen-IDs)
  └── Required by: All alert features (alerts are meaningless without it)

Price threshold config (per-item/per-category)
  └── Required by: Alert filtering
  └── Enhanced by: Watchlist management via Discord commands

Market value estimation (Tradera sold comps)
  └── Required by: Estimated profit in embed
  └── Required by: Deal scoring
  └── Required by: On-demand /price command

Watchlist management commands
  └── Requires: Persistent config (disk, not in-memory)
  └── Requires: Discord slash command infrastructure

Deal dismissal (/checked command)
  └── Requires: Per-listing ID tracking
  └── Requires: Discord slash command infrastructure

Per-item channel routing
  └── Requires: Category/keyword tagging on each alert
  └── Requires: Discord channel ID config per category

Listing age detection
  └── Requires: Timestamp parsing per marketplace (varies by site)
  └── Enhances: Deal scoring
```

---

## MVP Recommendation

### Must ship in v1 (table stakes, no negotiation)

1. Blocket + Tradera scraper (Vinted third, lower hardware inventory)
2. Disk-persisted deduplication (JSON file, keyed by listing URL or marketplace ID)
3. Keyword + price threshold filtering (hardcoded config is fine for v1)
4. Discord embed alerts: title, price, marketplace, link, timestamp
5. Scan loop with configurable interval (default 10 min)
6. Silent-failure alerting (bot posts to Discord if a scraper fails 3x in a row)

### Ship in v1.5 (first differentiator, high leverage)

7. Tradera sold comps scraping + median market value estimation
8. Profit estimate in alert embed ("~X SEK margin, based on N comps")
9. Discord slash commands: `/watch add`, `/watch remove`, `/watch list`, `/pause [marketplace]`, `/resume [marketplace]`

### Defer to v2 (once core is validated)

10. Deal scoring with confidence indicator
11. Per-category Discord channel routing
12. Listing age display in embed
13. On-demand `/price [model]` command
14. Deal dismissal (`/checked`)
15. Condition parsing from Swedish title text

### Deliberately never build

- Auto-buy/bid
- Multi-user SaaS features
- Email/SMS notifications
- Full description storage
- Tradera auction sniping

---

## Alert Fatigue: Specific Guidance

Alert fatigue is the most common failure mode for deal bots. It happens when operators start ignoring alerts because too many are noise. Prevention strategies, ordered by impact:

1. **Mandatory price threshold** — never alert without it. Even a loose threshold (e.g. "any GPU under 5000 SEK") cuts volume dramatically vs. alerting on all listings.

2. **Deduplication with bump detection** — Blocket and Tradera allow sellers to "bump" listings, which re-sorts them to the top. A naively implemented bot re-alerts on bumped listings. Track by listing ID, not by position in results.

3. **Minimum discount % as a secondary filter** — once market value comps are in, add a minimum margin filter (e.g. only alert if profit estimate > 500 SEK or > 20%). This is a v1.5 feature but dramatically improves signal.

4. **Rate limit the alert itself** — if the same listing somehow slips through deduplication twice within 30 minutes, suppress the second alert. Simple timestamp check on last-alerted listing ID.

---

## Blocket, Tradera, Vinted: Feature Implications

| Marketplace | Inventory for Hardware | Public API | Dedup Key | Bumping/Re-listing Risk | Sold Comps Available |
|-------------|----------------------|-----------|-----------|------------------------|---------------------|
| Blocket | High (Sweden's dominant classifieds) | No — HTML scraping required | Listing ID in URL (e.g. `/annons/123456`) | Yes — Blocket has "boost" feature; listings get re-sorted | No |
| Tradera | Medium (auction + BIN) | Yes (public search API exists, quality varies) | Item ID in URL | Low — auctions expire, BIN listings stable | Yes — sold listings filter on search page |
| Vinted | Low (clothing-focused; hardware incidental) | No — HTML scraping | Item ID in URL | No | No |

**Implication:** Blocket is the primary scraper target. Tradera is dual-purpose: secondary listing source AND the market value reference. Vinted is low-priority and can be cut from v1 if complexity is too high.

---

## Deduplication: Implementation Notes

Two distinct ID stores are needed (often conflated, leading to bugs):

| Store | Purpose | Contents | Expiry |
|-------|---------|---------|--------|
| `seen_ids` | Prevent re-alerting on known listings | Listing IDs from all scan cycles | Never expire (or expire after 30 days to prevent unbounded growth) |
| `dismissed_ids` | Listings the operator has manually dismissed via `/checked` | Listing IDs explicitly dismissed | Never expire |

A listing should alert if and only if: `id NOT IN seen_ids AND id NOT IN dismissed_ids AND price < threshold`.

After alerting, add to `seen_ids` immediately (before the Discord message is sent, to prevent race conditions on overlapping scan cycles).

---

## Market Value Estimation: Specific Guidance

Tradera sold listings are the right reference for Swedish local market prices. Key implementation details:

- Search Tradera with `status=sold` or equivalent filter + the keyword
- Take the **median** of last 5-10 sold prices (not mean — outliers from broken/incomplete items skew mean heavily)
- Cache comps results per keyword for 4-6 hours — sold comps don't change minute-to-minute
- Display sample size in the embed: "Comps: 4500 SEK median (n=7)" — operator knows to trust or distrust
- If fewer than 3 comps found, do not show a profit estimate — display "Insufficient comps (n=X)" instead
- Strip shipping costs from sold prices if Tradera exposes them (it sometimes does) — otherwise note that comps may include shipping

---

## Sources

- Training knowledge: Discord deal bot community patterns (r/buildapcsales, tech Discord servers, GPU monitor bots circa 2021-2025)
- Training knowledge: Blocket, Tradera, Vinted site structure and scraping conventions as of training cutoff (August 2025)
- Training knowledge: Alert fatigue research in notification system design
- Training knowledge: Swedish secondhand hardware market conventions
- Confidence note: Tradera API availability is MEDIUM confidence (API existed as of training but endpoints and ToS may have changed — verify before implementing)
- Confidence note: Blocket HTML structure is LOW-MEDIUM confidence (classifieds sites frequently restructure their HTML) — verify with live inspection before coding the scraper
- WebSearch unavailable — all findings from training data; treat as hypotheses to validate during implementation
