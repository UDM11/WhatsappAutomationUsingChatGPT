const fs = require('fs');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');
const whatsappFormatter = require('../utils/whatsappFormatter');

const API_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}`;

class WhatsAppService {
  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Send a formatted text message to a user on WhatsApp.
   * Automatically formats markdown (bold, lists, headers, code blocks).
   */
  async sendTextMessage(to, text, previewUrl = false) {
    try {
      if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
        logger.warn('WhatsApp credentials not configured; skipping sendTextMessage');
        return null;
      }

      const formatted = whatsappFormatter.format(text);
      const chunks = whatsappFormatter.splitIntoChunks(formatted);
      let lastResponse = null;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk.trim()) continue;

        const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: {
            preview_url: previewUrl,
            body: chunk,
          },
        });

        lastResponse = response.data;
        logger.info(`Message chunk [${i + 1}/${chunks.length}] sent to ${to}`, {
          messageId: response.data.messages?.[0]?.id,
        });

        // Small interval between chunks so WhatsApp delivers in correct order
        if (chunks.length > 1 && i < chunks.length - 1) {
          await this._delay(400);
        }
      }

      return lastResponse;
    } catch (error) {
      logger.error('Failed to send WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send a reaction emoji to a specific user message.
   */
  async sendReaction(to, messageId, emoji) {
    try {
      if (!config.whatsapp.phoneNumberId || !messageId) return null;

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji: emoji,
        },
      });

      return response.data;
    } catch (error) {
      logger.debug('Reaction failed (optional feature):', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Mark an incoming message as Read (gives blue ticks in WhatsApp).
   */
  async markAsRead(messageId) {
    try {
      if (!config.whatsapp.phoneNumberId || !messageId) return null;

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });

      logger.debug(`Marked message ${messageId} as read`);
      return response.data;
    } catch (error) {
      logger.debug('Mark as read error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Send an image with formatted caption to a WhatsApp user.
   */
  async sendImageMessage(to, imageUrl, caption = '') {
    try {
      if (!config.whatsapp.phoneNumberId) return null;

      const formattedCaption = caption ? whatsappFormatter.format(caption) : '';
      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'image',
        image: {
          link: imageUrl,
          caption: formattedCaption,
        },
      });

      logger.info(`Image sent to ${to}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to send image:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Download incoming media (documents, images, audio) from WhatsApp Cloud API.
   */
  async downloadMedia(mediaId, destinationPath) {
    try {
      if (!config.whatsapp.accessToken || !mediaId) return null;

      // 1. Get temporary download URL from Meta Graph API
      const metaRes = await this.client.get(`/${mediaId}`);
      const mediaUrl = metaRes.data?.url;
      if (!mediaUrl) throw new Error('Failed to retrieve media URL from Meta');

      // 2. Download binary file with Authorization header
      const fileRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 30000,
      });

      fs.writeFileSync(destinationPath, Buffer.from(fileRes.data));
      logger.info(`Successfully downloaded WhatsApp media ${mediaId} to ${destinationPath}`);
      return destinationPath;
    } catch (error) {
      logger.error(`Failed to download media ${mediaId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Send interactive quick-reply buttons (Max 3 buttons supported by WhatsApp API).
   */
  async sendQuickReplyButtons(to, bodyText, buttons, headerText = null, footerText = 'Powered by ChatGPT') {
    try {
      if (!config.whatsapp.phoneNumberId) return null;

      const buttonObjects = buttons.slice(0, 3).map((b, idx) => ({
        type: 'reply',
        reply: {
          id: b.id || `btn_${idx}`,
          title: (b.title || b.text || '').substring(0, 20),
        },
      }));

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: whatsappFormatter.format(bodyText),
          },
          action: {
            buttons: buttonObjects,
          },
        },
      };

      if (headerText) {
        payload.interactive.header = {
          type: 'text',
          text: headerText,
        };
      }

      if (footerText) {
        payload.interactive.footer = {
          text: footerText,
        };
      }

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, payload);
      return response.data;
    } catch (error) {
      logger.error('Failed to send interactive buttons (falling back to text):', error.response?.data || error.message);
      return this.sendTextMessage(to, bodyText);
    }
  }

  /**
   * Send interactive list menu (e.g. for options, tools, settings).
   */
  async sendInteractiveList(to, bodyText, buttonTitle, sections, headerText = null, footerText = 'Powered by ChatGPT') {
    try {
      if (!config.whatsapp.phoneNumberId) return null;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: whatsappFormatter.format(bodyText),
          },
          action: {
            button: buttonTitle.substring(0, 20),
            sections: sections,
          },
        },
      };

      if (headerText) {
        payload.interactive.header = {
          type: 'text',
          text: headerText,
        };
      }

      if (footerText) {
        payload.interactive.footer = {
          text: footerText,
        };
      }

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, payload);
      return response.data;
    } catch (error) {
      logger.error('Failed to send interactive list (falling back to text):', error.response?.data || error.message);
      return this.sendTextMessage(to, bodyText);
    }
  }

  /**
   * Send a document file.
   */
  async sendDocumentMessage(to, documentUrl, caption = '', filename = 'document.pdf') {
    try {
      if (!config.whatsapp.phoneNumberId) return null;

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'document',
        document: {
          link: documentUrl,
          caption: caption,
          filename: filename,
        },
      });

      logger.info(`Document sent to ${to}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to send document:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send location coordinates.
   */
  async sendLocationMessage(to, latitude, longitude, name = '', address = '') {
    try {
      if (!config.whatsapp.phoneNumberId) return null;

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'location',
        location: {
          latitude: latitude,
          longitude: longitude,
          name: name,
          address: address,
        },
      });

      logger.info(`Location sent to ${to}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to send location:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Helper delay.
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new WhatsAppService();
