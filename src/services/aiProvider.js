const fs = require('fs');
const chatgptService = require('./chatgpt');
const logger = require('../utils/logger');
const axios = require('axios');

class AIProvider {
  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
  }

  /**
   * Get intelligent AI response with automatic fallback protection.
   */
  async generateResponse(prompt, conversationId = null, mediaFilePath = null) {
    // 1. Try ChatGPT Puppeteer Service first
    try {
      logger.info('Attempting response via ChatGPT Puppeteer automation...');
      const result = await Promise.race([
        chatgptService.sendMessage(prompt, conversationId, mediaFilePath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI Engine Timeout (120s)')), 120000)),
      ]);

      if (result && (result.text?.trim() || result.images?.length > 0)) {
        return result;
      }
    } catch (chatgptErr) {
      logger.warn(`Primary ChatGPT Puppeteer attempt failed: ${chatgptErr.message}. Checking API fallback...`);
    }

    // 2. Fallback to Gemini Free API if key is present
    if (this.geminiApiKey) {
      try {
        logger.info('Executing Fallback via Google Gemini API...');
        const parts = [{ text: prompt }];

        if (mediaFilePath && fs.existsSync(mediaFilePath)) {
          const ext = mediaFilePath.toLowerCase();
          const mime = ext.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const b64 = fs.readFileSync(mediaFilePath).toString('base64');
          parts.unshift({ inline_data: { mime_type: mime, data: b64 } });
        }

        const geminiRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
          { contents: [{ parts }] },
          { timeout: 20000 }
        );

        const text = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { text, images: [], duration: 1200 };
        }
      } catch (geminiErr) {
        logger.error('Gemini fallback failed:', geminiErr.message);
      }
    }

    // 3. Fallback to OpenAI API if key is present
    if (this.openaiApiKey) {
      try {
        logger.info('Executing Fallback via OpenAI API...');
        const openaiRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
          },
          {
            headers: { Authorization: `Bearer ${this.openaiApiKey}` },
            timeout: 15000,
          }
        );

        const text = openaiRes.data?.choices?.[0]?.message?.content;
        if (text) {
          return { text, images: [], duration: 1500 };
        }
      } catch (openaiErr) {
        logger.error('OpenAI fallback failed:', openaiErr.message);
      }
    }

    // 4. Graceful Fallback if browser is temporarily throttled
    return {
      text: "I received your query. I am currently refreshing my AI connection session. Please send your question again in 10 seconds and I'll answer immediately!",
      images: [],
      duration: 500,
    };
  }
}

module.exports = new AIProvider();
