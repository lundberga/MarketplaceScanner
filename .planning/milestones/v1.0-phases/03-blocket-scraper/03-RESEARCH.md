# Phase 3: Blocket Scraper - Research

**Researched:** 2026-03-02
**Domain:** Blocket SSR HTML scraping, cheerio parsing, canary monitoring
**Confidence:** HIGH (live page inspection completed)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCRP-01 | Bot scrapes Blocket for GPU, CPU, RAM, and Storage listings matching search keywords | Live page inspection confirms SSR HTML with extractable listing IDs, titles, prices, URLs — cheerio sufficient, no headless browser needed |
</phase_requirements>

---

## Summary

Blocket's `/annonser/hela_sverige?q={keyword}` search page returns fully server-rendered HTML with no `__NEXT_DATA__` JSON blob. The project's existing STACK.md assumed `__NEXT_DATA__` would be present, but live inspection (2026-03-02) confirms Blocket has migrated away from Next.js for this route. Listing data is embedded directly in SSR HTML `<article>` elements with stable structural patterns: listing IDs in `aria-owns` attributes, titles in `<h2>` anchor text, prices in `<span>` elements, and full URLs in anchor `href` attributes pointing to `https://www.blocket.se/recommerce/forsale/item/{id}`.

The scraper can be implemented with undici + cheerio using the same pattern as `TraderaScraper`. The existing `parsePrice()` utility handles Blocket's `"11 500 kr"` format already. Blocket's `/recommerce/forsale/` section is **buy-now only** — "Auktion" appears only as a seller company name ("IT-Auktion Nordic AB"), not as a listing type. All listings are fixed-price, so `listingType` is always `'buy_now'` and `auctionEndsAt` is always `null`.

The deduplication path is identical to Tradera: listing IDs are extracted as integers, prefixed with `'blocket:'`, and passed to the existing `filterAndMarkSeen()` function in `src/db/seenListings.js` with no schema changes.

**Primary recommendation:** Implement `BlocketScraper` using `a.sf-search-ad-link` anchor selector in cheerio to extract listing ID, title, URL, and price from SSR HTML. Add a canary check asserting result count > 0 after every scrape cycle.

---

## Standard Stack

### Core (no new dependencies — all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| undici | built-in (Node 24) | HTTP GET requests to Blocket | Same as TraderaScraper — zero-dep, native fetch |
| cheerio | 1.2.0 (installed) | Parse SSR HTML, extract listings | jQuery-like selectors on static HTML, already in package.json |
| parsePrice | src/utils/parsePrice.js | Parse "11 500 kr" → 11500 | Already handles Blocket's Swedish price format |
| filterAndMarkSeen | src/db/seenListings.js | Dedup against seen_listings table | Same table as Tradera — no new schema |
| countSeen | src/db/seenListings.js | Cold-start seed detection | Same interface used by Tradera runner |
| logger | src/utils/logger.js | Structured pino logging | Project standard |

**Installation:** None required. All dependencies already in package.json.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cheerio CSS selectors | Regex on raw HTML | Cheerio is safer — regex on HTML breaks on attribute order changes |
| `a.sf-search-ad-link` selector | `article` element selector | Both work; anchor selector is more direct for extracting href+title together |

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── scrapers/
│   ├── IScraper.js        # Already exists — Listing typedef used unchanged
│   ├── tradera.js         # Already exists — pattern to mirror
│   ├── blocket.js         # NEW: BlocketScraper class
│   └── blocketRunner.js   # NEW: CLI smoke-test runner (mirrors traderaRunner.js)
├── utils/
│   └── parsePrice.js      # Already exists — reuse without changes
└── db/
    └── seenListings.js    # Already exists — filterAndMarkSeen() reused unchanged
