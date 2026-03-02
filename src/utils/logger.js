'use strict';
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  { level: isDev ? 'debug' : 'info' },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : process.stdout
);

module.exports = logger;
