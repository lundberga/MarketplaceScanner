'use strict';

const logger = require('../utils/logger');
const { detectDeals } = require('../deals/detectDeals');
const { pruneOldListings } = require('../db/seenListings');

/**
 * Returns keywords for a specific scraper, filtered by marketplace constraint.
 * Filters with marketplace=scraperName OR marketplace=NULL both contribute keywords.
 * Falls back to KEYWORDS env var or hardcoded defaults if no active thresholds exist.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} scraperName - e.g. 'tradera'
 * @returns {string[]}
 */
function getKeywordsForScraper(db, scraperName) {
  const rows = db.prepare(`
    SELECT DISTINCT search_term FROM thresholds
    WHERE active = 1 AND search_term IS NOT NULL AND search_term != ''
    AND (marketplace IS NULL OR marketplace = ?)
  `).all(scraperName);
  if (rows.length > 0) return rows.map(r => r.search_term);
  return (process.env.KEYWORDS || 'rtx 3080,rtx 3090,rtx 4080,rx 6800')
    .split(',').map(k => k.trim()).filter(Boolean);
}

/**
 * Runs one scraper and writes its scan_log row.
 *
 * @param {{ name: string, run: function }} scraper
 * @param {import('better-sqlite3').Database} db
 * @param {{ enqueue: function }|null} alertSender
 */
async function runOneScraper(scraper, db, alertSender) {
  const stmtGetConfig = db.prepare('SELECT value FROM user_config WHERE key = ?');
  const stmtInsertLog = db.prepare(`
    INSERT INTO scan_log
      (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const startedAt = Math.floor(Date.now() / 1000);
  let completedAt = null;
  let listingsFound = 0;
  let newListings = 0;
  let dealsAlerted = 0;
  let errorMsg = null;

  // Live pause check — read from DB each cycle, no in-memory caching
  const pauseRow = stmtGetConfig.get(`${scraper.name}.paused`);
  const isPaused = pauseRow?.value === 'true';

  if (isPaused) {
    completedAt = Math.floor(Date.now() / 1000);
    errorMsg = 'paused';
    logger.info({ marketplace: scraper.name }, 'Scraper paused — skipping');
  } else {
    try {
      const keywords = getKeywordsForScraper(db, scraper.name);
      const novel = await scraper.run(keywords);
      completedAt = Math.floor(Date.now() / 1000);
      // Phase 4 limitation: runners return novel-only; both fields populated with novel.length
      newListings = novel.length;
      listingsFound = novel.length;
      const alerts = await detectDeals(novel, db);
      dealsAlerted = alerts.length;
      if (alertSender) {
        alertSender.enqueue(alerts);  // fire-and-forget
      }
      logger.info({ marketplace: scraper.name, novel: novel.length }, 'Scraper complete');
    } catch (err) {
      completedAt = Math.floor(Date.now() / 1000);
      errorMsg = err.message;
      logger.error({ marketplace: scraper.name, err: err.message }, 'Scraper error — continuing cycle');
    }
  }

  // Write scan_log row — always, even on pause or error
  stmtInsertLog.run(scraper.name, startedAt, completedAt, listingsFound, newListings, dealsAlerted, errorMsg);
}

/**
 * Runs one full scan cycle across all scrapers in parallel.
 * Each scraper computes its own keyword list based on marketplace-filtered thresholds.
 * Runs daily prune of seen_listings older than 90 days via user_config tracking.
 *
 * @param {Array<{name: string, run: function}>} scrapers
 * @param {import('better-sqlite3').Database} db
 * @param {{ enqueue: function }|null} [alertSender]
 * @returns {Promise<void>}
 */
async function runCycle(scrapers, db, alertSender) {
  logger.info({ scrapers: scrapers.map(s => s.name) }, 'Cycle started');

  // Daily prune — at most once per 24 hours, tracked in user_config
  const lastPrune = db.prepare("SELECT value FROM user_config WHERE key = 'last_prune'").get();
  const now = Math.floor(Date.now() / 1000);
  if (!lastPrune || now - parseInt(lastPrune.value, 10) > 86400) {
    pruneOldListings(db);
    db.prepare("INSERT OR REPLACE INTO user_config (key, value) VALUES ('last_prune', ?)").run(String(now));
  }

  await Promise.allSettled(
    scrapers.map(scraper => runOneScraper(scraper, db, alertSender))
  );

  logger.info('Cycle complete');
}

module.exports = { runCycle };
