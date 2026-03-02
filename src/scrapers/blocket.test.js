'use strict';
const assert = require('assert');
const { BlocketScraper } = require('./blocket');
const logger = require('../utils/logger');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function syncTest(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${name} — ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${name} — ${err.message}`);
      failed++;
    }
  }

  // Test 1: _parse() on empty HTML returns []
  syncTest('_parse() on empty HTML string returns []', () => {
    const scraper = new BlocketScraper();
    const result = scraper._parse('', 'rtx 3080');
    assert.deepStrictEqual(result, []);
  });

  // Test 2: _parse() on HTML with one valid sf-search-ad-link article
  syncTest('_parse() returns one Listing with correct fields from valid HTML', () => {
    const scraper = new BlocketScraper();
    const html = `
      <article>
        <a class="sf-search-ad-link" id="21205286" href="/recommerce/forsale/item/21205286/rtx-3080">
          <span aria-hidden="true">hidden text</span>
          RTX 3080
        </a>
        <div class="font-bold"><span>9 000 kr</span></div>
      </article>
    `;
    const result = scraper._parse(html, 'rtx 3080');
    assert.strictEqual(result.length, 1, 'should return one listing');
    const l = result[0];
    assert(l.id.startsWith('blocket:'), 'id must start with blocket:');
    assert.strictEqual(l.id, 'blocket:21205286');
    assert.strictEqual(l.marketplace, 'blocket');
    assert.strictEqual(l.listingType, 'buy_now');
    assert.strictEqual(l.auctionEndsAt, null);
    assert.strictEqual(typeof l.price_sek, 'number');
  });

  // Test 3: scrape() with empty keyword list returns [] and does NOT fire canary warn
  await asyncTest('scrape() with empty keywords returns [] without canary warn', async () => {
    const scraper = new BlocketScraper();
    let warnCalled = false;
    const origWarn = logger.warn;
    logger.warn = (...args) => { warnCalled = true; };
    const result = await scraper.scrape([]);
    logger.warn = origWarn;
    assert.deepStrictEqual(result, []);
    assert.strictEqual(warnCalled, false, 'canary warn must not fire for empty keywords');
  });

  // Test 4 (canary): scrape() with keywords but zero results fires logger.warn with 'Blocket canary'
  await asyncTest('canary: logger.warn fires with Blocket canary when results empty with keywords', async () => {
    const scraper = new BlocketScraper();
    scraper._fetchKeyword = async () => [];
    let warnMessage = null;
    const origWarn = logger.warn;
    logger.warn = (obj, msg) => { warnMessage = msg; };
    await scraper.scrape(['rtx 3080']);
    logger.warn = origWarn;
    assert(warnMessage !== null, 'logger.warn should have been called');
    assert(warnMessage.includes('Blocket canary'), `warn message should contain 'Blocket canary', got: ${warnMessage}`);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
