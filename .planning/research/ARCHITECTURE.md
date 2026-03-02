# Architecture Patterns

**Domain:** Marketplace scraper + Discord flip-alert bot
**Project:** Hardware Flip Scanner
**Researched:** 2026-03-02
**Confidence:** HIGH — established patterns for this class of application

---

## Recommended Architecture

A five-layer pipeline where each layer has a single responsibility and communicates downward via well-defined interfaces. The bot process hosts all layers in a single Node.js (or Python) process — no microservices, no message queues. Simple, runs on Windows without infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│                    SCHEDULER LAYER                       │
│   cron-style polling loop, per-marketplace interval      │
└──────────────────────┬──────────────────────────────────┘
                       │ triggers
┌──────────────────────▼──────────────────────────────────┐
│                    SCRAPER LAYER                         │
│   BlocketScraper  |  TraderaScraper  |  VintedScraper   │
│   (normalizes all output to common Listing schema)       │
└──────────────────────┬──────────────────────────────────┘
                       │ raw listings
┌──────────────────────▼──────────────────────────────────┐
│               DEDUPLICATION LAYER                        │
│   seen-listings store (SQLite), filters already-sent     │
└──────────────────────┬──────────────────────────────────┘
                       │ new-only listings
┌──────────────────────▼──────────────────────────────────┐
│             DEAL DETECTION ENGINE                        │
│   threshold check + Tradera sold-price market lookup     │
│   scores each listing, produces DealAlert structs        │
└──────────────────────┬──────────────────────────────────┘
                       │ scored deals above threshold
┌──────────────────────▼──────────────────────────────────┐
│                  DISCORD LAYER                           │
│   alert poster (webhooks/bot embeds)                     │
│   command handler (slash commands for config)            │
└──────────────────────┬──────────────────────────────────┘
                       │ reads/writes
┌──────────────────────▼──────────────────────────────────┐
│               PERSISTENCE LAYER (SQLite)                 │
│   tables: seen_listings | thresholds | user_config       │
└─────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### 1. Scheduler Layer

**Responsibility:** Fire each scraper on its configured interval. Control pause/resume state per marketplace. Sequence scraper calls with polite delays to avoid rate-limiting.

**Communicates with:** Scraper Layer (triggers), Persistence Layer (reads pause state)

**Key decisions:**
- Use `node-cron` (Node.js) or `APScheduler` (Python) — not `setInterval`, which drifts and cannot be paused cleanly
- Each marketplace gets its own independent schedule slot. Blocket, Tradera, Vinted run on separate timers so one slow scrape does not block others
- Pause/resume state lives in the DB (`user_config` table), checked at trigger time — no in-memory-only state that would be lost on restart

**Interface:**
```
Scheduler.trigger(marketplace: 'blocket' | 'tradera' | 'vinted')
  → calls Scraper.fetch(marketplace)
  → passes results to Deduplicator.filter(listings)
```

---

### 2. Scraper Layer

**Responsibility:** Fetch raw listings from each marketplace and normalize them to a shared `Listing` schema. Each marketplace is an isolated module — adding a new marketplace means adding one file, not modifying existing code.

**Communicates with:** External marketplace URLs (outbound HTTP), Scheduler Layer (called by)

**Shared Listing schema:**
```typescript
interface Listing {
  id: string              // marketplace:listing_id — globally unique
  marketplace: string     // 'blocket' | 'tradera' | 'vinted'
  title: string
  price_sek: number
  url: string
  category: string        // 'gpu' | 'cpu' | 'ram' | 'storage' | 'unknown'
  condition: string | null
  location: string | null
  posted_at: Date | null
  image_url: string | null
  raw: Record<string, unknown>  // original payload for debugging
}
```

**Per-marketplace notes:**

