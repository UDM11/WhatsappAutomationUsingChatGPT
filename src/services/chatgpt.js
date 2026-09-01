const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const config = require('../config');

class ChatGPTService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isInitialized = false;
    this.isProcessing = false;
    this.queue = [];
    this.CONVERSATIONS = new Map();
  }

  async init() {
    if (this.isInitialized) return;

    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--single-process',
        ],
      });

      this.page = await this.browser.newPage();

      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      if (config.chatgpt.sessionToken) {
        const tokens = config.chatgpt.sessionToken.split(',').map((t) => t.trim());
        this.page.setCookie(
          tokens.map((value, i) => ({
            name: i === 0 ? '__Secure-next-auth.session-token' : `__Secure-next-auth.session-token.${i}`,
            value,
            domain: '.chatgpt.com',
            httpOnly: true,
            secure: true,
          }))
        );
      }

      if (config.chatgpt.cfClearance) {
        await this.page.setCookie({
          name: 'cf_clearance',
          value: config.chatgpt.cfClearance,
          domain: '.chatgpt.com',
          httpOnly: true,
          secure: true,
        });
      }

      await this.page.goto('https://chatgpt.com/', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      await this.page.waitForSelector('#prompt-textarea, textarea[data-id="root"]', {
        timeout: 30000,
      });

      this.isInitialized = true;
      logger.info('ChatGPT service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ChatGPT service:', error);
      throw error;
    }
  }

  async sendMessage(message, conversationId = null) {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, conversationId, resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { message, conversationId, resolve, reject } = this.queue.shift();
      try {
        const response = await this._sendAndGetResponse(message, conversationId);
        resolve(response);
      } catch (error) {
        logger.error('Error sending message to ChatGPT:', error);
        reject(error);
      }

      await this._delay(1000 + Math.random() * 2000);
    }

    this.isProcessing = false;
  }

  async _sendAndGetResponse(message, conversationId = null) {
    try {
      if (conversationId && this.CONVERSATIONS.has(conversationId)) {
        await this.page.goto(`https://chatgpt.com/c/${conversationId}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
      }

      const textarea = await this.page.$('#prompt-textarea, textarea[data-id="root"]');
      if (!textarea) {
        throw new Error('Could not find chat input');
      }

      await textarea.click({ clickCount: 3 });
      await this._delay(300);

      await this.page.evaluate((text) => {
        const textarea = document.querySelector('#prompt-textarea, textarea[data-id="root"]');
        if (textarea) {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, message);

      await this._delay(500);

      const sendButton = await this.page.$('button[data-testid="send-button"]');
      if (sendButton) {
        await sendButton.click();
      } else {
        await this.page.keyboard.press('Enter');
      }

      await this._waitForResponse();

      const response = await this._sendAndGetResponse(message, conversationId);

      const newUrl = this.page.url();
      const match = newUrl.match(/\/c\/([a-f0-9-]+)/);
      if (match && conversationId === null) {
        this.CONVERSATIONS.set(match[1], true);
      }

      return response;
    } catch (error) {
      logger.error('Error in _sendAndGetResponse:', error);
      throw error;
    }
  }

  async _waitForResponse() {
    try {
      await this.page.waitForFunction(
        () => {
          const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) return false;

          const stopButton = document.querySelector('button[aria-label="Stop generating"]');
          const streamingIndicator = document.querySelector('.result-streaming');

          return !stopButton && !streamingIndicator;
        },
        { timeout: 60000 }
      );

      await this._delay(1500);
    } catch (error) {
      logger.warn('Timeout waiting for response, extracting partial result');
    }
  }

  async _extractResponse() {
    try {
      const result = await this.page.evaluate(() => {
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage) return null;

        const markdown = lastMessage.querySelector('.markdown');
        let text = '';
        if (markdown) {
          text = markdown.innerText || markdown.textContent;
        } else {
          text = lastMessage.innerText || lastMessage.textContent;
        }

        const imageLinks = [];
        lastMessage.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src');
          if (src && img.naturalWidth > 0) {
            imageLinks.push(src);
          }
        });

        return { text, imageLinks };
      });

      if (!result) {
        return { text: 'Sorry, I could not generate a response.', images: [] };
      }

      return { text: result.text || '', images: result.imageLinks || [] };
    } catch (error) {
      logger.error('Error extracting response:', error);
      return { text: 'Sorry, an error occurred while processing the response.', images: [] };
    }
  }

  async _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.isInitialized = false;
      logger.info('ChatGPT service closed');
    }
  }

  async healthCheck() {
    try {
      if (!this.page) return false;
      const url = this.page.url();
      return url.includes('chatgpt.com');
    } catch {
      return false;
    }
  }
}

module.exports = new ChatGPTService();
