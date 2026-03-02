'use strict';
// src/db/index.js
// Exports the singleton better-sqlite3 Database instance.
// All modules should require this file — do not open separate connections.
// better-sqlite3 is synchronous and single-threaded: one connection is correct.
require('dotenv').config();

const { initDb } = require('./init');

// Open and initialize on first require; subsequent requires return the cached module export
const db = initDb();

module.exports = db;
