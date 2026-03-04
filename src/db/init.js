'use strict';
// src/db/init.js
// Opens (or creates) the SQLite database, sets WAL mode, and runs all DDL.
// Safe to run multiple times — all statements use IF NOT EXISTS.
// Run directly: node src/db/init.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const logger = require('../utils/logger');

// Absolute path — survives CWD changes and pm2 working directory differences
const DB_PATH = path.resolve(__dirname, '../../data/scanner.db');

const MIGRATIONS = [
  { v: 1, sql: 'ALTER TABLE seen_listings ADD COLUMN alerted_at INTEGER' },
  { v: 2, sql: 'ALTER TABLE seen_listings ADD COLUMN dismissed INTEGER DEFAULT 0' },
  { v: 3, sql: 'ALTER TABLE thresholds ADD COLUMN min_price INTEGER' },
  { v: 4, fn: db => {
    db.exec('ALTER TABLE thresholds ADD COLUMN search_term TEXT');
    db.exec(`UPDATE thresholds SET search_term = TRIM(
      CASE WHEN INSTR(COALESCE(keywords,''), ',') > 0
        THEN SUBSTR(keywords, 1, INSTR(keywords, ',')-1)
        ELSE COALESCE(keywords, name)
      END
    ) WHERE search_term IS NULL`);
  }},
  { v: 5, sql: 'ALTER TABLE seen_listings ADD COLUMN url TEXT' },
];

function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.v)) continue;
    try {
      if (m.fn) m.fn(db); else db.exec(m.sql);
    } catch (err) {
      // Column already exists from a prior manual migration — mark as applied and continue
      if (err.message && err.message.includes('duplicate column name')) {
        logger.info({ version: m.v }, 'Migration already applied (column exists) — recording version');
      } else {
        throw err;
      }
    }
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.v);
    logger.info({ version: m.v }, 'Migration applied');
  }
}

function initDb() {
  // Create data/ directory if it does not exist — better-sqlite3 will not create parent dirs
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);

  // WAL mode: allows concurrent reads during writes, crash-safe on abrupt kill
  // Must be called before any writes — do not move this line
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_listings (
      id          TEXT PRIMARY KEY,     -- 'blocket:12345678' — globally unique composite key
      marketplace TEXT NOT NULL,        -- 'blocket' | 'tradera' | 'vinted' | 'sweclockers'
      first_seen  INTEGER NOT NULL,     -- unix timestamp (seconds since epoch)
      title       TEXT,                 -- human-readable for debugging
      price_sek   INTEGER               -- price at time of first seen
    );

    CREATE INDEX IF NOT EXISTS idx_seen_marketplace
      ON seen_listings(marketplace);

    CREATE INDEX IF NOT EXISTS idx_seen_first_seen
      ON seen_listings(first_seen DESC);

    CREATE INDEX IF NOT EXISTS idx_seen_marketplace_price
      ON seen_listings(marketplace, price_sek);

    CREATE TABLE IF NOT EXISTS thresholds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,          -- e.g. 'RTX 3080 deal'
      category    TEXT,                   -- 'gpu' | 'cpu' | 'ram' | 'storage' | NULL (any)
      keywords    TEXT,                   -- comma-separated, e.g. 'rtx 3080,3080'
      max_price   INTEGER,                -- alert if listing.price_sek <= this value
      min_margin  REAL,                   -- alert if profit margin >= this (0.0–1.0)
      marketplace TEXT,                   -- 'blocket' | 'tradera' | NULL (any marketplace)
      active      INTEGER DEFAULT 1,      -- 1 = enabled, 0 = disabled
      created_at  INTEGER NOT NULL        -- unix timestamp
    );

    CREATE TABLE IF NOT EXISTS sold_price_cache (
      query_key    TEXT PRIMARY KEY,    -- normalized search term e.g. 'rtx 3080'
      median_price INTEGER,             -- median of last N sold prices in SEK
      sample_count INTEGER,             -- how many sold listings the median is based on
      fetched_at   INTEGER NOT NULL     -- unix timestamp — cache expires after 4 hours
    );

    CREATE TABLE IF NOT EXISTS user_config (
      key   TEXT PRIMARY KEY,           -- e.g. 'blocket.paused', 'scan_interval_minutes'
      value TEXT                        -- string value; parse to typed value in application code
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace     TEXT NOT NULL,
      started_at      INTEGER,          -- unix timestamp
      completed_at    INTEGER,          -- unix timestamp; NULL if still running or errored
      listings_found  INTEGER,          -- total listings returned by scraper
      new_listings    INTEGER,          -- listings not already in seen_listings
      deals_alerted   INTEGER,          -- listings that triggered a deal alert
      error           TEXT              -- NULL if success; error message if failed
    );
  `);

  // Verify WAL mode is active
  const journalMode = db.pragma('journal_mode', { simple: true });
  logger.info({ db_path: DB_PATH, journal_mode: journalMode }, 'Database initialized');

  runMigrations(db);

  return db;
}

module.exports = { initDb, DB_PATH };

// Allow running standalone: node src/db/init.js
if (require.main === module) {
  initDb();
  process.exit(0);
}
