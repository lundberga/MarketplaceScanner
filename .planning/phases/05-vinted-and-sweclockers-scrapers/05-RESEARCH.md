# Phase 5: Vinted and Sweclockers Scrapers - Research

**Researched:** 2026-03-03
**Domain:** Swedish secondhand marketplace scraping — REST JSON API (Vinted) + RSS XML feed (Sweclockers)
**Confidence:** MEDIUM

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Vinted — anti-bot approach**
- Use Vinted's internal JSON API (`https://www.vinted.se/api/v2/catalog/items`) — bypasses Cloudflare entirely, no Playwright required
- Add realistic headers (User-Agent, Accept, Accept-Language) + per-keyword jitter (1–3 s random delay)
- On 429 or 5xx: log a warn-level event and return `[]` — do NOT throw, do NOT retry in Phase 5 (retry logic is Phase 6+ concern)
- On Cloudflare challenge (403 + CF headers): same as 429 — warn + return `[]`

**Sweclockers — section and post type**
- Target the Hardware köp/sälj section only: `https://www.sweclockers.com/forum/lista/123` (Säljes subsection)
- Only scrape `Säljes` (for-sale) posts — skip `Köpes` (wanted) posts
- Title is taken directly from the forum thread title (first 250 chars)
- `listingType` is always `'buy_now'` (forum posts are fixed-price by convention)

**Price extraction — Sweclockers**
- Run thread title through existing `parsePrice()` — it already handles Swedish formats (`3500kr`, `3 500 SEK`, `3.500:-`)
- If `parsePrice()` returns `null`: set `price_sek = 0` (consistent with existing BlocketScraper behavior)
- Do NOT attempt regex extraction on post body — title-only for Phase 5

**Runner pattern**
- Both scrapers get dedicated runner files: `vintedRunner.js` and `sweclockersRunner.js`
- Identical pattern to `traderaRunner.js` — seed mode via `countSeen(marketplace) === 0 || SEED_MODE=true`, `filterAndMarkSeen`, return `[]` in seed mode
- Module-level scraper singleton, `module.exports = { runVinted }` / `module.exports = { runSweclockers }`

**Scheduler integration**
- Add both scrapers to the `scrapers` array in `index.js` exactly as Tradera and Blocket are registered
- Pause state (`vinted.paused`, `sweclockers.paused`) read from `user_config` by existing `runCycle.js` — no changes needed to scheduler

### Claude's Discretion

