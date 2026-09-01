const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');

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

  async sendTextMessage(to, text) {
    try {
      const truncatedText = text.length > 4096 ? text.substring(0, 4093) + '...' : text;

      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: truncatedText,
        },
      });

      logger.info(`Message sent to ${to}`, { messageId: response.data.messages?.[0]?.id });
      return response.data;
    } catch (error) {
      logger.error('Failed to send WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  async sendTextWithTyping(to, text, typingDelay = 1000) {
    try {
      await this.sendPresence(to, 'composing');
      await this._delay(typingDelay);
      await this.sendTextMessage(to, text);
      await this.sendPresence(to, 'paused');
    } catch (error) {
      logger.error('Failed to send message with typing:', error);
      throw error;
    }
  }

  async sendPresence(to, presence) {
    try {
      await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        to: to,
        type: 'reaction',
        reaction: {
          message_id: '',
          emoji: '',
        },
      });
    } catch {
      // Presence API may not be supported, ignore
    }
  }

  async markAsRead(messageId) {
    try {
      await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch (error) {
      logger.error('Failed to mark as read:', error);
    }
  }

  async sendSeenStatus(to) {
    try {
      await this.client.post(
        `/${config.whatsapp.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
        },
        {
          params: { messaging_product: 'whatsapp' },
        }
      );
    } catch {
      // Ignore seen status errors
    }
  }

  async getMediaUrl(mediaId) {
    try {
      const response = await this.client.get(`/${mediaId}`);
      return response.data.url;
    } catch (error) {
      logger.error('Failed to get media URL:', error);
      throw error;
    }
  }

  async downloadMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
        },
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Failed to download media:', error);
      throw error;
    }
  }

  async sendImageMessage(to, imageUrl, caption = '') {
    try {
      const response = await this.client.post(`/${config.whatsapp.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'image',
        image: {
          link: imageUrl,
          caption: caption,
        },
      });

      logger.info(`Image sent to ${to}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to send image:', error);
      throw error;
    }
  }

  async sendDocumentMessage(to, documentUrl, caption = '', filename = 'document.pdf') {
    try {
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
      logger.error('Failed to send document:', error);
      throw error;
    }
  }

  async sendLocationMessage(to, latitude, longitude, name = '', address = '') {
    try {
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
      logger.error('Failed to send location:', error);
      throw error;
    }
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new WhatsAppService();
