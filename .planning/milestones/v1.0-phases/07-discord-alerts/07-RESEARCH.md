# Phase 7: Discord Alerts - Research

**Researched:** 2026-03-03
**Domain:** discord.js 14 embed delivery, rate-control queue, SQLite schema migration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Embed color**
- Color by marketplace: Tradera=blue, Blocket=green, Vinted=teal, Sweclockers=orange
- Instant visual source identification at a glance

**Embed fields**
- Show: listing title, listed price (SEK), marketplace, category, estimated margin ("~1 400 SEK margin, 8 comps"), URL button
- When no sold-comp data: omit margin line entirely (do not show "no data")
- No auction end time field in this phase

**Alert deduplication (restart safety)**
- Add `alerted_at` column to existing `seen_listings` table (INTEGER epoch, nullable)
- On startup: skip posting any alert where `alerted_at IS NOT NULL`
- On post: set `alerted_at = unixepoch()` immediately after successful Discord send
- Keeps deduplication in one table — no new table needed

**Startup message**
- Post to Discord channel on bot startup: "Bot online — N thresholds active, next scan in X min"
- Threshold count read from `thresholds` table (active=1); next scan time from cron schedule
- Single message, no embed — plain text is fine

**Queue overflow / rate control**
- No cap on queue size — send all alerts, throttled at 1 msg per 1.5s
- If a cycle produces 20 alerts they all go out over ~30s — acceptable
- Dropped/failed sends logged via pino at warn level; no silent discard

### Claude's Discretion

- No specific references — open to standard discord.js EmbedBuilder approaches

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ALRT-01 | Bot posts a rich Discord embed with listing title and direct link to the marketplace listing | EmbedBuilder.setTitle + URL button via ButtonBuilder/ActionRowBuilder; discord.js 14.25.1 already installed |
| ALRT-02 | Bot includes listed price and estimated profit margin (derived from Tradera sold comps) in the embed | EmbedBuilder.addFields for price+margin; detectDeals already returns estimatedMargin and sampleCount; omit margin field when null |
| ALRT-03 | Bot includes marketplace source and hardware category in the embed | EmbedBuilder.addFields + setColor per marketplace; listing.marketplace and listing.category already on Listing shape |
</phase_requirements>

---

## Summary

Phase 7 delivers the final output layer: converting DealAlert objects from detectDeals into Discord embeds and posting them at a controlled rate. The entire Discord stack (discord.js 14.25.1) is already installed. The Listing shape already carries every field the embed needs (title, price_sek, url, marketplace, category), and detectDeals already returns estimatedMargin and sampleCount. This phase is primarily wiring and formatting work, not new library integration.

The two non-trivial engineering problems are: (1) the schema migration to add `alerted_at` to `seen_listings` — SQLite does not support `ADD COLUMN IF NOT EXISTS`, so the column existence check must use `PRAGMA table_info` in application code; and (2) the startup deduplication filter — on process restart, any seen_listing with `alerted_at IS NOT NULL` must be excluded from re-posting before the Discord client connects.

The rate limiter is a simple in-process queue using `setTimeout` chaining (1.5 s between sends). Discord's bot API has a per-channel rate limit; 1 msg/1.5 s stays well within the ~5 msg/5 s per-channel limit. No external queue library is needed.

