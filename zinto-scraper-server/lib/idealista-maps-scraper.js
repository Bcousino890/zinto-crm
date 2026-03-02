// lib/idealista-maps-scraper.js
const { getPage } = require('./browser');
const { parseIdealistaData } = require('./idealista-maps-extractor');

const MIN_INTERVAL_MS = 3000;
let _lastIdealistaRequest = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function humanDelay() {
  const ms = 1500 + Math.random() * 2500;
  await sleep(ms);
}

async function scrapeIdealistaMaps(url) {
  const now = Date.now();
  const elapsed = now - _lastIdealistaRequest;
  if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  _lastIdealistaRequest = Date.now();

  const page = await getPage();
  try {
    await humanDelay();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
    await sleep(800);
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'smooth' }));
    await sleep(600);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(400);

    const html = await page.content();
    return parseIdealistaData(html, url);
  } finally {
    await page.close();
  }
}

module.exports = { scrapeIdealistaMaps };
