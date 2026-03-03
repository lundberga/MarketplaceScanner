# Phase 1: Foundation - Research

**Researched:** 2026-03-02
**Domain:** Node.js project scaffold, better-sqlite3 schema init, pino logging, dotenv config, .gitignore hygiene
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEUP-01 | Bot tracks all seen listing IDs in SQLite to prevent duplicate alerts across scan cycles | `seen_listings` table schema with `id TEXT PRIMARY KEY` — SQLite enforces uniqueness; insert-or-ignore pattern prevents duplicates without application logic |
| DEUP-02 | Bot survives Windows process restarts without re-alerting on previously seen listings | SQLite file on disk persists across restarts by design; WAL mode prevents corruption on abrupt shutdown; absolute path via `path.resolve` ensures the file is found regardless of CWD on restart |
| DEUP-04 | Bot stores price thresholds, marketplace pause states, and dismissed deal IDs in SQLite | `thresholds`, `user_config`, and `seen_listings` tables cover all three storage needs; Phase 1 creates the schema; later phases populate it |
</phase_requirements>

---

## Summary

Phase 1 is a pure infrastructure phase: create the Node.js project skeleton, install all production dependencies up-front, establish the SQLite schema with all five tables, configure structured logging, and lock down secrets management with dotenv and .gitignore. Nothing scrapes or posts to Discord yet — this phase's deliverable is a `node src/db/init.js` command that runs cleanly and leaves a fully-formed database on disk.

The biggest risk is **better-sqlite3 native compilation on Windows**. better-sqlite3 requires C++ build tools (Visual Studio Desktop Development with C++ workload) because it compiles SQLite bindings via node-gyp. As of better-sqlite3 v12.6.2 (released 2026-01-16), Windows x64 prebuilt binaries ARE included in the release assets, meaning `npm install` will attempt to download a prebuilt first. However, if the prebuilt download fails (network, mismatched ABI, path with special characters), the fallback is source compilation — which requires Visual Studio Build Tools to be installed. The planner must include a verification step that confirms `require('better-sqlite3')` loads without error before any schema work proceeds.

The second key decision for the planner is **module system**: use CommonJS (`require`) not ESM for this project. discord.js 14 and better-sqlite3 both support CommonJS natively; mixing ESM introduces `import.meta.url` complexity for `__dirname` on Windows (drive letters in file URLs require `fileURLToPath` handling). CommonJS is the path of least resistance for a Windows-first, single-operator tool.

**Primary recommendation:** Init npm with CommonJS (`"type": "commonjs"` omitted or not set), install all production deps in one shot, run `db.pragma('journal_mode = WAL')` immediately after opening the database, and use `path.resolve(__dirname, '../../data/scanner.db')` for the database path.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2 | SQLite database access | Synchronous API fits Node.js single-process bot perfectly; no callback/promise ceremony around DB calls; fastest SQLite library for Node |
| pino | 10.3.1 | Structured JSON logging | Fastest Node.js logger; zero-dependency JSON output; child logger support for per-module context |
| pino-pretty | 13.1.3 | Human-readable dev log output | Transforms JSON logs to colored terminal output during development; never used in production |
| dotenv | 17.3.1 | Load .env into process.env | Universal standard for secret management in Node; zero-dependency; call once at entry point |
| node-cron | 4.2.1 | Install now, use in Phase 4 | Avoid npm install disruptions later; scheduling is central to this project |
| p-queue | 9.1.0 | Install now, use in Phase 2+ | Rate-limiting per marketplace; ESM-only package — verify import compatibility in CJS context |
| discord.js | 14.25.1 | Install now, use in Phase 7+ | Large install; better to front-load dependencies |
| cheerio | 1.2.0 | Install now, use in Phase 2+ | HTML parsing for scrapers |
| zod | 4.3.6 | Install now, use in Phase 8 | Input validation for slash commands |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | 13.1.3 | Dev-only pretty printer | devDependency; pipe or use as transport in development mode only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CommonJS | ESM (`"type": "module"`) | ESM is forward-looking but `__dirname` requires `fileURLToPath(import.meta.url)` shim on Windows; p-queue 9.x is ESM-only which would force the whole project to ESM anyway — evaluate this carefully |
| pino | winston | winston is fine but pino is 5x faster and simpler config; pino is preferred |
| dotenv | process.env only | dotenv enables .env.example pattern and keeps secrets out of code |

**Installation:**

```bash
# Production dependencies (install all up-front to avoid future disruption)
npm install better-sqlite3 pino dotenv discord.js@14 cheerio node-cron zod

# p-queue is ESM-only — verify it works in the project's module context before installing:
# If using CommonJS: npm install p-queue  (requires dynamic import() to load)
# If using ESM: npm install p-queue  (normal import works)

# Development dependencies
npm install -D pino-pretty
```

