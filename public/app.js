// Professional WhatsApp AI Application Logic
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const chatCanvas = document.getElementById('wa-chat-canvas');
  const inputField = document.getElementById('wa-input');
  const sendActionBtn = document.getElementById('btn-send-action');
  const iconSend = document.getElementById('icon-send');
  const iconMic = document.getElementById('icon-mic');
  const typingWave = document.getElementById('wa-typing-wave');
  const presenceStatus = document.getElementById('wa-presence');
  const smartPills = document.querySelectorAll('.smart-pill');
  const deviceClock = document.getElementById('device-clock');
  const initialTime = document.getElementById('initial-time');
  
  // Modals & Drawers
  const btnHdrMenu = document.getElementById('btn-hdr-menu');
  const dropdownMenu = document.getElementById('wa-dropdown-menu');
  const menuClearChat = document.getElementById('menu-clear-chat');
  const menuViewProfile = document.getElementById('menu-view-profile');
  const menuAiStatus = document.getElementById('menu-ai-status');
  const btnOpenProfile = document.getElementById('btn-open-profile');
  const profileDrawer = document.getElementById('profile-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const drawerLatency = document.getElementById('drawer-latency');
  const btnAttach = document.getElementById('btn-attach');
  const attachmentSheet = document.getElementById('attachment-sheet');
  const attachmentOptions = document.querySelectorAll('.attachment-option');

  // 1. Clock Updates
  function updateDeviceClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (deviceClock) deviceClock.textContent = timeStr.replace(/ AM| PM/i, '');
    if (initialTime) initialTime.textContent = timeStr;
  }
  updateDeviceClock();
  setInterval(updateDeviceClock, 30000);

  function getCurrentTimeString() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToBottom() {
    chatCanvas.scrollTop = chatCanvas.scrollHeight;
  }

  // 2. WhatsApp Markdown Parser
  function formatWhatsAppMarkdown(text) {
    if (!text) return '';
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks ```code```
    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code `code`
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold *bold* or **bold**
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');

    // Italics _italic_
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough ~strike~
    formatted = formatted.replace(/~([^~]+)~/g, '<del>$1</del>');

    // Convert newlines to <br/>
    formatted = formatted.replace(/\n/g, '<br/>');

    return formatted;
  }

  // 3. Append Chat Message Bubble with Tick Animations
  function appendMessage(sender, text, type = 'text', images = []) {
    const bubble = document.createElement('div');
    bubble.className = `wa-bubble ${sender === 'user' ? 'wa-user-bubble' : 'wa-bot-bubble'}`;

    let contentHtml = `<div class="wa-bubble-content">${formatWhatsAppMarkdown(text)}</div>`;

    if (images && images.length > 0) {
      images.forEach((imgUrl) => {
        contentHtml += `<div style="margin-top: 6px;"><img src="${imgUrl}" style="max-width: 100%; border-radius: 8px;" alt="Media" /></div>`;
      });
    }

    const timeStr = getCurrentTimeString();
    const tickId = `tick_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const metaHtml = `
      <div class="wa-bubble-meta">
        <span class="wa-time">${timeStr}</span>
        ${sender === 'user' ? `<span class="wa-ticks gray" id="${tickId}">✓</span>` : ''}
      </div>
    `;

    bubble.innerHTML = contentHtml + metaHtml;
    chatCanvas.insertBefore(bubble, typingWave);
    scrollToBottom();

    // Tick progression animation for user messages
    if (sender === 'user') {
      setTimeout(() => {
        const tickEl = document.getElementById(tickId);
        if (tickEl) {
          tickEl.textContent = '✓✓'; // Delivered
        }
      }, 400);
    }

    return tickId;
  }

  function markTicksBlue(tickId) {
    if (!tickId) return;
    const tickEl = document.getElementById(tickId);
    if (tickEl) {
      tickEl.className = 'wa-ticks blue';
      tickEl.textContent = '✓✓';
    }
  }

  // 4. Typing State Management
  function setBotTyping(isTyping) {
    typingWave.style.display = isTyping ? 'block' : 'none';
    if (presenceStatus) {
      presenceStatus.textContent = isTyping ? 'typing...' : 'online';
      presenceStatus.style.color = '#25d366';
    }
    if (isTyping) scrollToBottom();
  }

  // 5. Send Message to Backend (ChatGPT Session Automation)
  async function handleSendMessage(customText, messageType = 'text') {
    const rawText = customText || inputField.value.trim();
    if (!rawText) return;

    // Add user bubble
    const userTickId = appendMessage('user', rawText, messageType);
    inputField.value = '';
    updateComposerIcon();
    attachmentSheet.classList.remove('active');

    // Show bot typing wave
    setBotTyping(true);
    sendActionBtn.disabled = true;

    const startTime = Date.now();

    try {
      const res = await fetch('/api/dashboard/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: '+15550192834',
          text: rawText,
          type: messageType,
        }),
      });

      const data = await res.json();
      const duration = Date.now() - startTime;

      if (drawerLatency) {
        drawerLatency.textContent = `${duration} ms`;
      }

      setBotTyping(false);
      sendActionBtn.disabled = false;
      markTicksBlue(userTickId);

      if (data.success && data.data) {
        const replyText = data.data.reply || 'I received your request.';
        appendMessage('bot', replyText, 'text', data.data.images);
      } else {
        appendMessage('bot', `⚠️ ${data.error || 'Unable to generate response from ChatGPT.'}`);
      }
    } catch (err) {
      setBotTyping(false);
      sendActionBtn.disabled = false;
      appendMessage('bot', `⚠️ Connection error: ${err.message}`);
    }
  }

  // 6. Composer Input & Button Toggling
  function updateComposerIcon() {
    const hasText = inputField.value.trim().length > 0;
    if (hasText) {
      iconSend.classList.remove('hidden');
      iconMic.classList.add('hidden');
    } else {
      iconSend.classList.remove('hidden'); // Keep send icon clear for usability
      iconMic.classList.add('hidden');
    }
  }

  inputField.addEventListener('input', updateComposerIcon);

  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  });

  sendActionBtn.addEventListener('click', () => {
    handleSendMessage();
  });

  // 7. Smart Suggestion Pills
  smartPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const prompt = pill.dataset.prompt;
      if (prompt) {
        handleSendMessage(prompt);
      }
    });
  });

  // 8. Attachments Sheet
  btnAttach.addEventListener('click', (e) => {
    e.stopPropagation();
    attachmentSheet.classList.toggle('active');
  });

  attachmentOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      const type = opt.dataset.type;
      const msg = opt.dataset.msg;
      attachmentSheet.classList.remove('active');
      handleSendMessage(msg, type);
    });
  });

  // 9. Dropdown Menu (3-Dots)
  btnHdrMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!dropdownMenu.contains(e.target) && e.target !== btnHdrMenu) {
      dropdownMenu.classList.remove('active');
    }
    if (!attachmentSheet.contains(e.target) && e.target !== btnAttach) {
      attachmentSheet.classList.remove('active');
    }
  });

  // 10. Menu Actions
  menuClearChat.addEventListener('click', async () => {
    dropdownMenu.classList.remove('active');
    await fetch('/api/dashboard/clear-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'all' }),
    });

    const bubbles = chatCanvas.querySelectorAll('.wa-bubble');
    bubbles.forEach((b, idx) => {
      if (idx > 0) b.remove();
    });
  });

  menuViewProfile.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
    profileDrawer.classList.add('active');
  });

  menuAiStatus.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
    profileDrawer.classList.add('active');
  });

  btnOpenProfile.addEventListener('click', (e) => {
    if (e.target.closest('#wa-back-btn')) return;
    profileDrawer.classList.add('active');
  });

  btnCloseDrawer.addEventListener('click', () => {
    profileDrawer.classList.remove('active');
  });

  // Focus input automatically
  inputField.focus();
});
