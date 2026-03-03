'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');

/**
 * Idempotent migration — adds `dismissed INTEGER DEFAULT 0` to seen_listings if absent.
 * Called from alertSender.init() before any command handler fires.
 * Safe to run on a DB that already has the column (pragma check prevents double-ALTER).
 *
 * @param {import('better-sqlite3').Database} db
 */
function migrateDismissed(db) {
  const cols = db.pragma('table_info(seen_listings)');
  if (!cols.some(c => c.name === 'dismissed')) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN dismissed INTEGER DEFAULT 0');
    logger.info('Migration applied: seen_listings.dismissed added');
  }
}

/**
 * Handles the /dismiss slash command.
 * Marks the given listing_id as dismissed so it never triggers a future alert.
 * Replies ephemerally in all cases.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('better-sqlite3').Database} db
 */
async function handleDismiss(interaction, db) {
  const listingId = interaction.options.getString('listing_id');

  // Check the listing exists in seen_listings — dismissed listings that were never seen
  // would be a no-op anyway, but we surface a clear message
  const row = db.prepare('SELECT id, dismissed FROM seen_listings WHERE id = ?').get(listingId);

  if (!row) {
    return interaction.reply({
      content: `Listing \`${listingId}\` not found in seen listings. It may not have been scraped yet.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (row.dismissed === 1) {
    return interaction.reply({
      content: `Listing \`${listingId}\` is already dismissed.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare('UPDATE seen_listings SET dismissed = 1 WHERE id = ?').run(listingId);

  logger.info({ listingId }, 'listing dismissed via Discord command');
  return interaction.reply({
    content: `Listing \`${listingId}\` dismissed — it will not be alerted again.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { handleDismiss, migrateDismissed };
