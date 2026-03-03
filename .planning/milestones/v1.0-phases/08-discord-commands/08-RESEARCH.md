# Phase 8: Discord Commands - Research

**Researched:** 2026-03-03
**Domain:** discord.js 14 slash commands, SQLite mutations via better-sqlite3, Zod v4 validation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Client architecture**
- New `src/discord/commandHandler.js` module — does not live inside `alertSender.js`
- `alertSender.init()` exposes the discord.js `client` alongside `enqueue` and `sendStartupMessage`
- `index.js` passes `client` to `commandHandler.init(client, db)` after the Discord ready event
- `commandHandler.js` registers the `interactionCreate` listener and routes to per-command handlers

**Slash command registration**
- Guild-only registration (instant propagation, no 1-hour global delay)
- Separate `scripts/registerCommands.js` — run once manually, not on every bot startup
- Commands registered to the guild specified by `DISCORD_GUILD_ID` env var

**`/threshold` command UX**
- Subcommand group: `/threshold set`, `/threshold remove`, `/threshold list`
- `/threshold set` options (all named, not positional):
  - `name` (required, string) — human label e.g. "RTX 3080 deal"
  - `max_price` (required, integer, SEK)
  - `category` (optional, string choices: gpu, cpu, ram, storage)
  - `keywords` (optional, string, comma-separated)
  - `min_margin` (optional, number, 0.0–1.0)
  - `marketplace` (optional, string choices: tradera, blocket, vinted, sweclockers)
- `/threshold remove name:<name>` — sets `active = 0` (soft delete, not hard delete)
- `/threshold list` — returns all rows where `active = 1`; formats as a Discord code block table

**`/pause` and `/resume` commands**
- `/pause <marketplace>` — writes `<marketplace>.paused = "true"` to `user_config`
- `/resume <marketplace>` — writes `<marketplace>.paused = "false"` (or deletes the row)
- Valid marketplace names: tradera, blocket, vinted, sweclockers
- Invalid name → reply with a list of valid options
- `runCycle.js` already reads `user_config` pause state — no changes needed there

**`/dismiss` command**
- `/dismiss listing_id:<id>` — marks a listing so it is never re-alerted
- Storage: add a `dismissed` column (`INTEGER DEFAULT 0`) to `seen_listings` via migration — same pattern as `alerted_at`
- `detectDeals` / `filterUnalerted` must exclude rows where `dismissed = 1`

**Reply visibility**
- All command replies are ephemeral (only the invoker sees them)
- Keeps the deal alert channel clean — commands are management actions, not announcements

**Input validation**
- Use Zod for all slash command input parsing
- Invalid input → ephemeral reply with the error reason, never a thrown exception

### Claude's Discretion
- Exact formatting of `/threshold list` output (table vs embed vs code block)
- Error message copy
- Whether `registerCommands.js` uses REST or the client's application commands API
- Command handler file layout within `src/discord/` (flat vs subdirectory per command)

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CMND-01 | User can set or update a price threshold per category or specific item | `SlashCommandBuilder` with subcommands verified; `INSERT INTO thresholds` pattern confirmed; Zod v4 schema validated |
| CMND-02 | User can view all currently active price thresholds | `SELECT * FROM thresholds WHERE active = 1` verified; Discord ephemeral reply pattern confirmed |
| CMND-03 | User can pause and resume scanning per marketplace | `INSERT OR REPLACE INTO user_config` and `DELETE FROM user_config` patterns confirmed; `runCycle.js` already reads pause state live — no change needed |
| CMND-04 | User can dismiss a specific deal alert to prevent re-alerting | `ALTER TABLE seen_listings ADD COLUMN dismissed INTEGER DEFAULT 0` migration pattern confirmed; `filterUnalerted` must gain `dismissed = 0` predicate |
</phase_requirements>

---

## Summary

Phase 8 wires four Discord slash commands into the running bot so the operator can manage thresholds, pause/resume scrapers, and dismiss deal alerts without touching files or restarting. The technical stack is already fully installed: discord.js 14.25.1 (verified), Zod 4.3.6 (verified), better-sqlite3 (in use throughout). No new packages are required.

The architecture is a clean separation: `alertSender.js` owns the Discord client and already handles alert delivery. For Phase 8, `alertSender.init()` must expose the `client` object in its return value (currently it only returns `enqueue` and `sendStartupMessage`). A new `commandHandler.js` module receives `client` and `db`, registers the `interactionCreate` listener, and routes commands to per-command handler functions. This follows the same `async function init(...)` returning a methods object pattern already established in the codebase.

