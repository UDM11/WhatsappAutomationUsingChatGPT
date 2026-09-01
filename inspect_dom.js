require('dotenv').config();
const puppeteer = require('puppeteer-core');

async function inspect() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const rawToken = process.env.CHATGPT_SESSION_TOKEN || '';
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
  } else {
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

  await page.setCookie(...cookies);
  console.log(`Set ${cookies.length} cookies. Navigating to chatgpt.com...`);

  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4000));

  console.log('Final URL:', page.url());
  console.log('Final Title:', await page.title());

  const inputFound = await page.$('#prompt-textarea, textarea, div[contenteditable="true"]');
  console.log('Chat input textarea found:', Boolean(inputFound));

  await browser.close();
}

inspect().catch(console.error);
