// Shared interface contract for all marketplace scrapers. Import the types via JSDoc @type annotations.
'use strict';

/**
 * @typedef {Object} Listing
 * @property {string} id - Composite key: '{marketplace}:{listingId}' e.g. 'tradera:717510247'
 * @property {string} marketplace - 'tradera' | 'blocket' | 'vinted' | 'sweclockers'
 * @property {string} title - Listing title (max 250 chars)
 * @property {number} price_sek - Price in SEK as integer (0 if free or unknown)
 * @property {string} url - Full listing URL including https://
 * @property {string} category - 'gpu' | 'cpu' | 'ram' | 'storage' | 'unknown'
 * @property {'buy_now'|'auction'} listingType - Whether this is fixed-price or an auction
 * @property {string|null} auctionEndsAt - Raw Swedish date string from Sluttid, or null
 */

/**
 * @typedef {Object} IScraper
 * Every marketplace scraper class must implement this method.
 * @property {function(string[]): Promise<Listing[]>} scrape
 *   Accepts an array of search keywords, returns normalized Listing objects.
 *   Must never throw — catch all errors internally and return [].
 */

module.exports = {};