- **BlocketScraper** — HTML scraping with Cheerio (Node.js) or BeautifulSoup (Python). Blocket's search results page is server-rendered. Parse listing cards from the DOM. Apply User-Agent rotation and 1-3s jitter between requests. Rate limit: conservative — 1 request per cycle, not pagination-crawling the full catalogue.
- **TraderaScraper** — Tradera has a public REST API (`api.tradera.com`). Prefer the API for active listings over HTML scraping — it returns structured JSON and is less fragile. The API is unauthenticated for read-only search. Use HTML fallback if API changes.
- **VintedScraper** — HTML scraping. Vinted renders listing cards server-side on category/search pages. Same Cheerio/BS4 approach as Blocket. Vinted is more aggressive with bot detection; use realistic headers and back off on 429s.

**Anti-pattern to avoid:** A single God-Scraper class with `if marketplace === 'blocket'` branching. Instead: one class per marketplace implementing a shared `IScraper` interface.

```typescript
interface IScraper {
  fetch(query: SearchQuery): Promise<Listing[]>
}
```

---

### 3. Deduplication Layer

**Responsibility:** Filter out listings already seen in previous scan cycles. Mark new listings as seen atomically so concurrent scrapes don't double-alert.

**Communicates with:** Persistence Layer (read/write seen_listings), Scraper Layer (receives raw listings), Deal Detection Engine (outputs filtered listings)

**Strategy: SQLite with composite key**

Use SQLite, not Redis or a flat file.

- **Not Redis:** Redis is overkill — this runs on one local Windows machine, no distributed consumers. Adding Redis means a running server process the user must manage. SQLite is zero-infrastructure.
- **Not flat file:** Flat files (JSON array, text log) require full-file read and parse on every check cycle. At 5-minute intervals scanning 3 marketplaces with hundreds of listings each, this becomes slow and fragile. No atomic writes either.
- **SQLite:** Single-file, zero server, atomic writes via transactions, indexed lookups in microseconds for millions of rows. Perfect fit.

**`seen_listings` table:**
```sql
CREATE TABLE seen_listings (
  id          TEXT PRIMARY KEY,   -- 'blocket:12345678'
  marketplace TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,   -- unix timestamp
  title       TEXT,               -- for human-readable debugging
  price_sek   INTEGER
);
CREATE INDEX idx_seen_marketplace ON seen_listings(marketplace);
```

**Dedup flow:**
```
listings = scraper.fetch()
new_ids   = listings.map(l => l.id)
seen      = db.query("SELECT id FROM seen_listings WHERE id IN (?)", new_ids)
novel     = listings.filter(l => !seen.has(l.id))
db.insert seen for novel listings  ← atomic, inside transaction
return novel
```

**Retention:** Expire `seen_listings` rows older than 30 days via a nightly cleanup query. Listings that old will never re-appear as active, so no point keeping them.

---

### 4. Deal Detection Engine

**Responsibility:** Decide whether a listing is worth alerting on. Two scoring paths: (A) static threshold check, (B) market-value comparison via Tradera sold-listings lookup.

**Communicates with:** Persistence Layer (reads thresholds), TraderaSoldPriceCache (external lookup with local cache), Deduplication Layer (receives novel listings), Discord Layer (outputs DealAlert)

**DealAlert schema:**
```typescript
interface DealAlert {
  listing: Listing
  threshold_triggered: Threshold | null  // which rule fired
  market_value_sek: number | null        // from Tradera sold data
  estimated_profit_sek: number | null    // market_value - listing.price
  profit_margin_pct: number | null
  confidence: 'high' | 'medium' | 'low' // quality of market comparison
}
```

**Scoring logic:**

```
For each novel listing:
  1. Load matching thresholds from DB (by category + keywords)
  2. If listing.price_sek <= threshold.max_price → threshold triggered
  3. Fetch Tradera sold-price estimate for this item (cached, see below)
  4. If sold_price found AND (sold_price - listing.price) / sold_price >= min_margin → deal confirmed
  5. Build DealAlert with both signals
  6. If neither signal fires → discard (no alert)
```

**Tradera Sold-Price Lookup (the market-value component):**

This is the most architecturally interesting part. Tradera's sold listings are the market reference. The lookup must be:

- **Async** — network call, can be slow
- **Cached** — the same GPU model's sold-price doesn't change minute-to-minute. Cache results for 4 hours in SQLite.
- **Keyword-extracted** — take the listing title, extract the model identifier (e.g. "RTX 3080"), search Tradera sold listings for that term, take the median of the last 5 sold prices

**`sold_price_cache` table:**
```sql
CREATE TABLE sold_price_cache (
  query_key      TEXT PRIMARY KEY,   -- normalized search term e.g. "rtx 3080"
  median_price   INTEGER,
  sample_count   INTEGER,
  fetched_at     INTEGER             -- unix timestamp
);
```

Cache hit if `fetched_at > now() - 4 hours`. Cache miss → fetch Tradera sold search → compute median → store. Return null if fewer than 3 sold results (insufficient data — mark confidence 'low').

**Threshold data model:**
```sql
CREATE TABLE thresholds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,          -- 'RTX 3080 deal'
  category     TEXT,                   -- 'gpu' | null (any category)
  keywords     TEXT,                   -- 'rtx 3080,3080' (comma-separated)
  max_price    INTEGER,                -- alert if price <= this
  min_margin   REAL,                   -- alert if profit margin >= this (0.0-1.0)
  marketplace  TEXT,                   -- 'blocket' | null (any marketplace)
  active       INTEGER DEFAULT 1,
  created_at   INTEGER
);
```

---

### 5. Discord Layer

**Responsibility:** Post deal alert embeds to the configured Discord channel. Handle slash commands for threshold management and scan control.

**Communicates with:** Discord API (outbound), Persistence Layer (reads/writes thresholds and config), Deal Detection Engine (receives DealAlert)

**Two sub-components:**

**5a. Alert Poster**

Receives `DealAlert` structs and posts a rich embed. Operates as a simple function — no state, no loops. Called by the pipeline when a deal is scored.

Embed anatomy:
```
[Title]    GPU — RTX 3080 on Blocket
[URL]      https://blocket.se/listing/12345
[Color]    Green (high confidence) | Yellow (medium) | Grey (low)
[Fields]
  Listed Price:    2 200 SEK
  Market Value:    3 800 SEK (median of 6 Tradera sales)
  Est. Profit:     ~1 600 SEK (42%)
  Marketplace:     Blocket
  Location:        Stockholm
  Condition:       (from listing)
[Image]    thumbnail from listing
[Footer]   Scanned 2026-03-02 14:35
```

**5b. Command Handler**

Slash commands are the sole control interface. Commands:

| Command | Action | Writes to |
|---|---|---|
| `/threshold add <name> <max_price> [keywords] [category]` | Create threshold rule | `thresholds` |
| `/threshold list` | List all active thresholds | — (read) |
| `/threshold remove <id>` | Deactivate threshold | `thresholds` |
| `/scan pause <marketplace>` | Pause a marketplace | `user_config` |
| `/scan resume <marketplace>` | Resume a marketplace | `user_config` |
| `/scan status` | Show per-marketplace status and last scan time | — (read) |
| `/deal dismiss <alert_id>` | Mark a deal as dismissed in the channel | — (reaction/message edit) |

Command handler reads and writes directly to Persistence Layer. It does NOT call the scraper or deal engine — commands are control-plane, not data-plane.

---

### 6. Persistence Layer (SQLite)

**Responsibility:** Single source of truth for all durable state.

**Tables summary:**
```sql
-- Already covered above:
seen_listings      -- deduplication
thresholds         -- deal alert rules
sold_price_cache   -- Tradera market value cache

-- Additional:
user_config        -- key-value store for operational settings
scan_log           -- audit log of scan runs (for /scan status)
```

**`user_config` table:**
```sql
CREATE TABLE user_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Example rows:
-- ('blocket.paused', 'false')
-- ('tradera.paused', 'false')
-- ('vinted.paused', 'false')
-- ('alert_channel_id', '1234567890')
-- ('scan_interval_minutes', '10')
```

