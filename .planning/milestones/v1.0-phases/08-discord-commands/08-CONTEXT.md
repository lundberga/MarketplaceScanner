# Phase 8: Discord Commands - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the operator full bot control from Discord — threshold management (set/remove/list), marketplace pause/resume, and deal dismissal — without touching config files or restarting the process. UI enhancements and user-facing command help are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Client architecture
- New `src/discord/commandHandler.js` module — does not live inside `alertSender.js`
- `alertSender.init()` exposes the discord.js `client` alongside `enqueue` and `sendStartupMessage`
- `index.js` passes `client` to `commandHandler.init(client, db)` after the Discord ready event
- `commandHandler.js` registers the `interactionCreate` listener and routes to per-command handlers

### Slash command registration
- Guild-only registration (instant propagation, no 1-hour global delay)
- Separate `scripts/registerCommands.js` — run once manually, not on every bot startup
- Commands registered to the guild specified by `DISCORD_GUILD_ID` env var

### `/threshold` command UX
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

### `/pause` and `/resume` commands
- `/pause <marketplace>` — writes `<marketplace>.paused = "true"` to `user_config`
- `/resume <marketplace>` — writes `<marketplace>.paused = "false"` (or deletes the row)
- Valid marketplace names: tradera, blocket, vinted, sweclockers
- Invalid name → reply with a list of valid options
- `runCycle.js` already reads `user_config` pause state — no changes needed there

### `/dismiss` command
- `/dismiss listing_id:<id>` — marks a listing so it is never re-alerted
- Storage: add a `dismissed` column (`INTEGER DEFAULT 0`) to `seen_listings` via migration — same pattern as `alerted_at`
- `detectDeals` / `filterUnalerted` must exclude rows where `dismissed = 1`

### Reply visibility
- All command replies are **ephemeral** (only the invoker sees them)
- Keeps the deal alert channel clean — commands are management actions, not announcements

### Input validation
- Use Zod for all slash command input parsing
- Invalid input → ephemeral reply with the error reason, never a thrown exception

### Claude's Discretion
- Exact formatting of `/threshold list` output (table vs embed vs code block)
- Error message copy
- Whether `registerCommands.js` uses REST or the client's application commands API
- Command handler file layout within `src/discord/` (flat vs subdirectory per command)

</decisions>

<specifics>
## Specific Ideas

- The success criteria example `/threshold set GPU 2500` is positional-looking, but Discord slash commands with named options are more robust and self-documenting — use named options
- `dismissed` column reuses the same migration pattern as `alerted_at` (pragma table_info check before ALTER TABLE)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `alertSender.js` → `Client` instance: expose `client` from `init()` return value so commandHandler can attach listeners
- `src/db/init.js` → `db` singleton: already passed around; commandHandler receives it from index.js
- `detectDeals.js` → `loadThresholds()`: reads `active = 1` rows — threshold set/remove writes directly to the same table, no extra cache to invalidate
- Zod is likely already in package.json (check); if not, add it — used for slash command option validation

### Established Patterns
- Module init pattern: `async function init(...)` returning an object with methods — match this in `commandHandler.js`
- Migration pattern: `pragma table_info` check before `ALTER TABLE` — reuse for `dismissed` column
- `user_config` key/value: existing pause state uses `<marketplace>.paused` as key — continue that convention

### Integration Points
- `index.js`: after `alertSender.init(db)`, call `commandHandler.init(client, db)` — client must be exposed from alertSender
- `src/db/init.js`: no schema changes needed at init time — dismissed column added via migration in commandHandler.init()
- `filterUnalerted()` in `alertSender.js`: add `AND dismissed = 0` (or check after fetch) to exclude dismissed listings

</code_context>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-discord-commands*
*Context gathered: 2026-03-03*
