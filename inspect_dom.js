require('dotenv').config();
const puppeteer = require('puppeteer-core');

async function testPrompt() {
  const rawToken = process.env.CHATGPT_SESSION_TOKEN || '';
  const tokens = rawToken.split(',').map((t) => t.trim()).filter(Boolean);
  const cookies = tokens.map((val, idx) => ({
    name: `__Secure-next-auth.session-token.${idx}`,
    value: val,
    domain: '.chatgpt.com',
    path: '/',
    httpOnly: true,
    secure: true,
  }));

  if (process.env.CHATGPT_CF_CLEARANCE) {
    cookies.push({
      name: 'cf_clearance',
      value: process.env.CHATGPT_CF_CLEARANCE.trim(),
      domain: '.chatgpt.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  }

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setCookie(...cookies);
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });

  const inputSelector = '#prompt-textarea, textarea, div[contenteditable="true"]';
  await page.waitForSelector(inputSelector, { timeout: 20000 });
  await page.focus(inputSelector);
  await page.keyboard.type('give me html code', { delay: 10 });
  await new Promise((r) => setTimeout(r, 600));

  const sendBtn = await page.$(
    'button[data-testid="send-button"], button[aria-label="Send prompt"], button[data-testid="fruitjuice-send-button"], button.mb-1, button[aria-label="Send"]'
  );
  if (sendBtn) {
    console.log('Send button found! Clicking send button...');
    await sendBtn.click();
  } else {
    console.log('Send button not found, pressing Enter...');
    await page.keyboard.press('Enter');
  }

  console.log('Monitoring DOM for 15 seconds...');
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const data = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], article, .markdown'));
      const text = msgs.map((m) => m.innerText).filter(Boolean);
      const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]');
      const streaming = document.querySelector('.result-streaming');
      return {
        count: msgs.length,
        isStreaming: Boolean(stopBtn || streaming),
        sampleText: text.join(' | ').substring(0, 150),
      };
    });
    console.log(`Sec ${i + 1}: count=${data.count}, streaming=${data.isStreaming}, text=${data.sampleText}`);
  }

  await browser.close();
}

testPrompt().catch(console.error);
