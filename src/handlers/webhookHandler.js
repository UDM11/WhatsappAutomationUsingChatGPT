const express = require('express');
const router = express.Router();
const { verifyWebhook, verifySignature } = require('../middleware/webhookAuth');
const messageHandler = require('./messageHandler');
const logger = require('../utils/logger');
const config = require('../config');

router.get('/webhook', verifyWebhook);

router.post('/webhook', verifySignature, async (req, res) => {
  try {
    res.sendStatus(200);

    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      return;
    }

    for (const entry of body.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        if (change.field !== 'messages') {
          continue;
        }

        const value = change.value;

        if (!value.messages || !Array.isArray(value.messages)) {
          continue;
        }

        for (const message of value.messages) {
          const messageData = {
            from: message.from,
            messageId: message.id,
            timestamp: message.timestamp,
            type: message.type,
            text: message.text?.body || null,
            image: message.image || null,
            document: message.document || null,
            audio: message.audio || null,
            video: message.video || null,
            location: message.location || null,
            sticker: message.sticker || null,
            contacts: message.contacts || null,
          };

          logger.info('Received message:', {
            from: messageData.from,
            type: messageData.type,
          });

          setImmediate(() => {
            messageHandler.processIncomingMessage(messageData).catch((err) => {
              logger.error('Error processing message:', err);
            });
          });
        }

        if (value.statuses) {
          for (const status of value.statuses) {
            logger.info('Message status update:', {
              messageId: status.id,
              status: status.status,
              timestamp: status.timestamp,
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error processing webhook:', error);
  }
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: messageHandler.getStats(),
  });
});

router.get('/stats', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    stats: messageHandler.getStats(),
  });
});

module.exports = router;
