'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');

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

module.exports = { handleDismiss };
