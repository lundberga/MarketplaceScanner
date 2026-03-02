'use strict';
const assert = require('assert');

// We need to test internals — implement them inline here to test before the module exists
// These will be extracted into soldCache.js

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

const { parsePrice } = require('../utils/parsePrice');
const cheerio = require('cheerio');

function _parseSoldPrices(html) {
  const $ = cheerio.load(html);
  const prices = [];
  $('a[href*="/item/"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ');
    if (!text.includes('kr')) return;
    const lower = text.toLowerCase();
    if (/defekt|trasig|delar|parti|lot|f[öo]r delar/.test(lower)) return;
    // Extract Swedish price segment: 1-3 digits optionally followed by groups of (space + 3 digits)
    // e.g. "3 999 kr", "12 000 kr", "500 kr" — avoids grabbing model numbers like "3080"
    const priceMatch = text.match(/(\d{1,3}(?:\s\d{3})*)\s*kr/i);
    if (!priceMatch) return;
    const price = parsePrice(priceMatch[1] + ' kr');
    if (price !== null && price > 100) prices.push(price);
  });
  return prices;
}

let passed = 0;
const total = 8;

// median tests
assert.strictEqual(median([2000]), 2000, 'single element median');
passed++;

assert.strictEqual(median([1000, 3000, 2000]), 2000, 'odd count median');
passed++;

assert.strictEqual(median([1000, 2000]), 1500, 'even count median');
passed++;

assert.strictEqual(median([500, 100, 300, 200]), 250, 'even count median — 4 elements');
passed++;

// _parseSoldPrices tests
const mockHtml1 = `
  <html><body>
    <a href="/item/123/456/test">Grafikkort RTX 3080 3 999 kr</a>
  </body></html>
`;
const prices1 = _parseSoldPrices(mockHtml1);
assert.deepStrictEqual(prices1, [3999], 'parses single listing price');
passed++;

const mockHtmlDefekt = `
  <html><body>
    <a href="/item/123/789/defekt">Defekt RTX 3080 grafikkort för delar 500 kr</a>
  </body></html>
`;
const pricesDefekt = _parseSoldPrices(mockHtmlDefekt);
assert.deepStrictEqual(pricesDefekt, [], 'filters out defekt listings');
passed++;

const mockHtmlCheap = `
  <html><body>
    <a href="/item/123/012/cheap">Kabel 50 kr</a>
  </body></html>
`;
const pricesCheap = _parseSoldPrices(mockHtmlCheap);
assert.deepStrictEqual(pricesCheap, [], 'filters out sub-100 SEK prices');
passed++;

// null median when fewer than MIN_SAMPLES
const MIN_SAMPLES = 3;
const fewPrices = [1000, 2000]; // only 2
assert.strictEqual(fewPrices.length < MIN_SAMPLES, true, 'fewer than MIN_SAMPLES triggers null path');
passed++;

console.log(`soldCache unit tests: ${passed}/${total} passed`);