```

### Pattern 1: SSR HTML Listing Extraction via Cheerio

**What:** Use cheerio to select `a.sf-search-ad-link` anchors from Blocket SSR HTML. Each anchor has `href="/recommerce/forsale/item/{id}"` and contains the title text. Price is in the preceding sibling `<span>` within the same article card.

**When to use:** Every Blocket fetch — the HTML structure is consistent across all search result pages.

**Live-verified article structure (2026-03-02):**
```html
<article class="relative isolate sf-search-ad card ...">
  <div class="absolute" aria-owns="search-ad-21205286"></div>
  <!-- image div -->
  <div class="m-8 mt-4 mb-8 ...">
    <div>
      <div class="flex justify-between ... font-bold ...">
        <span>9 000 kr</span>   <!-- PRICE HERE -->
      </div>
      <h2 class="h4 ..." id="search-ad-21205286">
        <a class="sf-search-ad-link s-text! ..."
           href="https://www.blocket.se/recommerce/forsale/item/21205286"
           id="21205286">       <!-- LISTING ID IN anchor id attr -->
          <span class="absolute inset-0" aria-hidden="true"></span>
          Razer Blade 14 / RTX 3080   <!-- TITLE (text after hidden span) -->
        </a>
      </h2>
      <div class="text-xs s-text-subtle flex justify-between ...">
        <span class="whitespace-nowrap truncate mr-8">Svedala</span>  <!-- LOCATION -->
        <span class="whitespace-nowrap">5 tim</span>                  <!-- AGE -->
      </div>
    </div>
  </div>
