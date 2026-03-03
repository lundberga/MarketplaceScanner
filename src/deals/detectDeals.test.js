'use strict';
const assert = require('assert');
const Database = require('better-sqlite3');

// Helper: create an in-memory DB with the thresholds table
function makeDb(rows) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      keywords TEXT,
      max_price INTEGER,
      min_margin REAL,
      marketplace TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  if (rows && rows.length > 0) {
    const insert = db.prepare(
      'INSERT INTO thresholds (name, category, keywords, max_price, min_margin, marketplace, active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const r of rows) {
      insert.run(
        r.name || 'test',
        r.category ?? null,
        r.keywords ?? null,
        r.max_price ?? null,
        r.min_margin ?? null,
        r.marketplace ?? null,
        r.active !== undefined ? r.active : 1
      );
    }
  }
  return db;
}

// Stub lookupSoldPrice factories
function stubLookup({ medianPrice = null, sampleCount = 0 } = {}) {
  return async () => ({ medianPrice, sampleCount });
}

function throwingLookup() {
  return async () => { throw new Error('Simulated lookupSoldPrice failure'); };
}

// Helper: base buy_now listing
function makeListing(overrides) {
  return Object.assign({
    id: 'tradera:123',
    marketplace: 'tradera',
    title: 'RTX 3080 GPU',
    price_sek: 1000,
    url: 'https://www.tradera.com/item/1/123',
    category: 'gpu',
    listingType: 'buy_now',
    auctionEndsAt: null,
  }, overrides);
}

