const puppeteer = require('puppeteer-core');
const logger = require('../utils/logger');
const config = require('../config');
const eventBus = require('../utils/eventBus');

class ChatGPTService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    this.isInitializing = false;
    this.queue = [];
    this.isProcessing = false;
    this.lastActiveTime = Date.now();
  }

  async init() {
    if (this.isReady && this.page && !this.page.isClosed()) {
      return;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await this._delay(300);
      }
      return;
    }

    this.isInitializing = true;
    try {
      logger.info('Starting ChatGPT Puppeteer automation service...');

      const isWin = process.platform === 'win32';
      const chromePath = isWin
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/chromium';

      const launchOptions = {
        headless: process.env.NODE_ENV === 'production' ? 'new' : false,
        executablePath: chromePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--window-size=1280,800',
        ],
      };

      this.browser = await puppeteer.launch(launchOptions);
      this.browser.on('disconnected', () => {
        logger.warn('Puppeteer browser disconnected. Will reinitialize on next prompt.');
        this.isReady = false;
        this.page = null;
        this.browser = null;
      });

      this.page = await this.browser.newPage();
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      // Format session cookies (support both single and NextAuth chunked tokens .0, .1)
      const rawToken = config.chatgpt.sessionToken || '';
      const tokens = rawToken.split(',').map((t) => t.trim()).filter(Boolean);
      const cookies = [];

      if (tokens.length === 1) {
        cookies.push({
          name: '__Secure-next-auth.session-token',
          value: tokens[0],
          domain: '.chatgpt.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      } else if (tokens.length > 1) {
        tokens.forEach((val, idx) => {
          cookies.push({
            name: `__Secure-next-auth.session-token.${idx}`,
            value: val,
            domain: '.chatgpt.com',
            path: '/',
            httpOnly: true,
            secure: true,
          });
        });
      }

      if (config.chatgpt.cfClearance) {
        cookies.push({
          name: 'cf_clearance',
          value: config.chatgpt.cfClearance.trim(),
          domain: '.chatgpt.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }

      if (cookies.length > 0) {
        await this.page.setCookie(...cookies);
      }

      logger.info('Navigating to chatgpt.com with authenticated session...');
      await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Check for prompt input textarea
      const composerSelector =
        '#mobile-composer-prompt, textarea.wm-composer-textarea, #prompt-textarea, textarea, div[contenteditable="true"]';
      await this.page.waitForSelector(composerSelector, { timeout: 25000 });
      this.isReady = true;
      logger.info('✅ ChatGPT ready and connected to chatgpt.com');
    } catch (error) {
      logger.error('Failed to initialize ChatGPT Puppeteer service:', error);
      this.isReady = false;
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
        this.page = null;
      }
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Reset the current ChatGPT session (starts a fresh chat thread).
   */
  async resetSession() {
    try {
      if (this.page && !this.page.isClosed()) {
        logger.info('Resetting ChatGPT conversation to fresh chat...');
        await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const composerSelector =
          '#mobile-composer-prompt, textarea.wm-composer-textarea, #prompt-textarea, textarea, div[contenteditable="true"]';
        await this.page.waitForSelector(composerSelector, { timeout: 20000 });
      }
    } catch (error) {
      logger.error('Error resetting ChatGPT session:', error);
    }
  }

  /**
   * Send a prompt message to ChatGPT and return the extracted reply.
   */
  async sendMessage(message, conversationId = null) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        conversationId,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const startTime = Date.now();
      try {
        eventBus.emitEvent('chatgpt_prompt_start', { message: item.message });

        await this.init();

        const inputSelector =
          '#mobile-composer-prompt, textarea.wm-composer-textarea, #prompt-textarea, textarea, div[contenteditable="true"]';
        await this.page.waitForSelector(inputSelector, { timeout: 15000 });

        // Count assistant messages BEFORE sending prompt to accurately detect the new reply
        const initialCount = await this.page.evaluate(() => {
          const assistantRoles = document.querySelectorAll(
            '[data-message-role="assistant"], [data-message-author-role="assistant"], ._wdUoQG_assistantMessage, .markdown'
          );
          return assistantRoles.length;
        });

        await this.page.click(inputSelector).catch(() => {});
        await this.page.focus(inputSelector).catch(() => {});
        await this._delay(200);

        // Type prompt
        await this.page.keyboard.type(item.message, { delay: 10 });
        await this._delay(300);

        // Click send button or press Enter
        const sendBtnSelector = [
          'button[aria-label="Send message"]',
          'button[data-composer-submit]',
          'button.wm-composer-submitButton',
          'button[data-testid="send-button"]',
          'button[aria-label="Send prompt"]',
          'button[data-testid="fruitjuice-send-button"]',
          'button.mb-1',
          'button[aria-label="Send"]',
        ].join(', ');

        const sendBtn = await this.page.$(sendBtnSelector);
        if (sendBtn) {
          await sendBtn.click().catch(() => {});
        } else {
          await this.page.keyboard.press('Enter');
        }

        // Resilient polling for response completion (handles text, code blocks, lists, and images)
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
          let status = null;
          try {
            status = await this.page.evaluate((initialMsgCount) => {
              const assistantNodes = Array.from(
                document.querySelectorAll(
                  '[data-message-role="assistant"], [data-message-author-role="assistant"], ._wdUoQG_assistantMessage'
                )
              );
              const markdownNodes = Array.from(document.querySelectorAll('.markdown'));
              const messages = assistantNodes.length > 0 ? assistantNodes : markdownNodes;

              if (messages.length <= initialMsgCount) {
                return { hasNewMsg: false, isStreaming: true, text: '', images: [] };
              }

              const lastMsg = messages[messages.length - 1];

              // Extract formatted text preserving code blocks
              const preBlocks = Array.from(lastMsg.querySelectorAll('pre'));
              preBlocks.forEach((pre) => {
                const codeElem = pre.querySelector('code');
                const codeText = codeElem ? (codeElem.innerText || codeElem.textContent) : (pre.innerText || pre.textContent);
                const langMatch = pre.className.match(/language-(\w+)/) || (codeElem ? codeElem.className.match(/language-(\w+)/) : null);
                const lang = langMatch ? langMatch[1] : '';
                pre.setAttribute('data-extracted-code', `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`);
              });

              const contentNode = lastMsg.querySelector('._wdUoQG_messageCopy, .markdown') || lastMsg;
              let text = (contentNode.innerText || contentNode.textContent || '').trim();

              if (text.startsWith('ChatGPT said:')) {
                text = text.replace(/^ChatGPT said:\s*/i, '').trim();
              }

              const stopBtn = document.querySelector(
                'button[aria-label="Stop generating"], button[data-testid="stop-button"], button[data-stop-label="Stop generating"]'
              );
              const streaming = document.querySelector('.result-streaming, ._wdUoQG_streaming');
              const imageLoading = document.querySelector('[data-testid="image-gen-loading"]');

              const isStreaming = Boolean(stopBtn || streaming || imageLoading);

              // Extract images (e.g. from DALL-E)
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
          } catch (evalErr) {
            // Gracefully handle URL navigation when starting a fresh chat thread
            if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
              logger.info('ChatGPT navigating thread URL, preserving polling context...');
              await this._delay(600);
              continue;
            }
            throw evalErr;
          }

          if (status && status.hasNewMsg && status.text.length > 0) {
            replyText = status.text;
            replyImages = status.images;

            // If streaming stopped, we are done
            if (!status.isStreaming) {
              completed = true;
              break;
            }

            // Text stability fallback
            if (replyText.length === lastLength) {
              stableCount++;
              if (stableCount >= 4) {
                completed = true;
                break;
              }
            } else {
              stableCount = 0;
              lastLength = replyText.length;
            }
          }

          await this._delay(pollIntervalMs);
        }

        if (!completed && replyText.length === 0) {
          throw new Error('Timeout waiting for ChatGPT response');
        }

        const duration = Date.now() - startTime;
        eventBus.emitEvent('chatgpt_prompt_done', {
          message: item.message,
          reply: replyText,
          duration,
        });

        this.lastActiveTime = Date.now();
        item.resolve({ text: replyText, images: replyImages, duration });
      } catch (error) {
        logger.error('Error sending message to ChatGPT:', error.message);
        eventBus.emitEvent('chatgpt_error', { error: error.message });

        // Auto-heal session on error
        if (this.page && !this.page.isClosed()) {
          try {
            logger.info('Auto-healing: Reloading ChatGPT page after error...');
            await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch {
            this.isReady = false;
          }
        } else {
          this.isReady = false;
        }

        item.reject(error);
      }
    }

    this.isProcessing = false;
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      hasSessionToken: Boolean(config.chatgpt.sessionToken),
      hasCfClearance: Boolean(config.chatgpt.cfClearance),
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      mode: 'puppeteer',
      lastActive: new Date(this.lastActiveTime).toISOString(),
    };
  }

  async healthCheck() {
    return this.isReady && this.page && !this.page.isClosed();
  }

  setMode(mode) {
    this.mode = mode;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.isReady = false;
      this.page = null;
      this.browser = null;
      logger.info('ChatGPT browser closed');
    }
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new ChatGPTService();
