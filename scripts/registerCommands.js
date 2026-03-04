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

const filterCmd = new SlashCommandBuilder()
  .setName('filter')
  .setDescription('Manage deal filters')
  .addSubcommand(sub => sub.setName('add')
    .setDescription('Add a new deal filter')
    .addStringOption(opt => opt.setName('name').setDescription('Filter label').setRequired(true))
    .addStringOption(opt => opt.setName('search').setDescription('Search term for scraper (e.g. "rtx 3080")').setRequired(true))
    .addIntegerOption(opt => opt.setName('max_price').setDescription('Max price SEK').setRequired(true).setMinValue(1))
    .addIntegerOption(opt => opt.setName('min_price').setDescription('Min price SEK (skip too-cheap listings)').setMinValue(0))
    .addStringOption(opt => opt.setName('keywords').setDescription('Extra comma-separated title keywords'))
    .addStringOption(opt => opt.setName('marketplace').setDescription('Limit to marketplace').addChoices(...MARKETPLACE_CHOICES))
    .addNumberOption(opt => opt.setName('min_margin').setDescription('Min profit margin 0.0–1.0').setMinValue(0).setMaxValue(1))
  )
  .addSubcommand(sub => sub.setName('list').setDescription('List all filters'))
  .addSubcommand(sub => sub.setName('remove')
    .setDescription('Remove a filter by ID')
    .addIntegerOption(opt => opt.setName('id').setDescription('Filter ID from /filter list').setRequired(true).setMinValue(1))
  )
  .addSubcommand(sub => sub.setName('edit')
    .setDescription('Edit an existing filter')
    .addIntegerOption(opt => opt.setName('id').setDescription('Filter ID').setRequired(true).setMinValue(1))
    .addStringOption(opt => opt.setName('name').setDescription('New label'))
    .addStringOption(opt => opt.setName('search').setDescription('New search term'))
    .addIntegerOption(opt => opt.setName('max_price').setDescription('New max price SEK').setMinValue(1))
    .addIntegerOption(opt => opt.setName('min_price').setDescription('New min price SEK').setMinValue(0))
    .addStringOption(opt => opt.setName('keywords').setDescription('New keywords (comma-separated)'))
    .addStringOption(opt => opt.setName('marketplace').setDescription('New marketplace').addChoices(...MARKETPLACE_CHOICES))
    .addNumberOption(opt => opt.setName('min_margin').setDescription('New margin').setMinValue(0).setMaxValue(1))
  )
  .addSubcommand(sub => sub.setName('toggle')
    .setDescription('Enable or disable a filter')
    .addIntegerOption(opt => opt.setName('id').setDescription('Filter ID').setRequired(true).setMinValue(1))
  )
  .addSubcommand(sub => sub.setName('test')
    .setDescription('Show recent seen listings that match this filter')
    .addIntegerOption(opt => opt.setName('id').setDescription('Filter ID').setRequired(true).setMinValue(1))
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

const scanCmd = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('Trigger an immediate scan cycle');

const statusCmd = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show scan health and per-marketplace last scan stats');

const commands = [filterCmd, scanCmd, statusCmd, pauseCmd, resumeCmd, dismissCmd].map(c => c.toJSON());

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
