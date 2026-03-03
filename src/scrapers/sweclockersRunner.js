'use strict';
const { SweclockersScraper } = require('./sweclockers');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const scraper = new SweclockersScraper();

/**
 * Runs the Sweclockers scraper with seed-mode detection and deduplication.
 *
 * Seed mode fires when:
 *   - seen_listings has 0 rows for 'sweclockers' (cold start / DB wipe), OR
 *   - SEED_MODE=true env var is set (forced re-seed)
 *
 * In seed mode: all scraped listings are inserted into seen_listings but the
 * function returns [] — no listings propagate as "new" to the caller.
 *
 * In normal mode: only unseen listings are returned; seen_listings is updated.
 *
 * @param {string[]} keywords - Search keywords (passed to scraper interface; not used internally)
 * @returns {Promise<import('./IScraper').Listing[]>} Novel listings (empty in seed mode)
 */
async function runSweclockers(keywords) {
  const isSeedMode = process.env.SEED_MODE === 'true' || countSeen('sweclockers') === 0;
  if (isSeedMode) {
    logger.info(
      { reason: process.env.SEED_MODE === 'true' ? 'SEED_MODE env' : 'empty seen_listings' },
      'Sweclockers: seed mode active'
    );
  }
  const listings = await scraper.scrape(keywords);
  if (isSeedMode) {
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Sweclockers seed mode: all listings marked seen, no alerts emitted');
    return [];
  }
  const novel = filterAndMarkSeen(listings);
  logger.info({ found: listings.length, novel: novel.length }, 'Sweclockers run complete');
  return novel;
}

module.exports = { runSweclockers };