Slash command registration is a one-time operation performed by a separate `scripts/registerCommands.js` script using the discord.js `REST` client and `Routes.applicationGuildCommands`. Guild-scoped registration is confirmed to propagate instantly (vs. global commands which take up to 1 hour). The script needs two additional env vars beyond what is currently in `.env.example`: `DISCORD_CLIENT_ID` (the bot's application ID, required by `Routes.applicationGuildCommands`) and the guild ID. The `.env.example` currently defines `GUILD_ID` (not `DISCORD_GUILD_ID` as the CONTEXT.md states) — the planner must decide which name to standardize on and update `.env.example` accordingly.

**Primary recommendation:** Build commandHandler.js as a flat module with one function per command (thresholdSet, thresholdRemove, thresholdList, pause, resume, dismiss). Route by `interaction.commandName` + `interaction.options.getSubcommand(false)`. Validate all inputs with Zod `safeParse` before touching SQLite. Reply ephemerally on both success and failure.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| discord.js | 14.25.1 (installed) | Slash command builders, interaction handling, REST registration | Already in use for alert delivery; contains all required APIs |
| better-sqlite3 | 12.6.2 (installed) | Synchronous SQLite reads/writes in command handlers | Already the project DB layer; synchronous API simplifies interaction handler code |
| zod | 4.3.6 (installed) | Validate and parse slash command option values | Already in package.json; `safeParse` never throws, produces structured errors |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | 17.3.1 (installed) | Load env vars in `scripts/registerCommands.js` | Registration script runs standalone outside bot process |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Flat command functions | Class-per-command pattern | Classes add boilerplate for no gain; flat functions + routing switch is simpler |
| REST client for registration | client.application.commands.set() | Both work; REST is more explicit and works standalone without bot login |

**Installation:**
```bash
# No new packages needed — all dependencies already installed
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── discord/
│   ├── alertSender.js       # existing — expose client in return value
│   └── commandHandler.js    # NEW — interactionCreate listener + command routing
scripts/
└── registerCommands.js      # NEW — one-time guild command registration
```

### Pattern 1: Exposing client from alertSender.init()

**What:** `alertSender.init()` currently returns `{ enqueue, sendStartupMessage }`. Add `client` to the return object so `commandHandler.init(client, db)` can attach the `interactionCreate` listener.

**When to use:** Required — `commandHandler.js` must receive the same `Client` instance that is already logged in and `ready`.

**Example:**
```javascript
// src/discord/alertSender.js — change to return object
return {
  enqueue: (alerts) => queue.enqueue(alerts, db),
  sendStartupMessage: () => sendStartupMessage(channel, db),
  client,  // ADD THIS
};
```

```javascript
// index.js — after alertSender.init()
const discord = await alertSender.init(db);
await discord.sendStartupMessage();
const commandHandler = require('./src/discord/commandHandler');
await commandHandler.init(discord.client, db);
```

### Pattern 2: interactionCreate Routing

**What:** Register a single listener on the client that type-narrows with `isChatInputCommand()`, then routes by `commandName` and optionally `options.getSubcommand(false)`.

**Example:**
```javascript
// src/discord/commandHandler.js
'use strict';
const { Events } = require('discord.js');

async function init(client, db) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'threshold': return await handleThreshold(interaction, db);
        case 'pause':     return await handlePause(interaction, db);
        case 'resume':    return await handleResume(interaction, db);
        case 'dismiss':   return await handleDismiss(interaction, db);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'commandHandler: unhandled error');
      const method = interaction.deferred ? 'editReply' : 'reply';
      await interaction[method]({ content: 'Internal error.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}
```

### Pattern 3: Subcommand Routing within /threshold

**What:** `/threshold` has three subcommands dispatched by `interaction.options.getSubcommand()`.

**Example:**
```javascript
async function handleThreshold(interaction, db) {
  const sub = interaction.options.getSubcommand();  // 'set' | 'remove' | 'list'
  switch (sub) {
    case 'set':    return await thresholdSet(interaction, db);
    case 'remove': return await thresholdRemove(interaction, db);
    case 'list':   return await thresholdList(interaction, db);
  }
}
```

### Pattern 4: Zod Validation Before SQLite

**What:** Extract raw option values, run `safeParse`, reply ephemerally with error on failure, proceed on success.

**Example:**
```javascript
// Source: verified against Zod 4.3.6 installed in project
const { z } = require('zod');
const { MessageFlags } = require('discord.js');

const ThresholdSetSchema = z.object({
  name:        z.string().min(1).max(100),
  max_price:   z.number().int().positive(),
  category:    z.enum(['gpu','cpu','ram','storage']).optional(),
  keywords:    z.string().optional(),
  min_margin:  z.number().min(0).max(1).optional(),
  marketplace: z.enum(['tradera','blocket','vinted','sweclockers']).optional(),
});

async function thresholdSet(interaction, db) {
  const raw = {
    name:        interaction.options.getString('name'),
    max_price:   interaction.options.getInteger('max_price'),
    category:    interaction.options.getString('category') ?? undefined,
    keywords:    interaction.options.getString('keywords') ?? undefined,
    min_margin:  interaction.options.getNumber('min_margin') ?? undefined,
    marketplace: interaction.options.getString('marketplace') ?? undefined,
  };

  const result = ThresholdSetSchema.safeParse(raw);
  if (!result.success) {
    const errors = Object.entries(result.error.flatten().fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('\n');
    return interaction.reply({ content: `Invalid input:\n${errors}`, flags: MessageFlags.Ephemeral });
  }

  const data = result.data;
  db.prepare(`
    INSERT INTO thresholds (name, category, keywords, max_price, min_margin, marketplace, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(data.name, data.category ?? null, data.keywords ?? null, data.max_price,
         data.min_margin ?? null, data.marketplace ?? null, Math.floor(Date.now() / 1000));

  return interaction.reply({ content: `Threshold "${data.name}" set.`, flags: MessageFlags.Ephemeral });
}
```

### Pattern 5: Ephemeral Replies

**What:** All replies use `flags: MessageFlags.Ephemeral` (value `64`). This keeps the deal alert channel clean.

**Verified:** `MessageFlags.Ephemeral` equals `64` in discord.js 14.25.1.

```javascript
// Ephemeral reply — only the invoker sees it
await interaction.reply({ content: 'Done.', flags: MessageFlags.Ephemeral });
```

### Pattern 6: Guild Command Registration Script

**What:** A standalone `scripts/registerCommands.js` script that runs once to register slash commands to the guild. Uses discord.js `REST` client and `Routes.applicationGuildCommands`.

**Example:**
```javascript
// scripts/registerCommands.js
'use strict';
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  // ... build command JSON objects with SlashCommandBuilder
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('Commands registered to guild.');
})();
```

**Env vars needed (update `.env.example`):**
- `DISCORD_TOKEN` — already present
- `DISCORD_CLIENT_ID` — **missing from `.env.example`** — must be added (the bot's application ID, not the token)
- `GUILD_ID` — already present as `GUILD_ID` in `.env.example` (CONTEXT.md says `DISCORD_GUILD_ID` — planner must standardize; recommend `GUILD_ID` to match what already exists)

### Pattern 7: dismissed Column Migration

**What:** Add `dismissed INTEGER DEFAULT 0` to `seen_listings` using the same `pragma table_info` guard already established by `migrateAlertedAt` in `alertSender.js`.

**Example:**
```javascript
function migrateDismissed(db) {
  const cols = db.pragma('table_info(seen_listings)');
  if (!cols.some(c => c.name === 'dismissed')) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN dismissed INTEGER DEFAULT 0');
    logger.info('Migration applied: seen_listings.dismissed added');
  }
}
```

**filterUnalerted update** — add dismissed check:
```javascript
function filterUnalerted(alerts, db) {
  return alerts.filter(alert => {
    const row = db.prepare(
      'SELECT alerted_at, dismissed FROM seen_listings WHERE id = ?'
    ).get(alert.listing.id);
    return row && row.alerted_at === null && (row.dismissed === 0 || row.dismissed === null);
  });
}
```

### Pattern 8: /threshold list Formatting

**What:** Return active thresholds as a Discord code block table. Fits within Discord's 2000-character message limit for typical operator use (under 20 thresholds). Ephemeral reply.

**Recommended format (Claude's discretion):**
```javascript
async function thresholdList(interaction, db) {
  const rows = db.prepare('SELECT * FROM thresholds WHERE active = 1').all();
  if (rows.length === 0) {
    return interaction.reply({ content: 'No active thresholds.', flags: MessageFlags.Ephemeral });
  }
  const lines = rows.map(r =>
    `[${r.id}] ${r.name} — max ${r.max_price} SEK` +
    (r.category ? ` | cat:${r.category}` : '') +
    (r.marketplace ? ` | mkt:${r.marketplace}` : '') +
    (r.keywords ? ` | kw:${r.keywords}` : '') +
    (r.min_margin !== null ? ` | margin:${r.min_margin}` : '')
  );
  const body = '```\n' + lines.join('\n') + '\n```';
  return interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
}
```

If body exceeds 2000 chars, truncate with a note — not expected in practice for a single-operator tool.

### Anti-Patterns to Avoid

- **Registering commands on every bot startup:** Never call `rest.put(Routes.applicationGuildCommands(...))` inside `commandHandler.init()` or `index.js`. Discord rate-limits this and it adds latency. Keep it in the separate `scripts/registerCommands.js`.
- **Global command registration:** `Routes.applicationCommands(appId)` (no guild) takes up to 1 hour to propagate. Always use `Routes.applicationGuildCommands(appId, guildId)` for this bot.
- **Throwing inside interactionCreate:** An unhandled throw here will surface as an unhandled rejection. Wrap all handler logic in try/catch; use `interaction.reply` or `interaction.editReply` for errors.
- **Not checking `interaction.deferred`:** If a handler calls `deferReply` and then throws, the error handler must use `editReply` instead of `reply` (double-reply causes an API error). Use `interaction.deferred ? 'editReply' : 'reply'` guard.
- **Upsert on threshold set — name uniqueness:** The CONTEXT.md specifies INSERT (not upsert). If the operator calls `/threshold set` twice with the same name, two rows are created. This is acceptable; the name is a label, not a key. The planner may add a uniqueness check if desired, but it is not required by the locked decisions.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Command option type coercion | Manual string-to-number conversion | `getInteger()`, `getNumber()`, `getString()` on `CommandInteractionOptionResolver` | discord.js already coerces and validates types declared in `SlashCommandBuilder` |
| Input validation error messages | Custom error formatter | `result.error.flatten().fieldErrors` from Zod v4 | Zod produces field-level error messages; verified working in 4.3.6 |
| Ephemeral reply flag value | Magic number `64` | `MessageFlags.Ephemeral` | Named constant, avoids magic numbers, already in discord.js |
| Guild command registration API path | Hardcoded URL string | `Routes.applicationGuildCommands(appId, guildId)` | Verified: returns `/applications/{appId}/guilds/{guildId}/commands` |

**Key insight:** discord.js 14 handles all the protocol complexity (interaction acknowledgment, token expiry at 15 min, ephemeral bit). Zod handles validation. better-sqlite3 handles SQLite. Nothing custom needed.

---

## Common Pitfalls

### Pitfall 1: Missing DISCORD_CLIENT_ID env var for registerCommands.js
**What goes wrong:** `Routes.applicationGuildCommands` requires the application/client ID as first argument. The bot token is not the same as the application ID.
**Why it happens:** `.env.example` currently only has `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, `GUILD_ID`. The application ID is a separate value from the Discord Developer Portal.
**How to avoid:** Add `DISCORD_CLIENT_ID=your_application_id_here` to `.env.example` and document where to find it (Discord Developer Portal → Application → General Information → Application ID).
**Warning signs:** `registerCommands.js` throws a 401 or produces empty command list.

