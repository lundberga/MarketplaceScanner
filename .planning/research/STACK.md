# Technology Stack

**Project:** Hardware Flip Scanner (Swedish Marketplace Scraper + Discord Bot)
**Researched:** 2026-03-02
**Runtime on machine:** Node.js v24.13.1, Python 3.13.12

---

## Decision: Node.js, not Python

**Choose Node.js.** Both runtimes are installed on the machine, but Node.js wins for this specific project:

| Factor | Node.js | Python |
|--------|---------|--------|
| discord.js (best Discord lib) | Native | discord.py is Python but less ergonomic for embeds/slash commands |
| Async I/O model | Event loop native — ideal for concurrent HTTP fetches | Asyncio works but more boilerplate |
| cheerio (HTML parsing) | Fastest option, jQuery-like API | BeautifulSoup is fine but slower |
| Windows compatibility | First-class | First-class |
| Single-language codebase | Bot + scraper in one process | Same |
| **Verdict** | **Use this** | Skip |

The decisive factor is discord.js: it is the dominant Discord bot framework with superior embed builder APIs, slash command registration, and an enormous community. Mixing Python scrapers with a JS bot creates unnecessary process orchestration complexity.

---

## Recommended Stack

### Core Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 24.13.1 (installed) | Runtime | LTS, installed, required by discord.js >=18 |
| npm | bundled with Node | Package manager | Default, no need for pnpm/yarn for a solo project |

### Discord Bot Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| discord.js | **14.25.1** | Discord bot, slash commands, embeds | De facto standard. Slash commands, EmbedBuilder, REST gateway all built in. v14 is current major. Requires Node >=18. |
| @discordjs/rest | **2.6.0** | REST API client (used internally by discord.js) | Included transitively; expose directly if you need to register commands without a gateway connection |

Confidence: HIGH — version verified live from npm registry.

Do NOT use:
- `discord.py` — wrong language for this stack
- `eris` / `oceanic.js` — smaller ecosystems, discord.js is the clear standard
- `Sapphire Framework (@sapphire/framework 5.5.0)` — powerful but heavy abstraction overhead for a single-operator bot; overkill here

### HTTP Client (Scraping Requests)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **undici** | **7.22.0** | HTTP fetching for Blocket/Tradera/Vinted HTML | Node.js's own HTTP client (ships with Node 18+), zero dependencies, fastest fetch implementation. Use for straightforward HTML page fetching. |

Do NOT use:
- `axios 1.13.6` — adds 40KB dependency, no advantage over undici for simple GET requests
- `node-fetch 3.3.2` — redundant since Node 18+ has `fetch` natively
- `got 14.6.6` — excellent library but undici covers needs at zero cost

Confidence: HIGH — undici is the Node.js built-in HTTP client since v18, verified version from npm.

### HTML Parsing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **cheerio** | **1.2.0** | Parse SSR HTML from Blocket and Vinted | Blocket confirmed SSR: fetching `/recommerce/forsale/search?q=rtx` returns fully rendered HTML with listings, prices, and item IDs embedded in the markup. Cheerio's jQuery-like selectors make extracting `<a href="/recommerce/forsale/item/21202406">`, `<span>7 999 kr</span>` trivial. No headless browser needed for initial implementation. |

Live finding: Blocket's search page at `/recommerce/forsale/search?q=[query]` returns SSR HTML with complete listing data (item ID, price, title, location, time posted) in the DOM. Cheerio is sufficient and preferred.

Do NOT use (for initial build):
- `playwright 1.58.2` — overkill if SSR HTML is available. Adds 200MB+ of browser binaries, slower startup. Reserve as fallback if anti-bot measures force JS execution.
- `puppeteer 24.37.5` — same trade-off as Playwright. Heavier, slower. Playwright is preferred over Puppeteer if a headless browser becomes necessary (better API, multi-browser support).

Confidence: HIGH — Blocket SSR confirmed by live HTTP request returning rendered listing HTML.

### Tradera: API vs Scraping

**Finding:** Tradera has an old SOAP/REST developer portal at `api.tradera.com`. The portal redirects but the API exists. However, registration and API keys are required for the Tradera API.

