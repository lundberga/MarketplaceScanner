'use strict';

/**
 * Parses Swedish price strings to integer SEK.
 * Handles: "3 999 kr", "2 500:-", "2500 SEK", "1 200,00 kr", "kr/st 150 kr"
 * Returns null if no valid price found.
 * @param {string} raw
 * @returns {number|null}
 */
function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw
    .replace(/kr\/st/gi, '')       // remove "kr/st" unit prefix before stripping "kr"
    .replace(/kr|SEK|:-/gi, '')    // remove currency suffixes
    .replace(/,\d{2}/, '')         // strip decimal: "2500,00" → "2500"
    .replace(/\./g, '')            // strip period thousands separator
    .replace(/\s/g, '');           // strip all whitespace (Swedish thousands sep is space)
  const match = cleaned.match(/(\d+)/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return isNaN(value) ? null : value;
}

module.exports = { parsePrice };