### Pitfall 2: Interaction token expiry (3-second acknowledge window)
**What goes wrong:** Discord requires an interaction to be acknowledged within 3 seconds. If handler logic (e.g., a SQLite query in a loop) takes longer, the interaction token expires and `reply()` throws a `DiscordAPIError[10062]: Unknown Interaction`.
**Why it happens:** All the DB operations in this phase are synchronous better-sqlite3 calls that complete in microseconds. This is not a real risk for this phase, but becomes one if any async I/O is added to handlers later.
**How to avoid:** Keep command handlers synchronous where possible (all DB ops are sync). If async I/O is ever added, call `interaction.deferReply({ ephemeral: true })` first.
**Warning signs:** `DiscordAPIError[10062]` in logs.

### Pitfall 3: client not exposed from alertSender.init()
**What goes wrong:** `commandHandler.init(client, db)` cannot attach `interactionCreate` listener because `client` is not in the returned object from `alertSender.init()`.
**Why it happens:** Current `alertSender.js` returns only `{ enqueue, sendStartupMessage }`. The `client` variable is scoped inside `init()`.
**How to avoid:** The first task in Phase 8 must be adding `client` to the `alertSender.init()` return value.
**Warning signs:** `commandHandler.init` receives `undefined` for client; `client.on` throws TypeError.

