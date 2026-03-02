# Domain Pitfalls: Swedish Marketplace Scraper + Discord Bot

**Domain:** Marketplace monitoring bot (Blocket, Tradera, Vinted) + Discord alerts
**Researched:** 2026-03-02
**Confidence note:** Web search unavailable. Findings based on training knowledge through August 2025. Confidence levels are honest about this limitation. Items marked LOW should be verified before implementation.

---

## Critical Pitfalls

Mistakes that cause rewrites, bans, or broken core functionality.

---

### Pitfall 1: Blocket HTML Structure Changes Without Warning

**What goes wrong:** Blocket (Schibsted Sverige) is a large commercial platform that deploys frontend changes frequently. CSS class names are auto-generated (e.g., `_3abc4d`). Selectors break silently — the scraper continues to run but returns zero results or garbage data.

**Why it happens:** Schibsted uses a JavaScript-heavy SPA (React/Next.js frontend as of 2024-2025). The rendered HTML structure, class names, and data attributes can change with any deployment. There is no public changelog.

**Consequences:**
- Bot appears to be running but emits no alerts
- You don't notice until a deal passes without an alert
- Debugging requires inspecting fresh HTML against old selectors

**Prevention:**
- Select by `data-testid`, `aria-label`, or JSON-LD structured data embedded in the page — these are more stable than visual class names
- Blocket embeds listing data as `__NEXT_DATA__` or similar JSON in a `<script>` tag — parse that JSON blob instead of scraping rendered HTML where possible. This is significantly more stable.
- Implement a canary check: after each scrape cycle, assert that result count > 0 for a broad, guaranteed-to-have-results search (e.g., "dator"). Alert in Discord if canary fails.
- Log raw HTML snippet on every fetch (just the listing container) so you can diff when things break

**Detection warning signs:**
- Zero results on a search that always has listings
- Scraper returns data for the same 10 listings for days without new ones
- Parse errors on fields that used to work

**Phase:** Scraper foundation phase. Build canary + JSON extraction from the start, not as a retrofit.

---

### Pitfall 2: Vinted's Aggressive Session and Header Requirements

**What goes wrong:** Vinted is one of the most bot-hostile major marketplaces. Their API (which the web frontend uses) requires specific request headers — including `X-Auth-Token` or session cookies obtained through a login flow — for anything beyond the most basic browsing. The public listing pages load fine in a browser but API endpoints return 401 or 403 without proper session tokens.

**Why it happens:** Vinted protects against scraping via:
- Cloudflare protection on key endpoints
- Session tokens that expire and must be refreshed
- Fingerprinting of request headers (missing `Accept-Language`, `Accept-Encoding` patterns typical of browsers)
- Rate limits that are IP-based and reset slowly (hours, not minutes)

**Consequences:**
- Bot works in development, breaks in production after first IP block
- SESSION_EXPIRED errors appear randomly, requiring code to handle re-authentication
- Cloudflare IUAM challenges break plain HTTP clients entirely

**Prevention:**
- Use Vinted's public search URL (`https://www.vinted.se/catalog?search_text=...`) and parse the embedded JSON in the page's `<script id="__NEXT_DATA__">` tag — this avoids direct API calls
- Set realistic browser-mimicking headers: `User-Agent` (recent Chrome), `Accept-Language: sv-SE,sv;q=0.9,en;q=0.8`, `Accept-Encoding: gzip, deflate, br`
- Add 8-15 second random jitter between Vinted requests — not 2-3 seconds, actually 8-15
- If blocked, implement exponential backoff starting at 30 minutes, not seconds
- Do not share the same IP across Blocket + Tradera + Vinted if any gets blocked

**Detection warning signs:**
- HTTP 403 with Cloudflare HTML in response body
- HTTP 429 with `Retry-After` header
- Empty catalog results when searching common terms

**Phase:** Vinted scraper phase. Flag as "most fragile source" in documentation. Plan for it to require the most maintenance.

---

### Pitfall 3: Tradera Sold Listings Are Not Directly Accessible via Public API

**What goes wrong:** Tradera's public API (`api.tradera.com`) provides search and listing detail endpoints, but completed/sold auctions are not reliably accessible through the documented public API. The "sold price" data that makes deal detection accurate requires either: (a) scraping Tradera's HTML sold-search filter, or (b) using undocumented API endpoints that can change.

