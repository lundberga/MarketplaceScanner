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
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}&itemStatus=Active`;
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
    const seenIds = new Set(); // deduplicate within this page (same anchor appears for image + title)

    $('a[href*="/item/"]').each((_, el) => {
      const href = $(el).attr('href');
      const idMatch = href && href.match(/\/item\/\d+\/(\d+)/);
      if (!idMatch) return;

      const listingId = idMatch[1];

      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // Guard: skip non-listing anchors and empty-text image anchors (no price text)
      if (!text.includes('kr')) return;

      // Deduplicate after text check — image anchors (empty text) must not consume the ID slot
      if (seenIds.has(listingId)) return;
      seenIds.add(listingId);

      // Extract title: prefer h3 or title-class element; fall back to text before price
      const title = (
        $(el).find('h3').first().text().trim() ||
        $(el).find('[class*="title"]').first().text().trim() ||
        text.split(/\d+\s*kr/)[0].trim().substring(0, 250)
      ).substring(0, 250);

      // Determine listing type
      // "Ledande bud" = active bid (auction), "Eller Köp nu" = auction with buy-now option
      let listingType = 'buy_now';
      if (text.includes('Ledande bud') || text.includes('Eller Köp nu')) {
        listingType = 'auction';
      }

      // Extract price — for "Eller Köp nu" use the buy-now price (second price in text)
      let priceSource = text;
      if (text.includes('Eller Köp nu')) {
        const buyNowMatch = text.match(/Eller K[öo]p nu\s+([\d\s]+)\s*kr/i);
        if (buyNowMatch) priceSource = buyNowMatch[1] + ' kr';
      }
      const price_sek = parsePrice(priceSource);
      if (price_sek === null) return; // skip if price unparseable

      // Auction end time — store raw Swedish string, Phase 6 will parse it
      let auctionEndsAt = null;
      const sluttidMatch = text.match(/Sluttid\s*(\d+\s+\w+\s+\d+:\d+)/);
      if (sluttidMatch) {
        auctionEndsAt = sluttidMatch[1];
      }

      listings.push({
        id: `tradera:${listingId}`,
        marketplace: 'tradera',
        title: title || `tradera-${listingId}`,
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
