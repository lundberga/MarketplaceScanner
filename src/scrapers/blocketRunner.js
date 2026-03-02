'use strict';
require('dotenv').config();
const assert = require('assert');
const { BlocketScraper } = require('./blocket');
const { filterAndMarkSeen, countSeen } = require('../db/seenListings');
const logger = require('../utils/logger');

const KEYWORDS = ['rtx 3080', 'rtx 3090', 'rtx 4080', 'rx 6800', 'ryzen 5 5600', 'rtx 3070'];

async function main() {
  const scraper = new BlocketScraper();

  const listings = await scraper.scrape(KEYWORDS);
  logger.info({ count: listings.length }, 'Blocket runner: scrape done');

  // Schema assertions on every listing
  for (const l of listings) {
    assert(l.id.startsWith('blocket:'), 'id must start with blocket:');
    assert(l.marketplace === 'blocket', 'marketplace must be blocket');
    assert(typeof l.price_sek === 'number', 'price_sek must be number');
    assert(l.url.startsWith('https://'), 'url must be https');
    assert(l.listingType === 'buy_now', 'listingType must be buy_now');
    assert(l.auctionEndsAt === null, 'auctionEndsAt must be null');
  }

  // Seed mode detection
  const isFirstRun = countSeen('blocket') === 0;
  if (isFirstRun) {
    filterAndMarkSeen(listings);
    logger.info({ count: listings.length }, 'Blocket seed: populated seen_listings, no alerts sent');
  } else {
    const novel = filterAndMarkSeen(listings);
    logger.info({ found: listings.length, novel: novel.length }, 'Blocket run complete');
  }

  // Visual sample for inspection
  logger.info({ sample: listings.slice(0, 3) }, 'Blocket sample listings');
}

main().catch(err => {
  logger.error({ err: err.message }, 'Blocket runner failed');
  process.exit(1);
});
