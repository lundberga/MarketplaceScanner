---
phase: 08-discord-commands
plan: 01
subsystem: discord
tags: [discord.js, slash-commands, REST-api, command-handler]

# Dependency graph
requires:
  - phase: 07-discord-alerts
    provides: alertSender.js with Discord client, init() pattern, and channel send infrastructure
provides:
  - commandHandler.js with interactionCreate routing for all 4 slash commands
  - scripts/registerCommands.js for guild-scoped slash command registration
  - alertSender.js exposes client in init() return value
  - index.js wires commandHandler.init(discord.client, db)
affects: [08-02-threshold-command, 08-03-pause-resume-command, 08-04-dismiss-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy require inside switch cases — avoids startup failure if command modules not yet created"
    - "Guild-scoped command registration — instant propagation vs global 1-hour delay"
    - "commandHandler.init(client, db) pattern — receives client from alertSender return object"

key-files:
  created:
    - src/discord/commandHandler.js
    - scripts/registerCommands.js
  modified:
    - src/discord/alertSender.js
    - index.js
    - .env.example
    - package.json

key-decisions:
  - "Lazy require inside switch cases so startup does not fail before 08-02/03/04 command files exist"
  - "Guild-scoped registration via Routes.applicationGuildCommands for instant propagation"
  - "client exposed in alertSender.init() return value — no global state, passed explicitly to commandHandler"
  - "DISCORD_CLIENT_ID added to .env.example — required for REST registration, distinct from DISCORD_TOKEN"

patterns-established:
  - "Command routing: single interactionCreate listener in commandHandler.js routes by commandName to per-command modules"
  - "Error recovery: catch-all in interactionCreate replies with ephemeral Internal error if command handler throws"

requirements-completed: [CMND-01, CMND-02, CMND-03, CMND-04]

# Metrics
duration: 1min
completed: 2026-03-03
---

# Phase 8 Plan 01: Discord Commands Scaffold Summary

**interactionCreate routing scaffold with lazy-require command dispatch, guild slash command registration for all 4 commands (threshold/pause/resume/dismiss), and client exposed from alertSender for commandHandler wiring**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-03T11:54:53Z
- **Completed:** 2026-03-03T11:56:19Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- alertSender.init() now returns `client` property alongside enqueue and sendStartupMessage
- commandHandler.js created with interactionCreate listener routing threshold/pause/resume/dismiss via lazy require
- scripts/registerCommands.js builds all 4 slash command JSON objects and registers to guild via discord.js REST
- index.js wires commandHandler.init(discord.client, db) after Discord ready, enabling Plans 08-02/03/04 to add handlers

## Task Commits

Each task was committed atomically:

1. **Task 1: Expose client from alertSender.init() and create commandHandler scaffold** - `1e0244d` (feat)
2. **Task 2: Create scripts/registerCommands.js and wire commandHandler into index.js** - `78de3c6` (feat)

**Plan metadata:** (docs: complete plan - in progress)

## Files Created/Modified

- `src/discord/commandHandler.js` - interactionCreate listener with switch-case routing to lazy-required command modules; exports init(client, db)
- `scripts/registerCommands.js` - One-time guild command registration script; builds all 4 slash commands with full options and registers via REST.applicationGuildCommands
- `src/discord/alertSender.js` - Added `client` to init() return value so commandHandler can receive the Discord client
- `index.js` - Added commandHandler require and await commandHandler.init(discord.client, db) after sendStartupMessage
- `.env.example` - Added DISCORD_CLIENT_ID entry (Application ID required for slash command registration)
- `package.json` - Added "register": "node scripts/registerCommands.js" npm script

## Decisions Made

- Lazy require inside switch cases: command module files (commands/threshold.js etc.) do not exist yet. Placing require() inside the switch cases means startup never fails — the require throws only when that specific command is invoked and the file is missing, at which point the outer catch replies with "Internal error." This is acceptable during development ordering.
- Guild-scoped registration: Routes.applicationGuildCommands used instead of global registration for instant propagation (global takes up to 1 hour).
- DISCORD_CLIENT_ID: The Application ID is distinct from DISCORD_TOKEN and required only for REST registration. Added to .env.example with a clear comment pointing to where to find it in the Developer Portal.
- client exposed in return value (not global): alertSender passes client back through its return value, preserving the no-global-state pattern established in Phase 7.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required during this plan. Running `npm run register` requires DISCORD_CLIENT_ID and GUILD_ID in .env, but that is a one-time operator action before using slash commands, not a setup blocker for Plans 08-02/03/04.

## Next Phase Readiness

- commandHandler.js routing scaffold is in place — Plans 08-02, 08-03, 08-04 can each create their command module (commands/threshold.js, commands/pause.js, commands/dismiss.js) independently without touching shared routing code
- scripts/registerCommands.js is ready to run once all command modules are implemented
- No blockers for 08-02/03/04 parallel execution

---
*Phase: 08-discord-commands*
*Completed: 2026-03-03*

## Self-Check: PASSED

- FOUND: src/discord/commandHandler.js
- FOUND: scripts/registerCommands.js
- FOUND: src/discord/alertSender.js (client exposed)
- FOUND: index.js (commandHandler.init wired)
- FOUND: .env.example (DISCORD_CLIENT_ID added)
- FOUND: .planning/phases/08-discord-commands/08-01-SUMMARY.md
- FOUND commit: 1e0244d (Task 1)
- FOUND commit: 78de3c6 (Task 2)