**Why it happens:** Tradera's public developer API was designed for sellers to manage inventory, not for buyers or researchers to analyze market prices. Sold history is a premium data feature on most auction platforms.

**Consequences:**
- Market value estimation breaks if the sold-data source is unavailable
- If you rely on an undocumented endpoint and it changes, deal detection silently degrades to threshold-only mode
- Tradera's website has pagination that differs from API pagination — mixing them causes missed results

**Prevention:**
- Scrape Tradera's web search with `?status=sold` (or the equivalent Swedish URL parameter) — this is visible to anonymous browsers and more stable than undocumented API endpoints
- Cache Tradera sold-price data aggressively — fetch sold prices at most once per hour per item category, not on every scan cycle
- Build the deal detection engine to work in two modes: (a) with sold-price reference, (b) threshold-only fallback. If sold data fetch fails, fall back gracefully and note "no market reference" in the alert
- Verify the exact URL filter for sold listings during implementation: Tradera uses Swedish UI terms like "avslutade annonser" or filter parameters

**Detection warning signs:**
- Sold search returns active listings mixed in
- Same "sold price" returned for weeks without updating
- HTTP 401 on sold-search endpoint when unauthenticated

**Phase:** Deal detection phase. Design the fallback mode before the primary mode so the bot is never fully broken.

---

### Pitfall 4: Deduplication Failure — Re-Alerting the Same Listing

**What goes wrong:** The bot alerts on the same listing multiple times across scan cycles. Users get duplicate Discord pings for a deal they already dismissed 30 minutes ago.

**Why it happens:**
- Listing IDs are used as deduplication keys, but the key extraction is brittle (e.g., URL parsing fails on some listing URL formats)
- The deduplication store (a JSON file or SQLite) is not persisted properly — restarts on Windows reset it to empty
- A listing is re-indexed by the marketplace with a new ID (Blocket sometimes does this for bumped listings)
- Different URL formats for the same listing (mobile vs. desktop, with/without query params) generate different keys

**Consequences:**
- Users lose trust in the bot immediately
- Discord channel fills with duplicates and becomes noise
- Users disable notifications entirely

**Prevention:**
- Use listing ID extracted from URL path (e.g., `/item/123456789`) not the full URL as the dedup key
- Normalize URLs before keying: strip query params, strip UTM tracking, lowercase domain
- Store seen IDs in SQLite (not JSON file) — SQLite survives restarts and concurrent writes safely
- Persist the SQLite file to a fixed absolute path, not relative to cwd (Windows cwd changes on restart)
- Keep seen IDs for at least 7 days — listings stay live that long
- On startup, load the full seen-ID set into memory before first scan cycle

**Detection warning signs:**
- Same listing title appearing in Discord twice within one hour
- Seen-ID store growing slower than expected
- Bot sends alert immediately after restart for listings users dismissed yesterday

**Phase:** Core bot foundation phase, before any marketplace-specific code. Dedup must be solid before deal alerts go live.

---

### Pitfall 5: Discord Rate Limit Abuse — Burst Alerting

**What goes wrong:** A new search keyword is added, or the bot starts fresh with an empty seen-ID store, and it finds 80 "new" listings that all pass the price threshold. It tries to send 80 Discord messages in rapid succession and gets rate-limited (HTTP 429). Some messages are dropped silently.

**Why it happens:** Discord's global rate limit is 50 requests/second, but per-channel limits are much tighter — approximately 5 messages per 5 seconds in a single channel before slowdown kicks in. The bot is not built to queue and throttle outgoing messages.

**Consequences:**
- Messages are dropped (you miss sending real deal alerts)
- Bot's token gets flagged; repeated violations can result in the bot being banned from the guild
- Discord.js / discord.py will throw unhandled rate limit errors that crash the process if not caught

**Prevention:**
- Implement a message queue with a fixed send rate of maximum 1 message per 1.5 seconds to any single channel
- On first-run or after adding new keywords, do NOT alert on historical listings. Only alert on listings first seen AFTER the bot started, or use a "seed mode" that populates the seen-ID store without alerting
- discord.js has built-in rate limit handling — set `rest: { globalRequestsPerSecond: 40 }` below Discord's limit
- Never send more than 5 embeds in a burst — if > 5 new deals found in one cycle, queue them with delays