**Primary recommendation:** Create `src/discord/alertSender.js` as a CommonJS module that owns: Client lifecycle, the `alerted_at` migration, the dedup-filter-on-startup logic, the embed builder, and the throttled send queue. Wire it into `index.js` so the Discord client is ready before the first cron tick fires.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| discord.js | 14.25.1 (installed) | Discord bot Client, EmbedBuilder, ButtonBuilder, ActionRowBuilder | Already in package.json; project's chosen Discord library |
| better-sqlite3 | 12.6.2 (installed) | SQLite access for alerted_at migration and dedup query | Existing singleton; all DB work goes through src/db/index.js |
| pino | 10.3.1 (installed) | Warn-level logging on failed sends | Existing project logger |
| dotenv | 17.3.1 (installed) | DISCORD_TOKEN and DISCORD_CHANNEL_ID env vars | Already loaded in index.js as first statement |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:timers/promises | built-in Node 24 | `setTimeout` for async delay between sends | Rate-limit queue — no npm package needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| discord.js Client | WebhookClient | Webhook is simpler for send-only; but Phase 8 needs a full Client for slash commands — start with Client now to avoid re-architecture |
| setTimeout chaining | p-queue / bull | p-queue is ESM-only (ERR_REQUIRE_ESM from CJS — confirmed in Phase 4 decisions); bull requires Redis; setTimeout chaining handles this scale |

**Installation:** No new packages needed. Everything is already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── discord/
│   ├── alertSender.js       # Client lifecycle, embed builder, throttled queue, alerted_at dedup
│   └── buildEmbed.js        # (optional) pure embed-building function, easier to unit test
├── db/
│   ├── init.js              # Add alerted_at migration call here (or in alertSender.js init)
│   └── seenListings.js      # Add filterUnalerted() and markAlerted() helpers here
├── scheduler/
│   └── runCycle.js          # Pass alertSender into runCycle; call alertSender.enqueue(alerts)
└── index.js                 # Await alertSender.init() before cron task starts
```

### Pattern 1: Client Lifecycle (event-based ready, promise wrapper)

**What:** discord.js Client does not resolve `login()` when ready — the `ready` event fires asynchronously after. Wrap in a promise so `index.js` can `await` startup before the first cron tick.

**When to use:** Anywhere you need the Discord client to be ready before sending.

**Example:**

```javascript
// Source: discord.js guide + github.com/discordjs/discord.js issues/3607
'use strict';
const { Client, GatewayIntentBits } = require('discord.js');

function createDiscordClient(token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const ready = new Promise((resolve) => {
    client.once('ready', resolve);
  });

  client.login(token); // does NOT await — ready fires asynchronously

  return { client, ready };
}

// In index.js:
const { client, ready } = createDiscordClient(process.env.DISCORD_TOKEN);
await ready; // blocks until client emits 'ready'
// Now safe to fetch channel and send
```

**Key insight:** `GatewayIntentBits.Guilds` is the only intent needed for send-only bots. Phase 8 (slash commands) will require `GatewayIntentBits.GuildMessages` as well.

### Pattern 2: EmbedBuilder with Per-Marketplace Color

**What:** Build a rich embed from a DealAlert object using EmbedBuilder from discord.js (not from @discordjs/builders — the discord.js export includes full ColorResolvable support including hex strings).

**When to use:** Every alert post.

**Example:**

```javascript
// Source: discordjs.guide/popular-topics/embeds (verified)
'use strict';
const { EmbedBuilder, Colors } = require('discord.js');

const MARKETPLACE_COLORS = {
  tradera:      0x3498DB, // Blue  (Colors.Blue = 3447003)
  blocket:      0x57F287, // Green (Colors.Green = 5763719)
  vinted:       0x1ABC9C, // Teal/Aqua (Colors.Aqua = 1752220)
  sweclockers:  0xE67E22, // Orange (Colors.Orange = 15105570)
};

function buildEmbed(alert) {
  const { listing, estimatedMargin, sampleCount } = alert;
  const color = MARKETPLACE_COLORS[listing.marketplace] || 0x99AAB5;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(listing.title)
    .addFields(
      { name: 'Pris', value: `${listing.price_sek} SEK`, inline: true },
      { name: 'Källa', value: listing.marketplace, inline: true },
      { name: 'Kategori', value: listing.category || '—', inline: true }
    )
    .setTimestamp();

  if (estimatedMargin !== null && sampleCount !== null) {
    const marginFormatted = Math.round(estimatedMargin).toLocaleString('sv-SE');
    embed.addFields({
      name: 'Marginal',
      value: `~${marginFormatted} SEK (${sampleCount} comps)`,
      inline: false,
    });
  }

  return embed;
}
```

### Pattern 3: URL Button alongside Embed

**What:** A `ButtonStyle.Link` button attached to the message via ActionRowBuilder. Link buttons do NOT trigger interaction events — they just open the URL. No custom_id needed.

**When to use:** Every alert post, to provide the direct marketplace link.

**Example:**

```javascript
// Source: discordjs.guide/interactive-components/buttons (verified)
'use strict';
const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

