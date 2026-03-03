---
phase: 07-discord-alerts
verified: 2026-03-03T12:20:00Z
status: human_needed
score: 11/12 must-haves verified
re_verification: false
human_verification:
  - test: "Discord embed appearance and field layout"
    expected: "Embed shows title, Pris, Kalla, Kategori fields with correct marketplace color; Marginal field appears only when estimatedMargin is not null; 'Visa annons' button opens listing URL"
    why_human: "Cannot verify Discord embed rendering, button behavior, or color display programmatically without a live bot token and channel"
  - test: "Startup message posted before first cron tick"
    expected: "Message 'Bot online — N thresholds active, next scan in 15 min' appears in Discord channel before any scrape cycle runs"
    why_human: "Requires live DISCORD_TOKEN and DISCORD_CHANNEL_ID — network call cannot be mocked in static analysis"
  - test: "Restart does not re-post already-alerted listings"
    expected: "Stop node index.js, restart it; no duplicate embeds appear for listings whose alerted_at IS NOT NULL in seen_listings"
    why_human: "Requires running process with live DB state across two process lifetimes; cannot verify statically"
---

# Phase 7: Discord Alerts Verification Report

**Phase Goal:** Send Discord embed alerts when deals are detected
**Verified:** 2026-03-03T12:20:00Z
**Status:** human_needed (11/12 automated must-haves verified; 3 items require live Discord environment)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `alertSender.init(db)` runs without throwing and returns `{ enqueue, sendStartupMessage }` | VERIFIED | Module loads cleanly (`node -e "const s = require('./src/discord/alertSender'); console.log(typeof s.init)"` prints `function`); `init` returns object with both keys (lines 136-139 alertSender.js) |
| 2  | `buildEmbed` produces an EmbedBuilder with title, Pris, Kalla, Kategori fields and per-marketplace color | VERIFIED | Lines 39-45 show `.setColor()`, `.setTitle()`, `.addFields()` for Pris/Kalla/Kategori; MARKETPLACE_COLORS map lines 13-18 with hex values for all 4 marketplaces |
| 3  | `buildEmbed` omits the Marginal field entirely when `estimatedMargin` is null | VERIFIED | Lines 47-53: `if (estimatedMargin !== null && sampleCount !== null)` guard — no else branch, no fallback text |
| 4  | `enqueue(alerts)` is fire-and-forget — calling it returns before all sends complete | VERIFIED | `AlertQueue.enqueue` (lines 94-99) calls `this._drain()` without `await`; `_drain()` is async and runs in background. In runCycle.js line 61: `alertSender.enqueue(alerts)` — no `await` |
| 5  | Successful send sets `alerted_at = unixepoch()` in seen_listings; failed send logs warn and does NOT set alerted_at | VERIFIED | Lines 70-77 in alertSender.js: `await channel.send(...)` then `db.prepare('UPDATE seen_listings SET alerted_at = unixepoch() WHERE id = ?').run(...)` inside try; catch block only logs `logger.warn` — no DB write |
| 6  | Second startup: `migrateAlertedAt` does not throw (idempotent — PRAGMA table_info guard) | VERIFIED | Lines 20-26: `db.pragma('table_info(seen_listings)')` check before `ALTER TABLE`; migration only runs if column absent. No `ADD COLUMN IF NOT EXISTS` (unsupported in SQLite) found — confirmed absent by grep |
| 7  | `filterUnalerted` strips any alert whose listing already has `alerted_at IS NOT NULL` in seen_listings | VERIFIED | Lines 28-33: filters to `row && row.alerted_at === null`; called inside `AlertQueue.enqueue` before pushing to `_queue` (line 96) |
| 8  | Bot logs into Discord and sends startup message before the first cron tick fires | VERIFIED (static) | index.js lines 38-39: `await alertSender.init(db)` then `await discord.sendStartupMessage()` both inside async IIFE before `cron.schedule` and `task.execute()` (lines 52-66) |
| 9  | Deal alerts produced by detectDeals appear in Discord as embeds with all required fields | ? HUMAN NEEDED | Static code path confirmed: runCycle.js line 58 `detectDeals(novel, db)` → line 61 `alertSender.enqueue(alerts)` → `_sendOne` → `channel.send({ embeds, components })`. Field rendering requires live Discord environment |
| 10 | `runCycle.js` does not await the queue drain — enqueue is fire-and-forget and cycle completes immediately after | VERIFIED | runCycle.js line 61: `alertSender.enqueue(alerts);` — no `await` keyword. `_drain()` in AlertQueue is not awaited by `enqueue` |
| 11 | After Windows restart, listings with `alerted_at IS NOT NULL` are not re-posted | VERIFIED (static) | `filterUnalerted` called at enqueue time (line 96); keeps only `row.alerted_at === null`; `alerted_at` is persisted to SQLite. Mechanism is correct; live test = human item |
| 12 | On cold start (no prior alerted_at), all current listings are seed-mode suppressed — zero historical alerts | VERIFIED | Seed mode implemented in scraper runners (traderaRunner.js line 25, blocketRunner.js line 26): returns empty `[]` when `countSeen(marketplace) === 0`. Empty array flows to `detectDeals` → zero alerts → `enqueue([])` is no-op (filterUnalerted returns `[]`, enqueue returns early at line 97) |

