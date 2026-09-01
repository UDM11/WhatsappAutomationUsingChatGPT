/**
 * WhatsApp ChatGPT Pro • Client Application & Simulator Controller
 */

class AppController {
  constructor() {
    this.phone = '+9779818155158';
    this.isProcessing = false;
    this.eventSource = null;

    // DOM Elements
    this.chatFeed = document.getElementById('chat-feed');
    this.chatForm = document.getElementById('chat-form');
    this.inputBox = document.getElementById('user-input-box');
    this.typingIndicator = document.getElementById('typing-indicator');
    this.consoleFeed = document.getElementById('console-feed');
    this.presenceText = document.getElementById('wa-presence-text');
    this.attachPopup = document.getElementById('attach-popup');

    // Stat Elements
    this.statTotalMsgs = document.getElementById('stat-total-msgs');
    this.statActiveUsers = document.getElementById('stat-active-users');
    this.statLatency = document.getElementById('stat-latency');
    this.statMemory = document.getElementById('stat-memory');
    this.uptimeDisplay = document.getElementById('uptime-display');

    this.init();
  }

  init() {
    this.updateClock();
    setInterval(() => this.updateClock(), 10000);

    this.bindEvents();
    this.connectEventStream();
    this.fetchStatus();
    setInterval(() => this.fetchStatus(), 15000);
  }