function buildRow(url) {
  const button = new ButtonBuilder()
    .setLabel('Visa annons')
    .setURL(url)
    .setStyle(ButtonStyle.Link);

  return new ActionRowBuilder().addComponents(button);
}

// Sending:
await channel.send({
  embeds: [embed],
  components: [buildRow(listing.url)],
});
```

### Pattern 4: Throttled Send Queue (1.5 s between sends)

**What:** A simple async queue using `setTimeout` chaining. No external library. Alerts are pushed into an array; a drain loop processes one per 1.5 s.

**When to use:** Called from `runCycle.js` after `detectDeals` returns alerts.

**Example:**

```javascript
// Pattern: setTimeout chain — avoids p-queue (ESM-only) and external deps
'use strict';

const DELAY_MS = 1500;

class AlertQueue {
  constructor(sendFn) {
    this._send = sendFn;
    this._queue = [];
    this._draining = false;
  }

  enqueue(alerts) {
    this._queue.push(...alerts);
    if (!this._draining) this._drain();
  }

  async _drain() {
    this._draining = true;
    while (this._queue.length > 0) {
      const alert = this._queue.shift();
      await this._send(alert); // sends one embed; logs warn on failure
      if (this._queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    this._draining = false;
  }
}
```

### Pattern 5: SQLite Schema Migration (alerted_at column)

**What:** Add `alerted_at INTEGER` (nullable) to `seen_listings`. SQLite does NOT support `ADD COLUMN IF NOT EXISTS` — check with `PRAGMA table_info` first.

**When to use:** In init/migration code called at startup, before the first Discord send.

**Example:**

```javascript
// Source: sqlite.org/lang_altertable.html (verified — IF NOT EXISTS not supported)
function migrateAlertedAt(db) {
  const columns = db.pragma('table_info(seen_listings)');
  const exists = columns.some(col => col.name === 'alerted_at');
  if (!exists) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN alerted_at INTEGER');
    logger.info('Migration: added alerted_at column to seen_listings');
  }
}
```

### Pattern 6: Deduplication — filterUnalerted and markAlerted

**What:** On startup, query all DealAlerts that have `alerted_at IS NOT NULL` and skip them. After a successful send, set `alerted_at = unixepoch()`.

**When to use:** In alertSender.js, called before enqueue and after successful send.

**Example:**

```javascript
// Filter: only post alerts for listings not yet alerted
function filterUnalerted(alerts, db) {
  return alerts.filter(alert => {
    const row = db.prepare(
      'SELECT alerted_at FROM seen_listings WHERE id = ?'
    ).get(alert.listing.id);
    return row && row.alerted_at === null;
  });
}

// Mark: set alerted_at immediately after successful Discord send
function markAlerted(listingId, db) {
  db.prepare(
    'UPDATE seen_listings SET alerted_at = unixepoch() WHERE id = ?'
  ).run(listingId);
}
```

### Pattern 7: Startup Message

**What:** Plain-text message sent to the alert channel after client ready. Reads threshold count from DB and next scan time from the cron interval env var.

**Example:**

```javascript
async function sendStartupMessage(channel, db, intervalMinutes) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM thresholds WHERE active = 1').get();
  const count = row ? row.cnt : 0;
  await channel.send(
    `Bot online — ${count} thresholds active, next scan in ${intervalMinutes} min`
  );
}
```

### Anti-Patterns to Avoid

- **Sending before client is ready:** `client.channels.cache.get(id)` returns `undefined` if called before the `ready` event. Always await the ready promise before fetching channels.
- **Using `@discordjs/builders` EmbedBuilder instead of `discord.js` EmbedBuilder:** The builders-package EmbedBuilder does NOT accept named color strings or full ColorResolvable — only the discord.js package re-export does. Import from `discord.js`, not `@discordjs/builders`.
- **Setting `alerted_at` before send succeeds:** If `send()` throws, do not call `markAlerted()`. The update must be conditional on successful send.
- **Silent queue overflow:** Never discard alerts without a warn-level log. Per the constraint: dropped/failed sends logged at warn, no silent discard.
- **Blocking the cron tick on send queue drain:** `runCycle.js` should call `alertSender.enqueue(alerts)` and return immediately — the queue drains asynchronously in the background. Do not `await` the full drain inside runCycle.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discord embed formatting | Custom JSON message builder | `EmbedBuilder` from `discord.js` | Handles field limits (25 max), character limits (256 title, 1024 field value), API encoding |
| URL link buttons | Raw component JSON | `ButtonBuilder` + `ActionRowBuilder` | Handles component structure; link buttons require no customId |
| Discord rate limit retry | Custom 429 handler | discord.js built-in REST queue | discord.js automatically queues retries on 429 responses |
| Color name lookup | Color map string | Hex integer literals | Named colors changed casing in v14; hex integers are unambiguous |

**Key insight:** discord.js 14's REST layer handles 429 rate-limit retries automatically. The 1.5 s throttle is a proactive measure to avoid hitting the per-channel limit (~5 msg/5 s), not a retry mechanism.

---

## Common Pitfalls

### Pitfall 1: Channel cache miss (undefined channel)

**What goes wrong:** `client.channels.cache.get(DISCORD_CHANNEL_ID)` returns `undefined`, causing a TypeError on `.send()`.
**Why it happens:** Channel cache is populated during `GUILD_CREATE` events at login. If the channel ID is from a guild the bot hasn't joined, or if the code runs before the `ready` event, the cache may be empty.
**How to avoid:** Use `await client.channels.fetch(DISCORD_CHANNEL_ID)` instead of `.cache.get()` — `fetch()` hits the API if the cache misses. Only call after `ready` event fires.
**Warning signs:** `Cannot read properties of undefined (reading 'send')` at startup.

### Pitfall 2: EmbedBuilder imported from wrong package

**What goes wrong:** `const { EmbedBuilder } = require('@discordjs/builders')` — this EmbedBuilder only accepts `RGBTuple | number | null` for `.setColor()`, not hex strings or named colors.
**Why it happens:** discord.js exposes its own re-export that wraps the builders package with ColorResolvable support. The raw builders package skips that conversion.
**How to avoid:** Always import from `discord.js`: `const { EmbedBuilder, Colors } = require('discord.js')`.
**Warning signs:** TypeScript type error on setColor; or runtime error "Unable to convert color".

### Pitfall 3: Migration runs every startup (re-running ALTER TABLE)

**What goes wrong:** `ALTER TABLE seen_listings ADD COLUMN alerted_at INTEGER` throws "duplicate column name: alerted_at" on second startup.
**Why it happens:** SQLite does not support `ADD COLUMN IF NOT EXISTS`.
**How to avoid:** Check `PRAGMA table_info(seen_listings)` first and only run ALTER TABLE when the column is absent.
**Warning signs:** Process crashes with `SqliteError: duplicate column name` on second run.

### Pitfall 4: login() resolved before ready — code runs too early

**What goes wrong:** `await client.login(token)` returns, then code immediately calls `channel.send()` — but ready hasn't fired yet so channel cache is empty.
**Why it happens:** `client.login()` promise resolves when the login HTTP request completes, not when the WebSocket `READY` payload arrives.
**How to avoid:** Wrap `ready` event in a promise and await it. Do not `await client.login()` and then proceed — await the ready promise separately.
**Warning signs:** Channel is undefined; bot sends messages randomly depending on timing.

### Pitfall 5: markAlerted called before send resolves

**What goes wrong:** `markAlerted()` called before `channel.send()` resolves — if send throws, the listing is permanently marked alerted but the Discord message was never delivered.
**Why it happens:** Developer marks DB before awaiting the send promise.
**How to avoid:** Strictly: `await channel.send(...)` then `markAlerted(...)`. Wrap in try/catch; do not call markAlerted in the catch branch.

### Pitfall 6: Queue drain blocks cron cycle

**What goes wrong:** `runCycle.js` awaits the full alert queue drain — if 20 alerts go out over 30 s, the next cron tick is blocked (noOverlap: true skips it).
**Why it happens:** Passing the drain promise back to runCycle.
**How to avoid:** `alertSender.enqueue(alerts)` is fire-and-forget from runCycle's perspective. The queue drains asynchronously. runCycle returns immediately after enqueue.

---

## Code Examples

Verified patterns from official sources:

### Full Embed with URL Button Send

```javascript
// Source: discordjs.guide popular-topics/embeds + interactive-components/buttons (verified)
'use strict';
const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require('discord.js');

