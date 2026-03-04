'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');

/**
 * Handles the /scan slash command.
 * Triggers an immediate scan cycle without waiting for the next cron tick.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ safeCycle: function }} ctx
 */
async function handleScan(interaction, { safeCycle }) {
  await interaction.reply({ content: 'Scan triggered.', flags: MessageFlags.Ephemeral });
  safeCycle().catch(err => logger.error({ err: err.message }, '/scan cycle error'));
}

module.exports = { handleScan };