</article>
```

**Extraction approach using cheerio:**
```javascript
// Source: live page inspection 2026-03-02
const $ = cheerio.load(html);
$('a.sf-search-ad-link').each((_, el) => {
  const $a = $(el);
  const listingId = $a.attr('id');                          // "21205286"
  const url = $a.attr('href');                              // full https:// URL
  // Title: text of the anchor minus the hidden aria span
  $a.find('span[aria-hidden="true"]').remove();
  const title = $a.text().trim().substring(0, 250);         // "Razer Blade 14 / RTX 3080"
  // Price: in the sibling span with 'kr' inside the card
  const $article = $a.closest('article');
  const priceText = $article.find('div.font-bold span').first().text().trim(); // "9 000 kr"
  const price_sek = parsePrice(priceText);
  // ...
});
```

**Key fields:**
| Field | Source | Example |
|-------|--------|---------|
| Listing ID | `<a id="21205286">` | `21205286` |
| URL | `<a href="https://www.blocket.se/recommerce/forsale/item/21205286">` | Full HTTPS URL |
| Title | anchor text (after removing `aria-hidden` span) | `"Razer Blade 14 / RTX 3080"` |
| Price | `<div class="...font-bold..."><span>9 000 kr</span>` | `"9 000 kr"` → `9000` |
| Location | `<span class="whitespace-nowrap truncate mr-8">` | `"Svedala"` |

### Pattern 2: Canary Check

**What:** After each scrape cycle, assert that the result count for a broad guaranteed-populated keyword (e.g. `"grafikkort"`) is > 0. If count is 0, log a warning. This detects silent HTML structure changes.

**When to use:** Every call to `BlocketScraper.scrape()` — built into the class, not a separate step.

```javascript
// Source: PITFALLS.md recommendation, adapted for BlocketScraper
async scrape(keywords) {
  const results = await this._fetchAllKeywords(keywords);
  if (results.length === 0) {
    logger.warn({ keywords }, 'Blocket canary: zero results — page structure may have changed');
  }
  return results;
}
```

### Pattern 3: Seed Mode (Cold Start)

**What:** On first run, populate `seen_listings` with Blocket IDs without sending alerts. Reuse `countSeen('blocket')` to detect cold start.

**When to use:** Entry point / runner — same pattern as Tradera runner.

```javascript
// Source: mirrors traderaRunner.js pattern from Phase 2
const isFirstRun = countSeen('blocket') === 0;
const listings = await scraper.scrape(keywords);
if (isFirstRun) {
  // Seed: mark seen without alerting
  filterAndMarkSeen(listings);
  logger.info({ count: listings.length }, 'Blocket seed: populated seen_listings, no alerts sent');
} else {
  const novel = filterAndMarkSeen(listings);
  // novel goes to alerting pipeline (Phase 7)
}
```

### Anti-Patterns to Avoid

- **CSS class selectors:** Do NOT use class names like `card--cardShadow`, `s-bg`, or `sf-result-list` as primary selectors — Blocket uses utility CSS that changes with deployments. Use structural selectors (`a.sf-search-ad-link`, `article`) instead.
- **`__NEXT_DATA__` parsing:** The project's prior research assumed `__NEXT_DATA__` would be present. Live inspection (2026-03-02) confirms it is NOT present on Blocket search pages. Do not attempt to parse it.
- **Assuming `aria-owns` ID equals the anchor `id`:** Both `aria-owns="search-ad-21205286"` and `<a id="21205286">` contain the same listing ID, but extract from the anchor `id` attribute — it's on the direct element being parsed.
- **Regex on raw HTML instead of cheerio:** Blocket HTML is 700KB+ per page. Cheerio parses it correctly; regex risks breakage on attribute order or whitespace changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Swedish price parsing | Custom regex in blocket.js | `parsePrice()` from src/utils/parsePrice.js | Already tested for "11 500 kr", "9 000 kr" formats — identical to Tradera format |
| Seen-ID deduplication | Blocket-specific seen store | `filterAndMarkSeen()` from src/db/seenListings.js | Shared table is the requirement — "no separate store" is a success criterion |
| HTTP fetch with browser headers | Custom fetch wrapper | undici `fetch()` with headers object | Same pattern as TraderaScraper._fetchKeyword() |
| Request delay | Custom sleep logic | `sleep(REQUEST_DELAY_MS)` helper | Already in tradera.js — copy the pattern |

**Key insight:** BlocketScraper is a near-clone of TraderaScraper with different selectors. The only novel code is the cheerio selector strategy for SSR HTML vs. Tradera's different HTML structure.

---

## Common Pitfalls

### Pitfall 1: __NEXT_DATA__ Does Not Exist on Blocket Search Pages
**What goes wrong:** Code attempts to find `<script id="__NEXT_DATA__">` and parse JSON — returns null, crashes or silently returns empty array.
**Why it happens:** Prior research (PITFALLS.md, STACK.md) predicted `__NEXT_DATA__`. Live inspection proves Blocket has moved away from Next.js SSR data embedding for search pages.
**How to avoid:** Use cheerio to select `a.sf-search-ad-link` directly from the HTML DOM.
**Warning signs:** `__NEXT_DATA__` parse returns null on every request.

### Pitfall 2: Price Span Selector Too Broad
**What goes wrong:** `$('span').first()` inside an article captures a non-price span (like the hidden `aria-hidden` span or location span), returning null or wrong value for `parsePrice()`.
**Why it happens:** Multiple spans in each article card. The price is specifically inside `div.font-bold span` (the bold flex container holding price).
**How to avoid:** Use `$article.find('div.font-bold span').first().text()` — the price is always in the bold flex container.
**Warning signs:** `parsePrice()` returning null for many listings, or prices being 0.

### Pitfall 3: Title Contains Hidden Span Text
**What goes wrong:** `$a.text()` returns `"Razer Blade 14 / RTX 3080"` but may also include an empty string from `<span class="absolute inset-0" aria-hidden="true"></span>` if it has whitespace.
**Why it happens:** The anchor contains a visually-hidden positioning span before the title text.
**How to avoid:** Call `$a.find('span[aria-hidden="true"]').remove()` before calling `.text()`.
**Warning signs:** Titles with leading/trailing whitespace or empty strings for some listings.

### Pitfall 4: HTML Structure Changes Break All Selectors Simultaneously
**What goes wrong:** Blocket deploys a frontend change; `a.sf-search-ad-link` class no longer exists; all 54 results vanish silently.
**Why it happens:** CSS class names on Blocket are not guaranteed stable. The `sf-search-ad-link` class is currently stable (it's a semantic BEM-style name, not a hash) but could change.
**How to avoid:** The canary check catches this — zero results from a known-populated keyword triggers a `logger.warn()`. Additionally, fall back to `a[href*="/recommerce/forsale/item/"]` selector which depends on URL pattern (more stable than class names).
**Warning signs:** Canary warning fires, result count is 0 for broad keywords.

### Pitfall 5: Blocket Pages Are 700KB — Memory Pressure on Many Keywords
**What goes wrong:** Scanning 10 keywords in parallel, each loading 700KB HTML into cheerio, consumes ~7MB+ of memory in parallel, potentially causing GC pressure on a long-running bot.
**Why it happens:** Blocket search pages are large (700KB confirmed by live inspection).
**How to avoid:** Process keywords sequentially with `await` and a 3-5s delay (same pattern as TraderaScraper). This is already the project's established pattern.
**Warning signs:** Memory usage growing unboundedly over time; GC pauses visible in pino logs.

### Pitfall 6: Paginated Results — Only First Page Fetched
**What goes wrong:** Search for "grafikkort" returns 88 listings but scraper only gets the first page (54 results) without fetching page 2.
**Why it happens:** Blocket paginates search results but does not put `?page=N` links as visible `<a>` anchors in the current HTML structure (pagination may be JS-driven). Live inspection found no pagination hrefs in the HTML.
**How to avoid:** For Phase 3, accept first-page results (54 listings) as sufficient. The canary check will catch structural failures. Add pagination in a future phase if needed. Note: 54 results/page is confirmed by live inspection (54 `sf-search-ad` articles for "rtx 3080" which has 88 total).
**Warning signs:** Consistently missing listings that are visible on Blocket page 2.

---

## Code Examples

Verified patterns from live inspection:

### BlocketScraper class skeleton
```javascript
// Source: pattern mirrors src/scrapers/tradera.js (Phase 2)
// Selectors verified against live Blocket HTML 2026-03-02
'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const BASE_URL = 'https://www.blocket.se';
const SEARCH_URL = `${BASE_URL}/annonser/hela_sverige`;
const REQUEST_DELAY_MS = 3000; // 3s polite delay — blocket robots.txt prohibits crawling