**Detection warning signs:**
- Discord.js logging `RateLimitError` or HTTP 429 responses
- Messages arriving out of order or missing
- Bot goes silent after a flurry of activity

**Phase:** Discord bot foundation phase. Build the queue before wiring up scrapers.

---

## Moderate Pitfalls

---

### Pitfall 6: Price Parsing Fragility Across Marketplaces

**What goes wrong:** Each marketplace formats prices differently. Blocket uses `2 500 kr` (space as thousand separator, "kr" suffix). Tradera may use `2500 SEK` or `2 500:-`. Vinted uses locale-dependent format. Naive regex like `\d+` extracts `2` from `2 500 kr` instead of `2500`.

**Prevention:**
- Write a dedicated `parsePrice(rawString)` utility that handles:
  - Space as thousand separator (Swedish convention): `"2 500"` → `2500`
  - Period as thousand separator (some listings): `"2.500"` → `2500`
  - Comma as decimal: `"2500,00"` → `2500`
  - Suffixes: `kr`, `SEK`, `:-`, `kr/st`
- Unit test this function with real samples from each marketplace before connecting it to deal detection
- Log the raw price string alongside the parsed value for the first 50 listings found

**Phase:** Deal detection phase. Write and test before threshold comparison logic.

---

### Pitfall 7: Discord Embed Character Limits

**What goes wrong:** A listing title is 200+ characters (some Blocket listings are verbose). The embed field exceeds Discord's 256-character limit for field names or 1024-character limit for field values. The API call fails and the alert is never sent.

**Prevention:**
- Truncate title to 250 characters with `…` suffix before embedding
- Truncate description to 4096 characters (embed description limit)
- Total embed size limit is 6000 characters — stay well under by design
- Wrap all Discord API calls in try/catch with error logging that includes the listing ID

**Specific limits to hardcode (HIGH confidence — these are long-standing Discord API limits):**
- Embed title: 256 characters
- Embed description: 4096 characters
- Field name: 256 characters
- Field value: 1024 characters
- Total embed: 6000 characters
- Embeds per message: 10

**Phase:** Discord bot phase. Add truncation helpers before wiring up real listing data.

---

### Pitfall 8: Slash Command Registration Takes Time and Has Quotas

**What goes wrong:** Slash commands registered globally (not guild-specific) take up to 1 hour to propagate. During development, developers re-register commands repeatedly, hitting the 200 command registration calls per day limit.

**Prevention:**
- Register slash commands to a specific guild (server) during development — propagation is instant
- Only switch to global registration for production deployment
- Do not re-register on every bot startup — register once at deploy time, not in the `ready` event handler
- Keep command definitions in a separate `commands/` directory and only call the registration script manually

**Phase:** Discord bot phase, day one of development.

---

### Pitfall 9: Windows Process Management — Bot Dies and Nobody Notices

**What goes wrong:** An unhandled promise rejection crashes the Node.js process. The bot goes offline. On Windows, there is no supervisor process to restart it. The user doesn't notice for hours and misses deals.

**Prevention:**
- Use `pm2` for process management on Windows — it supports Windows natively, auto-restarts on crash, and can be configured to start on Windows login via `pm2 startup`
- Add global unhandled rejection and exception handlers that log to file before process exit
- Have the bot post a "startup" message to a `#bot-status` channel on every launch — silence in that channel signals a crash
- Set `pm2` to restart with exponential backoff (not tight loop) to avoid thrashing on persistent errors

**Windows-specific note:** `pm2 startup` on Windows requires running the generated command in an elevated PowerShell prompt. Document this in setup instructions.

**Phase:** Process management setup, before the bot handles real traffic.

---

### Pitfall 10: Market Value Estimation False Positives

**What goes wrong:** The bot flags a listing as a great deal because the price is below the average of recent Tradera sold listings — but the sold listings used as reference include broken items, parts-only sales, or items sold in lots (e.g., "10x DDR4 8GB mixed" sold for 800 SEK, making per-unit reference seem like 80 SEK, when actually individual sticks sell for 250 SEK).