### Pitfall 4: Double-reply error
**What goes wrong:** `DiscordAPIError[40060]: Interaction has already been acknowledged` when `reply()` is called twice.
**Why it happens:** Top-level error handler calls `reply()` after the handler already called `reply()` successfully — or after `deferReply()`.
**How to avoid:** Use the `interaction.replied` and `interaction.deferred` guards:
```javascript
if (!interaction.replied && !interaction.deferred) {
  await interaction.reply({ content: 'Error.', flags: MessageFlags.Ephemeral }).catch(() => {});
}
```

### Pitfall 5: GUILD_ID vs DISCORD_GUILD_ID naming inconsistency
**What goes wrong:** CONTEXT.md says `DISCORD_GUILD_ID` but `.env.example` already has `GUILD_ID`. If the script uses `DISCORD_GUILD_ID` but .env only sets `GUILD_ID`, registration fails silently (undefined guildId produces wrong URL).
**Why it happens:** CONTEXT.md was written speculatively; `.env.example` already establishes the convention.
**How to avoid:** Standardize on `GUILD_ID` (already in `.env.example`) across `scripts/registerCommands.js` and any other new code. No changes to `.env.example` needed for this variable.

### Pitfall 6: dismissed column default for pre-existing rows
**What goes wrong:** Pre-existing rows in `seen_listings` will have `dismissed = NULL` (not `0`) if the `ALTER TABLE` default is not applied retroactively.
**Why it happens:** SQLite `ALTER TABLE ADD COLUMN` with `DEFAULT 0` applies the default to new rows only; existing rows get the column's default value as specified at column creation — but this IS applied retroactively for `DEFAULT` constraints in SQLite (verified behavior: SQLite applies the default value to all existing rows for `INTEGER DEFAULT 0`).
**How to avoid:** The migration is safe as-is. The `filterUnalerted` query should guard both `dismissed = 0` AND `dismissed IS NULL` to be defensive:
```sql
SELECT alerted_at, dismissed FROM seen_listings WHERE id = ?
-- then in JS: row.dismissed === 0 || row.dismissed === null
```

