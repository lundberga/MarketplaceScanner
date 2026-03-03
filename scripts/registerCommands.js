'use strict';
// Run once manually to register slash commands to the guild:
//   node scripts/registerCommands.js
// or: npm run register
//
// Uses guild-scoped registration for instant propagation (vs global = up to 1 hour delay).
// Requires env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const MARKETPLACE_CHOICES = [
  { name: 'tradera',     value: 'tradera' },
  { name: 'blocket',     value: 'blocket' },
  { name: 'vinted',      value: 'vinted' },
  { name: 'sweclockers', value: 'sweclockers' },
];

const thresholdCmd = new SlashCommandBuilder()
  .setName('threshold')
  .setDescription('Manage price thresholds')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Add a new price threshold')
      .addStringOption(opt => opt.setName('name').setDescription('Label for this threshold').setRequired(true))
      .addIntegerOption(opt => opt.setName('max_price').setDescription('Maximum price in SEK').setRequired(true))
      .addStringOption(opt =>
        opt.setName('category').setDescription('Hardware category').setRequired(false)
          .addChoices(
            { name: 'GPU', value: 'gpu' }, { name: 'CPU', value: 'cpu' },
            { name: 'RAM', value: 'ram' }, { name: 'Storage', value: 'storage' }
          )
      )
      .addStringOption(opt => opt.setName('keywords').setDescription('Comma-separated keywords').setRequired(false))
      .addNumberOption(opt =>
        opt.setName('min_margin').setDescription('Minimum profit margin (0.0–1.0)').setRequired(false)
          .setMinValue(0).setMaxValue(1)
      )
      .addStringOption(opt =>
        opt.setName('marketplace').setDescription('Limit to one marketplace').setRequired(false)
          .addChoices(...MARKETPLACE_CHOICES)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Deactivate a threshold by name')
      .addStringOption(opt => opt.setName('name').setDescription('Threshold name to deactivate').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list').setDescription('List all active thresholds')
  );

const pauseCmd = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause a marketplace scraper')
  .addStringOption(opt =>
    opt.setName('marketplace').setDescription('Which marketplace to pause').setRequired(true)
      .addChoices(...MARKETPLACE_CHOICES)
  );

const resumeCmd = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume a paused marketplace scraper')
  .addStringOption(opt =>
    opt.setName('marketplace').setDescription('Which marketplace to resume').setRequired(true)
      .addChoices(...MARKETPLACE_CHOICES)
  );

const dismissCmd = new SlashCommandBuilder()
  .setName('dismiss')
  .setDescription('Dismiss a listing so it is never re-alerted')
  .addStringOption(opt =>
    opt.setName('listing_id')
      .setDescription('Listing ID to dismiss (e.g. blocket:12345678)')
      .setRequired(true)
  );

const commands = [thresholdCmd, pauseCmd, resumeCmd, dismissCmd].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  if (!process.env.DISCORD_CLIENT_ID) {
    console.error('ERROR: DISCORD_CLIENT_ID is not set in .env');
    console.error('Find it: Discord Developer Portal → Your Application → General Information → Application ID');
    process.exit(1);
  }
  if (!process.env.GUILD_ID) {
    console.error('ERROR: GUILD_ID is not set in .env');
    process.exit(1);
  }

  console.log(`Registering ${commands.length} commands to guild ${process.env.GUILD_ID}...`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('Commands registered successfully. Changes propagate instantly (guild-scoped).');
})().catch(err => {
  console.error('Registration failed:', err.message);
  process.exit(1);
});