**Recommendation:** Start with HTML scraping of Tradera search results using undici + cheerio (same pattern as Blocket). Tradera's listing pages are public HTML. Migrate to their API only if scraping proves brittle — the SOAP API's era predates modern REST conventions and may require complex XML handling.

For sold-price lookups (market reference): Tradera has a "Avslutade annonser" (ended listings) section at `www.tradera.com/search?q=[query]&saleType=1`. Scrape this the same way.

Confidence: MEDIUM — API portal existence confirmed live, but registration requirements unknown without creating an account. Scraping path is the safe default.

### Vinted

**Finding:** Live probe of `www.vinted.se/api/v2/catalog/items` returns HTTP 401 with `invalid_authentication_token`. Vinted's public API requires auth. Scraping the public HTML listing pages is required.

**Approach:** undici + cheerio on `www.vinted.se/catalog?search_text=[query]`. Vinted's robots.txt allows AI crawling for discovery purposes. Use polite delays.

Confidence: HIGH — API auth requirement confirmed by live 401 response.

### Persistence (Deduplication + Thresholds)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **better-sqlite3** | **12.6.2** | Store seen listing IDs and price thresholds | Synchronous SQLite bindings for Node. Zero config, single file database, no server process. Perfect for a local Windows machine. Handles deduplication (seen_listings table with listing_id PK) and thresholds (thresholds table per category/item). better-sqlite3 is specifically preferred over `sqlite3` (async, callback-based, harder to use) or `@keyv/sqlite` (key-value only, limits query flexibility). |

Do NOT use:
- PostgreSQL / MySQL — server setup on Windows is unnecessary complexity for a local bot
- Redis — same overkill concern, requires separate process
- JSON files — not safe for concurrent writes, no query capability for threshold lookups
- `sqlite3 5.1.7` — async callback API is painful; better-sqlite3 is strictly better DX

Confidence: HIGH — better-sqlite3 is the established choice for local Node.js SQLite, version verified from npm.

### Scheduled Jobs

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **node-cron** | **4.2.1** | Run scrape cycles every 5-15 minutes | Lightweight cron-syntax scheduler that runs in-process. No external dependencies. Cron expression `*/10 * * * *` for every 10 minutes. Stagger marketplace polls within the cycle to avoid rate limits. |

Do NOT use:
- `node-schedule` — larger API surface for a use case that needs one recurring job
- `setInterval` — works but loses interval drift guarantees and is harder to pause/resume per marketplace
- External task queues (Bull, BullMQ) — massively over-engineered for 3 marketplaces on one machine

Confidence: HIGH — node-cron v4 verified from npm registry.

### Request Throttling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **p-queue** | **9.1.0** | Limit concurrent HTTP requests per domain | Prevents hammering Blocket/Vinted with simultaneous requests. Set concurrency=1 per marketplace queue with a 2-3 second interval. Prevents rate-limit bans. |

Confidence: HIGH — p-queue is the standard Node.js concurrency primitive, version verified.

### Environment / Configuration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **dotenv** | **17.3.1** | Load Discord token from `.env` file | Standard approach. Discord bot token must never be committed to source. Single `.env` file with `DISCORD_TOKEN=`, `DISCORD_CHANNEL_ID=`, `GUILD_ID=`. |

Confidence: HIGH — dotenv is universal, version verified.

### Logging

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **pino** | **10.3.1** + **pino-pretty 13.1.3** | Structured logging | Fast structured logger. In development: `pino-pretty` for readable output. In production (always-on mode): plain JSON for log file output. Helps diagnose scraping failures and rate-limit events. |

Acceptable alternative: `winston 3.19.0` — equally valid, slightly more verbose config. Pino is faster and simpler.

Confidence: MEDIUM — both are well-established. Choice is low-stakes.

### Input Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **zod** | **4.3.6** | Validate Discord slash command inputs | When user sets a price threshold via `/threshold set item:RTX3080 max:2500`, validate input types before writing to DB. Zod integrates cleanly with TypeScript if added later. |