- Exact Vinted API query parameters (category IDs, sort order, per-page count)
- Sweclockers forum thread ID for the Säljes hardware subsection (to be verified via research)
- Inter-keyword delay values (follow Blocket's 3 s pattern)

### Deferred Ideas (OUT OF SCOPE)

- Playwright headless fallback for Vinted — deferred; plain HTTP + JSON API is sufficient for Phase 5
- Retry logic / exponential backoff on rate limiting — Phase 6+ concern
- Sweclockers `Köpes` (wanted) post scraping — out of scope; only for-sale posts are relevant to deal detection
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCRP-03 | Bot scrapes Vinted for GPU, CPU, RAM, and Storage listings | Vinted JSON API v2/catalog/items confirmed; session-cookie approach verified via multiple community implementations; JSON response fields documented |
| SCRP-04 | Bot scrapes Sweclockers marketplace (köp/sälj) for GPU, CPU, RAM, and Storage listings | Sweclockers RSS feed at `/feeds/marknad` confirmed live (2026-03-03); [Säljes] filter via title prefix confirmed; cheerio xmlMode parsing verified |
</phase_requirements>

---

## Summary

Phase 5 adds two scrapers that plug into the existing pipeline (IScraper interface, filterAndMarkSeen dedup, countSeen seed mode, runCycle scheduler) without modifying any Phase 2–4 code. Each scraper is fully isolated — a crash returns `[]` and does not abort other scrapers in the same cycle.

**Vinted** uses the internal JSON REST API at `https://www.vinted.se/api/v2/catalog/items?search_text={keyword}&per_page=96&order=newest_first`. A session cookie (`_vinted_fr_session`) must be fetched first by making a GET request to the Vinted homepage with browser-like headers. The cookie goes in all subsequent API headers. The JSON response has an `items` array with each item containing `id`, `title`, `price`, `url`, `currency` (and others). Rate limiting returns 429; Cloudflare blocks return 403. Both are handled by logging and returning `[]`.

**Sweclockers** is best approached via its RSS feed at `https://www.sweclockers.com/feeds/marknad`, which provides all new marketplace listings in real-time. Each RSS item has a `[Säljes]` / `[Köpes]` / `[Bytes]` / `[Skänkes]` prefix in the title. Filtering to `[Säljes]` only takes one string check. The listing URL contains a numeric ID (e.g. `/marknad/259954-sapphire-...`). Price is embedded in the description CDATA as a free-text Swedish string — the existing `parsePrice()` handles all formats found. Cheerio with `{ xmlMode: true }` parses RSS without any new dependency.

**Primary recommendation:** Use the RSS feed (not HTML scraping) for Sweclockers — it is simpler, more reliable, already delivers structured data, and requires no selector maintenance. For Vinted, use the JSON API with session-cookie bootstrap per keyword batch.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| undici (built-in) | Node.js 24 global | HTTP fetch for Vinted API + Sweclockers RSS | Already used by all existing scrapers via `require('undici')` |
| cheerio | ^1.2.0 (installed) | Parse Sweclockers RSS XML in `xmlMode: true` | Already installed; `xmlMode` option enables RSS/XML parsing without new dependency |
| parsePrice | project util | Parse Swedish price strings from RSS description text | Handles all known formats: `5000kr`, `3 500 SEK`, `3.500:-`, `1 200,00 kr` |
| classifyCategory | pattern copy from blocket.js | Map keyword to `gpu`/`cpu`/`ram`/`storage` | Same logic already proven in Blocket and Tradera |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino logger | ^10.3.1 (installed) | Structured log output | All log calls; same `logger.info/warn/error` with structured object first arg |
| dotenv | ^17.3.1 (installed) | Env var loading | Already loaded in index.js before any require — no action needed in scraper files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RSS feed (Sweclockers) | HTML scraping of /marknad/typ/saljes | RSS is cleaner, more stable, no selector maintenance; HTML scraping risks 403 and requires selector upkeep |
| cheerio xmlMode (Sweclockers) | fast-xml-parser or xml2js | Would add a new dependency; cheerio is already installed and handles RSS in xmlMode |
| Session-cookie bootstrap (Vinted) | OAuth mobile token | Cookie approach is simpler; mobile OAuth is undocumented and fragile |

**Installation:**
```bash
# No new dependencies required — cheerio, undici (built-in), pino, dotenv all already installed
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/scrapers/
├── vinted.js            # VintedScraper class — JSON API, session cookie, per-keyword fetch
├── vintedRunner.js      # Seed mode + filterAndMarkSeen wrapper (copy of traderaRunner.js pattern)
├── sweclockers.js       # SweclockersScraper class — RSS feed fetch + XML parse
├── sweclockersRunner.js # Seed mode + filterAndMarkSeen wrapper (copy of traderaRunner.js pattern)
├── blocket.js           # (existing — do not modify)
├── blocketRunner.js     # (existing — do not modify)
├── tradera.js           # (existing — do not modify)
├── traderaRunner.js     # (existing — do not modify)
└── IScraper.js          # (existing — already includes 'vinted' and 'sweclockers' in marketplace enum)
```

### Pattern 1: Vinted Session-Cookie Bootstrap

**What:** Before querying the API, fetch the Vinted homepage to obtain a `_vinted_fr_session` session cookie. Send this cookie with every subsequent API call. Cookie lasts one scraper run; refresh each `scrape(keywords)` call.

**When to use:** Every `scrape(keywords)` invocation.

**Implementation:**
```javascript
// Source: Verified via Androz2091/vinted-api, hipsuc/Vinted-API community implementations
// Cookie fetch — hits https://www.vinted.se to receive Set-Cookie header
async _fetchSessionCookie() {
  try {
    const res = await fetch('https://www.vinted.se', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      },
    });
    // undici / Node.js fetch: cookies in Set-Cookie response header
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/_vinted_\w+_session=([^;]+)/);
    return match ? match[1] : null;
  } catch (err) {
    logger.warn({ err: err.message }, 'Vinted: session cookie fetch failed');
    return null;
  }
}
```

**IMPORTANT NOTE (LOW confidence):** Community implementations show that undici may strip `Set-Cookie` headers per the Fetch API spec in some configurations. If cookie extraction returns null, the API call should still be attempted without the cookie — the API may work without it for a limited number of requests. Validate this during implementation by inspecting the actual response headers.

### Pattern 2: Vinted API JSON Request per Keyword

**What:** GET request to `https://www.vinted.se/api/v2/catalog/items` with `search_text`, `per_page`, and `order` parameters. Parse `response.items[]` array.

**JSON response fields confirmed (MEDIUM confidence — cross-verified via PyPI wrapper docs and multiple community implementations):**
```
items[n].id           — numeric item ID
items[n].title        — item title string
items[n].price        — price as string (e.g. "350.0")  [in EUR on .fr; SEK on .se]
items[n].url          — full item URL string (https://www.vinted.se/items/...)
items[n].currency     — currency code string (e.g. "SEK")
items[n].total_item_price — price including service fee as string
items[n].brand_title  — brand name string
```

**Implementation:**
```javascript
// Source: Verified via multiple community implementations (Pawikoski/vinted-api-wrapper, hipsuc/Vinted-API)
async _fetchKeyword(keyword, sessionCookie) {
  const params = new URLSearchParams({
    search_text: keyword,
    per_page: '96',
    order: 'newest_first',
  });
  const url = `https://www.vinted.se/api/v2/catalog/items?${params}`;

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
    };
    if (sessionCookie) {
      headers['Cookie'] = `_vinted_fr_session=${sessionCookie}`;
    }

    const res = await fetch(url, { headers });

    if (res.status === 429 || res.status >= 500) {
      logger.warn({ status: res.status, url }, 'Vinted: rate limited or server error — skipping keyword');
      return [];
    }
    if (res.status === 403) {
      const cfHeader = res.headers.get('cf-ray') || res.headers.get('cf-mitigated');
      logger.warn({ status: res.status, cloudflare: !!cfHeader, url }, 'Vinted: blocked — skipping keyword');
      return [];
    }
    if (!res.ok) {
      logger.warn({ status: res.status, url }, 'Vinted: non-200 response');
      return [];
    }

    const data = await res.json();
    return this._parse(data.items || [], keyword);
  } catch (err) {
    logger.error({ err: err.message, url }, 'Vinted: fetch error');
    return [];
  }
}
```

### Pattern 3: Sweclockers RSS Fetch and Parse

**What:** Fetch `https://www.sweclockers.com/feeds/marknad` once per `scrape(keywords)` call (the feed covers all categories). Then filter `[Säljes]` items and apply keyword relevance check via `classifyCategory` on the title. No per-keyword HTTP request needed.

