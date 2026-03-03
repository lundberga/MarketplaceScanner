'use strict';
require('dotenv').config();  // must be first — loads .env before any other require

const cron = require('node-cron');
const db = require('./src/db/index');
const logger = require('./src/utils/logger');
const { runTradera } = require('./src/scrapers/traderaRunner');
const { runBlocket } = require('./src/scrapers/blocketRunner');
const { runVinted } = require('./src/scrapers/vintedRunner');
const { runSweclockers } = require('./src/scrapers/sweclockersRunner');
const { runCycle } = require('./src/scheduler/runCycle');

// --- Configuration ---

const KEYWORDS = (process.env.KEYWORDS || 'rtx 3080,rtx 3090,rtx 4080,rx 6800')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

const INTERVAL = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);

// --- Scraper registry ---
// All installed scrapers always included; pause state in user_config controls skipping
const scrapers = [
  { name: 'tradera', run: runTradera },
  { name: 'blocket', run: runBlocket },
  { name: 'vinted', run: runVinted },
  { name: 'sweclockers', run: runSweclockers },
];

// --- Startup ---

logger.info({ keywords: KEYWORDS, interval_minutes: INTERVAL, scrapers: scrapers.map(s => s.name) }, 'Scanner starting');

// Validate cron expression before scheduling — catches out-of-range SCAN_INTERVAL_MINUTES values
// (e.g. 60 produces */60 * * * * which is invalid: minute field is 0-59)
const expression = `*/${INTERVAL} * * * *`;
const safeExpression = cron.validate(expression) ? expression : '*/15 * * * *';

if (!cron.validate(expression)) {
  logger.error({ expression, SCAN_INTERVAL_MINUTES: INTERVAL }, 'Invalid cron expression — SCAN_INTERVAL_MINUTES must be 1–59. Falling back to */15 * * * *');
}

// --- Schedule ---

const task = cron.schedule(safeExpression, async () => {
  await runCycle(scrapers, KEYWORDS, db);
}, {
  noOverlap: true,   // skip tick if previous cycle still running — overlap prevention via node-cron
  name: 'scanner',
});

// Log when a cron tick is skipped due to an in-progress cycle
task.on('execution:overlap', () => {
  logger.warn({ expression: safeExpression }, 'Cron tick skipped — previous cycle still running');
});

// Fire immediately on startup — do not wait for first cron tick
// task.execute() fires the first cycle immediately (node-cron v4 API)
task.execute();
