// lib/airbnb-scraper.js
const { getPage } = require('./browser');

function extractImages(data) {
  const urls = new Set();
  function walk(obj, depth) {
    if (!obj || depth > 15 || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(item => walk(item, depth + 1)); return; }
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' && val.includes('muscache.com')) urls.add(val);
      else walk(val, depth + 1);
    }
  }
  walk(data, 0);
  return Array.from(urls)
    .filter(u => u.includes('/im/pictures/') || u.includes('/pictures/'))
    .filter(u => !/avatar|user|profile/i.test(u))
    .map(u => u.replace(/[?&]im_w=\d+/g, '').replace(/[?&]aki_policy=[^&]+/g, ''))
    .map((url, i) => ({
      n: i + 1,
      url: url + (url.includes('?') ? '&' : '?') + 'im_w=1200',
      filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg',
    }));
}

function extractImagesFromText(text) {
  const matches = text.match(/https?:\/\/[^"]*muscache\.com[^"]*/g) || [];
  const unique = [...new Set(matches)]
    .filter(u => /\/im\/pictures\/|\/pictures\//.test(u))
    .filter(u => !/avatar|user|profile/i.test(u))
    .map(u => u.replace(/[?&]im_w=\d+/g, '').replace(/[?&]aki_policy=[^&]+/g, ''));
  return unique.map((url, i) => ({
    n: i + 1,
    url: url + (url.includes('?') ? '&' : '?') + 'im_w=1200',
    filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg',
  }));
}

function extractProperty(data) {
  try {
    const str = JSON.stringify(data);
    const titleMatch = str.match(/"name"\s*:\s*"([^"]{5,80})"/);
    const priceMatch = str.match(/"price"\s*:\s*(\d+)/);
    return {
      title: titleMatch ? titleMatch[1] : '',
      price: priceMatch ? parseInt(priceMatch[1]) : 0,
    };
  } catch (e) { return {}; }
}

async function scrapeAirbnb(listingUrl) {
  const page = await getPage();
  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const scraped = await page.evaluate(() => {
      const legacyEl = document.querySelector('#data-injected-user-state');
      if (legacyEl) return { raw: null, text: legacyEl.textContent, source: 'data-injected-user-state' };

      const deferredEl = document.getElementById('data-deferred-state-0');
      if (deferredEl && deferredEl.textContent.includes('muscache'))
        return { raw: null, text: deferredEl.textContent, source: 'data-deferred-state-0' };

      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          if (j && (j.bootstrapData || j.niobeMinimalClientData || j.niobeClientData))
            return { raw: j, text: null, source: s.id || 'script-json' };
        } catch (e) {}
      }

      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('muscache') && s.textContent.includes('/pictures/'))
          return { raw: null, text: s.textContent, source: 'script-fallback-' + (s.id || 'anon') };
      }
      return null;
    });

    let images = [], property = {};
    if (scraped) {
      if (scraped.raw) {
        images = extractImages(scraped.raw);
        property = extractProperty(scraped.raw);
      } else if (scraped.text) {
        images = extractImagesFromText(scraped.text);
        try { property = extractProperty(JSON.parse(scraped.text)); } catch (e) {}
      }
    }
    return { listingUrl, images, property, status: 'ok', error: null, source: scraped ? scraped.source : 'none' };
  } catch (err) {
    return { listingUrl, images: [], property: {}, status: 'error', error: err.message };
  } finally {
    await page.close();
  }
}

async function processWithConcurrency(urls, concurrency) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const slice = urls.slice(i, i + concurrency);
    const batch = await Promise.all(slice.map(url => scrapeAirbnb(url)));
    results.push(...batch);
  }
  return results;
}

module.exports = { scrapeAirbnb, processWithConcurrency };