**IMPORTANT — p-queue ESM-only caveat:** p-queue 9.x is published as ESM-only. In a CommonJS project, you must use dynamic `await import('p-queue')` to load it. This is fine for the scheduler context (async functions), but the planner must be aware. If this is unacceptable, p-queue 7.x is the last CJS-compatible version.

---

## Architecture Patterns

### Recommended Project Structure

```
scanner/
  src/
    db/
      init.js          # opens DB, runs PRAGMA WAL, creates all tables — Phase 1 deliverable
      index.js         # exports singleton db connection
      listings.js      # seen_listings CRUD (Phase 1 schema only, queries in Phase 2+)
      thresholds.js    # thresholds CRUD (schema in Phase 1, queries in Phase 6)
    utils/
      logger.js        # pino configuration — singleton logger export
    scrapers/          # (empty in Phase 1, populated in Phase 2+)
    bot/               # (empty in Phase 1, populated in Phase 7+)
    scheduler/         # (empty in Phase 1, populated in Phase 4)
  data/
    scanner.db         # SQLite file (gitignored)
  .env                 # secrets (gitignored)
  .env.example         # committed template with placeholder values
  .gitignore           # excludes .env, data/, node_modules/
  index.js             # entry point (stub in Phase 1)
  package.json
```

### Pattern 1: SQLite Init Module

**What:** A standalone `src/db/init.js` that opens (or creates) the SQLite file, sets WAL mode, and runs all `CREATE TABLE IF NOT EXISTS` DDL statements. Can be run directly (`node src/db/init.js`) and is also called by the application entry point on startup.

**When to use:** Always — run on every startup so missing tables are created without wiping existing data. `CREATE TABLE IF NOT EXISTS` is idempotent.

**Example:**

```javascript
// src/db/init.js
// Source: better-sqlite3 official docs (github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');

// Absolute path — survives CWD changes across process restarts
const DB_PATH = path.resolve(__dirname, '../../data/scanner.db');

function initDb() {
  const db = new Database(DB_PATH);

  // WAL mode: allows concurrent reads during writes, prevents corruption on crash
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_listings (
      id          TEXT PRIMARY KEY,     -- 'blocket:12345678' — globally unique
      marketplace TEXT NOT NULL,
      first_seen  INTEGER NOT NULL,     -- unix timestamp (seconds)
      title       TEXT,
      price_sek   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_seen_marketplace
      ON seen_listings(marketplace);

    CREATE TABLE IF NOT EXISTS thresholds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      category    TEXT,                 -- 'gpu' | 'cpu' | 'ram' | 'storage' | null (any)
      keywords    TEXT,                 -- comma-separated
      max_price   INTEGER,
      min_margin  REAL,
      marketplace TEXT,                 -- 'blocket' | 'tradera' | 'vinted' | null (any)
      active      INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sold_price_cache (
      query_key    TEXT PRIMARY KEY,    -- normalized search term e.g. 'rtx 3080'
      median_price INTEGER,
      sample_count INTEGER,
      fetched_at   INTEGER NOT NULL     -- unix timestamp
    );

    CREATE TABLE IF NOT EXISTS user_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace     TEXT NOT NULL,
      started_at      INTEGER,
      completed_at    INTEGER,
      listings_found  INTEGER,
      new_listings    INTEGER,
      deals_alerted   INTEGER,
      error           TEXT              -- null if success
    );
  `);

  logger.info({ db_path: DB_PATH }, 'Database initialized');
  return db;
}

module.exports = { initDb, DB_PATH };

// Allow running directly: node src/db/init.js
if (require.main === module) {
  initDb();
}
```

### Pattern 2: Singleton DB Connection

**What:** Export a single database connection from `src/db/index.js` so all modules share one handle. better-sqlite3 is synchronous and single-threaded — one connection is correct.

**Example:**

```javascript
// src/db/index.js
const { initDb } = require('./init');

// Singleton — created once, shared everywhere
const db = initDb();
module.exports = db;
```

### Pattern 3: Pino Logger Setup

**What:** Centralized logger factory with environment-aware transport. Use pino-pretty in development via NODE_ENV check; plain JSON in production.

**Example:**

```javascript
// src/utils/logger.js
// Source: github.com/pinojs/pino/blob/main/docs/api.md
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  { level: isDev ? 'debug' : 'info' },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : process.stdout
);

