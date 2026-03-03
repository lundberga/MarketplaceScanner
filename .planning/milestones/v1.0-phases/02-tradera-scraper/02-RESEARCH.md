# Phase 2: Tradera Scraper - Research

**Researched:** 2026-03-02
**Domain:** Web scraping (Tradera marketplace), deduplication pipeline, sold-price caching
**Confidence:** HIGH — Tradera live site verified, existing stack already chosen

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCRP-02 | Bot scrapes Tradera for GPU, CPU, RAM, and Storage listings (buy-now and ending-soon auctions) | Verified: `itemStatus=Active` returns public active listings without auth. URL pattern `/item/{categoryId}/{listingId}/{slug}`. Price format "Pris:3 999 kr,Köp nu" or "Pris:3 290 kr,Ledande bud". IScraper interface pattern documented. |
| DEUP-03 | Bot performs a seed-mode scan on cold start — populates seen-IDs from current listings without sending alerts | Supported: seen_listings table already in schema (Phase 1). Seed mode implementation pattern documented: check seen_listings row count, if zero run seed pass with INSERT OR IGNORE but no alert emission. |

</phase_requirements>

---

## Summary

Phase 2 implements the Tradera scraper end-to-end: active listing fetch, HTML parsing, Listing schema normalization, deduplication via the seen_listings table, seed mode on cold start, and the sold-price cache (TraderaSoldCache). All dependencies are already installed from Phase 1 (undici built-in, cheerio 1.2.0, better-sqlite3 12.6.2).

**CRITICAL FINDING — Verified:** The sold-listing URL filter works WITHOUT authentication. `https://www.tradera.com/search?q={query}&itemStatus=Ended` returns publicly accessible completed auction data with final sale prices. No login wall encountered. The `itemStatus` parameter accepts string values: `Active`, `Ended`, `Unsold`. This unblocks Phase 6 (Deal Detection) sold-comps feature.

Tradera uses Next.js for server-side rendering. Listing data is accessible via HTML parsing of the search results page. The listing ID is embedded in anchor `href` attributes following the pattern `/item/{categoryId}/{listingId}/{slug}` — the second numeric segment is the listing ID. Price text appears as prose ("Pris:3 999 kr,Köp nu", "Pris:3 290 kr,Ledande bud") requiring regex extraction. Listing type (auction vs. buy-now) is inferred from the presence of "Ledande bud" (auction) or "Köp nu" alone (fixed price).

**Primary recommendation:** Implement TraderaScraper using `undici` fetch + `cheerio` HTML parsing, extracting listing IDs via URL regex, prices via Swedish price parser, and listing type via text detection. Use `itemStatus=Active` for active listings and `itemStatus=Ended` for sold comps. No API key or auth required.

---

## Standard Stack

All packages already installed in Phase 1. No new `npm install` required for core functionality.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| undici | built-in (Node 24) | HTTP fetch for Tradera HTML pages | Node.js native, zero dependency cost, `require('undici')` confirmed working |
| cheerio | 1.2.0 | Parse Tradera HTML search results | jQuery-like selectors, SSR HTML confirmed, already in package.json |
| better-sqlite3 | 12.6.2 | seen_listings dedup writes + sold_price_cache | Sync API, already in package.json, schema from Phase 1 |
| pino | 10.3.1 | Structured logging in scraper | Already in package.json, logger exported from src/utils/logger.js |
| dotenv | 17.3.1 | Environment variables (SEED_MODE etc.) | Already in package.json |

### No New Dependencies Needed
Phase 2 uses only what Phase 1 already installed. The undici package is available via `require('undici')` as confirmed by live test.

---

## Architecture Patterns

### Recommended Project Structure for Phase 2

```
src/
├── db/
│   ├── init.js          # EXISTS — Phase 1
│   └── index.js         # EXISTS — singleton db connection
├── scrapers/
│   ├── IScraper.js      # NEW — interface definition (JSDoc @typedef)
│   ├── tradera.js       # NEW — TraderaScraper class
│   └── soldCache.js     # NEW — TraderaSoldCache class
├── utils/
│   ├── logger.js        # EXISTS — Phase 1
│   └── parsePrice.js    # NEW — Swedish price parser utility
└── index.js             # EXISTS (or placeholder)
```

