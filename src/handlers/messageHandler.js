const fs = require('fs');
const path = require('path');
const https = require('https');
const whatsappService = require('../services/whatsapp');
const chatgptService = require('../services/chatgpt');
const logger = require('../utils/logger');
const config = require('../config');

const IMAGE_DIR = path.join(__dirname, '..', '..', 'images');
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

class MessageHandler {
  constructor() {
    this.userConversations = new Map();
    this.processingUsers = new Set();
  }

  async processIncomingMessage(messageData) {
    const { from, messageId, text, type, timestamp } = messageData;

    logger.info(`Incoming message from ${from}`, { type, messageId });

    if (this.processingUsers.has(from)) {
      await whatsappService.sendTextMessage(
        from,
        'Still processing your previous message. Please wait a moment...'
      );
      return;
    }

    this.processingUsers.add(from);

    try {
      await whatsappService.markAsRead(messageId);

      let chatgptInput = '';

      switch (type) {
        case 'text':
          chatgptInput = text;
          break;
        case 'image':
          chatgptInput = '[User sent an image. Please describe what you see or ask for clarification.]';
          break;
        case 'document':
          chatgptInput = '[User sent a document. Please help them with the document content.]';
          break;
        case 'audio':
          chatgptInput = '[User sent a voice message. Please respond to their voice message.]';
          break;
        case 'video':
          chatgptInput = '[User sent a video. Please help them with the video content.]';
          break;
        case 'location':
          chatgptInput = '[User shared a location. Please help them with information about their location.]';
          break;
        case 'sticker':
          chatgptInput = '[User sent a sticker. Please respond with a friendly message.]';
          break;
        default:
          chatgptInput = text || '[User sent a message]';
      }

      if (!chatgptInput || chatgptInput.trim() === '') {
        await whatsappService.sendTextMessage(
          from,
          'I received your message but could not understand the content. Could you please type your message?'
        );
        return;
      }

      const conversationId = this.userConversations.get(from);

      await whatsappService.sendTextMessage(from, 'typing...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await chatgptService.sendMessage(chatgptInput, conversationId);

      if (!conversationId) {
        const newUrl = chatgptService.page.url();
        const match = newUrl.match(/\/c\/([a-f0-9-]+)/);
        if (match) {
          this.userConversations.set(from, match[1]);
        }
      }

      const replyText = response.text || '';
      const images = response.images || [];

      if (images.length > 0) {
        await whatsappService.sendTextWithTyping(from, replyText || 'Here is the image you requested:', 1500);

        for (const imgUrl of images) {
          try {
            const publicUrl = await this._publishImage(imgUrl, from);
            if (publicUrl) {
              await whatsappService.sendImageMessage(from, publicUrl, replyText);
              logger.info(`Image sent to ${from}`);
            }
          } catch (imgError) {
            logger.error('Failed to send image:', imgError);
            await whatsappService.sendTextMessage(
              from,
              'I could not send the image. (Image generation error)'
            );
          }
        }
      } else {
        await whatsappService.sendTextWithTyping(from, replyText, 1500);
      }

      logger.info(`Response sent to ${from}`);
    } catch (error) {
      logger.error(`Error processing message from ${from}:`, error);
      await whatsappService.sendTextMessage(
        from,
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    } finally {
      this.processingUsers.delete(from);
    }
  }

  async _publishImage(imgUrl, from) {
    const fileName = `${from.replace(/\D/g, '')}_${Date.now()}.png`;
    const filePath = path.join(IMAGE_DIR, fileName);

    try {
      if (imgUrl.startsWith('data:')) {
        const base64 = imgUrl.split(',')[1];
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      } else {
        await this._downloadFile(imgUrl, filePath);
      }
      return `${config.baseUrl}/images/${fileName}`;
    } catch (error) {
      logger.error('Failed to publish image:', error);
      return null;
    }
  }

  async _downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : require('http');
      const request = client.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          response.resume();
          request.destroy();
          return this._downloadFile(response.headers.location, filePath);
        }
        const file = fs.createWriteStream(filePath);
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
        file.on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      });
      request.on('error', reject);
    });
  }

  async handleSessionTimeout(userId) {
    this.userConversations.delete(userId);
    await whatsappService.sendTextMessage(
      userId,
      'Session expired. Starting a new conversation. How can I help you?'
    );
  }

  clearConversation(userId) {
    this.userConversations.delete(userId);
  }

  getStats() {
    return {
      activeConversations: this.userConversations.size,
      processingUsers: this.processingUsers.size,
    };
  }
}

module.exports = new MessageHandler();
