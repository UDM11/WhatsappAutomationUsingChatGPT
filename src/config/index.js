require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'my_whatsapp_verify_token',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
  },

  chatgpt: {
    sessionToken: process.env.CHATGPT_SESSION_TOKEN,
    cfClearance: process.env.CHATGPT_CF_CLEARANCE,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 20,
  },

  webhookSecret: process.env.WEBHOOK_SECRET || 'default_webhook_secret',
  logLevel: process.env.LOG_LEVEL || 'info',
};
