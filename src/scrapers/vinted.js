'use strict';
const { fetch } = require('undici');
const logger = require('../utils/logger');

const SESSION_URL = 'https://www.vinted.se';
const API_URL = 'https://www.vinted.se/api/v2/catalog/items';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function classifyCategory(keyword) {
  const kw = keyword.toLowerCase();
  if (/gpu|rtx|gtx|rx\s?\d|grafik|geforce|radeon/.test(kw)) return 'gpu';
  if (/cpu|ryzen|intel|core\s?i\d|processor|xeon/.test(kw)) return 'cpu';
  if (/ram|ddr\d|minne/.test(kw)) return 'ram';
  if (/ssd|hdd|nvme|m\.2|storage|lagring/.test(kw)) return 'storage';
  return 'unknown';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class VintedScraper {
  /**
   * Fetches active Vinted listings for all provided keywords.
   * Bootstraps a session cookie once, then queries the internal JSON API per keyword.
   * Deduplicates by listing ID within the batch.
   * Never throws — returns [] on error.
   * @param {string[]} keywords
   * @returns {Promise<import('./IScraper').Listing[]>}
   */
  async scrape(keywords) {
    const sessionCookie = await this._fetchSessionCookie();

    const allListings = [];
    let isFirst = true;
    for (const keyword of keywords) {
      if (!isFirst) {
        await sleep(1000 + Math.floor(Math.random() * 2000));
      }
      isFirst = false;

      const listings = await this._fetchKeyword(keyword, sessionCookie);
      allListings.push(...listings);
    }

    // Deduplicate by listing ID
    const seen = new Set();
    const deduped = allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    logger.info({ count: deduped.length }, 'Vinted scrape complete');
    return deduped;
  }

  /**
   * Fetches a session cookie from the Vinted homepage.
   * Returns null on any error — API calls proceed without a cookie.
   * @returns {Promise<string|null>}
   */
  async _fetchSessionCookie() {
    try {
      const res = await fetch(SESSION_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });

      // Try standard header first, then undici extension
      let cookieHeader = res.headers.get('set-cookie');
      if (!cookieHeader) {
        const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        cookieHeader = cookies[0] || null;
      }

      if (!cookieHeader) {
        logger.warn('Vinted: no set-cookie header from homepage — proceeding without session cookie');
        return null;
      }

      const match = cookieHeader.match(/_vinted_\w+_session=([^;]+)/);
      if (!match) {
        logger.warn({ cookieHeader: cookieHeader.substring(0, 100) }, 'Vinted: session cookie pattern not found — proceeding without cookie');
        return null;
      }

      return match[1];
    } catch (err) {
      logger.warn({ err: err.message }, 'Vinted: error fetching session cookie — proceeding without cookie');
      return null;
    }
  }

  /**
   * Fetches listings from the Vinted API for a single keyword.
   * Handles 429, 403 (Cloudflare), 5xx, and network errors gracefully.
   * @param {string} keyword
   * @param {string|null} sessionCookie
   * @returns {Promise<import('./IScraper').Listing[]>}
   */
  async _fetchKeyword(keyword, sessionCookie) {
    const params = new URLSearchParams({
      search_text: keyword,
      per_page: '96',
      order: 'newest_first',
    });
    const url = `${API_URL}?${params}`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
    };
    if (sessionCookie) {
      headers['Cookie'] = `_vinted_fr_session=${sessionCookie}`;
    }

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      logger.error({ err: err.message, url }, 'Vinted: fetch error');
      return [];
    }

    const { status } = res;

    if (status === 429 || status >= 500) {
      logger.warn({ status, url }, 'Vinted: rate limited or server error — skipping keyword');
      return [];
    }

    if (status === 403) {
      const cfHeader = res.headers.get('cf-ray') || res.headers.get('cf-mitigated');
      logger.warn({ status, cloudflare: !!cfHeader, url }, 'Vinted: blocked — skipping keyword');
      return [];
    }

    if (!res.ok) {
      logger.warn({ status, url }, 'Vinted: non-200 response');
      return [];
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      logger.error({ err: err.message, url }, 'Vinted: JSON parse error');
      return [];
    }

    return this._parse(data.items || [], keyword);
  }

  /**
   * Normalizes raw Vinted API items into Listing objects.
   * Skips items with empty titles. Deduplicates by id.
   * @param {Object[]} items
   * @param {string} keyword
   * @returns {import('./IScraper').Listing[]}
   */
  _parse(items, keyword) {
    if (items.length > 0) {
      logger.info({ rawItem: items[0] }, 'Vinted raw item sample');
    }

    const seen = new Set();
    const listings = [];

    for (const item of items) {
      const id = 'vinted:' + item.id;
      if (seen.has(id)) continue;

      const title = String(item.title || '').substring(0, 250);
      if (!title.trim()) continue;

      seen.add(id);

      const price_sek = Math.round(parseFloat(item.price || '0'));
      const url = item.url || `https://www.vinted.se/items/${item.id}`;

      listings.push({
        id,
        marketplace: 'vinted',
        title,
        price_sek,
        url,
        category: classifyCategory(keyword),
        listingType: 'buy_now',
        auctionEndsAt: null,
      });
    }

    return listings;
  }
}

module.exports = { VintedScraper };