module.exports = logger;
```

### Pattern 4: dotenv Loading

**What:** Call `dotenv.config()` as the very first line of the application entry point, before any other imports that might read `process.env`.

**Example:**

```javascript
// index.js (entry point)
require('dotenv').config();   // must be first

const logger = require('./src/utils/logger');
const db = require('./src/db/index');

logger.info('Scanner starting');
```

### Pattern 5: .env.example Template

```ini
# .env.example — commit this, never commit .env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_alert_channel_id_here
GUILD_ID=your_server_id_here
NODE_ENV=development
```

### Anti-Patterns to Avoid

- **Relative DB path:** `new Database('./data/scanner.db')` breaks when the process CWD differs from the project root. Always use `path.resolve(__dirname, ...)` for an absolute path.
- **In-memory DB for init:** Never use `:memory:` in the actual init module; it disappears on process exit. Only acceptable in tests.
- **Skipping WAL mode:** Without WAL, SQLite uses rollback journal mode which can corrupt the file on abrupt process termination (power loss, Windows Task Manager kill). `db.pragma('journal_mode = WAL')` must be called before any writes.
- **Committing .env:** Even with `.gitignore`, if `.env` was ever staged before the `.gitignore` was set, `git rm --cached .env` is needed. Create `.gitignore` as the very first file.
- **ESM/CJS mismatch:** p-queue 9.x is ESM-only. If the project uses CJS (`require`), p-queue must be loaded via `await import('p-queue')` in an async context. Decide on module system upfront and document it in package.json.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL schema migration | Custom migration runner | `CREATE TABLE IF NOT EXISTS` in init.js + WAL mode | Schema is stable for v1; full migration framework (Knex, Flyway) is overkill |
| Environment variable loading | Manual `fs.readFileSync('.env')` parsing | dotenv | dotenv handles multiline values, escaped characters, comment lines correctly |
| Log formatting | Custom `console.log` JSON serializer | pino + pino-pretty | pino handles circular refs, BigInt, Error objects, timestamp formatting; console.log does not |
| Process restart detection | Custom pid file / watchdog | pm2 (Phase 9) | pm2 handles crash detection, log rotation, Windows startup — don't invent this |

**Key insight:** The init phase's only custom code is SQL DDL — every other concern (logging, config, connection management) has a mature library that handles the edge cases.

---

## Common Pitfalls

### Pitfall 1: better-sqlite3 Fails to Install on Windows

**What goes wrong:** `npm install better-sqlite3` fails with a node-gyp compilation error, or silently falls back to source build and then fails due to missing C++ tools.

**Why it happens:** better-sqlite3 is a native Node.js addon compiled via node-gyp. Windows requires Visual Studio Build Tools with the "Desktop development with C++" workload. Without this, `npm install` fails. Even with prebuilt binaries in v12.6.2, if the ABI doesn't match or the download fails, it falls back to compilation.

**How to avoid:**
1. Verify build tools first: `npm install -g windows-build-tools` OR install via Visual Studio Installer (Community or Build Tools) with "Desktop development with C++" workload selected.
2. Pin to `better-sqlite3@12.6.2` which includes Windows x64 prebuilts.
3. After install, verify immediately: `node -e "require('better-sqlite3'); console.log('OK')"`.
4. If project path contains spaces (e.g., `C:\Users\alexl\Desktop\scanner`) — this is generally fine, but avoid special characters like `%` or `$`.

**Warning signs:** `gyp ERR!`, `MSBUILD : error`, `MSBuild.exe not found`, or a hang during `npm install`.

**Specific to Node.js v24:** The Node.js 24 / ABI 137 incompatibility was fixed in better-sqlite3 v12.1.0. v12.6.2 is safe for Node 24.

### Pitfall 2: SQLite File Not Found on Restart

**What goes wrong:** `init.js` uses a relative path. When pm2 or a Windows Task Scheduler entry starts the process from a different working directory, the database is created in an unexpected location, and a second empty database appears.

**Why it happens:** `new Database('./data/scanner.db')` resolves relative to `process.cwd()`, not the script location.

**How to avoid:** Always use `path.resolve(__dirname, '../../data/scanner.db')` (or appropriate relative path from `__dirname`). This is CWD-independent.

**Warning signs:** Database appears to be empty after restart; seen_listings are not persisted; two `.db` files appear in different directories.

### Pitfall 3: pino-pretty Used in Production

**What goes wrong:** pino-pretty is accidentally left active in production (pm2 process), adding ~30% log overhead and producing human-readable text instead of JSON.

**Why it happens:** Developer hardcodes `pino-pretty` transport without the `NODE_ENV` guard.

**How to avoid:** Gate pino-pretty on `process.env.NODE_ENV !== 'production'` in the logger factory. pm2 config should set `NODE_ENV=production`.

**Warning signs:** pm2 log output is colorized/formatted text instead of JSON; log parsing tools fail.

### Pitfall 4: Secrets in Git History

**What goes wrong:** `.env` is committed before `.gitignore` is in place. Even after adding `.gitignore`, the file remains tracked.

**Why it happens:** Developer runs `git add .` before creating `.gitignore`, or creates `.gitignore` after the first commit.

**How to avoid:** Create `.gitignore` as the absolute first file in the project, before `npm init` or any other files. Verify with `git status` that `.env` and `data/` are listed as untracked (not staged) after creating them.

**How to fix if already committed:** `git rm --cached .env && git commit -m "remove env from tracking"` — then rotate the Discord token immediately.

### Pitfall 5: WAL Mode Not Set

**What goes wrong:** Bot runs fine in development but SQLite becomes corrupted after a Windows restart or hard kill (e.g., power cut, Task Manager).

**Why it happens:** Default journal mode (DELETE/rollback) is less crash-resistant than WAL. In WAL mode, the WAL file is atomically checkpointed — incomplete writes don't corrupt the main db file.

**How to avoid:** `db.pragma('journal_mode = WAL')` must be the first pragma called after opening the connection, before any writes. Verify: `db.pragma('journal_mode', { simple: true })` should return `'wal'`.

### Pitfall 6: data/ Directory Not Created

**What goes wrong:** `new Database(DB_PATH)` throws `SQLITE_CANTOPEN: unable to open database file` because `data/` directory doesn't exist.

**Why it happens:** better-sqlite3 creates the SQLite file but NOT missing parent directories.

**How to avoid:** Add `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })` before opening the database connection in `init.js`.

---

## Code Examples

Verified patterns from official sources:

### Complete init.js

```javascript
// src/db/init.js — Phase 1 deliverable
// Sources:
//   better-sqlite3 API: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
//   WAL mode: sqlite.org/wal.html
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');