**Confirmed live (HIGH confidence):** Feed was fetched live on 2026-03-03 and returned real listings including GPU ([Säljes] Sapphire Radeon RX 7900 XT), RAM, monitors, keyboards. Feed is real-time with items posted minutes earlier.

**RSS item structure (verified):**
```xml
<item>
  <title>[Säljes] Sapphire Radeon RX 7900 XT 20GB Pulse Gaming OC</title>
  <link>https://www.sweclockers.com/marknad/259954-sapphire-radeon-rx-7900-xt-20gb-pulse-gaming-oc</link>
  <description><![CDATA[<div><p>...Bud från 5000kr...</p></div>]]></description>
  <guid isPermaLink="true">https://www.sweclockers.com/marknad/259954-...</guid>
  <pubDate>Tue, 03 Mar 2026 09:19:02 +0100</pubDate>
  <comments>https://www.sweclockers.com/marknad/259954-...</comments>
</item>
```

**Implementation:**
```javascript
// Source: Verified via live RSS feed fetch 2026-03-03 + cheerio xmlMode test
async scrape(keywords) {
  let xml;
  try {
    const res = await fetch('https://www.sweclockers.com/feeds/marknad', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Sweclockers: RSS fetch non-200');
      return [];
    }
    xml = await res.text();
  } catch (err) {
    logger.error({ err: err.message }, 'Sweclockers: RSS fetch error');
    return [];
  }
  return this._parse(xml, keywords);
}

_parse(xml, keywords) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const listings = [];
  const seenIds = new Set();

  $('item').each((_, el) => {
    const rawTitle = $('title', el).text().trim();

    // Only process for-sale posts
    if (!rawTitle.startsWith('[Säljes]')) return;

    // Strip [Säljes] prefix to get clean title
    const title = rawTitle.replace(/^\[Säljes\]\s*/, '').substring(0, 250);

    const link = $('link', el).text().trim();
    if (!link) return;

    // Extract numeric listing ID from URL: /marknad/259954-...
    const idMatch = link.match(/\/marknad\/(\d+)/);
    if (!idMatch) return;
    const listingId = idMatch[1];

    if (seenIds.has(listingId)) return;
    seenIds.add(listingId);

    // Category: match title against keyword-based classifier
    // (classifyCategory operates on the title text for Sweclockers, not a keyword)
    const category = classifyCategory(title);

    // Price: extract from description text, fall back to 0
    const description = $('description', el).text();
    const price_sek = parsePrice(description) ?? 0;

    listings.push({
      id: `sweclockers:${listingId}`,
      marketplace: 'sweclockers',
      title,
      price_sek,
      url: link,
      category,
      listingType: 'buy_now',
      auctionEndsAt: null,
    });
  });

  logger.info({ count: listings.length }, 'Sweclockers scrape complete');
  return listings;
}
```

