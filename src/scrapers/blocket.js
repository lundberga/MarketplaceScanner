'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const BASE_URL = 'https://www.blocket.se';
const SEARCH_URL = `${BASE_URL}/annonser/hela_sverige`;
const REQUEST_DELAY_MS = 3000;

function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor|xeon/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|m\.2|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class BlocketScraper {
  /**
   * Fetches active Blocket listings for all provided keywords.
   * Deduplicates by listing ID within this batch.
   * Never throws — returns [] on error.
   * @param {string[]} keywords
   * @returns {Promise<import('./IScraper').Listing[]>}
   */
  async scrape(keywords) {
    const allListings = [];
    for (const keyword of keywords) {
      if (allListings.length > 0) await sleep(REQUEST_DELAY_MS);
      const listings = await this._fetchKeyword(keyword);
      allListings.push(...listings);
    }
    // Deduplicate by listing ID
    const seen = new Set();
    const deduped = allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    // Canary check
    if (deduped.length === 0 && keywords.length > 0) {
      logger.warn({ keywords }, 'Blocket canary FAIL: zero results — possible structure change');
    }
    return deduped;
  }

  async _fetchKeyword(keyword) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}`;
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
        logger.warn({ status: res.status, url }, 'Blocket fetch non-200');
        return [];
      }
      html = await res.text();
    } catch (err) {
      logger.error({ err: err.message, url }, 'Blocket fetch error');
      return [];
    }
    return this._parse(html, keyword);
  }

  _parse(html, keyword) {
    const $ = cheerio.load(html);
    const listings = [];
    const seenIds = new Set();

    $('a.sf-search-ad-link').each((_, el) => {
      const $a = $(el);

      const listingId = $a.attr('id');
      if (!listingId || seenIds.has(listingId)) return;

      const url = $a.attr('href');
      if (!url || !url.includes('/recommerce/forsale/item/')) return;

      const fullUrl = url.startsWith('http') ? url : BASE_URL + url;

      $a.find('span[aria-hidden="true"]').remove();
      const title = $a.text().trim().substring(0, 250);
      if (!title) return;

      seenIds.add(listingId);

      const $article = $a.closest('article');
      const priceText = $article.find('div.font-bold span').first().text().trim();
      const price_sek = parsePrice(priceText);
      if (price_sek === null) return;

      listings.push({
        id: 'blocket:' + listingId,
        marketplace: 'blocket',
        title,
        price_sek,
        url: fullUrl,
        category: classifyCategory(keyword),
        listingType: 'buy_now',
        auctionEndsAt: null,
      });
    });

    logger.info({ keyword, count: listings.length }, 'Blocket scrape complete');
    return listings;
  }
}

module.exports = { BlocketScraper };