**Prevention:**
- Filter sold listings used as market reference: exclude listings with keywords like "defekt", "trasig", "delar", "parti", "lot" in the title
- Use median price, not mean — outliers (lots, broken items) distort mean significantly
- Require minimum sample size of 3 sold listings before using sold-price comparison; fall back to threshold mode if fewer
- Include the sample size in the Discord alert ("market ref: 2 800 SEK avg of 7 sales") so the user can judge quality

**Phase:** Deal detection phase. Apply filters before computing reference price.

---

### Pitfall 11: Scan Interval Creep Under Load

**What goes wrong:** The bot is configured for 5-minute scan cycles. Each cycle makes 3 marketplace HTTP requests. Over time, requests start taking 8-12 seconds each (slow responses, Vinted jitter delays). The cycle takes 4 minutes 50 seconds. When the 5-minute timer fires again, a new cycle starts while the previous is still running, creating overlapping cycles that double-request the same pages and increase ban risk.

**Prevention:**
- Use `setInterval`-with-lock or sequential scheduling: start the next cycle only after the previous one completes. Pattern:
  ```javascript
  async function runCycle() {
    await scrapeAll();
    setTimeout(runCycle, INTERVAL_MS); // schedule AFTER completion
  }
  runCycle();
  ```
  Never use plain `setInterval` for async work.
- Log cycle start time, end time, and duration each run

**Phase:** Bot main loop, during scraper foundation phase.

---

### Pitfall 12: Blocket Geographic Filtering Missed

**What goes wrong:** Blocket defaults to nationwide listings. The user only wants to flip hardware locally (Stockholm, Gothenburg, etc.) but the bot alerts on listings 600km away. The user clicks through to a "great deal" and realizes it requires a 12-hour round trip.

**Prevention:**
- Blocket's search URL supports region filtering (`?location_id=...` or similar). Verify exact parameter during implementation.
- Make location a configurable setting, defaulting to nationwide with a clear warning that shipping-only deals are included
- Include the listing's stated location in the Discord embed so the user sees it without clicking through

**Phase:** Blocket scraper phase.

---

### Pitfall 13: Tradera Auction vs. Buy-Now Price Confusion

**What goes wrong:** Tradera has both auctions and fixed-price ("Köp nu") listings. An auction at 150 SEK with 3 days remaining is not a deal — current bid is 150 SEK but it will sell for much more. The bot alerts on the current bid price as if it were the final price.

**Prevention:**
- Distinguish listing type: auction vs. buy-now vs. auction-with-buy-now
- For auctions, only alert if the buy-now price is below threshold, OR if the auction is ending within 2 hours AND current bid is below threshold (sniper opportunity)
- Include listing type and time-remaining in the Discord embed
- Filtered search: consider targeting buy-now listings only for deal detection to avoid auction confusion

**Phase:** Tradera scraper phase.

---

## Minor Pitfalls

---

### Pitfall 14: SQLite Locking on Windows

**What goes wrong:** SQLite database is accessed simultaneously by the scraper loop and a Discord command handler (e.g., user runs `/deals list` while a scan cycle is writing). On Windows, SQLite's default locking behavior causes `SQLITE_BUSY` errors that crash the handler.

**Prevention:**
- Use WAL (Write-Ahead Logging) mode: `PRAGMA journal_mode=WAL;` on connection open
- Use a SQLite wrapper that handles retries (`better-sqlite3` in Node.js is synchronous and avoids async race conditions; `aiosqlite` in Python handles async safely)

**Phase:** Database setup, day one.

---

### Pitfall 15: Encoding Issues in Swedish Listing Titles

**What goes wrong:** Swedish characters (å, ä, ö) in listing titles or URLs are mangled if the HTTP response charset is not handled correctly, or if URL encoding uses `%C3%A5` patterns that a naive string comparison misses.

**Prevention:**
- Always decode HTTP responses as UTF-8 explicitly (`response.text('utf-8')` in Python, or rely on Node.js `fetch` which handles this automatically for text)
- URL-encode search queries before appending to URLs using proper URL encoding libraries, not string concatenation
- Test with search terms containing Swedish characters: `"dator+hörlurar"`, `"grafikkort+RTX"`