### Pattern 1: IScraper Interface (CommonJS JSDoc)

The project uses CommonJS (no type:module per Phase 1 decisions). Interfaces are expressed via JSDoc `@typedef`. Every scraper must implement `scrape(keywords)`.

```javascript
// src/scrapers/IScraper.js
'use strict';

/**
 * @typedef {Object} Listing
 * @property {string} id            - Composite key: 'tradera:{listingId}'
 * @property {string} marketplace   - 'tradera'
 * @property {string} title         - Listing title
 * @property {number} price_sek     - Price in SEK (integer, 0 if free/unknown)
 * @property {string} url           - Full listing URL
 * @property {string} category      - 'gpu'|'cpu'|'ram'|'storage'|'unknown'
 * @property {'buy_now'|'auction'} listingType - Listing format
 * @property {string|null} auctionEndsAt - ISO string or null
 */

/**
 * @interface IScraper
 * Every scraper must implement this method.
 * @param {string[]} keywords - Search keywords to scrape
 * @returns {Promise<Listing[]>}
 */
module.exports = {};
```

### Pattern 2: TraderaScraper — Active Listings

URL pattern for Tradera active listings search (verified live):
```
https://www.tradera.com/search?q={query}&itemStatus=Active
```

Listing cards: each is an `<a>` tag with `href` matching `/item/{categoryId}/{listingId}/{slug}`.

Listing ID extraction: parse the second numeric segment from the href path.

Price extraction: find text containing "kr" near each listing card, strip Swedish thousands separators (spaces), extract integer. See Price Parser pattern below.

Listing type detection:
- Contains "Ledande bud" → `listingType: 'auction'`
- Contains "Köp nu" without "Eller Köp nu" → `listingType: 'buy_now'`
- Contains "Eller Köp nu" → `listingType: 'auction'` (auction with buy-now option — use buy-now price for threshold comparison)

Auction end time: text immediately after "Sluttid" (format: "20 mar 09:02"). Parse to ISO date.

