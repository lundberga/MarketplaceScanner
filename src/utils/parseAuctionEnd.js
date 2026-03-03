'use strict';

const SWEDISH_MONTHS = {
  januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
  juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Parses a raw Swedish auction-end string to a Unix timestamp (ms).
 * Format: "15 mars 13:00" (day month HH:MM, no year — assumes current year).
 * Returns null if the string cannot be parsed.
 * Year-boundary: if the resulting candidate date is more than 60 seconds in
 * the past, the year is incremented by 1 (handles e.g. December parsed in January).
 *
 * @param {string|null} raw
 * @param {number} [nowMs] - Override for current time (for testing). Defaults to Date.now().
 * @returns {number|null}
 */
function parseAuctionEnd(raw, nowMs) {
  if (!raw || typeof raw !== 'string') return null;

  const match = raw.trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const hour = parseInt(match[3], 10);
  const minute = parseInt(match[4], 10);

  const monthIndex = SWEDISH_MONTHS[monthStr];
  if (monthIndex === undefined) return null;

  const now = nowMs !== undefined ? nowMs : Date.now();
  const nowDate = new Date(now);
  let year = nowDate.getFullYear();

  const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);

  // Year-boundary fix: if candidate is more than 60 seconds in the past, push to next year
  if (candidate.getTime() < now - 60_000) {
    year += 1;
    candidate.setFullYear(year);
  }

  return candidate.getTime();
}

/**
 * Returns true if the listing passes the auction filter.
 * - buy_now listings always pass.
 * - auction listings pass only if auctionEndsAt parses to a valid timestamp
 *   AND ends within 2 hours from nowMs (i.e. endsAt > nowMs AND endsAt - nowMs <= TWO_HOURS_MS).
 *
 * @param {Object} listing - must have listingType {string} and auctionEndsAt {string|null} fields
 * @param {number} [nowMs] - Override for current time (for testing). Defaults to Date.now().
 * @returns {boolean}
 */
function passesAuctionFilter(listing, nowMs) {
  if (listing.listingType === 'buy_now') return true;

  const now = nowMs !== undefined ? nowMs : Date.now();
  const endsAt = parseAuctionEnd(listing.auctionEndsAt, now);

  if (endsAt === null) return false;

  // Must end in the future and within 2 hours
  return endsAt > now && (endsAt - now) <= TWO_HOURS_MS;
}

module.exports = { parseAuctionEnd, passesAuctionFilter };
