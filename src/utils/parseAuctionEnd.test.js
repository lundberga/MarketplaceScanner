'use strict';
const assert = require('assert');
const { parseAuctionEnd, passesAuctionFilter } = require('./parseAuctionEnd');

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

  // --- parseAuctionEnd tests ---

  syncTest('parseAuctionEnd(null) returns null', () => {
    assert.strictEqual(parseAuctionEnd(null), null);
  });

  syncTest('parseAuctionEnd("") returns null', () => {
    assert.strictEqual(parseAuctionEnd(''), null);
  });

  syncTest('parseAuctionEnd("not a date") returns null', () => {
    assert.strictEqual(parseAuctionEnd('not a date'), null);
  });

  syncTest('parseAuctionEnd("15 mars 13:00") returns a number (ms timestamp)', () => {
    // Use a nowMs fixed in March so year-boundary logic picks current year
    const nowMs = new Date(2026, 2, 10, 10, 0, 0, 0).getTime(); // 2026-03-10 10:00
    const result = parseAuctionEnd('15 mars 13:00', nowMs);
    assert.strictEqual(typeof result, 'number', 'should return a number');
    const d = new Date(result);
    assert.strictEqual(d.getFullYear(), 2026, 'year should be 2026');
    assert.strictEqual(d.getMonth(), 2, 'month index should be 2 (mars)');
    assert.strictEqual(d.getDate(), 15, 'day should be 15');
    assert.strictEqual(d.getHours(), 13, 'hour should be 13');
    assert.strictEqual(d.getMinutes(), 0, 'minute should be 0');
  });

  syncTest('parseAuctionEnd("31 december 23:50") called in January returns timestamp for December of current year (year-boundary)', () => {
    // nowMs is in January 2026 (month 0). December (month 11) is later in the year,
    // so candidate = Dec 31 2026 — it is in the future (not past), no year bump needed.
    // The year-boundary fix (bump when candidate is in the past) correctly leaves this as 2026.
    // passesAuctionFilter will return false since Dec 31 is > 2 hours away.
    const nowMs = new Date(2026, 0, 5, 12, 0, 0, 0).getTime(); // 2026-01-05 12:00
    const result = parseAuctionEnd('31 december 23:50', nowMs);
    assert.strictEqual(typeof result, 'number', 'should return a number');
    const d = new Date(result);
    // December 31 of the current year (2026) — still in the future from Jan 5
    assert.strictEqual(d.getFullYear(), 2026, 'year should be 2026 (next occurrence of Dec 31 from Jan)');
    assert.strictEqual(d.getMonth(), 11, 'month index should be 11 (december)');
    assert.strictEqual(d.getDate(), 31, 'day should be 31');
    assert.strictEqual(d.getHours(), 23, 'hour should be 23');
    assert.strictEqual(d.getMinutes(), 50, 'minute should be 50');
  });

  // --- passesAuctionFilter tests ---

  syncTest('passesAuctionFilter: buy_now with null auctionEndsAt returns true', () => {
    const listing = { listingType: 'buy_now', auctionEndsAt: null };
    assert.strictEqual(passesAuctionFilter(listing), true);
  });

  syncTest('passesAuctionFilter: auction with null auctionEndsAt returns false', () => {
    const listing = { listingType: 'auction', auctionEndsAt: null };
    assert.strictEqual(passesAuctionFilter(listing), false);
  });

  syncTest('passesAuctionFilter: auction with bad string auctionEndsAt returns false', () => {
    const listing = { listingType: 'auction', auctionEndsAt: 'bad string' };
    assert.strictEqual(passesAuctionFilter(listing), false);
  });

  syncTest('passesAuctionFilter: auction ending in 90 minutes returns true', () => {
    const nowMs = new Date(2026, 2, 10, 10, 0, 0, 0).getTime(); // 10:00
    // 90 minutes from now = 11:30
    const listing = { listingType: 'auction', auctionEndsAt: '10 mars 11:30' };
    assert.strictEqual(passesAuctionFilter(listing, nowMs), true);
  });

  syncTest('passesAuctionFilter: auction ending in 3 hours returns false', () => {
    const nowMs = new Date(2026, 2, 10, 10, 0, 0, 0).getTime(); // 10:00
    // 3 hours from now = 13:00
    const listing = { listingType: 'auction', auctionEndsAt: '10 mars 13:00' };
    assert.strictEqual(passesAuctionFilter(listing, nowMs), false);
  });

  syncTest('passesAuctionFilter: auction already ended (in the past) returns false', () => {
    const nowMs = new Date(2026, 2, 10, 10, 0, 0, 0).getTime(); // 10:00
    // ended at 9:00 same day
    const listing = { listingType: 'auction', auctionEndsAt: '10 mars 09:00' };
    assert.strictEqual(passesAuctionFilter(listing, nowMs), false);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