```javascript
// src/scrapers/tradera.js
'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const BASE_URL = 'https://www.tradera.com';
const SEARCH_URL = `${BASE_URL}/search`;
const REQUEST_DELAY_MS = 2000; // polite delay between keyword fetches

class TraderaScraper {
  /**
   * @param {string[]} keywords
   * @returns {Promise<import('./IScraper').Listing[]>}
   */
  async scrape(keywords) {
    const allListings = [];
    for (const keyword of keywords) {
      await sleep(REQUEST_DELAY_MS);
      const listings = await this._fetchKeyword(keyword);
      allListings.push(...listings);
    }
    // Deduplicate by listing ID within this batch (same item can appear for multiple keywords)
    const seen = new Set();
    return allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }

  async _fetchKeyword(keyword) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}&itemStatus=Active`;
    let html;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) {
        logger.warn({ status: res.status, url }, 'Tradera fetch non-200');
        return [];
      }
      html = await res.text();
    } catch (err) {
      logger.error({ err, url }, 'Tradera fetch error');
      return [];
    }
    return this._parse(html, keyword);
  }

  _parse(html, keyword) {
    const $ = cheerio.load(html);
    const listings = [];

    // Each listing card is an <a> tag linking to /item/{catId}/{listingId}/{slug}
    $('a[href*="/item/"]').each((_, el) => {
      const href = $(el).attr('href');
      const idMatch = href && href.match(/\/item\/\d+\/(\d+)\//);
      if (!idMatch) return;
      const listingId = idMatch[1];
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // Skip navigation links and non-listing anchors (no price text)
      if (!text.includes('kr')) return;

      const title = $(el).find('h3, [class*="title"]').first().text().trim()
        || text.split('kr')[0].trim();

      // Determine listing type
      let listingType = 'buy_now';
      if (text.includes('Ledande bud') || text.includes('Eller Köp nu')) {
        listingType = 'auction';
      }

      // Extract price: prefer buy-now price for auctions with buy-now option
      let priceRaw = '';
      if (text.includes('Eller Köp nu')) {
        // "3 290 kr, Eller Köp nu 3 790 kr" — use the buy-now price
        const buyNowMatch = text.match(/Eller Köp nu\s+([\d\s]+)\s*kr/);
        priceRaw = buyNowMatch ? buyNowMatch[1] : text;
      } else {
        priceRaw = text;
      }
      const price_sek = parsePrice(priceRaw);
      if (price_sek === null) return; // skip if price unparseable

      // Auction end time
      let auctionEndsAt = null;
      const sluttidMatch = text.match(/Sluttid\s*(\d+\s+\w+\s+\d+:\d+)/);
      if (sluttidMatch) {
        auctionEndsAt = sluttidMatch[1]; // store as raw string; Phase 6 can parse
      }

      listings.push({
        id: `tradera:${listingId}`,
        marketplace: 'tradera',
        title: title.substring(0, 250),
        price_sek,
        url: fullUrl,
        category: classifyCategory(keyword),
        listingType,
        auctionEndsAt,
      });
    });
    return listings;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}

module.exports = { TraderaScraper };
```

### Pattern 3: Swedish Price Parser

This is a utility needed across all scrapers. Swedish price formats encountered on Tradera (verified live):

| Raw Format | Parsed |
|-----------|--------|
| `"3 999 kr"` | `3999` |
| `"3 290 kr, Ledande bud"` | `3290` |
| `"2 500:-"` | `2500` |
| `"2500 SEK"` | `2500` |
| `"1 200,00 kr"` | `1200` |

```javascript
// src/utils/parsePrice.js
'use strict';

/**
 * Parses Swedish price strings to integer SEK.
 * Returns null if no valid price found.
 * @param {string} raw
 * @returns {number|null}
 */
function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Remove currency suffixes and noise
  let cleaned = raw
    .replace(/kr\/st|kr|SEK|:-/gi, '')
    .replace(/,\d{2}/, '')      // strip decimal: "2500,00" -> "2500"
    .replace(/\./g, '')          // strip period thousands separator
    .replace(/\s/g, '');         // strip all spaces (Swedish thousands sep)
  const match = cleaned.match(/(\d+)/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return isNaN(value) ? null : value;
}

module.exports = { parsePrice };
```

### Pattern 4: Deduplication Pipeline

The seen_listings table is already created in Phase 1 with composite primary key `id TEXT PRIMARY KEY` where id = `'tradera:{listingId}'`.

```javascript
// src/db/seenListings.js — thin wrapper for deduplication
'use strict';
const db = require('./index');

/**
 * Filters listings to only those not already in seen_listings.
 * Inserts new listings atomically.
 * @param {import('../scrapers/IScraper').Listing[]} listings
 * @returns {import('../scrapers/IScraper').Listing[]} novel listings only
 */
function filterAndMarkSeen(listings) {
  if (listings.length === 0) return [];

  const ids = listings.map(l => l.id);
  const placeholders = ids.map(() => '?').join(',');
  const seenRows = db.prepare(
    `SELECT id FROM seen_listings WHERE id IN (${placeholders})`
  ).all(...ids);
  const seenSet = new Set(seenRows.map(r => r.id));

  const novel = listings.filter(l => !seenSet.has(l.id));

  // Insert novel listings atomically
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO seen_listings (id, marketplace, first_seen, title, price_sek)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((items) => {
    const now = Math.floor(Date.now() / 1000);
    for (const l of items) {
      insertStmt.run(l.id, l.marketplace, now, l.title, l.price_sek);
    }
  });
  insertAll(novel);

  return novel;
}

/**
 * Returns the count of rows in seen_listings for a given marketplace.
 * Used for seed-mode detection.
 * @param {string} marketplace
 * @returns {number}
 */
function countSeen(marketplace) {
  return db.prepare(
    'SELECT COUNT(*) as cnt FROM seen_listings WHERE marketplace = ?'
  ).get(marketplace).cnt;
}

module.exports = { filterAndMarkSeen, countSeen };
```

### Pattern 5: Seed Mode

Seed mode populates seen_listings on first run WITHOUT emitting any alerts. This prevents the Discord channel from being flooded when the bot starts for the first time.

Detection strategy: check `countSeen('tradera')` before the first scrape cycle. If 0, run in seed mode.

```javascript
// In the scraper runner or index.js:
const { countSeen, filterAndMarkSeen } = require('./db/seenListings');
const { TraderaScraper } = require('./scrapers/tradera');

async function runTraderaWithSeed(keywords) {
  const isSeedMode = process.env.SEED_MODE === 'true' || countSeen('tradera') === 0;
  const scraper = new TraderaScraper();
  const listings = await scraper.scrape(keywords);

  if (isSeedMode) {
    // Mark all current listings as seen — no alerts emitted
    filterAndMarkSeen(listings); // inserts all, discards the return value
    logger.info({ count: listings.length }, 'Seed mode: populated seen_listings, no alerts sent');
    return [];
  }

  // Normal mode: filter to novel listings only
  return filterAndMarkSeen(listings);
}
```

### Pattern 6: TraderaSoldCache

Fetches sold/ended listing prices for a query term, caches in `sold_price_cache` with 4-hour TTL.

**Verified URL:** `https://www.tradera.com/search?q={query}&itemStatus=Ended` — returns ended listings publicly, no auth required.

```javascript
// src/scrapers/soldCache.js
'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const db = require('../db/index');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const SOLD_URL = 'https://www.tradera.com/search';
const MIN_SAMPLES = 3;

/**
 * Returns median sold price for a query term, or null if insufficient data.
 * @param {string} queryKey - Normalized term e.g. 'rtx 3080'
 * @returns {Promise<{medianPrice: number|null, sampleCount: number}>}
 */
async function lookupSoldPrice(queryKey) {
  // Check cache first
  const cached = db.prepare(
    'SELECT median_price, sample_count, fetched_at FROM sold_price_cache WHERE query_key = ?'
  ).get(queryKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && (now - cached.fetched_at) < CACHE_TTL_SECONDS) {
    return { medianPrice: cached.median_price, sampleCount: cached.sample_count };
  }

  // Cache miss — fetch from Tradera
  const url = `${SOLD_URL}?q=${encodeURIComponent(queryKey)}&itemStatus=Ended`;
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, queryKey }, 'Sold price fetch failed');
      return { medianPrice: null, sampleCount: 0 };
    }
    html = await res.text();
  } catch (err) {
    logger.error({ err, queryKey }, 'Sold price fetch error');
    return { medianPrice: null, sampleCount: 0 };
  }

  const prices = _parseSoldPrices(html);
  if (prices.length < MIN_SAMPLES) {
    logger.info({ queryKey, found: prices.length }, 'Insufficient sold data, returning null');
    return { medianPrice: null, sampleCount: prices.length };
  }

  const medianPrice = median(prices);
  const sampleCount = prices.length;

  // Upsert cache
  db.prepare(`
    INSERT INTO sold_price_cache (query_key, median_price, sample_count, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(query_key) DO UPDATE SET
      median_price = excluded.median_price,
      sample_count = excluded.sample_count,
      fetched_at   = excluded.fetched_at
  `).run(queryKey, medianPrice, sampleCount, now);

  return { medianPrice, sampleCount };
}

function _parseSoldPrices(html) {
  const $ = cheerio.load(html);
  const prices = [];

  $('a[href*="/item/"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ');
    if (!text.includes('kr')) return;

    // Filter out junk/lot/broken listings
    const lower = text.toLowerCase();
    if (/defekt|trasig|delar|parti|lot|för delar/.test(lower)) return;

    const price = parsePrice(text);
    if (price !== null && price > 100) { // sanity: ignore sub-100 SEK (accessories, etc.)
      prices.push(price);
    }
  });

  return prices;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

module.exports = { lookupSoldPrice };
```

### Anti-Patterns to Avoid

- **Auction current-bid as deal price:** For auctions with "Ledande bud" (active bid), NEVER compare current bid to threshold — the final price will be higher. Only compare "Köp nu" price or after auction ends. The `listingType` field enables this distinction.
- **Full URL as dedup key:** Use extracted listing ID (`717510247`), not the full URL. URLs may include tracking params or differ between mobile/desktop.
- **Re-running sold fetch per listing:** The sold price lookup is per query term (e.g., "rtx 3080"), not per individual listing. Multiple listings for the same model share one cache entry.
- **No jitter between requests:** Add at minimum 2s delay between keyword fetches to avoid being rate-limited.
- **God scraper with if/else branching:** TraderaScraper is its own class. Never add `if (marketplace === 'tradera')` inside a shared scraper.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swedish price parsing | Custom per-scraper inline regex | `src/utils/parsePrice.js` shared utility | Formats vary across Tradera, Blocket, Vinted — one tested utility serves all |
| DB deduplication | In-memory Set | better-sqlite3 `INSERT OR IGNORE` + `seen_listings` table | Set is lost on restart; SQLite survives restarts (proven in Phase 1) |
| HTTP with retries | Custom retry loop | undici fetch + simple try/catch + skip cycle | Over-engineering at this stage; log and skip is sufficient for v1 |
| HTML pagination | Custom page counter | Single-page scrape per keyword per cycle | Tradera shows top results on page 1; full catalogue crawl risks rate limits |

**Key insight:** The seen_listings deduplication is already designed and schema-complete from Phase 1. Phase 2 only needs to write the application-layer wrapper around `INSERT OR IGNORE`.

---

## Common Pitfalls

### Pitfall 1: Tradera Listing Card Anchors — Multiple Matches Per Listing
**What goes wrong:** The same listing URL (`/item/341372/717510247/...`) can appear in multiple `<a>` tags on the page — one for the image, one for the title, one for the price area. The cheerio `.each()` loop produces duplicate listing objects.
**Why it happens:** Tradera's card structure wraps multiple clickable elements in separate anchors pointing to the same URL.
**How to avoid:** Deduplicate by `listingId` within `_parse()` before returning. Use a Map keyed on listing ID and take the last (most complete) entry, or collect IDs into a Set inside the `.each()` handler and skip already-seen IDs.
**Warning signs:** Returned array has 2-3x expected count; same listing ID appears multiple times.

### Pitfall 2: Price Text on Navigation/Header Anchors
**What goes wrong:** Cheerio's `$('a[href*="/item/"]')` selector may catch navigation anchors or breadcrumbs that happen to contain `/item/` in their URL but are not listing cards.
**Why it happens:** Tradera's page may include "related item" links or footer links matching the pattern.
**How to avoid:** Guard with `if (!text.includes('kr')) return;` — navigation links never contain price text. The guard is already included in the pattern above.
**Warning signs:** Parser returns listings with null/0 price or empty titles.

### Pitfall 3: Auction End Time Parsing — Swedish Month Names
**What goes wrong:** Tradera's sluttid text uses Swedish month abbreviations: "20 mar", "8 apr", "29 jan". Passing this directly to `new Date()` fails silently (returns Invalid Date) in Node.js because Node's date parser uses English month names.
**Why it happens:** The sluttid format is a locale-specific string, not ISO 8601.
**How to avoid:** Store the raw "Sluttid" string in `auctionEndsAt` for now. Phase 6 (Deal Detection) will need to parse it — build a Swedish month map there. Phase 2 just stores the string.
**Warning signs:** `new Date(auctionEndsAt)` returns `Invalid Date`.

### Pitfall 4: itemStatus Parameter is a String, Not Integer
**What goes wrong:** Using `?itemStatus=1` or `?itemStatus=2` (integers) returns active listings mixed-status results, NOT ended listings.
**Why it happens:** Tradera's __NEXT_DATA__ reveals the parameter accepts string values: `"Active"`, `"Ended"`, `"Unsold"` — not integers.
**How to avoid:** Always use `itemStatus=Active` for live listings and `itemStatus=Ended` for sold comps. This was verified live on 2026-03-02.
**Warning signs:** "Ended" listings search returns active listings; sold-price cache returns current prices not historical sales.

### Pitfall 5: Seed Mode Not Triggered on Warm Restarts
**What goes wrong:** Seed mode should only run once — on true cold start when seen_listings is empty. If the bot crashes and restarts 30 seconds later, `countSeen('tradera')` > 0, so seed mode is skipped correctly. But if someone wipes the DB and restarts, seed mode triggers again — correct behavior.
**Why it happens:** Using `countSeen() === 0` as the trigger is idempotent and correct.
**How to avoid:** Do NOT use a flag file or timestamp for seed detection — the DB count is the ground truth. `process.env.SEED_MODE === 'true'` is an escape hatch for forced re-seeding.
**Warning signs:** Bot sends alerts on existing listings after a DB wipe — means seed mode check is broken.

### Pitfall 6: sold_price_cache UPSERT Syntax
**What goes wrong:** SQLite's `INSERT OR REPLACE` drops and re-inserts the row, resetting the row ID and potentially triggering foreign key issues. `INSERT OR IGNORE` skips the update, meaning stale cache entries are never refreshed.
**Why it happens:** Confusion between SQLite's three conflict strategies.
**How to avoid:** Use `INSERT INTO ... ON CONFLICT(query_key) DO UPDATE SET ...` (SQLite upsert syntax, available since SQLite 3.24 / Node better-sqlite3 any modern version). This is shown in the TraderaSoldCache pattern above.
**Warning signs:** Cache entries never update; sold price stays stale indefinitely.

---

## Code Examples

### Verified URL Patterns (confirmed live 2026-03-02)

```javascript
// Active Tradera listings — no auth required
// Source: live WebFetch verification 2026-03-02
const ACTIVE_URL = 'https://www.tradera.com/search?q=rtx+3080&itemStatus=Active';

// Sold/ended Tradera listings — no auth required
// Source: live WebFetch verification 2026-03-02
const SOLD_URL = 'https://www.tradera.com/search?q=rtx+3080&itemStatus=Ended';

// Listing ID extraction from URL path
// Source: observed from live Tradera page
// href = "/item/341372/717510247/aorus-geforce-rtx-3080-xtreme-10gb-grafikkort"
const idMatch = href.match(/\/item\/\d+\/(\d+)\//);
const listingId = idMatch ? idMatch[1] : null;
// listingId = "717510247"
```

### better-sqlite3 Transaction for Batch Insert
```javascript
// Source: better-sqlite3 docs pattern — synchronous API
// INSERT OR IGNORE handles the composite PK collision silently
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO seen_listings (id, marketplace, first_seen, title, price_sek)
  VALUES (?, ?, ?, ?, ?)
`);
const insertAll = db.transaction((items) => {
  const now = Math.floor(Date.now() / 1000);
  for (const item of items) {
    insertStmt.run(item.id, item.marketplace, now, item.title, item.price_sek);
  }
});
insertAll(novelListings);
```

### SQLite Upsert for Cache
```javascript
// Source: SQLite 3.24+ ON CONFLICT syntax, confirmed working in better-sqlite3
db.prepare(`
  INSERT INTO sold_price_cache (query_key, median_price, sample_count, fetched_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(query_key) DO UPDATE SET
    median_price = excluded.median_price,
    sample_count = excluded.sample_count,
    fetched_at   = excluded.fetched_at
`).run(queryKey, medianPrice, sampleCount, now);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tradera SOAP API (`api.tradera.com`) | HTML scraping of public search pages | Pre-existing — API requires registration | No API key needed; scraping is the correct path |
| `itemStatus=1` integer filter | `itemStatus=Ended` string filter | Verified live 2026-03-02 | Integer values return wrong data; must use string |
| Per-listing sold price fetch | Cached per query_key with 4h TTL | Design decision (Phase 1 architecture) | Reduces Tradera requests from N listings to ~5 query terms per cycle |

**Deprecated/outdated:**
- `api.tradera.com` SOAP API: Requires developer account registration, SOAP XML complexity. Not used. Scraping public HTML is simpler and sufficient.
- Integer `itemStatus` values (1, 2, 3): Do NOT work as expected. The correct values are the string enums `Active`, `Ended`, `Unsold`.

---

## Open Questions

1. **Tradera page structure stability for cheerio selectors**
   - What we know: Tradera uses Next.js SSR; listing cards rendered server-side; anchors follow `/item/{catId}/{listingId}/{slug}` pattern verified live
   - What's unclear: The exact CSS class names for listing title elements (they may be CSS module hashes). The price text proximity to the anchor card may vary.
   - Recommendation: Target `a[href*="/item/"]` + text content extraction (regex on the full text node) rather than class-based selectors. Fallback: if title extraction fails, use the URL slug as a human-readable title approximation.

2. **Tradera rate limiting behavior**
   - What we know: Tradera's site is publicly accessible; no Cloudflare challenge observed during research fetches
   - What's unclear: At what request frequency does Tradera start returning 429 or empty responses?
   - Recommendation: Start with 2s delay between keyword fetches. If 429s occur during testing, increase to 5s. Log all non-200 responses.

3. **Sold-price listing count for RTX 3080 ("21 exact matches")**
   - What we know: Live fetch of `itemStatus=Ended&q=rtx+3080` returned "21 exakta träffar" — sufficient for median calculation
   - What's unclear: Less common hardware keywords may return < 3 results, triggering the fallback.
   - Recommendation: The MIN_SAMPLES=3 guard and graceful null return handle this correctly. Phase 6 must handle null medianPrice by falling back to threshold-only mode.

---

## Sources

### Primary (HIGH confidence)
- Live WebFetch: `tradera.com/search?q=rtx+3080&itemStatus=Ended` — confirmed public access to sold listings, no auth wall, "21 exakta träffar" visible (2026-03-02)
- Live WebFetch: `tradera.com/search?q=rtx+3080&itemStatus=Active` — confirmed active listings structure, itemStatus string enum values from __NEXT_DATA__
- Live WebFetch: `tradera.com/search` — confirmed Next.js SSR, `/item/{catId}/{listingId}/{slug}` URL pattern, price format "Pris:3 999 kr,Köp nu"
- WebSearch site:tradera.com — revealed `itemStatus=Ended` string enum from an actual indexed URL

### Secondary (MEDIUM confidence)
- `C:/Users/alexl/Desktop/scanner/.planning/research/STACK.md` — cheerio 1.2.0, undici built-in, better-sqlite3 12.6.2 already installed
- `C:/Users/alexl/Desktop/scanner/.planning/research/ARCHITECTURE.md` — IScraper interface, Listing schema, dedup flow, sold_price_cache TTL design
- `C:/Users/alexl/Desktop/scanner/.planning/research/PITFALLS.md` — Tradera sold data pitfall, auction vs buy-now confusion pitfall
- `C:/Users/alexl/Desktop/scanner/src/db/init.js` — exact column names and types of all 5 Phase 1 tables

### Tertiary (LOW confidence — needs runtime validation)
- Cheerio selector patterns for Tradera card structure — derived from observed URL patterns + text content, not inspected raw HTML class names. The `a[href*="/item/"]` selector is based on observed URL structure; actual card wrapper elements were not visible in WebFetch HTML output.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages pre-installed and confirmed working (Phase 1)
- Tradera active listings URL: HIGH — verified live with itemStatus=Active string value
- Tradera sold listings URL: HIGH — verified live with itemStatus=Ended, public access confirmed
- Cheerio selector patterns: MEDIUM — URL pattern confirmed live, but exact CSS class names for title/price elements not inspected; text-content extraction approach is more robust anyway
- Deduplication logic: HIGH — schema and INSERT OR IGNORE semantics are well-understood
- Seed mode logic: HIGH — pattern is straightforward; countSeen() is the reliable detection mechanism
- SQLite upsert syntax: HIGH — ON CONFLICT DO UPDATE is standard SQLite 3.24+, better-sqlite3 supports it

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 for stack; 2026-03-16 for Tradera URL structures (site may change)
