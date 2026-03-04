'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const fakeListing = {
  title: 'RTX 3080 10GB — ASUS TUF Gaming (testad, funkar perfekt)',
  price_sek: 2800,
  marketplace: 'blocket',
  category: 'gpu',
  url: 'https://www.blocket.se',
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(fakeListing.title)
    .addFields({ name: 'Pris', value: `${fakeListing.price_sek} SEK`, inline: true })
    .addFields({ name: 'Källa', value: fakeListing.marketplace, inline: true })
    .addFields({ name: 'Kategori', value: fakeListing.category, inline: true })
    .addFields({ name: 'Marginal', value: '~1 200 SEK (8 comps)', inline: false })
    .setTimestamp();

  const button = new ButtonBuilder()
    .setLabel('Visa annons')
    .setURL(fakeListing.url)
    .setStyle(ButtonStyle.Link);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({ embeds: [embed], components: [row] });
  console.log('Test alert sent!');
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
