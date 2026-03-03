'use strict';

const { Events, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

// Per-command handlers — each in its own module for clean file ownership
// Plans 08-02/03/04 create these files; require() calls are deferred so startup
// does not fail before those files exist. Use lazy require inside the handler.

async function init(client, db) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
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
