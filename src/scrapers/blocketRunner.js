'use strict';

const { BlocketScraper } = require('./blocket');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const scraper = new BlocketScraper();

/**
 * Runs the Blocket scraper with seed-mode detection and deduplication.
 *
 * Seed mode fires when:
 *   - seen_listings has 0 rows for 'blocket' (cold start / DB wipe), OR
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
async function runBlocket(keywords) {
  const isSeedMode =
    process.env.SEED_MODE === 'true' || countSeen('blocket') === 0;

  if (isSeedMode) {
    logger.info(
      { reason: process.env.SEED_MODE === 'true' ? 'SEED_MODE env' : 'empty seen_listings' },
      'Blocket: seed mode active'
    );
  }

  const listings = await scraper.scrape(keywords);

  if (isSeedMode) {
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Blocket seed mode: all listings marked seen, no alerts emitted');
    return [];
  }

  const novel = filterAndMarkSeen(listings);
  logger.info({ found: listings.length, novel: novel.length }, 'Blocket run complete');
  return novel;
}

module.exports = { runBlocket };

if (require.main === module) {
  require('dotenv').config();
  const assert = require('assert');

  const KEYWORDS = ['rtx 3080', 'rtx 3090', 'rtx 4080', 'rx 6800', 'ryzen 5 5600', 'rtx 3070'];

  async function main() {
    const listings = await scraper.scrape(KEYWORDS);
    logger.info({ count: listings.length }, 'Blocket runner: scrape done');

    for (const l of listings) {
      assert(l.id.startsWith('blocket:'), 'id must start with blocket:');
      assert(l.marketplace === 'blocket', 'marketplace must be blocket');
      assert(typeof l.price_sek === 'number', 'price_sek must be number');
      assert(l.url.startsWith('https://'), 'url must be https');
      assert(l.listingType === 'buy_now', 'listingType must be buy_now');
      assert(l.auctionEndsAt === null, 'auctionEndsAt must be null');
    }

    const isFirstRun = countSeen('blocket') === 0;
    if (isFirstRun) {
      filterAndMarkSeen(listings);
      logger.info({ count: listings.length }, 'Blocket seed: populated seen_listings, no alerts sent');
    } else {
      const novel = filterAndMarkSeen(listings);
      logger.info({ found: listings.length, novel: novel.length }, 'Blocket run complete');
    }

    logger.info({ sample: listings.slice(0, 3) }, 'Blocket sample listings');
  }

  main().catch(err => {
    logger.error({ err: err.message }, 'Blocket runner failed');
    process.exit(1);
  });
}
