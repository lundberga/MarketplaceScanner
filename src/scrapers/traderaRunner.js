'use strict';
const { TraderaScraper } = require('./tradera');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const scraper = new TraderaScraper();

/**
 * Runs the Tradera scraper with seed-mode detection and deduplication.
 *
 * Seed mode fires when:
 *   - seen_listings has 0 rows for 'tradera' (cold start / DB wipe), OR
 *   - SEED_MODE=true env var is set (forced re-seed)
 *
 * In seed mode: all scraped listings are inserted into seen_listings but the
 * function returns [] — no listings propagate as "new" to the caller.
 *
 * In normal mode: only unseen listings are returned; seen_listings is updated.
 *
 * @param {string[]} keywords - Search keywords to scrape
 * @returns {Promise<import('./IScraper').Listing[]>} Novel listings (empty in seed mode)
 */
async function runTradera(keywords) {
  const isSeedMode =
    process.env.SEED_MODE === 'true' || countSeen('tradera') === 0;

  if (isSeedMode) {
    logger.info({ reason: process.env.SEED_MODE === 'true' ? 'SEED_MODE env' : 'empty seen_listings' }, 'Tradera: seed mode active');
  }

  const listings = await scraper.scrape(keywords);

  if (isSeedMode) {
    // Insert all listings as seen — filterAndMarkSeen does the insert
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Tradera seed mode: all listings marked seen, no alerts emitted');
    return [];
  }

  // Normal mode — filter returns only novel listings (and inserts them)
  const novel = filterAndMarkSeen(listings);
  logger.info({ found: listings.length, novel: novel.length }, 'Tradera run complete');
  return novel;
}

module.exports = { runTradera };