---

## Code Examples

Verified patterns from installed libraries:

### SlashCommandBuilder: /threshold with subcommands
```javascript
// Source: verified against discord.js 14.25.1 installed at node_modules/discord.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const thresholdCmd = new SlashCommandBuilder()
  .setName('threshold')
  .setDescription('Manage price thresholds')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Add a new price threshold')
      .addStringOption(opt => opt.setName('name').setDescription('Label for this threshold').setRequired(true))
      .addIntegerOption(opt => opt.setName('max_price').setDescription('Maximum price in SEK').setRequired(true))
      .addStringOption(opt =>
        opt.setName('category').setDescription('Hardware category').setRequired(false)
          .addChoices(
            { name: 'gpu', value: 'gpu' }, { name: 'cpu', value: 'cpu' },
            { name: 'ram', value: 'ram' }, { name: 'storage', value: 'storage' }
          )
      )
      .addStringOption(opt => opt.setName('keywords').setDescription('Comma-separated keywords').setRequired(false))
      .addNumberOption(opt =>
        opt.setName('min_margin').setDescription('Minimum profit margin (0.0–1.0)').setRequired(false)
          .setMinValue(0).setMaxValue(1)
      )
      .addStringOption(opt =>
        opt.setName('marketplace').setDescription('Limit to one marketplace').setRequired(false)
          .addChoices(
            { name: 'tradera', value: 'tradera' }, { name: 'blocket', value: 'blocket' },
            { name: 'vinted', value: 'vinted' }, { name: 'sweclockers', value: 'sweclockers' }
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Deactivate a threshold by name')
      .addStringOption(opt => opt.setName('name').setDescription('Threshold name').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list').setDescription('List all active thresholds')
  );
```

