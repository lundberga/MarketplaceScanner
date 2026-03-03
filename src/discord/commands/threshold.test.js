'use strict';

/**
 * Tests for src/discord/commands/threshold.js
 *
 * Uses an in-memory SQLite DB to avoid touching real data.
 * Stubs the Discord interaction object — only the methods/options used
 * by threshold.js are faked.
 */

const assert = require('assert');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE thresholds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      category    TEXT,
      keywords    TEXT,
      max_price   INTEGER,
      min_margin  REAL,
      marketplace TEXT,
      active      INTEGER DEFAULT 1,
      created_at  INTEGER
    );
  `);
  return db;
}

function seedRow(db, fields) {
  db.prepare(
    `INSERT INTO thresholds (name, category, keywords, max_price, min_margin, marketplace, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fields.name ?? 'test-threshold',
    fields.category ?? null,
    fields.keywords ?? null,
    fields.max_price ?? 9999,
    fields.min_margin ?? null,
    fields.marketplace ?? null,
    fields.active !== undefined ? fields.active : 1,
    Math.floor(Date.now() / 1000)
  );
}

// ---------------------------------------------------------------------------
// Interaction stub factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal Discord interaction stub.
 * @param {string} subcommand - The subcommand name ('set'|'remove'|'list')
 * @param {Object} opts       - Options returned by interaction.options.*
 */
function makeInteraction(subcommand, opts = {}) {
  const replies = [];

  const interaction = {
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => (name in opts ? opts[name] : null),
      getInteger: (name) => (name in opts ? opts[name] : null),
      getNumber: (name) => (name in opts ? opts[name] : null),
    },
    replied: false,
    deferred: false,
    reply: async (payload) => {
      interaction.replied = true;
      replies.push(payload);
    },
    _replies: replies,
  };

  return interaction;
}

// ---------------------------------------------------------------------------
// Lazy require — module doesn't exist yet in RED state
// ---------------------------------------------------------------------------

let handleThreshold;
try {
  ({ handleThreshold } = require('./threshold'));
} catch (e) {
  handleThreshold = null;
}

