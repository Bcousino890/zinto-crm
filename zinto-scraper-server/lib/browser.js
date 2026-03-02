// lib/browser.js
// Singleton persistent Playwright browser context.
// The same context (with accumulated cookies + fingerprint) is reused across
// all requests, behaving like a real user that browses continuously.

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const path = require('path');

chromium.use(stealth());

const PROFILE_DIR = path.join(os.homedir(), '.zinto-scraper-profile');

let _context = null;
let _browser = null;

async function getContext() {
  if (_context) return _context;

  _browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: null,
    userAgent: undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  _context = _browser;
  return _context;
}

async function getPage() {
  const ctx = await getContext();
  const page = await ctx.newPage();

  // Randomise viewport (1280-1920 wide, 720-1080 tall)
  const w = 1280 + Math.floor(Math.random() * 640);
  const h = 720  + Math.floor(Math.random() * 360);
  await page.setViewportSize({ width: w, height: h });

  return page;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _context = null;
  }
}

// Graceful shutdown
process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

module.exports = { getPage, getContext, closeBrowser };