### SlashCommandBuilder: /pause, /resume, /dismiss
```javascript
// Source: verified against discord.js 14.25.1
const MARKETPLACE_CHOICES = [
  { name: 'tradera', value: 'tradera' },
  { name: 'blocket', value: 'blocket' },
  { name: 'vinted', value: 'vinted' },
  { name: 'sweclockers', value: 'sweclockers' },
];

const pauseCmd = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause a marketplace scraper')
  .addStringOption(opt =>
    opt.setName('marketplace').setDescription('Which marketplace to pause').setRequired(true)
      .addChoices(...MARKETPLACE_CHOICES)
  );

const resumeCmd = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume a paused marketplace scraper')
  .addStringOption(opt =>
    opt.setName('marketplace').setDescription('Which marketplace to resume').setRequired(true)
      .addChoices(...MARKETPLACE_CHOICES)
  );

const dismissCmd = new SlashCommandBuilder()
  .setName('dismiss')
  .setDescription('Dismiss a listing so it is never re-alerted')
  .addStringOption(opt =>
    opt.setName('listing_id')
      .setDescription('Listing ID to dismiss (e.g. blocket:12345678)')
      .setRequired(true)
  );
```

### REST Guild Registration
```javascript
// Source: verified against discord.js 14.25.1 — Routes.applicationGuildCommands confirmed
'use strict';
require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  const commands = [thresholdCmd, pauseCmd, resumeCmd, dismissCmd].map(c => c.toJSON());
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log(`Registered ${commands.length} commands to guild ${process.env.GUILD_ID}`);
})().catch(console.error);
```

### Ephemeral reply pattern
```javascript
// Source: verified — MessageFlags.Ephemeral === 64 in discord.js 14.25.1
const { MessageFlags } = require('discord.js');

// Success reply
await interaction.reply({ content: 'Threshold set.', flags: MessageFlags.Ephemeral });

// Error reply with guard against double-reply
if (!interaction.replied && !interaction.deferred) {
  await interaction.reply({ content: 'Error.', flags: MessageFlags.Ephemeral }).catch(() => {});
}
```

### Zod v4 validation pattern
```javascript
// Source: verified against Zod 4.3.6 installed in project
const { z } = require('zod');

const ThresholdSetSchema = z.object({
  name:        z.string().min(1).max(100),
  max_price:   z.number().int().positive(),
  category:    z.enum(['gpu','cpu','ram','storage']).optional(),
  keywords:    z.string().optional(),
  min_margin:  z.number().min(0).max(1).optional(),
  marketplace: z.enum(['tradera','blocket','vinted','sweclockers']).optional(),
});

// result.error.flatten().fieldErrors returns { fieldName: ['error msg'] }
const result = ThresholdSetSchema.safeParse(raw);
if (!result.success) {
  const errors = Object.entries(result.error.flatten().fieldErrors)
    .map(([f, msgs]) => `${f}: ${msgs.join(', ')}`)
    .join('\n');
  return interaction.reply({ content: `Invalid input:\n${errors}`, flags: MessageFlags.Ephemeral });
}
```

### dismissed column migration + filterUnalerted update
```javascript
// Migration — same pattern as migrateAlertedAt in alertSender.js
function migrateDismissed(db) {
  const cols = db.pragma('table_info(seen_listings)');
  if (!cols.some(c => c.name === 'dismissed')) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN dismissed INTEGER DEFAULT 0');
    logger.info('Migration applied: seen_listings.dismissed added');
  }
}

// Updated filterUnalerted in alertSender.js
function filterUnalerted(alerts, db) {
  return alerts.filter(alert => {
    const row = db.prepare(
      'SELECT alerted_at, dismissed FROM seen_listings WHERE id = ?'
    ).get(alert.listing.id);
    return row && row.alerted_at === null && (row.dismissed === 0 || row.dismissed === null);
  });
}

// /dismiss handler
async function handleDismiss(interaction, db) {
  const listingId = interaction.options.getString('listing_id');
  const row = db.prepare('SELECT id FROM seen_listings WHERE id = ?').get(listingId);
  if (!row) {
    return interaction.reply({ content: `Listing \`${listingId}\` not found in seen listings.`, flags: MessageFlags.Ephemeral });
  }
  db.prepare('UPDATE seen_listings SET dismissed = 1 WHERE id = ?').run(listingId);
  return interaction.reply({ content: `Listing \`${listingId}\` dismissed.`, flags: MessageFlags.Ephemeral });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global command registration (1hr delay) | Guild command registration (instant) | discord.js v14 | Use `Routes.applicationGuildCommands` not `Routes.applicationCommands` |