async function sendAlert(channel, alert, db) {
  const { listing, estimatedMargin, sampleCount } = alert;

  const embed = new EmbedBuilder()
    .setColor(MARKETPLACE_COLORS[listing.marketplace] || 0x99AAB5)
    .setTitle(listing.title.slice(0, 256)) // embed title limit: 256 chars
    .addFields(
      { name: 'Pris',      value: `${listing.price_sek} SEK`, inline: true },
      { name: 'Källa',     value: listing.marketplace,         inline: true },
      { name: 'Kategori',  value: listing.category || '—',     inline: true }
    )
    .setTimestamp();

  if (estimatedMargin !== null && sampleCount !== null) {
    const formatted = Math.round(estimatedMargin).toLocaleString('sv-SE');
    embed.addFields({
      name: 'Marginal',
      value: `~${formatted} SEK (${sampleCount} comps)`,
    });
  }

  const button = new ButtonBuilder()
    .setLabel('Visa annons')
    .setURL(listing.url)
    .setStyle(ButtonStyle.Link);

  const row = new ActionRowBuilder().addComponents(button);

  try {
    await channel.send({ embeds: [embed], components: [row] });
    // Mark AFTER successful send
    db.prepare('UPDATE seen_listings SET alerted_at = unixepoch() WHERE id = ?')
      .run(listing.id);
  } catch (err) {
    logger.warn({ err: err.message, listingId: listing.id }, 'alertSender: send failed');
  }
}
```

### Client Init with Awaitable Ready

```javascript
// Source: discord.js Client API docs (discord.js.org) + issue #3607 pattern
'use strict';
const { Client, GatewayIntentBits } = require('discord.js');