### Pattern 4: Runner File (identical for both scrapers)

**What:** Copy `traderaRunner.js` exactly, replacing `TraderaScraper` and `runTradera` with `VintedScraper`/`runVinted` (or `SweclockersScraper`/`runSweclockers`).

```javascript
// Source: Existing traderaRunner.js (Phase 2 — verified production code)
'use strict';
const { VintedScraper } = require('./vinted');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const scraper = new VintedScraper();

async function runVinted(keywords) {
  const isSeedMode =
    process.env.SEED_MODE === 'true' || countSeen('vinted') === 0;

  if (isSeedMode) {
    logger.info(
      { reason: process.env.SEED_MODE === 'true' ? 'SEED_MODE env' : 'empty seen_listings' },
      'Vinted: seed mode active'
    );
  }

  const listings = await scraper.scrape(keywords);

  if (isSeedMode) {
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Vinted seed mode: all listings marked seen, no alerts emitted');
    return [];
  }

  const novel = filterAndMarkSeen(listings);
  logger.info({ found: listings.length, novel: novel.length }, 'Vinted run complete');
  return novel;
}

module.exports = { runVinted };
```

### Pattern 5: index.js Registration

**What:** Add two new entries to the `scrapers` array in `index.js`. No other changes to index.js.

```javascript
// Source: Existing index.js scrapers array pattern
const { runVinted } = require('./src/scrapers/vintedRunner');
const { runSweclockers } = require('./src/scrapers/sweclockersRunner');

const scrapers = [
  { name: 'tradera', run: runTradera },
  { name: 'blocket', run: runBlocket },
  { name: 'vinted', run: runVinted },         // NEW
  { name: 'sweclockers', run: runSweclockers }, // NEW
];
```