  updateClock() {
    const timeElem = document.getElementById('device-time');
    if (timeElem) {
      const now = new Date();
      timeElem.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  bindEvents() {
    // Chat Form Submit
    if (this.chatForm) {
      this.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    // Input Enter handler
    if (this.inputBox) {
      this.inputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // Quick Prompts
    document.querySelectorAll('.quick-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        if (prompt) {
          this.inputBox.value = prompt;
          this.sendMessage();
        }
      });
    });

    // Refresh Stats
    const btnRefresh = document.getElementById('btn-refresh-stats');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.fetchStatus();
        this.logConsole('Manually refreshed system metrics.', 'info');
      });
    }

    // Clear Chat
    const btnClearChat = document.getElementById('btn-clear-chat');
    if (btnClearChat) {
      btnClearChat.addEventListener('click', async () => {
        await fetch('/api/dashboard/clear-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.phone }),
        });
        this.chatFeed.innerHTML = `
          <div class="chat-date-pill">TODAY</div>
          <div class="chat-bubble bot-bubble">
            <div class="bubble-content">
              <p><strong>🔄 Chat history cleared.</strong></p>
              <p>How can I assist you right now?</p>
            </div>
            <div class="bubble-meta">
              <span class="bubble-time">${this.formatTime(new Date())}</span>
            </div>
          </div>
        `;
        this.logConsole('Chat history cleared for ' + this.phone, 'warn');
      });
    }

    // Clear Console Logs
    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        if (this.consoleFeed) this.consoleFeed.innerHTML = '';
      });
    }

    // Attachment Popup Toggle
    const btnAttach = document.getElementById('btn-attach-toggle');
    if (btnAttach && this.attachPopup) {
      btnAttach.addEventListener('click', () => {
        const isHidden = this.attachPopup.style.display === 'none';
        this.attachPopup.style.display = isHidden ? 'grid' : 'none';
      });

      document.querySelectorAll('.attach-item').forEach((item) => {
        item.addEventListener('click', () => {
          const type = item.getAttribute('data-type');
          this.attachPopup.style.display = 'none';
          this.sendMediaMessage(type);
        });
      });
    }

    // Lightbox Close
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxOverlay = document.getElementById('lightbox-overlay');
    if (lightboxClose && lightboxOverlay && lightboxModal) {
      const close = () => { lightboxModal.style.display = 'none'; };
      lightboxClose.addEventListener('click', close);
      lightboxOverlay.addEventListener('click', close);
    }
  }

  async sendMessage() {
    const text = this.inputBox.value.trim();
    if (!text || this.isProcessing) return;

    this.inputBox.value = '';
    this.isProcessing = true;

    // 1. Append User Bubble
    this.appendUserBubble(text);
    this.showTyping(true);

    const startTime = Date.now();
    try {
      this.logConsole(`[Simulator] Sending prompt to ChatGPT: "${text.substring(0, 40)}..."`, 'info');

      const res = await fetch('/api/dashboard/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.phone,
          text: text,
          type: 'text',
        }),
      });

      const data = await res.json();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (data.success && data.data) {
        this.appendBotBubble(data.data.reply, data.data.images);
        this.logConsole(`[Simulator] ChatGPT response received (${elapsed}s, ${data.data.reply?.length} chars)`, 'success');
        if (this.statLatency) {
          this.statLatency.textContent = `~${elapsed}s`;
        }
      } else {
        const errMsg = data.error || 'Temporary server error';
        this.appendBotBubble(`⚠️ *Error:* ${errMsg}`);
        this.logConsole(`[Simulator Error] ${errMsg}`, 'error');
      }
    } catch (err) {
      this.appendBotBubble('⚠️ *Error connecting to bot server.*');
      this.logConsole(`[Network Error] ${err.message}`, 'error');
    } finally {
      this.showTyping(false);
      this.isProcessing = false;
      this.fetchStatus();
    }
  }

  async sendMediaMessage(type) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const sampleText = {
      image: '[Shared a photo with ChatGPT]',
      document: '[Uploaded Document: Business_Plan.pdf]',
      audio: '[Recorded 14s Voice Audio Note]',
      location: '[Shared Live GPS Location: Kathmandu, Nepal]',
    }[type] || `[${type} message]`;

    this.appendUserBubble(sampleText);
    this.showTyping(true);

    try {
      const res = await fetch('/api/dashboard/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.phone,
          text: sampleText,
          type: type,
        }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        this.appendBotBubble(data.data.reply, data.data.images);
      }
    } catch (err) {
      this.appendBotBubble('⚠️ *Error processing media message.*');
    } finally {
      this.showTyping(false);
      this.isProcessing = false;
      this.fetchStatus();
    }
  }

  appendUserBubble(text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user-bubble';
    bubble.innerHTML = `
      <div class="bubble-content">
        <p>${this.escapeHtml(text)}</p>
      </div>
      <div class="bubble-meta">
        <span class="bubble-time">${this.formatTime(new Date())}</span>
        <span class="read-ticks"><i class="fa-solid fa-check-double"></i></span>
      </div>
    `;
    this.chatFeed.appendChild(bubble);
    this.scrollToBottom();
  }

  appendBotBubble(rawText, images = []) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot-bubble';

    let contentHtml = this.renderMarkdown(rawText);

    if (images && images.length > 0) {
      images.forEach((imgUrl) => {
        contentHtml += `
          <div class="bubble-img-container" style="margin-top: 8px;">
            <img src="${imgUrl}" alt="Generated Image" style="max-width: 100%; border-radius: 8px; cursor: pointer;" onclick="app.openLightbox('${imgUrl}')" />
          </div>
        `;
      });
    }

    bubble.innerHTML = `
      <div class="bubble-content">
        ${contentHtml}
      </div>
      <div class="bubble-meta">
        <span class="bubble-time">${this.formatTime(new Date())}</span>
      </div>
    `;

    this.chatFeed.appendChild(bubble);
    this.scrollToBottom();
  }

  renderMarkdown(text) {
    if (!text) return '';

    let formatted = this.escapeHtml(text);

    // Code Blocks: ```lang\ncode\n```
    formatted = formatted.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'CODE';
      const cleanCode = code.trim();
      return `
        <div class="bubble-code-block">
          <div class="bubble-code-header">
            <span>${language.toUpperCase()}</span>
            <button onclick="app.copyCode(this)">
              <i class="fa-regular fa-copy"></i> Copy
            </button>
          </div>
          <pre class="bubble-code-body"><code>${cleanCode}</code></pre>
        </div>
      `;
    });

    // Inline code: `code`
    formatted = formatted.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Bold: *bold*
    formatted = formatted.replace(/\*(.*?)\*/g, '<strong>$1</strong>');

    // Italic: _italic_
    formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');

    // Bullets: • bullet
    formatted = formatted.replace(/^•\s+(.+)$/gm, '<li style="margin-left: 14px;">$1</li>');

    // Newlines to <br> or <p>
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');

    return `<p>${formatted}</p>`;
  }

  showTyping(show) {
    if (this.typingIndicator) {
      this.typingIndicator.style.display = show ? 'flex' : 'none';
      if (show) this.scrollToBottom();
    }
    if (this.presenceText) {
      this.presenceText.textContent = show ? 'typing...' : 'online';
      this.presenceText.style.color = show ? '#25d366' : '#8696a0';
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      if (this.chatFeed) {
        this.chatFeed.scrollTop = this.chatFeed.scrollHeight;
      }
    }, 50);
  }

  async fetchStatus() {
    try {
      const res = await fetch('/api/dashboard/status');
      const data = await res.json();

      if (this.statTotalMsgs && data.stats) {
        this.statTotalMsgs.textContent = data.stats.totalMessagesProcessed || '0';
      }
      if (this.statActiveUsers && data.stats) {
        this.statActiveUsers.textContent = data.stats.totalUsersTracked || '1';
      }
      if (this.statMemory && data.server?.memory) {
        this.statMemory.textContent = `${data.server.memory.rssMb} MB`;
      }
      if (this.uptimeDisplay && data.uptime) {
        const mins = Math.floor(data.uptime / 60);
        const hours = Math.floor(mins / 60);
        this.uptimeDisplay.textContent = `Uptime: ${hours}h ${mins % 60}m`;
      }
    } catch {
      // Ignore background stats fetch errors
    }
  }

  connectEventStream() {
    try {
      this.eventSource = new EventSource('/api/dashboard/events');

      this.eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'event' && payload.event) {
            this.handleLiveEvent(payload.event);
          }
        } catch {
          // Ignore JSON parse errors
        }
      };

      this.eventSource.onerror = () => {
        // SSE auto-reconnects
      };
    } catch (err) {
      this.logConsole('SSE Stream error: ' + err.message, 'warn');
    }
  }

  handleLiveEvent(evt) {
    const time = new Date().toLocaleTimeString();
    switch (evt.name) {
      case 'incoming_message':
        this.logConsole(`[${time}] Incoming WhatsApp message from ${evt.data.from} (${evt.data.type})`, 'info');
        break;
      case 'chatgpt_prompt_start':
        this.logConsole(`[${time}] ChatGPT prompt processing started...`, 'info');
        break;
      case 'chatgpt_prompt_done':
        this.logConsole(`[${time}] ChatGPT generated response in ${evt.data.duration}ms`, 'success');
        break;
      case 'outgoing_reply':
        this.logConsole(`[${time}] Reply dispatched to ${evt.data.to}`, 'success');
        break;
      case 'chatgpt_error':
        this.logConsole(`[${time}] ChatGPT Error: ${evt.data.error}`, 'error');
        break;
    }
    this.fetchStatus();
  }

  logConsole(message, type = 'info') {
    if (!this.consoleFeed) return;

    const line = document.createElement('div');
    line.className = `console-line line-${type}`;
    line.textContent = message;

    this.consoleFeed.appendChild(line);
    this.consoleFeed.scrollTop = this.consoleFeed.scrollHeight;

    // Keep max 50 lines
    while (this.consoleFeed.children.length > 50) {
      this.consoleFeed.removeChild(this.consoleFeed.firstChild);
    }
  }

  copyCode(btn) {
    const codeBlock = btn.closest('.bubble-code-block');
    const code = codeBlock.querySelector('code').innerText;
    navigator.clipboard.writeText(code).then(() => {
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
      }, 2000);
    });
  }

  openLightbox(src) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) {
      img.src = src;
      modal.style.display = 'flex';
    }
  }

  formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Instantiate global app controller
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new AppController();
  window.app = app;
});
