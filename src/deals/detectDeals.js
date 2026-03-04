'use strict';

const { lookupSoldPrice: _lookupSoldPrice } = require('../scrapers/soldCache');
const { passesAuctionFilter } = require('../utils/parseAuctionEnd');
const { lookupStaticPrice } = require('../data/marketPrices');
const logger = require('../utils/logger');

function loadThresholds(db) {
  return db.prepare(
    'SELECT id, name, keywords, search_term, min_price, max_price, min_margin, marketplace FROM thresholds WHERE active = 1'
  ).all();
}

/**
 * Returns true if every word in `searchTerm` appears as a standalone token in `title`.
 * Handles "Ryzen 7 7800X3D" matching search "ryzen 7800x3d" (space before model number).
 * Prevents partial matches like "ti" inside "gigabyte" or "3080" inside "13080".
 * Case-insensitive.
 */
function allWordsPresent(title, searchTerm) {
  const titleLower = title.toLowerCase();
  const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word must be preceded and followed by a non-alphanumeric character (or string boundary)
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(titleLower);
  });
}

function matchesThreshold(listing, threshold) {
  // 1. Price range (NULL = no limit)
  if (threshold.min_price !== null && listing.price_sek < threshold.min_price) return false;
  if (threshold.max_price !== null && listing.price_sek > threshold.max_price) return false;
  // 2. Title check — every word must appear as a standalone token in the title
  if (threshold.keywords) {
    const kws = threshold.keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length > 0 && !kws.some(kw => allWordsPresent(listing.title, kw))) return false;
  } else if (threshold.search_term) {
    if (!allWordsPresent(listing.title, threshold.search_term)) return false;
  }
  // 3. Marketplace (NULL = any)
  if (threshold.marketplace !== null && threshold.marketplace !== listing.marketplace) return false;
  return true;
}

async function buildAlert(listing, threshold, lookupFn) {
  // Sold-comps query key: keywords first entry, then search_term, then first 3 title words
  const queryKey =
    threshold.keywords?.split(',')[0].trim().toLowerCase() ||
    threshold.search_term?.toLowerCase() ||
    listing.title.toLowerCase().trim().split(/\s+/).slice(0, 3).join(' ');

  const { medianPrice: livePrice, sampleCount } = await lookupFn(queryKey);

  // Fall back to static research prices when Tradera sold-comps has insufficient data
  let medianPrice = livePrice;
  let marginSource = livePrice !== null ? 'live' : null;
  if (livePrice === null) {
    const staticPrice = lookupStaticPrice(queryKey);
    if (staticPrice !== null) {
      medianPrice = staticPrice;
      marginSource = 'static';
    }
  }

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
      search_term: threshold.search_term,
    },
    estimatedMargin,
    sampleCount,
    medianSoldPrice: medianPrice,
    marginSource,
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
