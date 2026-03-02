'use strict';
const assert = require('assert');
const Database = require('better-sqlite3');

// Create isolated in-memory DB for tests
const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
testDb.exec(`
  CREATE TABLE seen_listings (
    id TEXT PRIMARY KEY,
    marketplace TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    title TEXT,
    price_sek INTEGER
  );
  CREATE INDEX idx_seen_marketplace ON seen_listings(marketplace);
`);

// Temporarily replace the module's db with testDb by monkey-patching require cache
// Load the module under test with the test DB injected
const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith('db/index') || request.endsWith('db\\index')) return testDb;
  return origLoad.apply(this, arguments);
};
const { filterAndMarkSeen, countSeen } = require('./seenListings');
Module._load = origLoad; // restore

const makeListings = (ids) => ids.map(id => ({
  id: `tradera:${id}`,
  marketplace: 'tradera',
  title: `Listing ${id}`,
  price_sek: 1000,
  url: `https://www.tradera.com/item/1/${id}/test`,
  category: 'gpu',
  listingType: 'buy_now',
  auctionEndsAt: null,
}));

let passed = 0;
const total = 7;

// Test 1: empty input
assert.deepStrictEqual(filterAndMarkSeen([]), [], 'empty input returns []');
passed++;

// Test 2: first call inserts and returns all
const batch1 = makeListings(['aaa', 'bbb']);
const result1 = filterAndMarkSeen(batch1);
assert.strictEqual(result1.length, 2, 'first call returns all 2 novel listings');
passed++;

// Test 3: second call on same IDs returns []
const result2 = filterAndMarkSeen(batch1);
assert.strictEqual(result2.length, 0, 'second call on same IDs returns []');
passed++;

// Test 4: mixed batch — only novel returned
const batch2 = makeListings(['aaa', 'ccc']); // aaa is seen, ccc is new
const result3 = filterAndMarkSeen(batch2);
assert.strictEqual(result3.length, 1, 'only novel listing returned');
assert.strictEqual(result3[0].id, 'tradera:ccc', 'correct novel listing returned');
passed++;

// Test 5: countSeen returns 0 for unknown marketplace
assert.strictEqual(countSeen('blocket'), 0, 'countSeen returns 0 for unseen marketplace');
passed++;

// Test 6: countSeen returns correct count after inserts
assert.strictEqual(countSeen('tradera'), 3, 'countSeen returns 3 after inserting aaa, bbb, ccc');
passed++;

// Test 7: third call returns [] (no double-insert error)
const result4 = filterAndMarkSeen(makeListings(['aaa', 'bbb', 'ccc']));
assert.strictEqual(result4.length, 0, 'third call returns [] — INSERT OR IGNORE works');
passed++;

console.log(`seenListings: ${passed}/${total} tests passed`);