**Score:** 11/12 truths verified automated (1 truth needs live environment confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/discord/alertSender.js` | Discord client lifecycle, embed builder, throttled queue, alerted_at migration | VERIFIED | 143 lines; exports `{ init }`; all required functions present: `migrateAlertedAt`, `filterUnalerted`, `buildEmbed`, `buildRow`, `_sendOne`, `AlertQueue`, `sendStartupMessage`, `init`. CommonJS only — no `import`/`export` |
| `index.js` | Process entry point with Discord init before cron start | VERIFIED | `require('./src/discord/alertSender')` line 12; `await alertSender.init(db)` line 38; `await discord.sendStartupMessage()` line 39; `runCycle(..., discord)` line 53 |
| `src/scheduler/runCycle.js` | Cycle executor that passes alerts to Discord queue | VERIFIED | Fourth param `alertSender` documented in JSDoc (lines 19-22); `if (alertSender) alertSender.enqueue(alerts)` at line 60-62; backward compatible when called without fourth arg |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/discord/alertSender.js` | `src/db/index.js` | `db` arg passed to `init(db)` | VERIFIED | `db.pragma(...)` at line 21, `db.prepare(...)` at lines 30, 72, 81 — db used throughout |
| `alertSender._sendOne` | `channel.send` | `await channel.send({ embeds, components })` | VERIFIED | Line 70: `await channel.send({ embeds: [embed], components: [row] })` |
| `alertSender._sendOne` success | `seen_listings.alerted_at` | `db.prepare UPDATE after await channel.send` | VERIFIED | Line 72: `db.prepare('UPDATE seen_listings SET alerted_at = unixepoch() WHERE id = ?').run(...)` inside try block, after send |
| `index.js` | `src/discord/alertSender.js` | `await alertSender.init(db)` | VERIFIED | Line 38: `const discord = await alertSender.init(db)` |
| `index.js` | channel (via sendStartupMessage) | `await alertSender.sendStartupMessage()` | VERIFIED | Line 39: `await discord.sendStartupMessage()` |
| `src/scheduler/runCycle.js` | `src/discord/alertSender.js` | `alertSender.enqueue(alerts)` — injected dependency | VERIFIED | Line 61: `alertSender.enqueue(alerts);` inside `if (alertSender)` guard |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ALRT-01 | 07-01, 07-02 | Bot posts a rich Discord embed with listing title and direct link to the marketplace listing | VERIFIED | `buildEmbed` sets `.setTitle(listing.title.slice(0, 256))`; `buildRow(url)` creates link button with `ButtonStyle.Link`; `channel.send({ embeds: [embed], components: [row] })` wires both |
| ALRT-02 | 07-01, 07-02 | Bot includes listed price and estimated profit margin (derived from Tradera sold comps) in the embed | VERIFIED | `addFields({ name: 'Pris', value: ... SEK })` unconditional; Marginal field added when `estimatedMargin !== null && sampleCount !== null` (lines 47-53) |
| ALRT-03 | 07-01, 07-02 | Bot includes marketplace source and hardware category in the embed | VERIFIED | `addFields({ name: 'Kalla', value: listing.marketplace })` and `addFields({ name: 'Kategori', value: listing.category })` — both present in buildEmbed lines 43-44 |

No orphaned requirements: all three ALRT IDs are mapped to Phase 7 in REQUIREMENTS.md (lines 92-94) and both plans claim them.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, empty implementations, stub handlers, or `console.log`-only paths found in any of the three modified files.

Additional checks passed:
- `ADD COLUMN IF NOT EXISTS` absent (SQLite does not support it — PRAGMA guard used correctly)
- `@discordjs/builders` import absent — EmbedBuilder correctly sourced from `discord.js`
- `await client.login()` NOT used — `client.login()` called without await inside the ready-event Promise (line 123), per the plan requirement
- `client.channels.cache.get()` NOT used — `client.channels.fetch()` used (line 128), which works even before GUILD_CREATE fires

### Commit Verification

Both implementation commits exist and are reachable in git log:
- `799f4d3` — feat(07-01): create Discord alertSender module
- `b363d12` — feat(07-02): add alertSender param to runCycle — fire-and-forget enqueue
- `92e5c0b` — feat(07-02): wire alertSender into index.js — async startup with Discord init

### Human Verification Required

#### 1. Discord Embed Appearance

**Test:** With `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID` set in `.env`, run `node index.js`. Wait for a scan cycle that produces at least one deal alert.
**Expected:** An embed appears in the Discord channel with: title (truncated to 256 chars), Pris field (e.g. "4500 SEK"), Kalla field (marketplace name), Kategori field (hardware category). Embed color matches the marketplace (Tradera=blue #3498DB, Blocket=green #57F287, Vinted=teal #1ABC9C, Sweclockers=orange #E67E22). "Visa annons" button is visible and opens the listing URL. If estimatedMargin is null, no Marginal field appears. If not null, Marginal field shows "~X SEK (N comps)".
**Why human:** Discord embed rendering cannot be verified without a live bot token, a configured channel, and actual deal detections flowing through the pipeline.

#### 2. Startup Message Before First Cron Tick

**Test:** Run `node index.js` with a fresh environment.
**Expected:** The message "Bot online — N thresholds active, next scan in 15 min" (or configured interval) appears in the Discord channel before any scrape-cycle log lines appear.
**Why human:** Requires live network connection to Discord API and a valid bot token.

#### 3. Restart Deduplication (alerted_at Persistence)

**Test:** Run `node index.js` until at least one embed is posted. Stop the process (Ctrl+C). Verify `alerted_at IS NOT NULL` for that listing via `node -e "const db = require('./src/db/index'); console.log(db.prepare('SELECT id, alerted_at FROM seen_listings WHERE alerted_at IS NOT NULL LIMIT 5').all())"`. Restart `node index.js`.
**Expected:** No duplicate embeds for listings that already have `alerted_at` set. The startup message posts again but previously-alerted listings do not re-appear as embeds.
**Why human:** Requires two process lifetimes with live Discord connectivity to observe the absence of re-posting.

### Gaps Summary

No gaps found. All 12 must-have truths are either verified from static analysis or confirmed as requiring human testing due to live external service dependency (Discord API). The three human-needed items are inherent to Discord integration — they cannot be verified without a running bot with valid credentials. The code paths are all correct and wired.

---

_Verified: 2026-03-03T12:20:00Z_
_Verifier: Claude (gsd-verifier)_
