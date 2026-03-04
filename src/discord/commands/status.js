'use strict';

const { MessageFlags, EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

/**
 * Handles the /status slash command.
 * Shows scan health: active filters, total listings seen, and per-marketplace last scan stats.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('better-sqlite3').Database} db
 */
async function handleStatus(interaction, db) {
  const filterCount = db.prepare('SELECT COUNT(*) AS n FROM thresholds WHERE active = 1').get().n;
  const listingCount = db.prepare('SELECT COUNT(*) AS n FROM seen_listings').get().n;

  const scans = db.prepare(`
    SELECT marketplace,
           MAX(started_at) AS last_scan,
           MAX(completed_at) - MAX(started_at) AS duration_s,
           (SELECT listings_found FROM scan_log s2 WHERE s2.marketplace = s.marketplace ORDER BY started_at DESC LIMIT 1) AS listings,
           (SELECT deals_alerted FROM scan_log s2 WHERE s2.marketplace = s.marketplace ORDER BY started_at DESC LIMIT 1) AS deals,
           (SELECT error FROM scan_log s2 WHERE s2.marketplace = s.marketplace ORDER BY started_at DESC LIMIT 1) AS last_error
    FROM scan_log s GROUP BY marketplace ORDER BY marketplace
  `).all();

  const embed = new EmbedBuilder()
    .setTitle('Scanner Status')
    .setColor(0x5865F2)
    .setDescription(`**${filterCount}** active filters | **${listingCount.toLocaleString('sv-SE')}** listings seen`)
    .setTimestamp();

  if (scans.length === 0) {
    embed.addFields({ name: 'Scans', value: 'No scan data yet.', inline: false });
  } else {
    for (const s of scans) {
      const lastScanStr = s.last_scan
        ? new Date(s.last_scan * 1000).toLocaleString('sv-SE')
        : '—';
      const durationStr = s.duration_s != null ? `${s.duration_s}s` : '—';
      const listingsStr = s.listings != null ? String(s.listings) : '—';
      const dealsStr = s.deals != null ? String(s.deals) : '—';
      const errorStr = s.last_error ? ` ⚠️ ${s.last_error}` : '';

      embed.addFields({
        name: s.marketplace,
        value: `Last: ${lastScanStr} (${durationStr}) | found: ${listingsStr} | deals: ${dealsStr}${errorStr}`,
        inline: false,
      });
    }
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { handleStatus };
