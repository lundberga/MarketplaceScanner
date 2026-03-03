'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');

// Valid marketplace names — must match runCycle.js scraper names and registerCommands.js choices.
// Discord enforces these at the UI level via addChoices(), so invalid values cannot arrive
// from normal usage. The validation here is a defensive safeguard.
const VALID_MARKETPLACES = new Set(['tradera', 'blocket', 'vinted', 'sweclockers']);

async function handlePause(interaction, db) {
  const marketplace = interaction.options.getString('marketplace');

  // Defensive guard — Discord choices should prevent this, but guard anyway
  if (!VALID_MARKETPLACES.has(marketplace)) {
    return interaction.reply({
      content: `Unknown marketplace \`${marketplace}\`. Valid options: ${[...VALID_MARKETPLACES].join(', ')}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Write pause state — INSERT OR REPLACE handles both first-time set and updates
  db.prepare('INSERT OR REPLACE INTO user_config (key, value) VALUES (?, ?)').run(
    `${marketplace}.paused`,
    'true'
  );

  logger.info({ marketplace }, 'scraper paused via Discord command');
  return interaction.reply({
    content: `\`${marketplace}\` scraper paused. The next scan cycle will skip it.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleResume(interaction, db) {
  const marketplace = interaction.options.getString('marketplace');

  // Defensive guard
  if (!VALID_MARKETPLACES.has(marketplace)) {
    return interaction.reply({
      content: `Unknown marketplace \`${marketplace}\`. Valid options: ${[...VALID_MARKETPLACES].join(', ')}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Delete the pause row — absence of the row means not paused (runCycle checks value === 'true')
  // Using DELETE is cleaner than setting value to 'false' — no stale rows accumulate.
  db.prepare('DELETE FROM user_config WHERE key = ?').run(`${marketplace}.paused`);

  logger.info({ marketplace }, 'scraper resumed via Discord command');
  return interaction.reply({
    content: `\`${marketplace}\` scraper resumed. The next scan cycle will include it.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { handlePause, handleResume };
