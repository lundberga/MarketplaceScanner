'use strict';
// scripts/seedFilters.js
// Wipes all existing thresholds and seeds the curated profit-focused filter set.
// Run: node scripts/seedFilters.js
//
// Prices based on Tradera/Blocket used market research, March 2026.
// max_price is set ~25-35% below typical market to ensure meaningful margin.
// min_price weeds out broken/for-parts listings and low auction bids.

require('dotenv').config();
const { initDb } = require('../src/db/init');

const db = initDb();

const now = Math.floor(Date.now() / 1000);

// --------------------------------------------------------------------------
// Filter definitions
// market_sek  = typical used selling price on Tradera/Blocket (for reference)
// max_price   = the maximum we pay — anything listed at or below this triggers an alert
// min_price   = floor to filter out broken/incomplete listings and unfinished auctions
// --------------------------------------------------------------------------
const filters = [
  // ── NVIDIA RTX 40 Series ──────────────────────────────────────────────────
  // RTX 4090: market ~18 000–20 000 → buy ≤13 000 for ~5 000–7 000 margin
  { name: 'RTX 4090',        search: 'rtx 4090',        min: 8000,  max: 13000 },
  // RTX 4080 Super: market ~11 000–13 000 → buy ≤8 500
  { name: 'RTX 4080 Super',  search: 'rtx 4080 super',  min: 5000,  max: 8500  },
  // RTX 4080: market ~9 500–11 000 → buy ≤7 000
  { name: 'RTX 4080',        search: 'rtx 4080',        min: 4500,  max: 7000  },
  // RTX 4070 Ti Super: market ~6 500–7 500 → buy ≤4 800
  { name: 'RTX 4070 Ti Super', search: 'rtx 4070 ti super', min: 3000, max: 4800 },
  // RTX 4070 Ti: market ~5 500–6 500 → buy ≤4 000
  { name: 'RTX 4070 Ti',     search: 'rtx 4070 ti',     min: 2500,  max: 4000  },
  // RTX 4070 Super: market ~4 000–5 000 → buy ≤3 000
  { name: 'RTX 4070 Super',  search: 'rtx 4070 super',  min: 2000,  max: 3000  },
  // RTX 4070: market ~3 500–4 500 → buy ≤2 700
  { name: 'RTX 4070',        search: 'rtx 4070',        min: 1800,  max: 2700  },
  // RTX 4060 Ti: market ~2 500–3 200 → buy ≤1 800
  { name: 'RTX 4060 Ti',     search: 'rtx 4060 ti',     min: 1200,  max: 1800  },

  // ── NVIDIA RTX 30 Series ──────────────────────────────────────────────────
  // RTX 3090: market ~6 500–8 000 → buy ≤5 000
  { name: 'RTX 3090',        search: 'rtx 3090',        min: 3000,  max: 5000  },
  // RTX 3080 Ti: market ~5 000–6 000 → buy ≤3 800
  { name: 'RTX 3080 Ti',     search: 'rtx 3080 ti',     min: 2500,  max: 3800  },
  // RTX 3080: market ~3 200–4 000 → buy ≤2 500
  { name: 'RTX 3080',        search: 'rtx 3080',        min: 1500,  max: 2500  },
  // RTX 3070 Ti: market ~2 500–3 200 → buy ≤1 900
  { name: 'RTX 3070 Ti',     search: 'rtx 3070 ti',     min: 1200,  max: 1900  },
  // RTX 3070: market ~2 000–2 800 → buy ≤1 600
  { name: 'RTX 3070',        search: 'rtx 3070',        min: 1000,  max: 1600  },
  // RTX 3060 Ti: market ~2 000–2 700 → buy ≤1 700
  { name: 'RTX 3060 Ti',     search: 'rtx 3060 ti',     min: 1000,  max: 1700  },

  // ── AMD RX 7000 Series ────────────────────────────────────────────────────
  // RX 7900 XTX: market ~6 000–8 500 → buy ≤5 200
  { name: 'RX 7900 XTX',     search: 'rx 7900 xtx',     min: 3500,  max: 5200  },
  // RX 7900 XT: market ~4 500–6 000 → buy ≤3 500
  { name: 'RX 7900 XT',      search: 'rx 7900 xt',      min: 2000,  max: 3500  },
  // RX 7800 XT: market ~2 500–3 500 → buy ≤2 000
  { name: 'RX 7800 XT',      search: 'rx 7800 xt',      min: 1300,  max: 2000  },

  // ── AMD RX 6000 Series ────────────────────────────────────────────────────
  // RX 6900 XT: market ~3 000–4 000 → buy ≤2 200
  { name: 'RX 6900 XT',      search: 'rx 6900 xt',      min: 1500,  max: 2200  },
  // RX 6800 XT: market ~2 500–3 500 → buy ≤1 900
  { name: 'RX 6800 XT',      search: 'rx 6800 xt',      min: 1200,  max: 1900  },

  // ── AMD Ryzen CPUs ────────────────────────────────────────────────────────
  // Ryzen 7 7800X3D: market ~3 500–4 500 → buy ≤2 500 (hot gaming CPU)
  { name: 'Ryzen 7 7800X3D', search: 'ryzen 7800x3d',   min: 1500,  max: 2500  },
  // Ryzen 7 5800X3D: market ~3 200–4 000 → buy ≤2 500 (still very popular)
  { name: 'Ryzen 7 5800X3D', search: 'ryzen 5800x3d',   min: 1800,  max: 2500  },
  // Ryzen 7 5700X3D: market ~3 000–3 800 → buy ≤2 200
  { name: 'Ryzen 7 5700X3D', search: 'ryzen 5700x3d',   min: 1500,  max: 2200  },
  // Ryzen 9 5950X: market ~2 000–2 800 → buy ≤1 500
  { name: 'Ryzen 9 5950X',   search: 'ryzen 9 5950x',   min: 800,   max: 1500  },
  // Ryzen 9 5900X: market ~1 500–2 200 → buy ≤1 100
  { name: 'Ryzen 9 5900X',   search: 'ryzen 9 5900x',   min: 600,   max: 1100  },
  // Ryzen 5 5600X: market ~1 200–1 500 → buy ≤800
  { name: 'Ryzen 5 5600X',   search: 'ryzen 5600x',     min: 400,   max: 800   },

  // ── Intel CPUs ────────────────────────────────────────────────────────────
  // i9-13900K: market ~3 000–4 500 → buy ≤2 200
  { name: 'Core i9-13900K',  search: 'i9-13900k',       min: 1000,  max: 2200  },
  // i7-13700K: market ~2 000–3 000 → buy ≤1 500
  { name: 'Core i7-13700K',  search: 'i7-13700k',       min: 700,   max: 1500  },
  // i5-13600K: market ~1 200–1 800 → buy ≤900 (budget but high volume)
  { name: 'Core i5-13600K',  search: 'i5-13600k',       min: 500,   max: 900   },
];

// ── Execute ────────────────────────────────────────────────────────────────

const deleteAll = db.prepare('DELETE FROM thresholds');
const insert = db.prepare(`
  INSERT INTO thresholds (name, search_term, min_price, max_price, active, created_at)
  VALUES (?, ?, ?, ?, 1, ?)
`);

const seed = db.transaction(() => {
  const { changes: deleted } = deleteAll.run();
  console.log(`Deleted ${deleted} existing filter(s).`);

  for (const f of filters) {
    insert.run(f.name, f.search, f.min, f.max, now);
    console.log(`  + [${f.name}]  search="${f.search}"  ${f.min}–${f.max} SEK`);
  }

  console.log(`\nSeeded ${filters.length} filters.`);
});

seed();
