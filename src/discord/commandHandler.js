'use strict';

const { Events, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

// Per-command handlers — each in its own module for clean file ownership

async function init(client, db, ctx = {}) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'filter': {
          const { handleFilter } = require('./commands/filter');
          return await handleFilter(interaction, db);
        }
        case 'threshold': {
          const { handleThreshold } = require('./commands/threshold');
          return await handleThreshold(interaction, db);
        }
        case 'pause': {
          const { handlePause } = require('./commands/pause');
          return await handlePause(interaction, db);
        }
        case 'resume': {
          const { handleResume } = require('./commands/pause');
          return await handleResume(interaction, db);
        }
        case 'dismiss': {
          const { handleDismiss } = require('./commands/dismiss');
          return await handleDismiss(interaction, db);
        }
        case 'scan': {
          const { handleScan } = require('./commands/scan');
          return await handleScan(interaction, ctx);
        }
        case 'status': {
          const { handleStatus } = require('./commands/status');
          return await handleStatus(interaction, db);
        }
        default:
          logger.warn({ command: interaction.commandName }, 'commandHandler: unknown command');
      }
    } catch (err) {
      logger.error({ err: err.message, command: interaction.commandName }, 'commandHandler: unhandled error');
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Internal error.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  logger.info('commandHandler: interactionCreate listener registered');
}

module.exports = { init };
