'use strict';

const logger = require('../utils/logger');
const { detectDeals } = require('../deals/detectDeals');

/**
 * Runs one full scan cycle across all scrapers sequentially.
 *
 * For each scraper:
 *   1. Read pause state live from user_config (no caching)
 *   2. If paused: skip scraper, write scan_log row with error='paused'
 *   3. Else: run scraper, catch errors individually (one failure does not abort the rest)
 *   4. Write scan_log row unconditionally at end of each scraper's turn
 *
 * @param {Array<{name: string, run: function}>} scrapers
 *   Array of scraper descriptors. Each has a name (e.g. 'tradera') and a run(keywords) async fn.
 * @param {string[]} keywords - Search keywords passed to every scraper
 * @param {import('better-sqlite3').Database} db - The open SQLite database instance
 * @returns {Promise<void>}
 */
async function runCycle(scrapers, keywords, db) {
  logger.info({ scrapers: scrapers.map(s => s.name) }, 'Cycle started');

  const stmtGetConfig = db.prepare('SELECT value FROM user_config WHERE key = ?');
  const stmtInsertLog = db.prepare(`
    INSERT INTO scan_log
      (marketplace, started_at, completed_at, listings_found, new_listings, deals_alerted, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const scraper of scrapers) {
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
        const novel = await scraper.run(keywords);
        completedAt = Math.floor(Date.now() / 1000);
        // Phase 4 limitation: runners return novel-only; both fields populated with novel.length
        // Runners will be extended in a later phase if total-before-dedup count is needed
        newListings = novel.length;
        listingsFound = novel.length;
        const alerts = await detectDeals(novel, db);
        dealsAlerted = alerts.length;
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

  logger.info('Cycle complete');
}

module.exports = { runCycle };