async function initDiscord(token, channelId) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token);
  });

  const channel = await client.channels.fetch(channelId);
  return { client, channel };
}
```

### Idempotent alerted_at Migration

```javascript
// Source: sqlite.org/lang_altertable.html (verified — IF NOT EXISTS not supported)
function migrateAlertedAt(db) {
  const cols = db.pragma('table_info(seen_listings)');
  if (!cols.some(c => c.name === 'alerted_at')) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN alerted_at INTEGER');
    logger.info('Migration applied: seen_listings.alerted_at added');
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `MessageEmbed` class | `EmbedBuilder` class | discord.js v14 (2022) | Chainable builder replaces plain object; color names lowercased |
| `SCREAMING_CASE` color names (e.g. `'GREEN'`) | Title-case names (e.g. `'Green'`) or hex integer | discord.js v14 | Hex integers are safest — no casing bugs |
| `client.on('ready', ...)` — register before login | `client.once('ready', ...)` — same API, `once` prevents leaks | Stable since v12 | Use `once` to avoid stale listeners on reconnect |
| `MessageButton` + `MessageActionRow` | `ButtonBuilder` + `ActionRowBuilder` | discord.js v14 | Old classes removed entirely |

**Deprecated/outdated:**
- `MessageEmbed`: removed in v14, replaced by `EmbedBuilder`
- `MessageButton` / `MessageActionRow`: removed in v14, use `ButtonBuilder` / `ActionRowBuilder`
- `client.channels.cache.get(id)`: safe when client is ready, but `channels.fetch(id)` is safer for initial startup

---

## Open Questions

1. **Channel ID type validation at startup**
   - What we know: `DISCORD_CHANNEL_ID` is a string from `.env`; `client.channels.fetch()` accepts a string snowflake.
   - What's unclear: Whether the bot needs to be a member of the channel's guild for `fetch()` to work. Standard guild bot token should have access to any channel in the guild it was added to.
   - Recommendation: Log a clear error if `channel.fetch()` rejects at startup (missing permissions, wrong ID) — fail fast rather than silently swallowing.

2. **Token missing / invalid at startup**
   - What we know: `client.login(token)` throws on invalid token; the `error` event fires.
   - Recommendation: Listen for `client.on('error')` and fail the process with a clear message rather than hanging.

---

## Sources

### Primary (HIGH confidence)

- [discordjs.guide/popular-topics/embeds](https://discordjs.guide/popular-topics/embeds) — EmbedBuilder API, addFields, setColor, channel.send usage
- [discordjs.guide/interactive-components/buttons](https://discordjs.guide/interactive-components/buttons) — ButtonBuilder, ButtonStyle.Link, ActionRowBuilder, channel.send with components
- [discord.js.org/docs/packages/discord.js/14.18.0/EmbedBuilder:Class](https://discord.js.org/docs/packages/discord.js/14.18.0/EmbedBuilder:Class) — setColor signature (ColorResolvable)
- [discord.js.org/docs/packages/discord.js/14.18.0/Client:Class](https://discord.js.org/docs/packages/discord.js/14.18.0/Client:Class) — login, channels.fetch, ready event
- [sqlite.org/lang_altertable.html](https://www.sqlite.org/lang_altertable.html) — Confirms IF NOT EXISTS NOT supported for ADD COLUMN
- [gist.github.com/thomasbnt/b6f455e2c7d743b796917fa3c205f812](https://gist.github.com/thomasbnt/b6f455e2c7d743b796917fa3c205f812) — Discord color hex values for blue/green/teal/orange

### Secondary (MEDIUM confidence)

- [github.com/discordjs/discord.js/issues/3607](https://github.com/discordjs/discord.js/issues/3607) — Confirmed: login() resolves before ready event fires; pattern of wrapping in promise is the community standard
- [github.com/discordjs/discord.js/issues/8926](https://github.com/discordjs/discord.js/issues/8926) — Confirmed: @discordjs/builders EmbedBuilder uses narrower type than discord.js EmbedBuilder; import from discord.js
- [discord.js rate limit docs](https://discord.js.org/docs/packages/discord.js/14.19.3/RESTRateLimit:Interface) — discord.js 14 REST queue handles 429 retries automatically

### Tertiary (LOW confidence)

- WebSearch result: better-sqlite3 12.x bundles SQLite 3.51.2 — not directly verified against official release notes; PRAGMA table_info approach works regardless of exact SQLite version

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — discord.js 14.25.1 is already installed and verified in package.json; no new dependencies required
- Architecture: HIGH — EmbedBuilder, ButtonBuilder, and ActionRowBuilder APIs verified against official discord.js guide; Client ready pattern verified against issue tracker
- Pitfalls: HIGH — migration pitfall verified against sqlite.org official docs; EmbedBuilder import pitfall verified against GitHub issue #8926

**Research date:** 2026-03-03
**Valid until:** 2026-06-03 (discord.js 14.x stable; SQLite behavior stable)
