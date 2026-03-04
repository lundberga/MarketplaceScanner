'use strict';
// data/marketPrices.js
// Static market price estimates (median resale SEK) used as fallback when
// Tradera sold-comps data is insufficient. Based on Tradera/Blocket research, March 2026.

const PRICES = {
  // NVIDIA RTX 40 Series
  'rtx 4090':          19000,
  'rtx 4080 super':    12000,
  'rtx 4080':          10200,
  'rtx 4070 ti super':  7000,
  'rtx 4070 ti':        6000,
  'rtx 4070 super':     4500,
  'rtx 4070':           4000,
  'rtx 4060 ti':        2850,

  // NVIDIA RTX 30 Series
  'rtx 3090':           7250,
  'rtx 3080 ti':        5500,
  'rtx 3080':           3600,
  'rtx 3070 ti':        2850,
  'rtx 3070':           2400,
  'rtx 3060 ti':        2350,

  // AMD RX 7000 Series
  'rx 7900 xtx':        7250,
  'rx 7900 xt':         5250,
  'rx 7800 xt':         3000,

  // AMD RX 6000 Series
  'rx 6900 xt':         3500,
  'rx 6800 xt':         3000,

  // AMD Ryzen CPUs
  'ryzen 7800x3d':      4000,
  'ryzen 5800x3d':      3600,
  'ryzen 5700x3d':      3400,
  'ryzen 9 5950x':      2400,
  'ryzen 9 5900x':      1850,
  'ryzen 5600x':        1350,

  // Intel CPUs
  'i9-13900k':          3750,
  'i7-13700k':          2500,
  'i5-13600k':          1500,
};

/**
 * Look up a static median market price by search term.
 * Returns null if no entry found.
 * @param {string} query
 * @returns {number|null}
 */
function lookupStaticPrice(query) {
  if (!query) return null;
  const key = query.toLowerCase().trim();
  return PRICES[key] ?? null;
}

module.exports = { lookupStaticPrice };