### Anti-Patterns to Avoid

- **Scraping Sweclockers HTML listing pages directly:** The RSS feed is simpler, provides the same data, avoids selector maintenance, and works without anti-bot pressure. HTML scraping of `/marknad/typ/saljes` returns 403.
- **Fetching Vinted per-keyword with no delay:** Add 1–3 s jitter between keywords to avoid triggering rate limiting. Use `Math.random() * 2000 + 1000` for 1–3 s range.
- **Throwing on Vinted error responses:** The contract is: never throw. Return `[]` on all error conditions (429, 403, 5xx, network error). `runCycle.js` has a try/catch but scrapers must not rely on it.
- **Building Sweclockers category filter by fetching multiple category URLs:** The single RSS feed `/feeds/marknad` already includes all categories; filter by applying `classifyCategory(title)` locally.
- **Using `classifyCategory(keyword)` for Sweclockers:** Unlike Blocket/Tradera, Sweclockers scraper fetches a single feed for all keywords — there is no per-keyword loop. Use `classifyCategory(title)` to classify based on the listing title itself.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XML/RSS parsing | Custom regex or string splitting | `cheerio.load(xml, { xmlMode: true })` | Handles CDATA, entity encoding, nested tags — regex on RSS is fragile |
| Swedish price parsing | New price parser | `parsePrice()` from `src/utils/parsePrice.js` | Already handles `5000kr`, `3 500 SEK`, `3.500:-`, `1 200,00 kr` — tested |
| Category classification | New category logic | `classifyCategory()` (copy from blocket.js) | Proven across 3 scrapers; covers GPU/CPU/RAM/storage Swedish terms |
| Deduplication | Custom seen-IDs set | `filterAndMarkSeen()` + `countSeen()` from `seenListings.js` | SQLite-backed, survives restarts, identical interface as all other scrapers |
| Seed mode logic | Custom cold-start handling | Runner pattern (copy traderaRunner.js) | Proven pattern, 3 lines to adapt |

**Key insight:** This phase's value is integration, not invention. Every hard problem (dedup, price parsing, category classification, seed mode, scheduler isolation) is already solved. The only novel work is the API/RSS fetch + normalization to the `Listing` schema.

---

## Common Pitfalls

### Pitfall 1: Undici Cookie Extraction on Windows

**What goes wrong:** `undici` / the global `fetch` in Node.js strips `Set-Cookie` response headers per the Fetch API spec. Accessing `res.headers.get('set-cookie')` may return null even when Vinted returns a cookie.

**Why it happens:** The Fetch API specification (which undici implements) restricts access to `Set-Cookie` headers in browser contexts. Node.js 24's built-in fetch uses undici and may apply this restriction.

**How to avoid:** Try `res.headers.get('set-cookie')` first. If null, also try `res.headers.getSetCookie()` (undici-specific method that returns an array). If still unavailable, fall back to attempting the API request without the cookie — some community implementations report the API works for a burst of requests without session cookie.

**Warning signs:** `sessionCookie` is always `null`, API returns 401 or empty items.

**Confidence:** LOW (flagged for validation during implementation — test live against vinted.se)

### Pitfall 2: classifyCategory() on Sweclockers Title vs Keyword

**What goes wrong:** Calling `classifyCategory(keyword)` for Sweclockers (like Blocket does) won't work because Sweclockers uses a single RSS feed fetch — there's no per-keyword request. Each listing must be classified by its title.

**Why it happens:** Blocket and Tradera iterate keywords and fetch one page per keyword, so `classifyCategory(keyword)` is natural. Sweclockers fetches one RSS feed and then filters/classifies each item.

