const express = require('express');
const router = express.Router();
const os = require('os');
const config = require('../config');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');
const chatgptService = require('../services/chatgpt');
const whatsappService = require('../services/whatsapp');
const messageHandler = require('./messageHandler');

// 1. System & Service Status
router.get('/status', (req, res) => {
  const memory = process.memoryUsage();
  const chatgptStatus = chatgptService.getStatus();
  const messageStats = messageHandler.getStats();

  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    server: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
      port: config.port,
      nodeEnv: config.nodeEnv,
      baseUrl: config.baseUrl,
    },
    whatsapp: {
      isConfigured: Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken),
      phoneNumberId: config.whatsapp.phoneNumberId ? `${config.whatsapp.phoneNumberId.slice(0, 4)}...${config.whatsapp.phoneNumberId.slice(-4)}` : null,
      hasAccessToken: Boolean(config.whatsapp.accessToken),
      verifyToken: config.whatsapp.verifyToken,
      apiVersion: config.whatsapp.apiVersion,
      webhookUrl: `${config.baseUrl}/api/webhook`,
    },
    chatgpt: chatgptStatus,
    stats: messageStats,
  });
});

// 2. Server-Sent Events (SSE) for Real-Time Dashboard Live Feed
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial batch of recent events
  const initialEvents = eventBus.getRecentEvents(25);
  res.write(`data: ${JSON.stringify({ type: 'init_events', events: initialEvents })}\n\n`);

  const eventListener = (event) => {
    res.write(`data: ${JSON.stringify({ type: 'event', event })}\n\n`);
  };

  eventBus.on('event', eventListener);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off('event', eventListener);
  });
});

// 3. WhatsApp Message Simulator
router.post('/simulate', async (req, res) => {
  const { from = '9800000000', text = 'Hello AI', type = 'text' } = req.body;

  if (!text && type === 'text') {
    return res.status(400).json({ error: 'Text message is required' });
  }

  const messageData = {
    from,
    messageId: `sim_${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type,
    text,
  };

  try {
    const result = await messageHandler.processIncomingMessage(messageData, true);
    res.json({
      success: true,
      data: result,
      history: messageHandler.getConversationHistory(from),
    });
  } catch (error) {
    logger.error('Simulator error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Test Prompt directly with ChatGPT
router.post('/test-chatgpt', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const startTime = Date.now();
  try {
    const response = await chatgptService.sendMessage(prompt);
    res.json({
      success: true,
      durationMs: Date.now() - startTime,
      response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      durationMs: Date.now() - startTime,
      error: error.message,
    });
  }
});

// 5. Test Sending Real Message via Meta WhatsApp Graph API
router.post('/test-whatsapp', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Recipient number (to) and message are required' });
  }

  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    return res.status(400).json({
      error: 'WhatsApp credentials (WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID) are not set in .env',
    });
  }

  try {
    const result = await whatsappService.sendTextMessage(to, message);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// 6. Get Chat Histories
router.get('/conversations', (req, res) => {
  const { phone } = req.query;
  if (phone) {
    res.json({
      phone,
      history: messageHandler.getConversationHistory(phone),
    });
  } else {
    res.json({
      conversations: messageHandler.getAllConversations(),
    });
  }
});

// 7. Clear Conversation Sessions
router.post('/clear-history', (req, res) => {
  const { phone = 'all' } = req.body;
  messageHandler.clearConversation(phone);
  res.json({ success: true, message: `Cleared conversation for: ${phone}` });
});

// 8. Switch AI Mode
router.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (!['auto', 'puppeteer', 'mock'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Allowed: auto, puppeteer, mock' });
  }
  chatgptService.setMode(mode);
  res.json({ success: true, mode: chatgptService.mode });
});

// 9. Restart ChatGPT Service
router.post('/restart-chatgpt', async (req, res) => {
  try {
    await chatgptService.close();
    chatgptService.init().catch((err) => {
      logger.error('Background init failed:', err);
    });
    res.json({ success: true, message: 'ChatGPT service restart triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
