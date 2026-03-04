'use strict';
const db = require('../db/index');
const logger = require('../utils/logger');

/**
 * Filters listings to only those not already in seen_listings.
 * Inserts novel listings atomically in a single transaction.
 * Uses INSERT OR IGNORE — safe to call with duplicates, never throws on conflict.
 * @param {import('../scrapers/IScraper').Listing[]} listings
 * @returns {import('../scrapers/IScraper').Listing[]} novel (unseen) listings only
 */
function filterAndMarkSeen(listings) {
  if (listings.length === 0) return [];

  const ids = listings.map(l => l.id);

  // Build parameterized IN clause
  const placeholders = ids.map(() => '?').join(',');
  const seenRows = db.prepare(
    `SELECT id FROM seen_listings WHERE id IN (${placeholders})`
  ).all(ids);
  const seenSet = new Set(seenRows.map(r => r.id));

  const novel = listings.filter(l => !seenSet.has(l.id));
  if (novel.length === 0) return [];

  // Insert novel listings atomically — INSERT OR IGNORE handles any race-condition duplicates
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO seen_listings (id, marketplace, first_seen, title, price_sek, url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((items) => {
    const now = Math.floor(Date.now() / 1000);
    for (const l of items) {
      insertStmt.run(l.id, l.marketplace, now, l.title || null, l.price_sek || null, l.url ?? null);
    }
  });
  insertAll(novel);

  logger.info({ total: listings.length, novel: novel.length }, 'Dedup: novel listings filtered');
  return novel;
}

/**
 * Returns the count of rows in seen_listings for a given marketplace.
 * Used for seed-mode detection: if 0, this is a cold start.
 * @param {string} marketplace - e.g. 'tradera'
 * @returns {number}
 */
function countSeen(marketplace) {
  const row = db.prepare(
    'SELECT COUNT(*) AS cnt FROM seen_listings WHERE marketplace = ?'
  ).get(marketplace);
  return row ? row.cnt : 0;
}

const PRUNE_TTL_DAYS = 90;

function pruneOldListings(db) {
  const cutoff = Math.floor(Date.now() / 1000) - (PRUNE_TTL_DAYS * 86400);
  const info = db.prepare('DELETE FROM seen_listings WHERE first_seen < ?').run(cutoff);
  if (info.changes > 0) {
    logger.info({ deleted: info.changes, cutoff_days: PRUNE_TTL_DAYS }, 'Pruned old seen_listings');
  }
}

module.exports = { filterAndMarkSeen, countSeen, pruneOldListings };