**How to avoid:** Call `classifyCategory(title)` not `classifyCategory(keyword)`. The regex in `classifyCategory` tests GPU/CPU/RAM/storage patterns — titles like "Sapphire Radeon RX 7900 XT" will correctly return `'gpu'`.

**Warning signs:** All Sweclockers listings classified as `'unknown'`.

### Pitfall 3: Vinted Price Field is a String, Not a Number

**What goes wrong:** `item.price` in the Vinted API response is a string (e.g., `"350.0"`), not an integer. Passing it directly as `price_sek` violates the `Listing` schema (`price_sek` must be a number).

**Why it happens:** Vinted returns price as a decimal string with currency separate. The Listing schema requires an integer SEK value.

**How to avoid:** Convert via `Math.round(parseFloat(item.price || '0'))`. Check that `item.currency` is `'SEK'` — if it's `'EUR'`, either skip or convert (but vinted.se should return SEK).

**Warning signs:** SQLite type errors, price_sek is NaN or a string in seen_listings.

### Pitfall 4: Sweclockers RSS Price in Description vs Title

**What goes wrong:** Price is not in the title — it's in the description CDATA (`"Bud från 5000kr"`, `"Pris + frakt på 69kr"`). Running `parsePrice()` on the raw title returns null → sets `price_sek = 0`.

**Why it happens:** Sellers write free-form descriptions; the RSS title is just the item name.

**How to avoid:** Extract `$('description', el).text()` and run `parsePrice()` on that. The description is free-text Swedish so `parsePrice()` will find embedded prices. If it still returns null, `price_sek = 0` is correct per the locked decision.

**Warning signs:** All Sweclockers listings have `price_sek = 0`.

### Pitfall 5: Sweclockers RSS `<link>` Parsing with Cheerio

**What goes wrong:** In some RSS feeds, `<link>` is a self-closing tag or is adjacent to a `<atom:link>` namespace. Cheerio in xmlMode may not select it as expected with `$('link', el).text()`.

**Why it happens:** RSS 2.0 allows `<link>` as plain text content, but some feeds use `<atom:link>` instead. Cheerio's xmlMode selector behavior differs from HTML mode.

**How to avoid:** Test `$('link', el).text()` first. If empty, fall back to `$('guid', el).text()` — the guid in Sweclockers feed is the permaLink and contains the same URL.

**Warning signs:** `link` is always empty string; listing URLs are missing.

### Pitfall 6: Vinted Rate Limiting Across Keywords

**What goes wrong:** Querying multiple keywords in rapid succession triggers 429 Too Many Requests mid-scrape.

**Why it happens:** Vinted enforces per-IP request rate limits. Blocket uses 3 s fixed delay; for Vinted with its more aggressive anti-bot system, adding randomization is preferred.

**How to avoid:** Add `await sleep(1000 + Math.floor(Math.random() * 2000))` between keywords (1–3 s jitter as specified in CONTEXT.md). Skip any remaining keywords if a 429 is received on the first keyword (early bail-out option).

**Warning signs:** Consistent 429 after the 2nd or 3rd keyword.

---

## Code Examples

### Sweclockers RSS — Listing ID Extraction
```javascript
// Source: Live RSS feed verified 2026-03-03; URL format /marknad/{numeric-id}-{slug}
const link = 'https://www.sweclockers.com/marknad/259954-sapphire-radeon-rx-7900-xt';
const idMatch = link.match(/\/marknad\/(\d+)/);
// idMatch[1] === '259954'
const id = `sweclockers:${idMatch[1]}`;
// id === 'sweclockers:259954'
```

### Sweclockers RSS — [Säljes] Filter
```javascript
// Source: Verified against live RSS feed — prefix format confirmed
const rawTitle = '[Säljes] Sapphire Radeon RX 7900 XT 20GB Pulse Gaming OC';
if (!rawTitle.startsWith('[Säljes]')) return; // skip [Köpes], [Bytes], [Skänkes]
const title = rawTitle.replace(/^\[Säljes\]\s*/, '').substring(0, 250);
// title === 'Sapphire Radeon RX 7900 XT 20GB Pulse Gaming OC'
```