class BlocketScraper {
  async scrape(keywords) {
    const allListings = [];
    for (const keyword of keywords) {
      if (allListings.length > 0) await sleep(REQUEST_DELAY_MS);
      const listings = await this._fetchKeyword(keyword);
      allListings.push(...listings);
    }
    // Canary check
    if (allListings.length === 0 && keywords.length > 0) {
      logger.warn({ keywords }, 'Blocket canary FAIL: zero results — possible structure change');
    }
    // Deduplicate by listing ID
    const seen = new Set();
    return allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }

  async _fetchKeyword(keyword) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}`;
    let html;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!res.ok) {
        logger.warn({ status: res.status, url }, 'Blocket fetch non-200');
        return [];
      }
      html = await res.text();
    } catch (err) {
      logger.error({ err: err.message, url }, 'Blocket fetch error');
      return [];
    }
    return this._parse(html, keyword);
  }

  _parse(html, keyword) {
    const $ = cheerio.load(html);
    const listings = [];
    const seenIds = new Set();

    $('a.sf-search-ad-link').each((_, el) => {
      const $a = $(el);
      const listingId = $a.attr('id');
      if (!listingId || seenIds.has(listingId)) return;
      seenIds.add(listingId);

      const url = $a.attr('href');
      if (!url || !url.includes('/recommerce/forsale/item/')) return;
      const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

      // Title: remove hidden aria span, then get text
      $a.find('span[aria-hidden="true"]').remove();
      const title = $a.text().trim().substring(0, 250);
      if (!title) return;

      // Price: inside the bold flex container in the article card
      const $article = $a.closest('article');
      const priceText = $article.find('div.font-bold span').first().text().trim();
      const price_sek = parsePrice(priceText);
      if (price_sek === null) return;

      listings.push({
        id: `blocket:${listingId}`,
        marketplace: 'blocket',
        title,
        price_sek,
        url: fullUrl,
        category: classifyCategory(keyword),
        listingType: 'buy_now',   // Blocket /recommerce/forsale/ is buy-now only
        auctionEndsAt: null,
      });
    });

    logger.info({ keyword, count: listings.length }, 'Blocket scrape complete');
    return listings;
  }
}
```

### Fallback selector (if sf-search-ad-link disappears)
```javascript
// Source: live inspection — URL pattern is stable
// Use as fallback if primary selector breaks
$('a[href*="/recommerce/forsale/item/"]').each((_, el) => {
  const href = $(el).attr('href');
  const idMatch = href && href.match(/\/item\/(\d+)/);
  if (!idMatch) return;
  const listingId = idMatch[1];
  // ... rest of extraction
});
```

### Canary check (per-cycle warning)
```javascript
// Source: PITFALLS.md recommendation, Phase 3 success criteria
// Called from runner after every scrape() call
if (results.length === 0) {
  logger.warn({ keywords }, 'Blocket canary: zero results — check page structure');
}
```

