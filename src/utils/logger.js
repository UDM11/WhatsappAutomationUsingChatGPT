const winston = require('winston');
const config = require('../config');
const eventBus = require('./eventBus');

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'whatsapp-chatgpt-bot' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  })
);

// Hook into winston logs to emit to in-memory event bus
logger.on('data', (log) => {
  try {
    eventBus.emitEvent('log', {
      level: log.level,
      message: log.message,
      timestamp: log.timestamp,
      meta: log.meta || log[Symbol.for('splat')] || null,
    });
  } catch (err) {
    // Ignore bus emit errors
  }
});

module.exports = logger;