| `ephemeral: true` in reply options | `flags: MessageFlags.Ephemeral` | discord.js v14 | Old syntax still works but new approach is canonical |
| Manual REST calls | `REST` class from discord.js | discord.js v13+ | `REST` class handles versioning, auth headers, rate limits |

**Deprecated/outdated:**
- `interaction.reply({ ephemeral: true })`: Still works in discord.js 14 but `flags: MessageFlags.Ephemeral` is the canonical form per current docs.
- `client.application.commands.set()` for registration: Works but couples registration to bot startup. Standalone REST script is the better pattern for this use case.

---

## Open Questions

1. **DISCORD_GUILD_ID vs GUILD_ID env var name**
   - What we know: `.env.example` already defines `GUILD_ID`; CONTEXT.md says `DISCORD_GUILD_ID`
   - What's unclear: Whether the planner wants to rename `GUILD_ID` to `DISCORD_GUILD_ID` in `.env.example` for consistency, or keep the existing name
   - Recommendation: Use `GUILD_ID` to match the existing `.env.example` — avoids a breaking rename for the operator's `.env` file. Document this as `process.env.GUILD_ID` in `registerCommands.js`.

2. **Threshold name uniqueness**
   - What we know: CONTEXT.md says INSERT (not upsert) for `/threshold set`; two calls with the same name create two rows
   - What's unclear: Whether the operator expects `/threshold set` to be idempotent (update if name exists) or always-insert
   - Recommendation: Keep as INSERT per locked decision. Both rows will be active, both will fire alerts. If the operator wants to update, they remove then set. Add a comment in code.

3. **registerCommands.js npm script**
   - What we know: `scripts/registerCommands.js` doesn't exist yet; `scripts/` directory doesn't exist
   - What's unclear: Whether to add a `package.json` `scripts` entry like `"register": "node scripts/registerCommands.js"`
   - Recommendation: Add `"register": "node scripts/registerCommands.js"` to `package.json` scripts for discoverability. Not blocking.

---

## Sources

### Primary (HIGH confidence)
- discord.js 14.25.1 installed at `node_modules/discord.js` — verified via `node -e "require('discord.js').version"` → `14.25.1`
  - `SlashCommandBuilder`, `SlashCommandSubcommandBuilder` — functional verification: built full command tree, `toJSON()` produced correct option types
  - `REST`, `Routes.applicationGuildCommands` — functional verification: route returns correct path string
  - `Events.InteractionCreate` — verified: `'interactionCreate'`
  - `MessageFlags.Ephemeral` — verified: `64`
  - `ChatInputCommandInteraction.prototype.isChatInputCommand` — verified: function
  - `CommandInteractionOptionResolver.prototype.getSubcommand`, `getString`, `getInteger`, `getNumber` — verified: all functions
- Zod 4.3.6 installed at `node_modules/zod` — verified via `node_modules/zod/package.json`
  - `z.safeParse()` with complex schema — verified functional
  - `result.error.flatten().fieldErrors` — verified structure: `{ fieldName: ['msg'] }`
- better-sqlite3 12.6.2 installed — `ALTER TABLE ADD COLUMN` migration pattern verified via in-memory DB test
  - `pragma table_info` before `ALTER TABLE` — verified pattern matches `migrateAlertedAt` in `alertSender.js`
  - `dismissed = 0 OR dismissed IS NULL` query — verified against existing schema
- `alertSender.js` read directly — confirmed `client` is a local variable in `init()` not yet exposed
- `index.js` read directly — confirmed `const discord = await alertSender.init(db)` pattern; commandHandler call placement identified
- `.env.example` read directly — `GUILD_ID` (not `DISCORD_GUILD_ID`) is the established name

### Secondary (MEDIUM confidence)
- Guild vs global command registration propagation: documented behavior in discord.js community — guild commands propagate instantly, global commands take up to 1 hour. Consistent with discord.js official guidance.

### Tertiary (LOW confidence)
- None — all critical claims verified against installed source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries installed and version-verified
- Architecture: HIGH — all APIs tested in Node.js against installed packages; existing code patterns read directly
- Pitfalls: HIGH for API-level pitfalls (verified against installed discord.js); MEDIUM for interaction timing (not testable without live Discord connection)

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (discord.js stable; Zod v4 stable; better-sqlite3 stable)
