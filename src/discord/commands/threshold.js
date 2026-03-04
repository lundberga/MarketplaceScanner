'use strict';

const { MessageFlags } = require('discord.js');
const { z } = require('zod');
const logger = require('../../utils/logger');

// --- Zod validation schemas ---

const ThresholdSetSchema = z.object({
  name:        z.string().min(1).max(100),
  max_price:   z.number().int().positive(),
  min_price:   z.number().int().min(0).optional(),
  category:    z.enum(['gpu', 'cpu', 'ram', 'storage']).optional(),
  keywords:    z.string().optional(),
  min_margin:  z.number().min(0).max(1).optional(),
  marketplace: z.enum(['tradera', 'blocket', 'vinted', 'sweclockers']).optional(),
});

const ThresholdRemoveSchema = z.object({
  name: z.string().min(1).max(100),
});

// --- Subcommand handlers ---

async function thresholdSet(interaction, db) {
  const raw = {
    name:        interaction.options.getString('name'),
    max_price:   interaction.options.getInteger('max_price'),
    min_price:   interaction.options.getInteger('min_price') ?? undefined,
    category:    interaction.options.getString('category') ?? undefined,
    keywords:    interaction.options.getString('keywords') ?? undefined,
    min_margin:  interaction.options.getNumber('min_margin') ?? undefined,
    marketplace: interaction.options.getString('marketplace') ?? undefined,
  };

  const result = ThresholdSetSchema.safeParse(raw);
  if (!result.success) {
    const errors = Object.entries(result.error.flatten().fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('\n');
    return interaction.reply({ content: `Invalid input:\n${errors}`, flags: MessageFlags.Ephemeral });
  }

  const data = result.data;
  // INSERT always — two rows with same name is acceptable (both stay active).
  // To update an existing threshold: /threshold remove <name> then /threshold set <name>.
  db.prepare(`
    INSERT INTO thresholds (name, category, keywords, min_price, max_price, min_margin, marketplace, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    data.name,
    data.category    ?? null,
    data.keywords    ?? null,
    data.min_price   ?? null,
    data.max_price,
    data.min_margin  ?? null,
    data.marketplace ?? null,
    Math.floor(Date.now() / 1000)
  );

  logger.info({ name: data.name, min_price: data.min_price, max_price: data.max_price }, 'threshold set via Discord command');
  const priceRange = data.min_price
    ? `${data.min_price}–${data.max_price} SEK`
    : `max ${data.max_price} SEK`;
  return interaction.reply({
    content: `Threshold \`${data.name}\` set (${priceRange}).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function thresholdRemove(interaction, db) {
  const raw = { name: interaction.options.getString('name') };
  const result = ThresholdRemoveSchema.safeParse(raw);
  if (!result.success) {
    return interaction.reply({ content: 'Invalid name.', flags: MessageFlags.Ephemeral });
  }

  const info = db.prepare(
    'UPDATE thresholds SET active = 0 WHERE name = ? AND active = 1'
  ).run(result.data.name);

  if (info.changes === 0) {
    return interaction.reply({
      content: `No active threshold named \`${result.data.name}\` found.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  logger.info({ name: result.data.name, deactivated: info.changes }, 'threshold removed via Discord command');
  return interaction.reply({
    content: `Threshold \`${result.data.name}\` deactivated (${info.changes} row${info.changes !== 1 ? 's' : ''}).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function thresholdList(interaction, db) {
  const rows = db.prepare('SELECT * FROM thresholds WHERE active = 1 ORDER BY id').all();

  if (rows.length === 0) {
    return interaction.reply({ content: 'No active thresholds.', flags: MessageFlags.Ephemeral });
  }

  const lines = rows.map(r => {
    const priceRange = r.min_price ? `${r.min_price}–${r.max_price} SEK` : `max ${r.max_price} SEK`;
    let line = `[${r.id}] ${r.name} — ${priceRange}`;
    if (r.category)    line += ` | cat:${r.category}`;
    if (r.marketplace) line += ` | mkt:${r.marketplace}`;
    if (r.keywords)    line += ` | kw:${r.keywords}`;
    if (r.min_margin !== null && r.min_margin !== undefined) line += ` | margin:${r.min_margin}`;
    return line;
  });

  let body = '```\n' + lines.join('\n') + '\n```';
  // Guard against Discord 2000-char limit (should not happen for single-operator use)
  if (body.length > 1990) {
    body = body.slice(0, 1950) + '\n...(truncated)\n```';
  }

  return interaction.reply({ content: body, flags: MessageFlags.Ephemeral });
}

// --- Router ---

async function handleThreshold(interaction, db) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'set':    return thresholdSet(interaction, db);
    case 'remove': return thresholdRemove(interaction, db);
    case 'list':   return thresholdList(interaction, db);
    default:
      return interaction.reply({ content: `Unknown subcommand: ${sub}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { handleThreshold };
