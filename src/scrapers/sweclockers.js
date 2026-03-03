'use strict';
const { fetch } = require('undici');
const cheerio = require('cheerio');
const { parsePrice } = require('../utils/parsePrice');
const logger = require('../utils/logger');

const RSS_URL = 'https://www.sweclockers.com/feeds/marknad';

function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor|xeon/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|m\.2|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}

class SweclockersScraper {
  /**
   * Fetches active Sweclockers marketplace listings via RSS feed.
   * Keywords parameter satisfies IScraper interface but is not used — one RSS
   * fetch covers all categories.
   * Never throws — returns [] on error.
   * @param {string[]} keywords
   * @returns {Promise<import('./IScraper').Listing[]>}
   */
  async scrape(keywords) {
    let xml;
    try {
      const res = await fetch(RSS_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        },
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Sweclockers: RSS fetch non-200');
        return [];
      }
      xml = await res.text();
    } catch (err) {
      logger.error({ err: err.message }, 'Sweclockers: RSS fetch error');
      return [];
    }
    return this._parse(xml);
  }

  _parse(xml) {
    const $ = cheerio.load(xml, { xmlMode: true });
    const listings = [];
    const seenIds = new Set();

    $('item').each((_, el) => {
      // Filter: only [Säljes] posts — skip [Köpes], [Bytes], [Skänkes]
      const rawTitle = $('title', el).text().trim();
      if (!rawTitle.startsWith('[Säljes]')) return;

      // Strip [Säljes] prefix and truncate
      const title = rawTitle.replace(/^\[Säljes\]\s*/, '').substring(0, 250);

      // Get link; fall back to guid (confirmed permaLink in Sweclockers RSS)
      let link = $('link', el).text().trim();
      if (!link) {
        link = $('guid', el).text().trim();
      }
      if (!link) return;

      // Extract numeric listing ID from URL path /marknad/{id}-{slug}
      const idMatch = link.match(/\/marknad\/(\d+)/);
      if (!idMatch) return;

      const listingId = idMatch[1];
      if (seenIds.has(listingId)) return;
      seenIds.add(listingId);

      // Parse price from CDATA description text; fall back to 0
      const description = $('description', el).text();
      const price_sek = parsePrice(description) ?? 0;

      // Classify by title (no per-keyword loop — single RSS covers all)
      const category = classifyCategory(title);

      listings.push({
        id: 'sweclockers:' + listingId,
        marketplace: 'sweclockers',
        title,
        price_sek,
        url: link,
        category,
        listingType: 'buy_now',
        auctionEndsAt: null,
      });
    });

    logger.info({ count: listings.length }, 'Sweclockers scrape complete');
    return listings;
  }
}

module.exports = { SweclockersScraper };