**`scan_log` table:**
```sql
CREATE TABLE scan_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace   TEXT NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER,
  listings_found INTEGER,
  new_listings  INTEGER,
  deals_alerted INTEGER,
  error         TEXT       -- null if success
);
```

**ORM vs raw SQL:** Use raw SQL with a thin wrapper (better-sqlite3 for Node.js, built-in `sqlite3` for Python). No ORM needed — schema is small and stable, and ORMs add complexity without benefit at this scale.

---

## Data Flow: New Listing to Discord Alert

```
Scheduler tick (every 10 min, marketplace = 'blocket')
  │
  ▼
BlocketScraper.fetch(queries: ['rtx 3080', 'rtx 3070', 'gpu'])
  → HTTP GET blocket.se/search?q=...
  → parse HTML → normalize to Listing[]
  │
  ▼
Deduplicator.filter(listings: Listing[])
  → SELECT id FROM seen_listings WHERE id IN (...)
  → INSERT INTO seen_listings for new ids
  → return novel: Listing[]
  │
  ▼
DealEngine.score(listing: Listing) [for each novel listing]
  ├── load thresholds from DB (WHERE active=1)
  ├── check: listing.price_sek <= threshold.max_price?
  ├── TraderaSoldCache.lookup(extracted_model_term)
  │     ├── cache hit? → return cached median
  │     └── cache miss? → GET tradera.com/sold?q=rtx+3080
  │                     → parse prices → median → INSERT cache → return
  └── build DealAlert if threshold OR margin condition met
  │
  ▼
AlertPoster.send(deal: DealAlert)
  → build Discord embed
  → POST to Discord channel via bot or webhook
  │
  ▼
ScanLog.record(marketplace, stats)
  → INSERT INTO scan_log
```

---

## Suggested Build Order

Build in this order — each phase produces something runnable and testable before the next phase starts.

### Phase 1: Persistence + Schema

Stand up SQLite, create all tables, write thin DB wrapper. Nothing runs yet, but the schema is the contract everything else depends on.

**Must exist before:** everything else reads/writes the DB.

### Phase 2: One Working Scraper (Tradera)

Tradera first because it has a public API — no HTML parsing, no fragile selectors. Get the scraper working end-to-end: fetch → normalize → print listings. Proves the `Listing` schema is right.

**Why Tradera first:** API is more stable than HTML scraping. Also provides sold-price data needed by the Deal Engine. Building Tradera first means the market-value component is available early.

### Phase 3: Deduplication

Wire the Tradera scraper output through the deduplication layer. Run twice — confirm second run produces zero new listings. Schema and logic proven.

### Phase 4: Blocket + Vinted Scrapers

Add HTML scrapers for both. They share the same `IScraper` interface — the dedup and pipeline code doesn't change. Verify both normalize correctly to the `Listing` schema.

### Phase 5: Scheduler

Wrap all three scrapers in the scheduler. Now the bot is polling autonomously. At this point it fetches, deduplicates, but does not alert — just logs to console/scan_log.

### Phase 6: Deal Detection Engine

Implement threshold loading, price comparison, Tradera sold-price cache, and deal scoring. No Discord yet — output DealAlert structs to console for validation.

### Phase 7: Discord Bot — Alerts

Wire deal alerts to Discord via embed poster. First real end-to-end path: scrape → score → Discord message.

### Phase 8: Discord Bot — Commands

Add slash commands for threshold management and scan control. At this point the bot is fully operational.

### Phase 9: Hardening

Error handling, rate-limit backoff, restart resilience (Windows Task Scheduler or pm2), seen_listings cleanup job.

---

## Where the Market-Value Comparison Fits

The Tradera sold-price lookup sits inside the **Deal Detection Engine**, not the scraper layer. The scraper's job is fetching active listings. The sold-price lookup is a separate concern — it answers "what is this item worth?" rather than "what is for sale?"

The lookup is cached in SQLite at the **query-key level** (normalized item name like "rtx 3080"), not per-listing. Multiple listings for the same item share one cache entry, minimizing Tradera API calls.

The Tradera scraper (active listings) and Tradera sold-price lookup are two separate functions:

| Function | Source | Trigger | Cache |
|---|---|---|---|
| `TraderaScraper.fetch()` | Tradera search (active listings) | Scheduler tick | No — always fresh |
| `TraderaSoldCache.lookup()` | Tradera sold search | Deal Engine scoring | Yes — 4 hour TTL |

This separation keeps the scraper layer stateless and the market-value logic confined to the Deal Engine, where it belongs.

---

## Anti-Patterns to Avoid

### 1. God Process / God Class
**What goes wrong:** Single `bot.js` with 1000+ lines doing scraping, dedup, scoring, and Discord all inline.
**Why bad:** Impossible to test individual layers, breaks impossible to isolate, adding a marketplace requires touching everything.
**Instead:** Five discrete modules with explicit function signatures at boundaries.

### 2. In-Memory Deduplication Only
**What goes wrong:** Store seen IDs in a JavaScript `Set` or Python `set` in memory.
**Why bad:** Every process restart (which happens on Windows) loses all dedup state. Bot re-alerts on every listing it saw before the restart.
**Instead:** SQLite `seen_listings` table. Survives restarts. Zero additional infrastructure.

### 3. Polling Tradera Sold Prices Per Listing Per Scan
**What goes wrong:** Every listing triggers a fresh Tradera sold-search network call.
**Why bad:** 50 listings/cycle × 3 marketplaces = 150 network calls per 10-minute cycle. Rate limits, slow cycles, fragile.
**Instead:** 4-hour SQLite cache keyed on normalized model term. 50 listings → ~5 cache lookups (most share the same model).

### 4. Scraper Logic Coupled to Discord Logic
**What goes wrong:** Scraper directly calls `channel.send()` or builds embeds.
**Why bad:** Cannot test scrapers without a live Discord bot. Cannot change alert format without touching scrapers.
**Instead:** Scrapers return `Listing[]`. Discord layer receives `DealAlert[]`. Clean boundary.

### 5. Synchronous Scraping Blocking the Event Loop (Node.js)
**What goes wrong:** Awaiting each HTTP request sequentially inside one tick.
**Why bad:** Three marketplaces × multiple pages = slow cycles, Discord command handler becomes unresponsive during scrape.
**Instead:** `Promise.allSettled()` to run marketplace scrapers concurrently. Command handler stays responsive because it's event-driven on the Discord gateway, separate from the scrape loop.

---

## Scalability Considerations

This bot runs on one local machine for one operator. Scale is not a concern. What IS a concern is **resilience**:

| Concern | Mitigation |
|---|---|
| Scraper fails (site structure changed) | Log error to scan_log, continue other marketplaces, alert operator via Discord DM |
| Tradera sold cache miss returns no data | Mark deal confidence 'low', still alert if threshold triggered — do not suppress |
| Process crash / Windows restart | SQLite survives, scheduler restarts from scratch, dedup prevents re-alerts |
| Rate limiting (429 from Blocket/Vinted) | Exponential backoff, skip this cycle, log to scan_log |
| SQLite lock contention | Use WAL mode (`PRAGMA journal_mode=WAL`) — allows concurrent reads during write |

---

## Sources

**Confidence assessment:**

| Area | Confidence | Basis |
|---|---|---|
| Component boundaries | HIGH | Standard pattern for this class of bot — well established |
| SQLite for dedup | HIGH | Canonical choice for local single-process persistence |
| Scraper IScraper interface | HIGH | Standard adapter pattern |
| Tradera API availability | MEDIUM | Training data — verify API endpoint exists before coding |
| Discord slash command API | HIGH | Stable since 2021, well documented |
| Tradera sold-price via search | MEDIUM | Depends on Tradera's search allowing sold-listing filtering without auth — verify early |

**Note:** Web search and official docs were unavailable during this research session. Architecture recommendations are based on training knowledge of established patterns. The Tradera API endpoint and sold-listing query capability should be verified as the first act of Phase 2 development — if sold-listing search requires auth or is unavailable, the market-value component will need a different data source.
