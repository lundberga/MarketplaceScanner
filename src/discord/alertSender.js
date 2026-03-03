'use strict';

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require('discord.js');
const logger = require('../utils/logger');

const MARKETPLACE_COLORS = {
  tradera:     0x3498DB,  // Blue
  blocket:     0x57F287,  // Green
  vinted:      0x1ABC9C,  // Teal
  sweclockers: 0xE67E22,  // Orange
};

function migrateAlertedAt(db) {
  const cols = db.pragma('table_info(seen_listings)');
  if (!cols.some(c => c.name === 'alerted_at')) {
    db.exec('ALTER TABLE seen_listings ADD COLUMN alerted_at INTEGER');
    logger.info('Migration applied: seen_listings.alerted_at added');
  }
}

function filterUnalerted(alerts, db) {
  return alerts.filter(alert => {
    const row = db.prepare('SELECT alerted_at FROM seen_listings WHERE id = ?').get(alert.listing.id);
    return row && row.alerted_at === null;
  });
}

function buildEmbed(alert) {
  const { listing, estimatedMargin, sampleCount } = alert;
  const color = MARKETPLACE_COLORS[listing.marketplace] || 0x99AAB5;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(listing.title.slice(0, 256))
    .addFields({ name: 'Pris', value: `${listing.price_sek} SEK`, inline: true })
    .addFields({ name: 'Källa', value: listing.marketplace, inline: true })
    .addFields({ name: 'Kategori', value: listing.category || '—', inline: true })
    .setTimestamp();

  if (estimatedMargin !== null && sampleCount !== null) {
    embed.addFields({
      name: 'Marginal',
      value: `~${Math.round(estimatedMargin).toLocaleString('sv-SE')} SEK (${sampleCount} comps)`,
      inline: false,
    });
  }

  return embed;
}

function buildRow(url) {
  const button = new ButtonBuilder()
    .setLabel('Visa annons')
    .setURL(url)
    .setStyle(ButtonStyle.Link);
  return new ActionRowBuilder().addComponents(button);
}

async function _sendOne(alert, channel, db) {
  const embed = buildEmbed(alert);
  const row = buildRow(alert.listing.url);
  try {
    await channel.send({ embeds: [embed], components: [row] });
    // markAlerted AFTER successful send — never before
    db.prepare('UPDATE seen_listings SET alerted_at = unixepoch() WHERE id = ?')
      .run(alert.listing.id);
  } catch (err) {
    logger.warn({ err: err.message, listingId: alert.listing.id }, 'alertSender: send failed');
    // Do NOT mark alerted on failure
  }
}

async function sendStartupMessage(channel, db) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM thresholds WHERE active = 1').get();
  const count = row ? row.cnt : 0;
  const interval = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);
  await channel.send(`Bot online — ${count} thresholds active, next scan in ${interval} min`);
}

class AlertQueue {
  constructor(sendFn) {
    this._send = sendFn;
    this._queue = [];
    this._draining = false;
  }

  enqueue(alerts, db) {
    // Filter already-alerted before pushing
    const unalerted = filterUnalerted(alerts, db);
    if (unalerted.length === 0) return;
    this._queue.push(...unalerted);
    if (!this._draining) this._drain();
  }

  async _drain() {
    this._draining = true;
    while (this._queue.length > 0) {
      const alert = this._queue.shift();
      await this._send(alert);
      if (this._queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    this._draining = false;
  }
}

async function init(db) {
  migrateAlertedAt(db);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(process.env.DISCORD_TOKEN);
  });

  let channel;
  try {
    channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  } catch (err) {
    logger.error({ err: err.message }, 'alertSender: failed to fetch Discord channel');
    throw err;
  }

  const queue = new AlertQueue((alert) => _sendOne(alert, channel, db));

  return {
    enqueue: (alerts) => queue.enqueue(alerts, db),
    sendStartupMessage: () => sendStartupMessage(channel, db),
    client,  // Exposed so commandHandler.init(client, db) can attach interactionCreate listener
  };
}

module.exports = { init };