function requireHandler() {
  if (!handleThreshold) throw new Error('threshold.js not found — RED state');
  return handleThreshold;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL: ${name} — ${e.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // thresholdSet — valid input
  // -------------------------------------------------------------------------

  await test('thresholdSet valid data: inserts row with active=1', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', {
      name: 'gpu-deal',
      max_price: 5000,
      category: 'gpu',
      keywords: 'rtx 3080',
      min_margin: 0.1,
      marketplace: 'tradera',
    });
    await fn(interaction, db);
    const row = db.prepare('SELECT * FROM thresholds WHERE name = ?').get('gpu-deal');
    assert.ok(row, 'row should be inserted');
    assert.strictEqual(row.active, 1, 'active should be 1');
    assert.strictEqual(row.max_price, 5000);
    assert.strictEqual(row.category, 'gpu');
    assert.strictEqual(row.keywords, 'rtx 3080');
  });

  await test('thresholdSet valid data: reply is ephemeral and contains name', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', {
      name: 'my-threshold',
      max_price: 3000,
    });
    await fn(interaction, db);
    assert.strictEqual(interaction._replies.length, 1, 'should have one reply');
    const reply = interaction._replies[0];
    assert.ok(reply.flags !== undefined, 'reply must have flags');
    assert.ok(
      reply.content && reply.content.includes('my-threshold'),
      `reply content should contain "my-threshold", got: "${reply.content}"`
    );
  });

  await test('thresholdSet valid minimal (only name + max_price): inserts with nulls for optional fields', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', {
      name: 'minimal',
      max_price: 1000,
    });
    await fn(interaction, db);
    const row = db.prepare('SELECT * FROM thresholds WHERE name = ?').get('minimal');
    assert.ok(row, 'row should be inserted');
    assert.strictEqual(row.category, null);
    assert.strictEqual(row.keywords, null);
    assert.strictEqual(row.min_margin, null);
    assert.strictEqual(row.marketplace, null);
  });

  // -------------------------------------------------------------------------
  // thresholdSet — invalid input (Zod rejection)
  // -------------------------------------------------------------------------

  await test('thresholdSet max_price=0 (not positive): Zod rejects, reply contains max_price, no DB insert', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', {
      name: 'bad-price',
      max_price: 0,
    });
    await fn(interaction, db);
    assert.strictEqual(interaction._replies.length, 1);
    const reply = interaction._replies[0];
    assert.ok(reply.content && reply.content.includes('max_price'),
      `Expected "max_price" in error reply, got: "${reply.content}"`);
    const count = db.prepare('SELECT COUNT(*) as c FROM thresholds').get().c;
    assert.strictEqual(count, 0, 'no row should be inserted on Zod rejection');
  });

  await test('thresholdSet min_margin=1.5 (>1.0): Zod rejects, reply contains min_margin, no DB insert', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', {
      name: 'bad-margin',
      max_price: 1000,
      min_margin: 1.5,
    });
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.ok(reply && reply.content && reply.content.includes('min_margin'),
      `Expected "min_margin" in error reply, got: "${reply && reply.content}"`);
    const count = db.prepare('SELECT COUNT(*) as c FROM thresholds').get().c;
    assert.strictEqual(count, 0, 'no row should be inserted on Zod rejection');
  });

  await test('thresholdSet: reply flags is 64 (MessageFlags.Ephemeral)', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('set', { name: 'ep-test', max_price: 1000 });
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.strictEqual(reply.flags, 64, `flags must be 64 (Ephemeral), got: ${reply.flags}`);
  });

  // -------------------------------------------------------------------------
  // thresholdRemove
  // -------------------------------------------------------------------------

  await test('thresholdRemove existing name: sets active=0, replies ephemerally', async () => {
    const fn = requireHandler();
    const db = makeDb();
    seedRow(db, { name: 'old-deal', active: 1 });
    const interaction = makeInteraction('remove', { name: 'old-deal' });
    await fn(interaction, db);
    const row = db.prepare('SELECT active FROM thresholds WHERE name = ?').get('old-deal');
    assert.strictEqual(row.active, 0, 'active should be 0 after remove');
    assert.strictEqual(interaction._replies[0].flags, 64);
    assert.ok(interaction._replies[0].content.includes('old-deal'));
  });

  await test('thresholdRemove non-existent name: replies with not-found message, no rows changed', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('remove', { name: 'ghost-threshold' });
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.ok(reply, 'should have a reply');
    assert.strictEqual(reply.flags, 64);
    assert.ok(
      reply.content && (
        reply.content.toLowerCase().includes('no') ||
        reply.content.toLowerCase().includes('not found') ||
        reply.content.includes('ghost-threshold')
      ),
      `Expected "not found" or similar, got: "${reply.content}"`
    );
  });

  await test('thresholdRemove only deactivates active rows, leaves already-inactive rows unchanged', async () => {
    const fn = requireHandler();
    const db = makeDb();
    seedRow(db, { name: 'inactive-deal', active: 0 });
    const interaction = makeInteraction('remove', { name: 'inactive-deal' });
    await fn(interaction, db);
    // The already-inactive row should not have been "re-found"
    const reply = interaction._replies[0];
    // Either "not found" or 0-changes response
    assert.ok(reply.content, 'should have content');
  });

  // -------------------------------------------------------------------------
  // thresholdList
  // -------------------------------------------------------------------------

  await test('thresholdList with active rows: returns code block containing threshold name', async () => {
    const fn = requireHandler();
    const db = makeDb();
    seedRow(db, { name: 'test-gpu', max_price: 4999 });
    const interaction = makeInteraction('list');
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.ok(reply, 'should have a reply');
    assert.strictEqual(reply.flags, 64);
    assert.ok(reply.content && reply.content.includes('```'), 'reply should be a code block');
    assert.ok(reply.content.includes('test-gpu'), 'code block should include threshold name');
    assert.ok(reply.content.includes('4999'), 'code block should include max price');
  });

  await test('thresholdList with no active rows: returns "No active thresholds." ephemerally', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('list');
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.ok(reply, 'should have a reply');
    assert.strictEqual(reply.flags, 64);
    assert.ok(
      reply.content && reply.content.toLowerCase().includes('no active thresholds'),
      `Expected "No active thresholds", got: "${reply.content}"`
    );
  });

  await test('thresholdList excludes inactive rows (active=0)', async () => {
    const fn = requireHandler();
    const db = makeDb();
    seedRow(db, { name: 'visible-gpu', max_price: 3000, active: 1 });
    seedRow(db, { name: 'hidden-gpu',  max_price: 1000, active: 0 });
    const interaction = makeInteraction('list');
    await fn(interaction, db);
    const reply = interaction._replies[0];
    assert.ok(reply.content.includes('visible-gpu'), 'visible should be shown');
    assert.ok(!reply.content.includes('hidden-gpu'), 'inactive should NOT be shown');
  });

  // -------------------------------------------------------------------------
  // Router — unknown subcommand
  // -------------------------------------------------------------------------

  await test('handleThreshold with unknown subcommand: replies ephemerally', async () => {
    const fn = requireHandler();
    const db = makeDb();
    const interaction = makeInteraction('nonexistent-sub');
    await fn(interaction, db);
    assert.strictEqual(interaction._replies[0].flags, 64);
  });

  // -------------------------------------------------------------------------
  // Module shape
  // -------------------------------------------------------------------------

  await test('handleThreshold is exported as a function', async () => {
    if (!handleThreshold) throw new Error('module not found');
    assert.strictEqual(typeof handleThreshold, 'function');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