const DB_PATH = path.resolve(__dirname, '../../data/scanner.db');

function initDb() {
  // Ensure data/ directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);

  // WAL mode: concurrent reads, crash-safe writes
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_listings (
      id          TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL,
      first_seen  INTEGER NOT NULL,
      title       TEXT,
      price_sek   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_seen_marketplace
      ON seen_listings(marketplace);

    CREATE TABLE IF NOT EXISTS thresholds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      category    TEXT,
      keywords    TEXT,
      max_price   INTEGER,
      min_margin  REAL,
      marketplace TEXT,
      active      INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sold_price_cache (
      query_key    TEXT PRIMARY KEY,
      median_price INTEGER,
      sample_count INTEGER,
      fetched_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace     TEXT NOT NULL,
      started_at      INTEGER,
      completed_at    INTEGER,
      listings_found  INTEGER,
      new_listings    INTEGER,
      deals_alerted   INTEGER,
      error           TEXT
    );
  `);

  logger.info({ db_path: DB_PATH, journal_mode: 'WAL' }, 'Database initialized');
  return db;
}

module.exports = { initDb, DB_PATH };

if (require.main === module) {
  initDb();
  process.exit(0);
}
```

### Verify WAL mode is active

```javascript
// Quick verification — run this after initDb()
const mode = db.pragma('journal_mode', { simple: true });
console.assert(mode === 'wal', `Expected WAL mode, got: ${mode}`);
```

### List all tables (smoke test)

```javascript
// Verify all 5 tables exist
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map(r => r.name);
console.log('Tables:', tables);
// Expected: ['scan_log', 'seen_listings', 'sold_price_cache', 'thresholds', 'user_config']
```

### .gitignore Content

```gitignore
# Secrets
.env

# Database file
data/
*.db

# Dependencies
node_modules/

# Logs
*.log
```

### package.json Starter

```json
{
  "name": "scanner",
  "version": "1.0.0",
  "description": "Hardware flip scanner — Swedish marketplace bot",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "db:init": "node src/db/init.js",
    "dev": "NODE_ENV=development node index.js"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

Note: No `"type": "module"` — project uses CommonJS. p-queue 9.x (ESM-only) requires `await import('p-queue')` in async contexts.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sqlite3` (async callbacks) | `better-sqlite3` (synchronous) | ~2018 | Synchronous API eliminates callback pyramid; better for sequential schema init |
| `winston` as default logger | `pino` preferred for performance-sensitive apps | ~2020 | 5x faster; JSON-first; pino-pretty for dev |
| `require('dotenv').config()` anywhere | Call at entry point before any other `require` | Always best practice | Ensures env vars are available before modules initialize |
| `windows-build-tools` npm package | Visual Studio Build Tools (official installer) | ~2022 | `windows-build-tools` package deprecated; use official VS installer or `choco install visualstudio2022buildtools` |
| Global node-gyp install | node-gyp bundled with npm | npm 7+ | No need to `npm install -g node-gyp` manually |

**Deprecated/outdated:**
- `windows-build-tools` npm package: Do NOT use `npm install -g windows-build-tools` — this package is deprecated. Use Visual Studio Installer or Chocolatey instead.
- better-sqlite3 v11 and below: No Node.js v24 support. Must use v12.1.0+.

---

## Open Questions

1. **Module system: CommonJS vs ESM**
   - What we know: p-queue 9.x is ESM-only; discord.js 14 supports both; better-sqlite3 supports both; Node.js 24 has first-class ESM support
   - What's unclear: Whether the planner should commit to ESM (cleaner long-term) or CJS (simpler Windows path handling, no `import.meta.url` shim needed) — this decision affects every file in the project
   - Recommendation: Choose CJS for Phase 1. The project is a single-operator local tool, not a library. CJS avoids the `__dirname` / `import.meta.url` shim on Windows and is simpler to debug. Load p-queue via `await import('p-queue')` in async scheduler code. Revisit for v2.

2. **Visual Studio Build Tools — already installed?**
   - What we know: The machine is Windows 11; Node.js v24.13.1 is installed (suggests some dev tooling exists); better-sqlite3 v12.6.2 has Windows x64 prebuilts which may avoid compilation entirely
   - What's unclear: Whether the prebuilt binary for Node.js v24 / ABI 137 is included in the v12.6.2 Windows release assets
   - Recommendation: Attempt `npm install better-sqlite3@12.6.2` first. If it fails with a build error, install Build Tools before proceeding. The planner should make this a gated first task with explicit verification.

3. **`data/` directory location**
   - What we know: ARCHITECTURE.md specifies `data/scanner.db` at project root; this path is gitignored
   - What's unclear: Whether `data/` at `C:\Users\alexl\Desktop\scanner\data\` is acceptable or if a less transient location (e.g., AppData) is preferred
   - Recommendation: Use `data/scanner.db` at project root for Phase 1 as specified. If persistence across project moves/renames becomes a concern, address in Phase 9.

---

## Sources

### Primary (HIGH confidence)
- better-sqlite3 official API docs (`github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md`) — Database constructor, exec(), pragma(), prepare/run/get/all patterns
- better-sqlite3 releases page (`github.com/WiseLibs/better-sqlite3/releases`) — v12.6.2 confirmed Windows x64 prebuilts; released 2026-01-16
- better-sqlite3 troubleshooting (`github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md`) — Windows build tools, `install_tools.bat`, path with special characters
- pino API docs (`github.com/pinojs/pino/blob/main/docs/api.md`) — logger constructor, transport config, child loggers
- dotenv README (`github.com/motdotla/dotenv`) — config() usage, .env.example pattern
- node-gyp Windows docs (`github.com/nodejs/node-gyp#on-windows`) — Visual Studio 2019+ "Desktop development with C++" workload requirement
- SQLite WAL docs (`sqlite.org/wal.html`) — WAL mode behavior, crash safety guarantees

### Secondary (MEDIUM confidence)
- GitHub issue `WiseLibs/better-sqlite3#1384`: Node 24 / ABI 137 prebuilt issue confirmed fixed in v12.1.0 via PR #1385 — multiple commenters confirm
- GitHub issue `WiseLibs/better-sqlite3#1376`: Node.js 24 compatibility confirmed broken pre-v12.1.0; v12.6.2 is safe
- `STACK.md` project research (2026-03-02): all library versions verified from npm registry at research time

### Tertiary (LOW confidence)
- WebSearch results on node-gyp + Visual Studio 2026 compatibility: a `Build toolchain compatibility with Visual Studio 2026` issue was opened in nodejs/node (`github.com/nodejs/node/issues/60861`) — this is a Node.js compilation concern, not a native addon concern, but worth monitoring if VS 2026 is installed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified from npm registry in project STACK.md (2026-03-02); better-sqlite3 Node 24 compatibility confirmed via GitHub issues
- Architecture: HIGH — patterns are well-established for this class of Node.js single-file database application; confirmed against official docs
- Pitfalls: HIGH — better-sqlite3 Windows build issues verified via multiple GitHub issues; WAL mode necessity documented in SQLite official docs; other pitfalls are well-documented general Node.js patterns

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (stable libraries; better-sqlite3 prebuilt status could change with new Node.js releases)
