'use strict';

const { MessageFlags, EmbedBuilder } = require('discord.js');
const { z } = require('zod');
const logger = require('../../utils/logger');

// --- Zod validation schemas ---

const FilterAddSchema = z.object({
  name:        z.string().min(1).max(100),
  search:      z.string().min(1).max(200),
  max_price:   z.number().int().positive(),
  min_price:   z.number().int().min(0).optional(),
  keywords:    z.string().optional(),
  marketplace: z.enum(['tradera', 'blocket', 'vinted', 'sweclockers']).optional(),
  min_margin:  z.number().min(0).max(1).optional(),
});

const FilterEditSchema = z.object({
  id:          z.number().int().positive(),
  name:        z.string().min(1).max(100).optional(),
  search:      z.string().min(1).max(200).optional(),
  max_price:   z.number().int().positive().optional(),
  min_price:   z.number().int().min(0).optional(),
  keywords:    z.string().optional(),
  marketplace: z.enum(['tradera', 'blocket', 'vinted', 'sweclockers']).optional(),
  min_margin:  z.number().min(0).max(1).optional(),
});

const FilterIdSchema = z.object({
  id: z.number().int().positive(),
});

// --- Subcommand handlers ---

async function filterAdd(interaction, db) {
  const raw = {
    name:        interaction.options.getString('name'),
    search:      interaction.options.getString('search'),
    max_price:   interaction.options.getInteger('max_price'),
    min_price:   interaction.options.getInteger('min_price') ?? undefined,
    keywords:    interaction.options.getString('keywords') ?? undefined,
    marketplace: interaction.options.getString('marketplace') ?? undefined,
    min_margin:  interaction.options.getNumber('min_margin') ?? undefined,
  };

  const result = FilterAddSchema.safeParse(raw);
  if (!result.success) {
    const errors = Object.entries(result.error.flatten().fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('\n');
    return interaction.reply({ content: `Invalid input:\n${errors}`, flags: MessageFlags.Ephemeral });
  }

  const data = result.data;
  const info = db.prepare(`
    INSERT INTO thresholds (name, search_term, keywords, min_price, max_price, min_margin, marketplace, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    data.name,
    data.search,
    data.keywords    ?? null,
    data.min_price   ?? null,
    data.max_price,
    data.min_margin  ?? null,
    data.marketplace ?? null,
    Math.floor(Date.now() / 1000)
  );

  const id = info.lastInsertRowid;
  logger.info({ id, name: data.name, search: data.search, max_price: data.max_price }, 'filter added via Discord command');

  const priceRange = data.min_price
    ? `${data.min_price}–${data.max_price} SEK`
    : `max ${data.max_price} SEK`;
  return interaction.reply({
    content: `Filter \`${data.name}\` added (ID: ${id}) — search: \`${data.search}\` | ${priceRange}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function filterList(interaction, db) {
  const rows = db.prepare(
    'SELECT * FROM thresholds ORDER BY active DESC, id ASC'
  ).all();

  if (rows.length === 0) {
    return interaction.reply({ content: 'No filters configured.', flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle('Deal Filters')
    .setColor(0x5865F2)
    .setTimestamp();

  for (const r of rows) {
    const status = r.active ? '✅' : '❌ (disabled)';
    const priceRange = r.min_price ? `${r.min_price}–${r.max_price} SEK` : `max ${r.max_price} SEK`;
    let detail = `search: ${r.search_term || '—'} | ${priceRange}`;
    if (r.marketplace) detail += ` | marketplace: ${r.marketplace}`;
    if (r.keywords)    detail += ` | kw: ${r.keywords}`;
    if (r.min_margin !== null && r.min_margin !== undefined) detail += ` | margin: ${r.min_margin}`;

    embed.addFields({
      name: `[${r.id}] ${r.name}  ${status}`,
      value: detail,
      inline: false,
    });
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function filterRemove(interaction, db) {
  const raw = { id: interaction.options.getInteger('id') };
  const result = FilterIdSchema.safeParse(raw);
  if (!result.success) {
    return interaction.reply({ content: 'Invalid ID.', flags: MessageFlags.Ephemeral });
  }

  const row = db.prepare('SELECT name, active FROM thresholds WHERE id = ?').get(result.data.id);
  if (!row) {
    return interaction.reply({ content: `No filter with ID ${result.data.id} found.`, flags: MessageFlags.Ephemeral });
  }

  db.prepare('UPDATE thresholds SET active = 0 WHERE id = ?').run(result.data.id);

  logger.info({ id: result.data.id, name: row.name }, 'filter removed via Discord command');
  return interaction.reply({
    content: `Filter \`${row.name}\` (ID: ${result.data.id}) removed.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function filterEdit(interaction, db) {
  const raw = {
    id:          interaction.options.getInteger('id'),
    name:        interaction.options.getString('name') ?? undefined,
    search:      interaction.options.getString('search') ?? undefined,
    max_price:   interaction.options.getInteger('max_price') ?? undefined,
    min_price:   interaction.options.getInteger('min_price') ?? undefined,
    keywords:    interaction.options.getString('keywords') ?? undefined,
    marketplace: interaction.options.getString('marketplace') ?? undefined,
    min_margin:  interaction.options.getNumber('min_margin') ?? undefined,
  };

  const result = FilterEditSchema.safeParse(raw);
  if (!result.success) {
    const errors = Object.entries(result.error.flatten().fieldErrors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('\n');
    return interaction.reply({ content: `Invalid input:\n${errors}`, flags: MessageFlags.Ephemeral });
  }

  const data = result.data;
  const existing = db.prepare('SELECT * FROM thresholds WHERE id = ?').get(data.id);
  if (!existing) {
    return interaction.reply({ content: `No filter with ID ${data.id} found.`, flags: MessageFlags.Ephemeral });
  }

  // Build dynamic SET clause — only update provided fields
  const sets = [];
  const values = [];

  if (data.name       !== undefined) { sets.push('name = ?');        values.push(data.name); }
  if (data.search     !== undefined) { sets.push('search_term = ?'); values.push(data.search); }
  if (data.max_price  !== undefined) { sets.push('max_price = ?');   values.push(data.max_price); }
  if (data.min_price  !== undefined) { sets.push('min_price = ?');   values.push(data.min_price); }
  if (data.keywords   !== undefined) { sets.push('keywords = ?');    values.push(data.keywords); }
  if (data.marketplace !== undefined) { sets.push('marketplace = ?'); values.push(data.marketplace); }
  if (data.min_margin !== undefined) { sets.push('min_margin = ?');  values.push(data.min_margin); }

  if (sets.length === 0) {
    return interaction.reply({ content: 'No fields to update.', flags: MessageFlags.Ephemeral });
  }

  values.push(data.id);
  db.prepare(`UPDATE thresholds SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM thresholds WHERE id = ?').get(data.id);
  const priceRange = updated.min_price
    ? `${updated.min_price}–${updated.max_price} SEK`
    : `max ${updated.max_price} SEK`;

  logger.info({ id: data.id, fields: sets.length }, 'filter edited via Discord command');
  return interaction.reply({
    content: `Filter \`${updated.name}\` (ID: ${data.id}) updated — search: \`${updated.search_term || '—'}\` | ${priceRange}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function filterToggle(interaction, db) {
  const raw = { id: interaction.options.getInteger('id') };
  const result = FilterIdSchema.safeParse(raw);
  if (!result.success) {
    return interaction.reply({ content: 'Invalid ID.', flags: MessageFlags.Ephemeral });
  }

  const row = db.prepare('SELECT name, active FROM thresholds WHERE id = ?').get(result.data.id);
  if (!row) {
    return interaction.reply({ content: `No filter with ID ${result.data.id} found.`, flags: MessageFlags.Ephemeral });
  }

  const newActive = row.active ? 0 : 1;
  db.prepare('UPDATE thresholds SET active = ? WHERE id = ?').run(newActive, result.data.id);

  const state = newActive ? '**enabled**' : '**disabled**';
  logger.info({ id: result.data.id, name: row.name, active: newActive }, 'filter toggled via Discord command');
  return interaction.reply({
    content: `Filter \`${row.name}\` ${state}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function filterTest(interaction, db) {
  const raw = { id: interaction.options.getInteger('id') };
  const result = FilterIdSchema.safeParse(raw);
  if (!result.success) {
    return interaction.reply({ content: 'Invalid ID.', flags: MessageFlags.Ephemeral });
  }

  const filter = db.prepare('SELECT * FROM thresholds WHERE id = ?').get(result.data.id);
  if (!filter) {
    return interaction.reply({ content: `No filter with ID ${result.data.id} found.`, flags: MessageFlags.Ephemeral });
  }

  // Build query against seen_listings matching price range, marketplace, and search/keyword terms
  let query = 'SELECT * FROM seen_listings WHERE 1=1';
  const params = [];

  if (filter.max_price !== null) {
    query += ' AND price_sek <= ?';
    params.push(filter.max_price);
  }
  if (filter.min_price !== null) {
    query += ' AND price_sek >= ?';
    params.push(filter.min_price);
  }
  if (filter.marketplace) {
    query += ' AND marketplace = ?';
    params.push(filter.marketplace);
  }

  // Title match: keywords or search_term
  const searchTerms = [];
  if (filter.keywords) {
    filter.keywords.split(',').map(k => k.trim()).filter(Boolean).forEach(k => searchTerms.push(k));
  } else if (filter.search_term) {
    searchTerms.push(filter.search_term);
  }

  if (searchTerms.length > 0) {
    const titleClauses = searchTerms.map(() => 'LOWER(title) LIKE ?').join(' OR ');
    query += ` AND (${titleClauses})`;
    searchTerms.forEach(t => params.push(`%${t.toLowerCase()}%`));
  }

  query += ' ORDER BY first_seen DESC LIMIT 5';

  const rows = db.prepare(query).all(...params);

  if (rows.length === 0) {
    return interaction.reply({
      content: `No recent listings match filter \`${filter.name}\` (ID: ${result.data.id}).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Test: ${filter.name}`)
    .setDescription(`search: \`${filter.search_term || '—'}\` | max ${filter.max_price} SEK${filter.marketplace ? ` | ${filter.marketplace}` : ''}`)
    .setColor(0x5865F2)
    .setTimestamp();

  for (const row of rows) {
    const date = row.first_seen
      ? new Date(row.first_seen * 1000).toLocaleDateString('sv-SE')
      : '—';
    const link = row.url
      ? `[${row.price_sek.toLocaleString('sv-SE')} SEK](${row.url})`
      : `${row.price_sek.toLocaleString('sv-SE')} SEK`;
    embed.addFields({
      name: row.title.slice(0, 100),
      value: `${link} | ${row.marketplace} | ${date}`,
      inline: false,
    });
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// --- Router ---

async function handleFilter(interaction, db) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'add':    return filterAdd(interaction, db);
    case 'list':   return filterList(interaction, db);
    case 'remove': return filterRemove(interaction, db);
    case 'edit':   return filterEdit(interaction, db);
    case 'toggle': return filterToggle(interaction, db);
    case 'test':   return filterTest(interaction, db);
    default:
      return interaction.reply({ content: `Unknown subcommand: ${sub}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { handleFilter };
