const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const webhookRoutes = require('./handlers/webhookHandler');
const chatgptService = require('./services/chatgpt');
const cron = require('node-cron');

const app = express();

app.use(helmet());

app.use(cors());

app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '10mb' }));

app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.use('/api', webhookRoutes);

app.use(
  '/images',
  express.static(path.join(__dirname, '..', 'images'), {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

cron.schedule('*/30 * * * *', async () => {
  try {
    const healthy = await chatgptService.healthCheck();
    if (!healthy) {
      logger.warn('ChatGPT service unhealthy, attempting restart...');
      await chatgptService.close();
      await chatgptService.init();
    }
  } catch (error) {
    logger.error('Health check failed:', error);
  }
});

async function startServer() {
  try {
    logger.info('Initializing ChatGPT service...');
    await chatgptService.init();
    logger.info('ChatGPT service ready');

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Webhook URL: ${config.baseUrl}/api/webhook`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await chatgptService.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await chatgptService.close();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer();

module.exports = app;
