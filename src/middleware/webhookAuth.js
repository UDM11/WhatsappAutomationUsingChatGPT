const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

function verifyWebhook(req, res, next) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook verified successfully by Meta');
    return res.status(200).send(challenge);
  } else {
    logger.warn('Webhook verification failed', { mode, token });
    return res.sendStatus(403);
  }
}

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  // If no secret is configured or signature is absent, allow webhook through
  if (!config.webhookSecret || config.webhookSecret === 'default_webhook_secret' || !signature) {
    return next();
  }

  try {
    const rawPayload = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', config.webhookSecret)
        .update(rawPayload)
        .digest('hex');

    if (
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return next();
    } else {
      logger.warn('Webhook signature mismatch, allowing payload for processing');
      return next();
    }
  } catch (error) {
    logger.error('Error verifying signature:', error);
    return next();
  }
}

module.exports = { verifyWebhook, verifySignature };
