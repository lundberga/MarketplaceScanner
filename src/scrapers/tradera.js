'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const BASE_URL = 'https://www.tradera.com';
const SEARCH_URL = `${BASE_URL}/search`;
const REQUEST_DELAY_MS = 2000; // polite delay between keyword fetches — do not reduce

class TraderaScraper {
  /**
   * Fetches active Tradera listings for all provided keywords.
   * Deduplicates by listing ID within this batch (same item can appear for multiple keywords).
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
    // Deduplicate by listing ID — same item may appear for multiple keyword searches
    const seen = new Set();
    return allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }

  async _fetchKeyword(keyword) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}&itemStatus=Active&sortBy=AddedOn&sortOrder=Descending`;
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
        logger.warn({ status: res.status, url }, 'Tradera fetch non-200');
        return [];
      }
      html = await res.text();
    } catch (err) {
      logger.error({ err: err.message, url }, 'Tradera fetch error');
      return [];
    }
    return this._parse(html, keyword);
  }

  _parse(html, keyword) {
    const $ = cheerio.load(html);
    const listings = [];

    // Tradera now renders individual item cards as div[id="item-card-{listingId}"]
    // with data-item-type, a dedicated price element (#item-card-{id}-price),
    // and a time element (#item-card-{id}-time).
    $('div[id^="item-card-"]').each((_, el) => {
      const card = $(el);
      const cardId = card.attr('id');

      // Only main cards — skip sub-elements like item-card-{id}-price / -time / -badge
      if (!/^item-card-\d+$/.test(cardId)) return;

      const listingId = cardId.replace('item-card-', '');

      // Title from the image anchor's title attribute (most reliable)
      const title = card.find('a[title]').first().attr('title')?.trim().substring(0, 250);
      if (!title) return;

      const href = card.find('a[href*="/item/"]').first().attr('href');
      if (!href) return;
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

      // Listing type from data-item-type ("Auction" vs everything else = buy_now)
      const listingType = card.attr('data-item-type') === 'Auction' ? 'auction' : 'buy_now';

      // Price from dedicated price element: "Pris:349 kr,Köp nu." etc.
      const priceText = $(`#item-card-${listingId}-price`).text().replace(/\s+/g, ' ');
      const price_sek = parsePrice(priceText);
      if (price_sek === null) return;

      // Auction end time from dedicated time element: "Sluttid7 mar 09:19."
      let auctionEndsAt = null;
      if (listingType === 'auction') {
        const timeText = $(`#item-card-${listingId}-time`).text().replace(/\s+/g, ' ');
        const sluttidMatch = timeText.match(/Sluttid\s*(\d{1,2}\s+\w+\s+\d{2}:\d{2})/);
        if (sluttidMatch) auctionEndsAt = sluttidMatch[1];
      }

      listings.push({
        id: `tradera:${listingId}`,
        marketplace: 'tradera',
        title,
        price_sek,
        url: fullUrl,
        category: classifyCategory(keyword),
        listingType,
        auctionEndsAt,
      });
    });

    logger.info({ keyword, count: listings.length }, 'Tradera scrape complete');
    return listings;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classifies a keyword into a hardware category.
 * @param {string} keyword
 * @returns {'gpu'|'cpu'|'ram'|'storage'|'unknown'}
 */
function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor|xeon/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|m\.2|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}

module.exports = { TraderaScraper };
