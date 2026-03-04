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
const { parseAuctionEnd } = require('../utils/parseAuctionEnd');

const MARKETPLACE_COLORS = {
  tradera:     0x3498DB,  // Blue
  blocket:     0x57F287,  // Green
  vinted:      0x1ABC9C,  // Teal
  sweclockers: 0xE67E22,  // Orange
};

function filterUnalerted(alerts, db) {
  return alerts.filter(alert => {
    const row = db.prepare(
      'SELECT alerted_at, dismissed FROM seen_listings WHERE id = ?'
    ).get(alert.listing.id);
    // Exclude if not found, already alerted, or dismissed
    return row
      && row.alerted_at === null
      && (row.dismissed === 0 || row.dismissed === null);
  });
}

function buildEmbed(alert) {
  const { listing, threshold, estimatedMargin, sampleCount } = alert;
  const color = MARKETPLACE_COLORS[listing.marketplace] || 0x99AAB5;
  const isAuction = listing.listingType === 'auction';

  // Title: listing type header
  const typeLabel = isAuction ? '✅ AUCTION Listing' : '✅ BUY IT NOW Listing';

  // Description: item title + price + marketplace
  const priceFmt = listing.price_sek.toLocaleString('sv-SE');
  const description = `**${listing.title.slice(0, 200)}** (${priceFmt} SEK) [${listing.marketplace}]`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(typeLabel)
    .setURL(listing.url)
    .setDescription(description)
    .setTimestamp();

  // 💰 Price field
  const priceLabel = isAuction ? `Current Bid: ${priceFmt} SEK` : `Price: ${priceFmt} SEK`;
  embed.addFields({ name: '💰 Price', value: priceLabel, inline: false });

  // 🔥 Below target — only shown when price is under max_price
  if (threshold && threshold.max_price !== null && listing.price_sek < threshold.max_price) {
    const savings = threshold.max_price - listing.price_sek;
    const pct = ((savings / threshold.max_price) * 100).toFixed(1);
    embed.addFields({
      name: `🔥 ${pct}% below target`,
      value: `${savings.toLocaleString('sv-SE')} SEK cheaper than max (${threshold.max_price.toLocaleString('sv-SE')} SEK)`,
      inline: false,
    });
  }

  // 🔍 Search Term
  const searchTerm = threshold?.search_term || threshold?.name || '—';
  embed.addFields({ name: '🔍 Search Term', value: searchTerm, inline: false });

  // ⏱️ Time Left — auctions only
  if (isAuction && listing.auctionEndsAt) {
    const endMs = parseAuctionEnd(listing.auctionEndsAt);
    if (endMs) {
      const diffMs = endMs - Date.now();
      const diffMins = Math.round(diffMs / 60000);
      const timeStr = diffMins <= 0
        ? 'Ending now'
        : diffMins < 60
          ? `${diffMins}m left`
          : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m left`;
      embed.addFields({ name: '⏱️ Time Left', value: `${timeStr} (ends ${listing.auctionEndsAt})`, inline: false });
    } else {
      embed.addFields({ name: '⏱️ Time Left', value: listing.auctionEndsAt, inline: false });
    }
  }

  // 📊 Margin — shown for both live comps and static estimates
  if (estimatedMargin !== null) {
    const { marginSource } = alert;
    const sourceTag = marginSource === 'live'
      ? `${sampleCount} sold comps`
      : 'est. market price';
    embed.addFields({
      name: '📊 Est. Margin',
      value: `~${Math.round(estimatedMargin).toLocaleString('sv-SE')} SEK (${sourceTag})`,
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
  await channel.send(`Bot online — ${count} active filters, next scan in ${interval} min`);
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
