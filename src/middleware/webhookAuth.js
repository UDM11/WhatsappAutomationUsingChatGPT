const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

function verifyWebhook(req, res, next) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  } else {
    logger.warn('Webhook verification failed', { mode, token });
    return res.sendStatus(403);
  }
}

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn('No signature found in request');
    return res.sendStatus(401);
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', config.webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    logger.warn('Invalid signature');
    return res.sendStatus(401);
  }

  next();
}

module.exports = { verifyWebhook, verifySignature };
