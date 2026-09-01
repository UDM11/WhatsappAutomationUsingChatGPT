const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const config = require('../config');
const eventBus = require('../utils/eventBus');

class ChatGPTService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isProcessing = false;
    this.queue = [];
    this.lastError = null;
    this.lastResponseTime = null;
    this.totalRequests = 0;
  }

  async init() {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    try {
      logger.info('Starting ChatGPT Puppeteer instance...');
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1280,800',
        ],
      };

      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      this.browser = await puppeteer.launch(launchOptions);

      this.page = await this.browser.newPage();
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      const tokens = config.chatgpt.sessionToken.split(',').map((t) => t.trim());
      const cookies = tokens.map((value, i) => ({
        name: i === 0 ? '__Secure-next-auth.session-token' : `__Secure-next-auth.session-token.${i}`,
        value,
        domain: '.chatgpt.com',
        path: '/',
        httpOnly: true,
        secure: true,
      }));

      if (config.chatgpt.cfClearance) {
        cookies.push({
          name: 'cf_clearance',
          value: config.chatgpt.cfClearance,
          domain: '.chatgpt.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }

      await this.page.setCookie(...cookies);
      logger.info('Navigating to chatgpt.com with session cookies...');
      await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.page.waitForSelector('#prompt-textarea, textarea, div[contenteditable="true"]', { timeout: 25000 });
      
      this.lastError = null;
      logger.info('✅ ChatGPT ready and connected to chatgpt.com');
      eventBus.emitEvent('chatgpt_ready', { status: 'ready' });
      return this.page;
    } catch (error) {
      let pageDetails = '';
      if (this.page && !this.page.isClosed()) {
        try {
          const title = await this.page.title();
          const currentUrl = this.page.url();
          pageDetails = ` (Page title: "${title}", URL: ${currentUrl})`;
        } catch (e) {}
      }
      this.page = null;
      this.lastError = error.message + pageDetails;
      logger.error('Failed to initialize ChatGPT service:', this.lastError);
      eventBus.emitEvent('chatgpt_error', { error: this.lastError });
      throw new Error(this.lastError);
    }
  }

  async sendMessage(message) {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, resolve, reject, timestamp: Date.now() });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const startTime = Date.now();
      try {
        eventBus.emitEvent('chatgpt_prompt_start', { message: item.message });

        await this.init();

        const inputSelector = '#prompt-textarea, textarea, div[contenteditable="true"]';
        await this.page.waitForSelector(inputSelector, { timeout: 15000 });

        // Count assistant messages BEFORE sending prompt to track the new response
        const initialCount = await this.page.evaluate(() => {
          return document.querySelectorAll('[data-message-author-role="assistant"]').length;
        });

        await this.page.focus(inputSelector);
        await this._delay(200);

        // Try typing and clicking the send button
        await this.page.keyboard.type(item.message, { delay: 10 });
        await this._delay(200);

        // Click send button or press Enter
        const sendBtn = await this.page.$('button[data-testid="send-button"], button[aria-label="Send prompt"]');
        if (sendBtn) {
          await sendBtn.click().catch(() => {});
        } else {
          await this.page.keyboard.press('Enter');
        }

        // Resilient polling for response completion
        let replyText = '';
        let replyImages = [];
        let completed = false;
        let lastLength = 0;
        let stableCount = 0;
        const maxWaitMs = 60000;
        const pollIntervalMs = 800;
        const startWait = Date.now();

        await this._delay(1500);

        while (Date.now() - startWait < maxWaitMs) {
          const status = await this.page.evaluate((initialMsgCount) => {
            const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
            if (messages.length <= initialMsgCount) {
              return { hasNewMsg: false, isStreaming: true, text: '', images: [] };
            }

            const lastMsg = messages[messages.length - 1];
            const markdown = lastMsg.querySelector('.markdown') || lastMsg;
            const text = (markdown.innerText || markdown.textContent || '').trim();

            const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]');
            const streaming = document.querySelector('.result-streaming');
            const imageLoading = document.querySelector('[data-testid="image-gen-loading"]');

            const isStreaming = Boolean(stopBtn || streaming || imageLoading);

            // Extract images
            const imgElements = Array.from(lastMsg.querySelectorAll('img'));
            const images = [];
            imgElements.forEach((img) => {
              const src = img.getAttribute('src');
              if (src && !src.includes('avatar') && !src.includes('profile')) {
                images.push(src);
              }
            });

            return { hasNewMsg: true, isStreaming, text, images };
          }, initialCount);

          if (status.hasNewMsg && status.text.length > 0) {
            replyText = status.text;
            replyImages = status.images;

            // If streaming stopped, we are done
            if (!status.isStreaming) {
              completed = true;
              break;
            }

            // If text length hasn't changed for 3 consecutive polls (2.4s), assume done
            if (status.text.length === lastLength && status.text.length > 20) {
              stableCount++;
              if (stableCount >= 3) {
                completed = true;
                break;
              }
            } else {
              stableCount = 0;
              lastLength = status.text.length;
            }
          }

          await this._delay(pollIntervalMs);
        }

        // If we extracted text even after timeout, use it
        if (!replyText && replyImages.length === 0) {
          throw new Error('Timeout waiting for ChatGPT response');
        }

        if (!replyText && replyImages.length > 0) {
          replyText = 'Here is the generated image:';
        }

        this.totalRequests++;
        this.lastResponseTime = Date.now() - startTime;

        eventBus.emitEvent('chatgpt_prompt_complete', {
          prompt: item.message,
          response: replyText,
          imagesCount: replyImages.length,
          durationMs: this.lastResponseTime,
        });

        item.resolve({ text: replyText, images: replyImages });
      } catch (error) {
        logger.error('Error sending message to ChatGPT:', error.message);
        this.lastError = error.message;
        eventBus.emitEvent('chatgpt_error', { error: error.message });

        // Auto-heal: Refresh ChatGPT page to clear any stuck input or modal
        if (this.page && !this.page.isClosed()) {
          try {
            logger.info('Auto-healing: Reloading ChatGPT page after error...');
            await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
          } catch (reloadErr) {
            logger.warn('Failed to reload ChatGPT page:', reloadErr.message);
          }
        }

        item.reject(error);
      }

      await this._delay(600);
    }

    this.isProcessing = false;
  }

  async _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (err) {}
      this.browser = null;
      this.page = null;
      logger.info('ChatGPT service closed');
    }
  }

  async healthCheck() {
    try {
      if (!this.page || this.page.isClosed()) return false;
      const url = this.page.url();
      return url.includes('chatgpt.com');
    } catch {
      return false;
    }
  }

  getStatus() {
    return {
      isInitialized: Boolean(this.page && !this.page.isClosed()),
      isProcessing: this.isProcessing,
      queueLength: this.queue.length,
      hasSessionToken: Boolean(config.chatgpt.sessionToken),
      hasCfClearance: Boolean(config.chatgpt.cfClearance),
      lastError: this.lastError,
      lastResponseTime: this.lastResponseTime,
      totalRequests: this.totalRequests,
    };
  }
}

module.exports = new ChatGPTService();