**Phase:** Scraper foundation phase. Test with Swedish characters in the first integration test.

---

### Pitfall 16: Vinted Category Mismatch — Hardware Listed Under Wrong Category

**What goes wrong:** Vinted is primarily a fashion platform. Computer hardware listed there is often miscategorized (under "Electronics" with no subcategory, or even under "Other"). Searching only the correct category misses listings; searching globally creates noise.

**Prevention:**
- Search Vinted by keyword across all categories, not by category filter
- Apply a keyword blocklist post-fetch to filter obviously wrong items: listings with "kjol", "jacka", "skor" in the title alongside hardware terms
- Accept that Vinted hardware listings are rare and noisy — it's a secondary source

**Phase:** Vinted scraper phase.

---

### Pitfall 17: Discord Bot Token Exposed in Version Control

**What goes wrong:** `.env` file containing `DISCORD_TOKEN=...` is committed to git. If the repo is public, the token is immediately scraped by bots and the bot is compromised.

**Prevention:**
- Add `.env` to `.gitignore` before the first commit
- Use `dotenv` for local development, never hardcode tokens
- Discord automatically invalidates tokens it detects in public GitHub repos — but private repos are not safe either if the token leaks

**Phase:** Project initialization, before any code is written.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Blocket scraper | HTML structure changes silently | Parse `__NEXT_DATA__` JSON blob, not CSS selectors; add canary check |
| Vinted scraper | Cloudflare block, session expiry | Parse `__NEXT_DATA__`, 8-15s jitter, exponential backoff |
| Tradera sold prices | Sold data not in public API | Scrape HTML sold-search filter; cache aggressively; build fallback |
| Tradera active listings | Auction vs. buy-now confusion | Flag listing type; alert on buy-now price only for threshold comparison |
| Deal detection | Market reference distorted by lots/broken items | Filter "defekt"/"parti" titles; use median not mean |
| Deal detection | Price parsing wrong Swedish formats | Dedicated `parsePrice()` with unit tests |
| Discord bot foundation | Burst rate limiting on cold start | Message queue; seed mode that suppresses alerts for historical listings |
| Discord bot foundation | Slash commands re-registered on every start | Register once manually, not in `ready` handler |
| Deduplication | Re-alerting on same listing | SQLite-backed seen-ID store with 7-day TTL; normalize URL keys |
| Windows process | Bot crashes undetected | pm2 with startup hook; startup message to `#bot-status` |
| Windows process | Scan cycles overlap under load | setTimeout-after-completion pattern, never setInterval for async |
| Database | SQLite locking under concurrent access | WAL mode + better-sqlite3 or aiosqlite |
| Project setup | Discord token in version control | .gitignore before first commit |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Discord rate limits and embed limits | HIGH | Stable, documented API limits unchanged for years |
| Discord slash command registration behavior | HIGH | Well-documented behavior, verified in training data |
| Blocket HTML/Next.js structure | MEDIUM | Training data through Aug 2025 — verify `__NEXT_DATA__` key name on actual site before coding |
| Tradera public API sold-listing access | MEDIUM | Training suggests sold data is not in public API; verify by hitting `developer.tradera.com` |
| Vinted anti-bot measures | MEDIUM | Known aggressive; specific Cloudflare version/behavior may have changed |
| pm2 on Windows behavior | HIGH | Well-documented, stable tooling |
| SQLite WAL on Windows | HIGH | Standard SQLite feature, well-documented |
| Swedish price format patterns | HIGH | Cultural/locale knowledge, very stable |

---

## Sources

- Training knowledge through August 2025 (no web access available during this research session)
- Discord API documentation (rate limits, embed limits): stable facts, HIGH confidence
- Blocket/Tradera/Vinted: MEDIUM confidence — verify current structure on first implementation session
- Community knowledge: marketplace scraping forums, GitHub issues on Schibsted/Tradera scrapers

**Verification recommended before Phase 1:** Visit Blocket search results page, view-source, confirm `__NEXT_DATA__` JSON presence and listing structure. Visit Tradera developer docs to confirm what sold-listing access exists publicly.