// Lazy require so tests run RED before detectDeals.js exists
let detectDeals;
try {
  ({ detectDeals } = require('./detectDeals'));
} catch (e) {
  // RED state: module doesn't exist yet
  detectDeals = null;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL: ${name} — ${e.message}`);
      failed++;
    }
  }

  function require_detectDeals() {
    if (!detectDeals) throw new Error('detectDeals module not found — RED state');
    return detectDeals;
  }

  // -------------------------------------------------------------------------
  // Group 1: Early-exit and empty-threshold cases
  // -------------------------------------------------------------------------

  await asyncTest('empty listings returns [] without querying DB', async () => {
    const fn = require_detectDeals();
    const db = makeDb([]);
    // If early exit works, DB is never queried — the empty threshold table is irrelevant
    const result = await fn([], db, stubLookup());
    assert.deepStrictEqual(result, []);
  });

  await asyncTest('listing with empty threshold DB returns []', async () => {
    const fn = require_detectDeals();
    const db = makeDb([]);
    const result = await fn([makeListing()], db, stubLookup());
    assert.deepStrictEqual(result, []);
  });

  await asyncTest('empty thresholds emits a warn-level log (stub logger.warn)', async () => {
    const fn = require_detectDeals();
    const logger = require('../utils/logger');
    let warnCalled = false;
    const origWarn = logger.warn.bind(logger);
    logger.warn = (...args) => { warnCalled = true; };
    const db = makeDb([]);
    await fn([makeListing()], db, stubLookup());
    logger.warn = origWarn;
    assert.strictEqual(warnCalled, true, 'logger.warn must be called when thresholds empty');
  });

  // -------------------------------------------------------------------------
  // Group 2: Threshold matching — price
  // -------------------------------------------------------------------------

  await asyncTest('listing price 1000 matches threshold max_price 1500 => one DealAlert', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: 'gpu', max_price: 1500 }]);
    const alerts = await fn([makeListing({ price_sek: 1000 })], db, stubLookup());
    assert.strictEqual(alerts.length, 1, 'should produce one alert');
  });

  await asyncTest('listing price 2000 does NOT match threshold max_price 1500 => []', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: 'gpu', max_price: 1500 }]);
    const alerts = await fn([makeListing({ price_sek: 2000 })], db, stubLookup());
    assert.deepStrictEqual(alerts, []);
  });

  // -------------------------------------------------------------------------
  // Group 3: Threshold matching — keywords
  // -------------------------------------------------------------------------

  await asyncTest('listing with title containing keyword passes keyword filter', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'rtx-deal', category: null, keywords: 'rtx 3080,rtx3080', max_price: 9999 }]);
    const alerts = await fn([makeListing({ title: 'RTX 3080 great card', category: 'gpu' })], db, stubLookup());
    assert.strictEqual(alerts.length, 1, 'title containing keyword must match');
  });

  await asyncTest('listing with non-matching title fails keyword filter => []', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'rtx-deal', category: null, keywords: 'rtx 3080,rtx3080', max_price: 9999 }]);
    const alerts = await fn([makeListing({ title: 'GTX 1060 cheap card', category: 'gpu' })], db, stubLookup());
    assert.deepStrictEqual(alerts, []);
  });

  // -------------------------------------------------------------------------
  // Group 4: Threshold matching — marketplace
  // -------------------------------------------------------------------------

  await asyncTest('listing marketplace=tradera passes threshold marketplace=tradera', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'tradera-gpu', category: null, marketplace: 'tradera', max_price: 9999 }]);
    const alerts = await fn([makeListing({ marketplace: 'tradera' })], db, stubLookup());
    assert.strictEqual(alerts.length, 1, 'marketplace match should produce alert');
  });

  await asyncTest('listing marketplace=blocket fails threshold marketplace=tradera => []', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'tradera-gpu', category: null, marketplace: 'tradera', max_price: 9999 }]);
    const alerts = await fn([makeListing({ marketplace: 'blocket' })], db, stubLookup());
    assert.deepStrictEqual(alerts, []);
  });

  // -------------------------------------------------------------------------
  // Group 5: Threshold matching — category wildcard
  // -------------------------------------------------------------------------

  await asyncTest('NULL category threshold matches listing with any category', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'any-cat', category: null, max_price: 9999 }]);
    const alerts = await fn([makeListing({ category: 'cpu' })], db, stubLookup());
    assert.strictEqual(alerts.length, 1, 'null category should match any category');
  });

  // -------------------------------------------------------------------------
  // Group 6: Auction filter
  // -------------------------------------------------------------------------

  await asyncTest('auction listing with auctionEndsAt=null is filtered before threshold check => []', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'any-deal', category: null, max_price: 9999 }]);
    const auctionListing = makeListing({ listingType: 'auction', auctionEndsAt: null });
    const alerts = await fn([auctionListing], db, stubLookup());
    assert.deepStrictEqual(alerts, []);
  });

  // -------------------------------------------------------------------------
  // Group 7: DealAlert struct shape and sold-comps enrichment
  // -------------------------------------------------------------------------

  await asyncTest('DealAlert.estimatedMargin = medianPrice - price_sek when comps available', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: 'gpu', max_price: 9999 }]);
    const listing = makeListing({ price_sek: 2000 });
    const lookup = stubLookup({ medianPrice: 3000, sampleCount: 5 });
    const alerts = await fn([listing], db, lookup);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].estimatedMargin, 1000, 'margin = 3000 - 2000 = 1000');
    assert.strictEqual(alerts[0].sampleCount, 5);
    assert.strictEqual(alerts[0].medianSoldPrice, 3000);
  });

  await asyncTest('DealAlert.estimatedMargin=null, sampleCount=0 when comps unavailable', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: 'gpu', max_price: 9999 }]);
    const listing = makeListing({ price_sek: 2000 });
    const lookup = stubLookup({ medianPrice: null, sampleCount: 0 });
    const alerts = await fn([listing], db, lookup);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].estimatedMargin, null);
    assert.strictEqual(alerts[0].sampleCount, 0);
    assert.strictEqual(alerts[0].medianSoldPrice, null);
  });

  // -------------------------------------------------------------------------
  // Group 8: min_margin checks
  // -------------------------------------------------------------------------

  await asyncTest('min_margin fails: medianPrice=3000 min_margin=0.3 => required=900; listing price=2200 (margin=800) => filtered out', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: null, max_price: 9999, min_margin: 0.3 }]);
    const listing = makeListing({ price_sek: 2200 });
    const lookup = stubLookup({ medianPrice: 3000, sampleCount: 5 });
    const alerts = await fn([listing], db, lookup);
    assert.deepStrictEqual(alerts, [], 'margin 800 < required 900 — must be filtered');
  });

  await asyncTest('min_margin skipped when comps unavailable: listing passes even with min_margin set', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: null, max_price: 9999, min_margin: 0.3 }]);
    const listing = makeListing({ price_sek: 2200 });
    const lookup = stubLookup({ medianPrice: null, sampleCount: 0 });
    const alerts = await fn([listing], db, lookup);
    assert.strictEqual(alerts.length, 1, 'no comps => min_margin check skipped => listing passes');
  });

  // -------------------------------------------------------------------------
  // Group 9: Error resilience
  // -------------------------------------------------------------------------

  await asyncTest('detectDeals never throws when lookupSoldPrice throws', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'gpu-deal', category: null, max_price: 9999 }]);
    const listing = makeListing();
    // Should NOT throw
    let result;
    try {
      result = await fn([listing], db, throwingLookup());
    } catch (e) {
      assert.fail(`detectDeals must never throw, but threw: ${e.message}`);
    }
    // The (listing, threshold) pair errored — the pair is skipped, returns []
    assert.deepStrictEqual(result, []);
  });

  await asyncTest('inner loop error skips only that pair; other pairs still produce alerts', async () => {
    const fn = require_detectDeals();
    // Two thresholds: first throws, second succeeds
    const db = makeDb([
      { name: 'bad-threshold', category: 'gpu', max_price: 9999 },
      { name: 'good-threshold', category: 'cpu', max_price: 9999 },
    ]);
    // Two listings: one matches bad-threshold (will throw), one matches good-threshold (succeeds)
    const gpuListing = makeListing({ id: 'tradera:1', category: 'gpu' });
    const cpuListing = makeListing({ id: 'tradera:2', category: 'cpu' });

    let callCount = 0;
    const selectiveLookup = async () => {
      callCount++;
      if (callCount === 1) throw new Error('First lookup fails');
      return { medianPrice: 2000, sampleCount: 4 };
    };

    const alerts = await fn([gpuListing, cpuListing], db, selectiveLookup);
    // The cpu listing with good-threshold should still produce an alert
    assert.strictEqual(alerts.length, 1, 'good pair should still produce alert despite first pair failing');
    assert.strictEqual(alerts[0].listing.id, 'tradera:2');
  });

  // -------------------------------------------------------------------------
  // Group 10: DealAlert struct shape verification
  // -------------------------------------------------------------------------

  await asyncTest('DealAlert has correct threshold sub-shape (id, name, max_price, min_margin)', async () => {
    const fn = require_detectDeals();
    const db = makeDb([{ name: 'shape-test', category: 'gpu', max_price: 5000, min_margin: 0.1 }]);
    const listing = makeListing({ price_sek: 1000 });
    const lookup = stubLookup({ medianPrice: 2000, sampleCount: 3 });
    const alerts = await fn([listing], db, lookup);
    assert.strictEqual(alerts.length, 1);
    const t = alerts[0].threshold;
    assert.ok(typeof t.id === 'number', 'threshold.id must be number');
    assert.strictEqual(t.name, 'shape-test');
    assert.strictEqual(t.max_price, 5000);
    assert.strictEqual(t.min_margin, 0.1);
    assert.strictEqual(alerts[0].listing, listing, 'listing must be the original object');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
