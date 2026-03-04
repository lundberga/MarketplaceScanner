'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const db = require('../db/index');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 hours
// Tradera is the authoritative sold-price reference for Swedish hardware.
// Used for sold-comps regardless of which marketplace a filter targets.
const SOLD_URL = 'https://www.tradera.com/search';
const MIN_SAMPLES = 3; // minimum sold comps to compute a meaningful median

/**
 * Returns the median sold price for a normalized query term, with 4-hour SQLite cache.
 * Returns null medianPrice if fewer than MIN_SAMPLES sold prices are found.
 * Never throws — catches all errors and returns { medianPrice: null, sampleCount: 0 }.
 *
 * @param {string} queryKey - Normalized search term e.g. 'rtx 3080' (lowercase, trimmed)
 * @returns {Promise<{ medianPrice: number|null, sampleCount: number }>}
 */
async function lookupSoldPrice(queryKey) {
  // 1. Check cache
  try {
    const cached = db.prepare(
      'SELECT median_price, sample_count, fetched_at FROM sold_price_cache WHERE query_key = ?'
    ).get(queryKey);
    const now = Math.floor(Date.now() / 1000);
    if (cached && (now - cached.fetched_at) < CACHE_TTL_SECONDS) {
      logger.info({ queryKey, age: now - cached.fetched_at }, 'Sold price cache hit');
      return { medianPrice: cached.median_price, sampleCount: cached.sample_count };
    }
  } catch (err) {
    logger.warn({ err: err.message, queryKey }, 'sold_price_cache read error — proceeding to fetch');
  }

  // 2. Cache miss — fetch from Tradera
  // itemStatus=Ended is the verified string value (NOT an integer)
  const url = `${SOLD_URL}?q=${encodeURIComponent(queryKey)}&itemStatus=Ended`;
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, queryKey }, 'Sold price fetch non-200');
      return { medianPrice: null, sampleCount: 0 };
    }
    html = await res.text();
  } catch (err) {
    logger.error({ err: err.message, queryKey }, 'Sold price fetch error');
    return { medianPrice: null, sampleCount: 0 };
  }

  // 3. Parse prices from HTML
  const prices = _parseSoldPrices(html);
  const sampleCount = prices.length;

  if (sampleCount < MIN_SAMPLES) {
    logger.info({ queryKey, found: sampleCount, required: MIN_SAMPLES }, 'Insufficient sold data — returning null');
    return { medianPrice: null, sampleCount };
  }

  const medianPrice = median(prices);

  // 4. Upsert cache — ON CONFLICT DO UPDATE refreshes the existing row
  try {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO sold_price_cache (query_key, median_price, sample_count, fetched_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET
        median_price = excluded.median_price,
        sample_count = excluded.sample_count,
        fetched_at   = excluded.fetched_at
    `).run(queryKey, medianPrice, sampleCount, now);
  } catch (err) {
    logger.warn({ err: err.message, queryKey }, 'sold_price_cache write error — continuing');
  }

  logger.info({ queryKey, medianPrice, sampleCount }, 'Sold price fetched and cached');
  return { medianPrice, sampleCount };
}

/**
 * Parses price integers from Tradera ended-listing HTML.
 * Filters out: defective/broken/lot listings, prices under 100 SEK (accessories).
 * Uses Swedish thousand-separator pattern to avoid capturing model numbers (e.g. "3080").
 * @param {string} html
 * @returns {number[]}
 */
function _parseSoldPrices(html) {
  const $ = cheerio.load(html);
  const prices = [];

  $('a[href*="/item/"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ');
    if (!text.includes('kr')) return;

    // Filter out junk listings — defective, for parts, lots
    const lower = text.toLowerCase();
    if (/defekt|trasig|delar|parti|lot|f[öo]r delar/.test(lower)) return;

    // Extract Swedish price segment: 1-3 digits optionally followed by (space + 3 digits) groups
    // e.g. "3 999 kr", "12 000 kr", "500 kr" — avoids grabbing model numbers like "3080"
    const priceMatch = text.match(/(\d{1,3}(?:\s\d{3})*)\s*kr/i);
    if (!priceMatch) return;

    const price = parsePrice(priceMatch[1] + ' kr');
    // Sanity check: ignore sub-100 SEK (cables, adapters — not hardware units)
    if (price !== null && price > 100) {
      prices.push(price);
    }
  });

  return prices;
}

/**
 * Computes the median of an array of numbers.
 * Returns null for empty arrays.
 * @param {number[]} arr
 * @returns {number|null}
 */
function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

module.exports = { lookupSoldPrice };