### Vinted — Price Conversion
```javascript
// Source: Verified via PyPI vinted-api-wrapper docs — price field is string decimal
// item.price = "5000.0", item.currency = "SEK"
const rawPrice = item.price || '0';
const price_sek = Math.round(parseFloat(rawPrice));
// price_sek === 5000
```

### Vinted — Listing ID Construction
```javascript
// Source: Community implementations — item.id is numeric
const id = `vinted:${item.id}`;
// e.g. 'vinted:6217648291'
```

### Vinted — URL Construction
```javascript
// Source: PyPI wrapper example — url is a full string in item object
const url = item.url;
// e.g. 'https://www.vinted.se/items/6217648291-rtx-3080'
// Fall back if missing:
const url = item.url || `https://www.vinted.se/items/${item.id}`;
```

### Cheerio xmlMode RSS Parse (verified in project)
```javascript
// Source: Verified via cheerio ^1.2.0 in project on 2026-03-03
const $ = cheerio.load(xmlString, { xmlMode: true });
$('item').each((_, el) => {
  const title = $('title', el).text().trim();
  const link  = $('link', el).text().trim();
  const desc  = $('description', el).text(); // strips CDATA automatically
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sweclockers forum-based köp/sälj scraping | Sweclockers has a dedicated Marknad (marketplace) with RSS feed | ~2020-2022 (site redesign) | No forum thread scraping needed; RSS is cleaner and simpler |
| Vinted requires Playwright to bypass Cloudflare | Vinted internal JSON API works with session cookie + browser headers | Ongoing community finding | No Playwright dependency, pure HTTP |
| Vinted Datadome on web endpoint | Mobile-style API endpoints not under Datadome protection | Ongoing | `/api/v2/catalog/items` works without `cf_clearance` cookie |

**Deprecated/outdated:**
- CONTEXT.md references `https://www.sweclockers.com/forum/lista/123` (forum-based Säljes subsection): This approach is outdated — Sweclockers now has a proper marketplace (`/marknad`) with an RSS feed. The forum lista ID is unnecessary.
- Fetching individual Sweclockers marketplace HTML pages: The RSS feed provides all the same data without selector fragility.

---

## Open Questions

1. **Undici Set-Cookie header accessibility**
   - What we know: The Fetch API spec restricts `Set-Cookie` access; undici implements this; some versions expose `getSetCookie()` as an extension.
   - What's unclear: Whether Node.js 24's specific undici version (v7.x bundled) exposes `getSetCookie()` or returns headers via `headers.raw()`.
   - Recommendation: During Wave 1 implementation, log `[...res.headers.entries()]` for the homepage fetch to inspect what's actually available. If cookie is inaccessible, attempt API call without cookie — the Vinted API may still work for some requests without it.

2. **Sweclockers RSS `<link>` element cheerio behavior**
   - What we know: RSS 2.0 `<link>` is a text-content element. Cheerio xmlMode should handle it. Live fetch was attempted but returned 403 from the web scraper tool.
   - What's unclear: Whether `$('link', el).text()` returns the URL correctly or needs `$('link', el).attr('href')` fallback.
   - Recommendation: In Wave 1, also prepare `$('guid', el).text()` as fallback since the guid is confirmed to contain the permaLink URL.

3. **Vinted price field name for vinted.se domain**
   - What we know: `item.price` is the field on `.fr`/`.pl` domains (confirmed via PyPI wrapper example). Currency is `'SEK'` on `.se`.
   - What's unclear: Whether `.se` returns `price` in SEK directly, or whether a conversion field is needed.
   - Recommendation: Log the first raw item object during development (`logger.info({ rawItem: data.items[0] }, 'Vinted raw item')`) to confirm field names before parsing.

4. **Sweclockers RSS feed category coverage**
   - What we know: The live feed (`/feeds/marknad`) includes all categories — GPU, RAM, monitors, keyboards, peripherals, CPUs, complete PCs, etc.
   - What's unclear: Whether there are category-specific RSS feeds (e.g., `/feeds/marknad/kategori/grafikkort`) that would reduce noise.
   - Recommendation: Use the single `/feeds/marknad` feed and classify locally via `classifyCategory(title)`. Listings for non-hardware categories will get `category: 'unknown'` and be naturally filtered at the deal-detection phase. This is acceptable for Phase 5.

---

## Sources

### Primary (HIGH confidence)
- Live RSS feed `https://www.sweclockers.com/feeds/marknad` — fetched 2026-03-03, real listings confirmed, XML structure verified including [Säljes] prefix and /marknad/{id} URL format
- Existing project code (`blocket.js`, `tradera.js`, `traderaRunner.js`, `blocketRunner.js`, `seenListings.js`, `parsePrice.js`, `IScraper.js`) — all patterns read directly
- Cheerio xmlMode test — verified in project environment 2026-03-03

### Secondary (MEDIUM confidence)
- [PyPI vinted-api-wrapper](https://pypi.org/project/vinted-api-wrapper/) — Item object field names confirmed: `id`, `title`, `price` (string), `url`, `total_item_price`, `service_fee`, `brand_title`, `user`, `currency`
- [Androz2091/vinted-api GitHub](https://github.com/Androz2091/vinted-api) — Cookie name `_vinted_fr_session`, endpoint `/api/v2/catalog/items`, `search_text` parameter confirmed
- [hipsuc/Vinted-API](https://github.com/hipsuc/Vinted-API) — Query parameters `search_text`, `per_page`, `order`, `page` confirmed; response structure `{ code, items[] }`
- [Sweclockers marknad URL discovery via WebSearch](https://www.sweclockers.com/marknad/typ/saljes) — `/marknad/typ/saljes` and `/marknad/kategori/grafikkort` URL pattern verified

### Tertiary (LOW confidence)
- Cookie extraction via `res.headers.get('set-cookie')` in undici — WebSearch only, needs validation at implementation time
- Vinted price is SEK on `.se` domain — inferred from domain convention, not directly verified against live response

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; cheerio xmlMode verified in project
- Architecture: HIGH — runner pattern copied exactly from proven traderaRunner.js; only scraper internals are new
- Vinted API fields: MEDIUM — cross-verified via 3+ community implementations; exact field names not confirmed against live vinted.se response
- Sweclockers RSS structure: HIGH — verified via live feed fetch 2026-03-03
- Pitfalls: MEDIUM — mostly derived from code analysis and community reports; cookie extraction pitfall is LOW

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (RSS feed structure is stable; Vinted API is unofficial and may change — recheck if scraper returns 0 items)

---

## Key Implementation Decisions for Planner

These items are in Claude's Discretion and resolved by research:

1. **Vinted `per_page`:** Use `96` — maximum documented in community implementations, reduces number of API calls per keyword.
2. **Vinted `order`:** Use `newest_first` — surfaces recent listings; comparable to Blocket/Tradera behavior.
3. **Vinted inter-keyword delay:** Use `1000 + Math.floor(Math.random() * 2000)` ms (1–3 s jitter as specified in CONTEXT.md).
4. **Sweclockers scraping approach:** Use RSS feed (`/feeds/marknad`) — NOT HTML scraping, NOT forum-based URL from CONTEXT.md. The CONTEXT.md forum URL (`/forum/lista/123`) is outdated; Sweclockers migrated to a proper marketplace.
5. **Sweclockers category classification:** Apply `classifyCategory(title)` on the listing title (not a keyword — no per-keyword loop for this scraper).
6. **Sweclockers RSS fetch frequency:** Once per `scrape(keywords)` call — no per-keyword repeat. The single feed covers all hardware categories.