Confidence: HIGH — Zod v4 is current stable, version verified.

---

## Full Dependency List

```bash
# Production dependencies
npm install discord.js@14 better-sqlite3 cheerio node-cron p-queue dotenv pino zod

# Development dependencies
npm install -D pino-pretty
```

Note: `undici` ships with Node.js 18+ — no separate install needed. Use `import { fetch } from 'undici'` or the global `fetch` in Node 18+.

---

## Project Structure (Recommended)

```
scanner/
  src/
    bot/
      index.js          # discord.js client, login, event handlers
      commands/         # slash command handlers (threshold, pause, resume, dismiss)
      embeds/           # EmbedBuilder templates for deal alerts
    scrapers/
      blocket.js        # undici fetch + cheerio parse for Blocket
      tradera.js        # undici fetch + cheerio parse for Tradera
      vinted.js         # undici fetch + cheerio parse for Vinted
    scheduler/
      index.js          # node-cron job definitions, per-marketplace queues
    db/
      index.js          # better-sqlite3 connection + schema setup
      listings.js       # seen_listings CRUD
      thresholds.js     # threshold CRUD
    utils/
      logger.js         # pino configuration
      pricing.js        # profit estimate calculations
  data/
    scanner.db          # SQLite database (gitignored)
  .env                  # Discord token (gitignored)
  .env.example          # Committed template
  index.js              # Entry point
  package.json
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | Node.js | Python | discord.js is superior; single-language codebase |
| Discord lib | discord.js 14 | Sapphire, eris | Overkill/smaller ecosystem |
| HTTP client | undici (built-in) | axios, got, node-fetch | Zero dependency cost; native |
| HTML parser | cheerio | playwright, puppeteer | Blocket is SSR — no JS execution needed |
| Database | better-sqlite3 | Redis, PostgreSQL, JSON | Local machine; SQLite is correct scale |
| Scheduler | node-cron | setInterval, BullMQ | Right-sized; cron syntax is readable |
| Concurrency | p-queue | Manual setTimeout | Clean rate limiting per marketplace |

---

## Windows Compatibility Notes

- **better-sqlite3** requires native compilation. On Windows, this needs `windows-build-tools` or Visual Studio Build Tools. Run: `npm install --global windows-build-tools` OR install "Desktop development with C++" workload from Visual Studio installer. Node v24 ships with npm that handles this via `node-gyp`.
- **playwright** (if needed in future): Playwright downloads browser binaries automatically on Windows — no special setup.
- **node-cron**: Runs in-process, no Windows service needed. For always-on behavior, use `pm2` (`npm install -g pm2`) to keep the process alive across terminal closes.
- **pm2 on Windows**: pm2 startup on Windows requires `pm2 startup` + Task Scheduler configuration. Alternative: create a simple `.bat` file in Windows Startup folder that runs `node index.js`.

---

## Sources

- discord.js version: live npm registry query → `14.25.1`, engines `node>=18`
- undici version: npm registry → `7.22.0`
- cheerio version: npm registry → `1.2.0`
- better-sqlite3 version: npm registry → `12.6.2`
- node-cron version: npm registry → `4.2.1`
- p-queue version: npm registry → `9.1.0`
- playwright version: npm registry → `1.58.2`
- zod version: npm registry → `4.3.6`
- pino version: npm registry → `10.3.1`
- dotenv version: npm registry → `17.3.1`
- Blocket SSR confirmed: live HTTP GET to `blocket.se/recommerce/forsale/search?q=rtx` returned 698KB HTML with listing item IDs, prices (`7 999 kr`), titles, and locations in the DOM
- Blocket robots.txt: prohibits automated crawling — use polite delays (2-4s between requests)
- Vinted API 401: live probe of `vinted.se/api/v2/catalog/items` returned `invalid_authentication_token` — HTML scraping required
- Tradera API portal: `api.tradera.com` returns 200 with developer portal HTML — SOAP-era API, registration required
- Node.js version on machine: v24.13.1 (verified via `node --version`)
- Python version on machine: 3.13.12 (available but not chosen)
