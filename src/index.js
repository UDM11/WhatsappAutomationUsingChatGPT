const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const webhookRoutes = require('./handlers/webhookHandler');
const dashboardRoutes = require('./handlers/dashboardHandler');
const chatgptService = require('./services/chatgpt');
const cron = require('node-cron');

const app = express();

app.set('trust proxy', 1);

// Security middleware with relaxed CSP for local dashboard scripts/styles
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors());

// Rate limiter for production webhooks (relaxed on localhost)
if (config.nodeEnv === 'production') {
  app.use(
    '/api/webhook',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: { error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}

// Parse JSON with rawBody capture for Meta Webhook HMAC validation
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Request logging (skip noisy dashboard polling/events in console)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/dashboard/events') && !req.path.startsWith('/public')) {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
    });
  }
  next();
});

// Serve frontend dashboard static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
app.use('/api', webhookRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Static generated image directory
app.use(
  '/images',
  express.static(path.join(__dirname, '..', 'images'), {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);

// Fallback to dashboard index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Periodic health check (logs status without terminating active browser)
cron.schedule('*/30 * * * *', async () => {
  try {
    const healthy = await chatgptService.healthCheck();
    if (!healthy) {
      logger.info('ChatGPT health check: Browser idle or inactive');
    }
  } catch (error) {
    logger.error('Health check failed:', error);
  }
});

async function startServer() {
  try {
    // Start listening on all network interfaces (0.0.0.0)
    app.listen(config.port, '0.0.0.0', () => {
      logger.info(`🚀 Server running on 0.0.0.0:${config.port}`);
      logger.info(`📱 WhatsApp Chat UI: http://localhost:${config.port}`);
      logger.info(`🔗 Webhook URL: ${config.baseUrl}/api/webhook`);
      logger.info(`🌐 Environment: ${config.nodeEnv}`);
    });

    // Initialize ChatGPT browser session
    try {
      await chatgptService.init();
    } catch (err) {
      logger.warn(`Initial ChatGPT browser startup deferred: ${err.message}`);
    }
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
});

startServer();

module.exports = app;
