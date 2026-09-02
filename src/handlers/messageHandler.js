const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const whatsappService = require('../services/whatsapp');
const aiProvider = require('../services/aiProvider');
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
    this.messageHistories = new Map(); // phone -> [{ sender: 'user'|'bot', text, timestamp, type }]
    this.processingUsers = new Map(); // phone -> timestamp
    this.totalMessagesProcessed = 0;
    this.startTime = Date.now();
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
    if (history.length > 50) {
      history.shift();
    }
  }

  /**
   * Handle built-in slash commands (/help, /start, /reset, /ping, /stats)
   */
  async _handleCommand(from, text, isSimulation, messageId) {
    const cmd = text.trim().toLowerCase();

    if (cmd === '/start' || cmd === '/help' || cmd === 'help' || cmd === 'hi' || cmd === 'hello') {
      const welcomeMenu = `*🤖 Welcome to ChatGPT Assistant on WhatsApp!*

I am your AI companion powered by *ChatGPT*. Ask me anything directly here!

*🌟 Key Capabilities:*
• *💬 General Chat & Advice* — Ask questions, brainstorm ideas, draft emails.
• *💻 Coding & Debugging* — HTML, CSS, JavaScript, Python, SQL, React.
• *📊 Business & Finance* — Stock analysis, NEPSE, economics, market research.
• *✍️ Writing & Translation* — Essays, summaries, Nepali/English translation.
• *🎨 Image Generation* — Type \`/image <prompt>\` to generate visuals.

*⚡ Useful Commands:*
• \`/reset\` or \`/new\` — Start a fresh new chat session.
• \`/ping\` — Check server latency and health.
• \`/help\` — Display this menu.

_Just type your message below to get started!_ 👇`;

      this._recordMessage(from, 'bot', welcomeMenu, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, welcomeMenu);
      }
      return { status: 'command', reply: welcomeMenu };
    }

    if (cmd === '/reset' || cmd === '/new' || cmd === '/clear') {
      this.userConversations.delete(from);
      await chatgptService.resetSession().catch(() => {});
      const resetMsg = `*🔄 Conversation Reset!*

Your previous context has been cleared. What would you like to explore next?`;

      this._recordMessage(from, 'bot', resetMsg, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, resetMsg);
      }
      return { status: 'command', reply: resetMsg };
    }

    if (cmd === '/ping') {
      const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
      const pingMsg = `*🏓 Pong!*
• *Status:* 🟢 Online & Connected
• *Uptime:* ${uptimeSec} seconds
• *Processed Messages:* ${this.totalMessagesProcessed}`;

      this._recordMessage(from, 'bot', pingMsg, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, pingMsg);
      }
      return { status: 'command', reply: pingMsg };
    }

    return null;
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

    // 1. Instant Blue Ticks (Mark as Read)
    if (!isSimulation && messageId && config.whatsapp.accessToken) {
      await whatsappService.markAsRead(messageId).catch(() => {});
    }

    // 2. Check for built-in slash commands
    if (type === 'text' && text && text.startsWith('/')) {
      const cmdResult = await this._handleCommand(from, text, isSimulation, messageId);
      if (cmdResult) return cmdResult;
    }

    // 3. Track user active state without dropping messages
    this.processingUsers.set(from, Date.now());

    try {
      // 4. Send reaction indicator (hourglass 💡)
      if (!isSimulation && messageId && config.whatsapp.accessToken) {
        await whatsappService.sendReaction(from, messageId, '💡').catch(() => {});
      }

      let chatgptInput = '';
      let mediaFilePath = null;

      switch (type) {
        case 'text':
          chatgptInput = text;
          break;

        case 'document': {
          const doc = messageData.document || {};
          const filename = doc.filename || 'document';
          const caption = text || 'Please analyze, summarize, and explain the key points in this document.';
          let docContent = '';

          // Download document if Meta media ID is present
          if (!isSimulation && doc.id) {
            const sanitizedName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const tempPath = path.join(IMAGE_DIR, sanitizedName);
            const downloaded = await whatsappService.downloadMedia(doc.id, tempPath);

            if (downloaded && fs.existsSync(downloaded)) {
              mediaFilePath = downloaded;
              try {
                const ext = path.extname(filename).toLowerCase();
                const textExtensions = [
                  '.txt', '.csv', '.json', '.md', '.js', '.py', '.html',
                  '.css', '.xml', '.yaml', '.yml', '.sql', '.sh', '.ts',
                  '.c', '.cpp', '.java', '.php', '.log'
                ];

                if (textExtensions.includes(ext)) {
                  docContent = fs.readFileSync(downloaded, 'utf8').substring(0, 15000);
                } else if (ext === '.pdf') {
                  const rawPdf = fs.readFileSync(downloaded, 'latin1');
                  const textBlocks = rawPdf.match(/\(([^\(\)]{3,})\)\s*Tj/g) || [];
                  const extracted = textBlocks.map((b) => b.replace(/^\(|\)\s*Tj$/g, '')).join(' ');
                  if (extracted.length > 50) {
                    docContent = extracted.substring(0, 15000);
                  } else {
                    docContent = `[PDF Document: ${filename} (Size: ${(fs.statSync(downloaded).size / 1024).toFixed(1)} KB)]`;
                  }
                } else {
                  docContent = `[Attached Document: ${filename} (Size: ${(fs.statSync(downloaded).size / 1024).toFixed(1)} KB)]`;
                }
              } catch (readErr) {
                logger.warn(`Could not extract text from document ${filename}:`, readErr.message);
              }
            }
          }

          if (docContent && docContent.length > 10) {
            chatgptInput = `The user sent a document file named "${filename}".\n\n--- DOCUMENT CONTENT ---\n${docContent}\n--- END OF DOCUMENT ---\n\nUser instructions: ${caption}`;
          } else {
            chatgptInput = `The user sent a document file titled "${filename}". User request: "${caption}". Please provide a helpful, comprehensive response.`;
          }
          break;
        }

        case 'image': {
          const img = messageData.image || {};
          const caption = text || 'Please describe and analyze this image in detail.';

          if (!isSimulation && img.id) {
            const tempPath = path.join(IMAGE_DIR, `user_img_${Date.now()}.jpg`);
            mediaFilePath = await whatsappService.downloadMedia(img.id, tempPath);
          }

          chatgptInput = text
            ? `Please analyze this attached photo and answer: "${caption}"`
            : 'Please analyze this attached photo in detail and describe what you see.';
          break;
        }

        case 'location': {
          const loc = messageData.location || {};
          chatgptInput = `The user shared their GPS location (Latitude: ${loc.latitude}, Longitude: ${loc.longitude}${loc.name ? `, Place: ${loc.name}` : ''}${loc.address ? `, Address: ${loc.address}` : ''}). Please provide helpful local facts, weather context, or recommendations.`;
          break;
        }

        case 'audio':
          chatgptInput = '[The user sent a voice audio note. Acknowledge their voice note and let them know you received it.]';
          break;

        default:
          chatgptInput = text || '[User sent a message]';
      }

      if (!chatgptInput || chatgptInput.trim() === '') {
        const fallback = 'I received your message but could not read the text. Could you please type your question?';
        this._recordMessage(from, 'bot', fallback, 'text');
        if (!isSimulation && config.whatsapp.accessToken) {
          await whatsappService.sendTextMessage(from, fallback);
        }
        return { status: 'empty', reply: fallback };
      }

      const conversationId = this.userConversations.get(from);

      // 5. Call Intelligent AI Provider with Vision & Media Support
      const response = await aiProvider.generateResponse(chatgptInput, conversationId, mediaFilePath);

      const replyText = response.text || '';
      const images = response.images || [];

      this._recordMessage(from, 'bot', replyText, 'text', images[0] || null);

      eventBus.emitEvent('outgoing_reply', {
        to: from,
        replyText,
        images,
        isSimulation,
      });

      // 6. Send formatted reply back to WhatsApp
      if (!isSimulation && config.whatsapp.accessToken && config.whatsapp.phoneNumberId) {
        if (images.length > 0) {
          for (const imgUrl of images) {
            try {
              const publicUrl = await this._publishImage(imgUrl, from);
              if (publicUrl) {
                await whatsappService.sendImageMessage(from, publicUrl, replyText);
              }
            } catch (imgError) {
              logger.error('Failed to send image, sending as text fallback:', imgError);
              await whatsappService.sendTextMessage(from, replyText);
            }
          }
        } else {
          await whatsappService.sendTextMessage(from, replyText);
        }
      }

      logger.info(`Response successfully delivered to ${from}`);
      return {
        status: 'success',
        reply: replyText,
        images,
        conversationId: this.userConversations.get(from) || null,
      };
    } catch (error) {
      logger.error(`Error processing message from ${from}:`, error);
      const errReply = '⚠️ *Sorry, I encountered a temporary issue generating your reply.* Please send your question again in a few moments.';
      this._recordMessage(from, 'bot', errReply, 'text');
      if (!isSimulation && config.whatsapp.accessToken) {
        await whatsappService.sendTextMessage(from, errReply).catch(() => {});
      }
      return { status: 'error', error: error.message, reply: errReply };
    } finally {
      this.processingUsers.delete(from);
      if (mediaFilePath && fs.existsSync(mediaFilePath)) {
        fs.unlink(mediaFilePath, () => {});
      }
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
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: 'https://chatgpt.com/',
      },
      timeout: 20000,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
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
      this.processingUsers.clear();
      logger.info('Cleared all user conversations');
    } else {
      this.userConversations.delete(userId);
      this.messageHistories.delete(userId);
      this.processingUsers.delete(userId);
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