### classifyCategory (copy from tradera.js)
```javascript
// Source: src/scrapers/tradera.js — identical logic, copy verbatim
function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor|xeon/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|m\.2|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `__NEXT_DATA__` JSON parsing (predicted in PITFALLS.md/STACK.md) | Direct cheerio SSR HTML parsing | Confirmed 2026-03-02 (live inspection) | Simpler than expected — no JSON path navigation needed |
| Blocket listing URL: `/annons/{id}` | `/recommerce/forsale/item/{id}` | Unknown (pre-2026) | URL pattern in STACK.md was outdated; live confirmed current pattern |

**Deprecated/outdated (from prior project research):**
- `__NEXT_DATA__` parsing approach: Not applicable to current Blocket search pages. The SSR HTML approach is the correct method.
- `/annons/` URL format: Current Blocket listing URLs use `/recommerce/forsale/item/{id}` format.

---

## Open Questions

1. **Price selector stability: `div.font-bold span`**
   - What we know: Live inspection shows price in `<div class="flex justify-between ... font-bold ..."><span>9 000 kr</span>`. The `font-bold` is a Tailwind utility class.
   - What's unclear: Whether `font-bold` class could disappear in a style system update (Blocket uses Warp DS design system, not Tailwind directly — but the output class matches).
   - Recommendation: Use `div.font-bold span` as primary selector; add fallback that checks all spans in the article for `kr` text. Log raw priceText on first 5 listings each run for monitoring.

2. **Pagination: Is page 2+ accessible?**
   - What we know: "88 annonser" shown for "rtx 3080" but only 54 `sf-search-ad` articles returned per live fetch. No `<a>` pagination links found in HTML (JS-driven pagination likely).
   - What's unclear: Whether `?page=2` or `?o=2` or similar query param works for server-side pagination.
   - Recommendation: For Phase 3, accept 54 results/page. Investigate `?page=2` empirically in the implementation task — if it works, add a second-page fetch for broad keywords. Not a blocker.

3. **Rate limit behavior**
   - What we know: robots.txt prohibits crawling; 3-5s delay is the project standard.
   - What's unclear: Whether Blocket actively 429s or blocks IPs at what threshold.
   - Recommendation: Use 3s delay between keyword fetches. Log HTTP status codes. If 429 appears, back off 30s and retry once, then return [].

---

## Validation Architecture

> Skipped — `.planning/config.json` not checked; no `nyquist_validation` config found. Using project's established pattern: Node.js built-in assert module, `*.test.js` files run with `node`.

### Test Approach (matching Phase 2 pattern)
The project uses inline Node assert-based tests (no Jest/Vitest). For Phase 3:

| Req ID | Behavior | Test Type | Command |
|--------|----------|-----------|---------|
| SCRP-01 | BlocketScraper.scrape(['rtx 3080']) returns non-empty Listing[] | Live smoke test | `node src/scrapers/blocketRunner.js` |
| SCRP-01 | Each Listing has id='blocket:{id}', marketplace='blocket', price_sek integer, url starting 'https://' | Schema validation in smoke test | Inline assertions in runner |
| SCRP-01 | Listing IDs feed into filterAndMarkSeen() with no schema changes | Integration check | Smoke test calls filterAndMarkSeen() on results |
| SCRP-01 | Canary warning fires when result count is 0 | Unit test with mock | `node src/scrapers/blocket.test.js` (empty HTML fixture) |

---

## Sources

### Primary (HIGH confidence)
- Live HTTP inspection of `https://www.blocket.se/annonser/hela_sverige?q=rtx+3080` — 2026-03-02, 701,925 bytes HTML
  - Confirmed: 54 `sf-search-ad` article elements per page
  - Confirmed: listing ID in `<a id="{id}">` and `aria-owns="search-ad-{id}"`
  - Confirmed: URL pattern `https://www.blocket.se/recommerce/forsale/item/{id}`
  - Confirmed: price in `<div class="...font-bold..."><span>{price} kr</span>`
  - Confirmed: title in anchor text after `<span aria-hidden="true">` removal
  - Confirmed: NO `__NEXT_DATA__` script tag present
  - Confirmed: "Auktion" appears only as seller name, not listing type — all listings are buy-now

### Secondary (MEDIUM confidence)
- `src/scrapers/tradera.js` (Phase 2 implementation) — pattern to mirror for BlocketScraper class structure
- `src/db/seenListings.js` — `filterAndMarkSeen(listings)` and `countSeen(marketplace)` API confirmed
- `.planning/research/STACK.md` — cheerio 1.2.0, undici, pino already installed

### Tertiary (LOW confidence — prior research, now partially superseded)
- `.planning/research/PITFALLS.md` — `__NEXT_DATA__` assumption was incorrect for current Blocket; canary check recommendation still valid
- `.planning/research/STACK.md` — Blocket SSR confirmed but `__NEXT_DATA__` prediction was wrong

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all confirmed installed
- Architecture: HIGH — live page inspection; selectors verified against real HTML
- Pitfalls: HIGH — primary pitfalls derived from live data, not assumptions
- `__NEXT_DATA__` absence: HIGH — confirmed by direct live inspection

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days) — Blocket HTML structure is commercial SSR, changes with deployments; re-verify if canary fires
