'use strict';

const { lookupSoldPrice: _lookupSoldPrice } = require('../scrapers/soldCache');
const { passesAuctionFilter } = require('../utils/parseAuctionEnd');
const logger = require('../utils/logger');

function loadThresholds(db) {
  return db.prepare(
    'SELECT id, name, category, keywords, max_price, min_margin, marketplace FROM thresholds WHERE active = 1'
  ).all();
}

function matchesThreshold(listing, threshold) {
  // 1. Category (NULL = wildcard)
  if (threshold.category !== null && threshold.category !== listing.category) return false;
  // 2. Price (NULL = no limit)
  if (threshold.max_price !== null && listing.price_sek > threshold.max_price) return false;
  // 3. Keywords — comma-separated TEXT, never a JS array
  if (threshold.keywords) {
    const kws = threshold.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (kws.length > 0 && !kws.some(kw => listing.title.toLowerCase().includes(kw))) return false;
  }
  // 4. Marketplace (NULL = any)
  if (threshold.marketplace !== null && threshold.marketplace !== listing.marketplace) return false;
  return true;
}

async function buildAlert(listing, threshold, lookupFn) {
  // Sold-comps query key: threshold keywords first entry, else first 3 words of title
  const firstKeyword = threshold.keywords
    ? threshold.keywords.split(',')[0].trim().toLowerCase()
    : null;
  const queryKey = firstKeyword || listing.title.toLowerCase().trim().split(/\s+/).slice(0, 3).join(' ');

  const { medianPrice, sampleCount } = await lookupFn(queryKey);

  const estimatedMargin = medianPrice !== null ? medianPrice - listing.price_sek : null;

  // min_margin check — ONLY discard when comps exist AND margin is insufficient
  if (threshold.min_margin !== null && medianPrice !== null) {
    const requiredMargin = threshold.min_margin * medianPrice;
    if (estimatedMargin < requiredMargin) return null;
  }

  return {
    listing,
    threshold: {
      id: threshold.id,
      name: threshold.name,
      max_price: threshold.max_price,
      min_margin: threshold.min_margin,
    },
    estimatedMargin,
    sampleCount,
    medianSoldPrice: medianPrice,
  };
}

/**
 * Detects deals by matching listings against active thresholds and enriching
 * matched pairs with sold-comp margin data.
 *
 * Never throws — inner errors skip the offending (listing, threshold) pair;
 * outer unexpected errors return [].
 *
 * @param {import('../scrapers/IScraper').Listing[]} listings
 * @param {import('better-sqlite3').Database} db
 * @param {function(string): Promise<{medianPrice: number|null, sampleCount: number}>} [_lookup]
 *   Optional injected lookup function (for testing). Defaults to the real lookupSoldPrice.
 * @returns {Promise<Object[]>} DealAlert[]
 */
async function detectDeals(listings, db, _lookup) {
  const lookupFn = _lookup || _lookupSoldPrice;

  try {
    if (listings.length === 0) return [];

    const thresholds = loadThresholds(db);
    if (thresholds.length === 0) {
      logger.warn('detectDeals: no active thresholds configured — returning []');
      return [];
    }

    // Auction filter runs BEFORE any sold-comps HTTP calls
    const auctionPassed = listings.filter(passesAuctionFilter);

    const alerts = [];
    for (const listing of auctionPassed) {
      for (const threshold of thresholds) {
        if (!matchesThreshold(listing, threshold)) continue;
        try {
          const alert = await buildAlert(listing, threshold, lookupFn);
          if (alert !== null) alerts.push(alert);
        } catch (innerErr) {
          logger.warn(
            { err: innerErr.message, listingId: listing.id, thresholdId: threshold.id },
            'detectDeals: buildAlert error — skipping pair'
          );
        }
      }
    }

    logger.info(
      { input: listings.length, auctionPassed: auctionPassed.length, alerts: alerts.length },
      'detectDeals complete'
    );
    return alerts;
  } catch (err) {
    logger.error({ err: err.message }, 'detectDeals: unexpected error — returning []');
    return [];
  }
}

module.exports = { detectDeals };
