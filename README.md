# WhatsApp ChatGPT Automation

> **WhatsApp auto-reply bot powered by ChatGPT, no API key needed.**
> Built on the official Meta WhatsApp Business API.

Automatically replies to incoming WhatsApp messages using ChatGPT (via chatgpt.com) — no ChatGPT API key required. Handles text responses, remembers conversation context, and shows typing indicators for a natural chat feel.

## ✨ Features

- 🤖 **Auto-replies** to WhatsApp messages using ChatGPT
- 🔑 **No API key needed** — drives chatgpt.com directly via Puppeteer
- 💬 **Text responses** with conversation memory
- ✍️ **Typing indicators** for a natural chat experience
- 🛡️ **Rate limiting** built in
- 📦 **Production-ready** with secure HTTPS webhook handling

## 🏗 Architecture

```
WhatsApp User -> Meta Webhook -> Your Server -> ChatGPT (chatgpt.com) -> Response
```

## ⚙️ Requirements

- Node.js 18+
- A [Meta Developer](https://developers.facebook.com/) account (free)
- A ChatGPT account (free)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd whatsapp-automation
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
# WhatsApp Business API (Meta Developer)
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Server
PORT=3000
BASE_URL=https://your-public-url.com
```

> **Note:** `BASE_URL` must be your public HTTPS URL. WhatsApp needs it to display responses.

### 3. ChatGPT Session

1. Open [chatgpt.com](https://chatgpt.com) and log in
2. Open Developer Tools (F12) → Application → Cookies
3. Copy the following cookies into `.env`:
   - `__Secure-next-auth.session-token` → `CHATGPT_SESSION_TOKEN`
   - `cf_clearance` → `CHATGPT_CF_CLEARANCE`

### 4. Start the Server

```bash
npm run dev
```

### 5. Configure Webhook

In [Meta Developer Console](https://developers.facebook.com/) → WhatsApp → Configuration:

- **Webhook URL:** `https://your-public-url.com/api/webhook`
- **Verify Token:** (value from your `.env`)
- **Subscribe to:** `messages`

Then send a message to your connected WhatsApp number — ChatGPT will reply automatically.

## 📚 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business phone number ID | ✅ |
| `WHATSAPP_ACCESS_TOKEN` | Meta API access token | ✅ |
| `WHATSAPP_VERIFY_TOKEN` | Custom webhook verification token | ✅ |
| `CHATGPT_SESSION_TOKEN` | ChatGPT session cookie | ✅ |
| `CHATGPT_CF_CLEARANCE` | ChatGPT Cloudflare clearance cookie | ✅ |
| `BASE_URL` | Public HTTPS URL of your server | ✅ |
| `PORT` | Server port (default 3000) | ❌ |
| `WEBHOOK_SECRET` | For verifying webhook signatures | ❌ |

## 📁 Project Structure

```
src/
├── config/
│   └── index.js          # Configuration & env variables
├── handlers/
│   ├── messageHandler.js # Message processing logic
│   └── webhookHandler.js # Webhook API routes
├── middleware/
│   └── webhookAuth.js    # Security & signature verification
├── services/
│   ├── chatgpt.js        # ChatGPT integration (Puppeteer)
│   └── whatsapp.js       # WhatsApp Business API client
├── utils/
│   └── logger.js         # Logging configuration
└── index.js              # Server entry point
```

## 🚧 Troubleshooting

#### ChatGPT not responding
- Session cookies may have expired — re-login and update `.env`
- Check if chatgpt.com has changed its layout

#### Messages not received
- Verify webhook URL is correct
- Ensure HTTPS certificate is valid
- Check Meta webhook logs in Developer Console

#### Server crashes
- Check logs in `logs/` folder
- Verify all environment variables are set

## 📄 License

This project is for personal/educational use. Make sure to comply with Meta's and OpenAI's terms of service.

---

**Made with ❤️** for automating WhatsApp with ChatGPT.
