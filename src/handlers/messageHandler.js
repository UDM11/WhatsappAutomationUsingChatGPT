const fs = require('fs');
const path = require('path');
const https = require('https');
const whatsappService = require('../services/whatsapp');
const chatgptService = require('../services/chatgpt');
const logger = require('../utils/logger');
const config = require('../config');
const eventBus = require('../utils/eventBus');

const IMAGE_DIR = path.join(__dirname, '..', '..', 'images');
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

class MessageHandler {
  constructor() {
    this.userConversations = new Map(); // phone -> conversationId
    this.messageHistories = new Map();  // phone -> [{ sender: 'user'|'bot', text, timestamp, type }]
    this.processingUsers = new Set();
    this.totalMessagesProcessed = 0;
  }

  _recordMessage(phone, sender, text, type = 'text', mediaUrl = null) {
    if (!this.messageHistories.has(phone)) {
      this.messageHistories.set(phone, []);
    }
    const history = this.messageHistories.get(phone);
    history.push({
      sender,
      text,
      type,
      mediaUrl,
      timestamp: new Date().toISOString(),
    });
    // Keep max 50 messages per user in memory
    if (history.length > 50) {
      history.shift();
    }
  }

  async processIncomingMessage(messageData, isSimulation = false) {
    const { from, messageId, text, type, timestamp } = messageData;

    this.totalMessagesProcessed++;
    logger.info(`Processing incoming message from ${from}`, { type, messageId, isSimulation });

    this._recordMessage(from, 'user', text || `[${type} message]`, type);

    eventBus.emitEvent('incoming_message', {
      from,
      messageId,
      type,
      text,
      isSimulation,
      timestamp: timestamp || new Date().toISOString(),
    });

    if (this.processingUsers.has(from)) {
      const waitReply = 'Still processing your previous message. Please wait a moment...';
      this._recordMessage(from, 'bot', waitReply, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, waitReply);
      }
      return { status: 'busy', reply: waitReply };
    }

    this.processingUsers.add(from);

    try {
      if (!isSimulation && messageId && config.whatsapp.accessToken) {
        await whatsappService.markAsRead(messageId).catch(() => {});
      }

      let chatgptInput = '';

      switch (type) {
        case 'text':
          chatgptInput = text;
          break;
        case 'image':
          chatgptInput = text ? `[User sent an image with caption: "${text}"]` : '[User sent an image. Please describe or acknowledge.]';
          break;
        case 'document':
          chatgptInput = text ? `[User sent a document: "${text}"]` : '[User sent a document.]';
          break;
        case 'audio':
          chatgptInput = '[User sent a voice audio note.]';
          break;
        case 'video':
          chatgptInput = '[User sent a video message.]';
          break;
        case 'location':
          chatgptInput = '[User shared their location.]';
          break;
        case 'sticker':
          chatgptInput = '[User sent a sticker.]';
          break;
        default:
          chatgptInput = text || '[User sent a message]';
      }

      if (!chatgptInput || chatgptInput.trim() === '') {
        const fallback = 'I received your message but could not understand the content. Could you please type your message?';
        this._recordMessage(from, 'bot', fallback, 'text');
        if (!isSimulation && config.whatsapp.accessToken) {
          await whatsappService.sendTextMessage(from, fallback);
        }
        return { status: 'empty', reply: fallback };
      }

      const conversationId = this.userConversations.get(from);

      // Call ChatGPT service
      const response = await chatgptService.sendMessage(chatgptInput, conversationId);

      if (!conversationId && chatgptService.page) {
        try {
          const newUrl = chatgptService.page.url();
          const match = newUrl.match(/\/c\/([a-f0-9-]+)/);
          if (match) {
            this.userConversations.set(from, match[1]);
          }
        } catch (err) {
          // Ignore URL inspection error
        }
      }

      const replyText = response.text || '';
      const images = response.images || [];

      this._recordMessage(from, 'bot', replyText, 'text', images[0] || null);

      eventBus.emitEvent('outgoing_reply', {
        to: from,
        replyText,
        images,
        isSimulation,
      });

      // Send to real WhatsApp if not simulation
      if (!isSimulation && config.whatsapp.accessToken && config.whatsapp.phoneNumberId) {
        if (images.length > 0) {
          for (const imgUrl of images) {
            try {
              const publicUrl = await this._publishImage(imgUrl, from);
              if (publicUrl) {
                await whatsappService.sendImageMessage(from, publicUrl, replyText);
              }
            } catch (imgError) {
              logger.error('Failed to send image:', imgError);
              await whatsappService.sendTextMessage(from, replyText);
            }
          }
        } else {
          await whatsappService.sendTextMessage(from, replyText);
        }
      }

      logger.info(`Response completed for ${from}`);
      return {
        status: 'success',
        reply: replyText,
        images,
        conversationId: this.userConversations.get(from) || null,
      };
    } catch (error) {
      logger.error(`Error processing message from ${from}:`, error);
      const errReply = 'Sorry, I encountered an error processing your message. Please try again later.';
      this._recordMessage(from, 'bot', errReply, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, errReply).catch(() => {});
      }
      return { status: 'error', error: error.message, reply: errReply };
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

  getConversationHistory(userId) {
    return this.messageHistories.get(userId) || [];
  }

  getAllConversations() {
    const list = [];
    for (const [phone, messages] of this.messageHistories.entries()) {
      list.push({
        phone,
        conversationId: this.userConversations.get(phone) || null,
        messageCount: messages.length,
        lastMessage: messages[messages.length - 1] || null,
      });
    }
    return list;
  }

  clearConversation(userId) {
    if (userId === 'all') {
      this.userConversations.clear();
      this.messageHistories.clear();
      logger.info('Cleared all user conversations');
    } else {
      this.userConversations.delete(userId);
      this.messageHistories.delete(userId);
      logger.info(`Cleared conversation for ${userId}`);
    }
  }

  getStats() {
    return {
      activeConversations: this.userConversations.size,
      totalUsersTracked: this.messageHistories.size,
      processingUsers: this.processingUsers.size,
      totalMessagesProcessed: this.totalMessagesProcessed,
    };
  }
}

module.exports = new MessageHandler();
