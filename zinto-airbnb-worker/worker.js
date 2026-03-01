import puppeteer from '@cloudflare/puppeteer';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Walk JSON recursively to find muscache.com image URLs
function extractImages(data) {
  const urls = new Set();
  function walk(obj, d) {
    if (!obj || d > 15 || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(i => walk(i, d + 1)); return; }
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.includes('muscache.com')) urls.add(v);
      else walk(v, d + 1);
    }
  }
  walk(data, 0);
  return Array.from(urls)
    .filter(u => (u.includes('/im/pictures/') || u.includes('/pictures/')) && !/avatar|user|profile/i.test(u))
    .map(u => u.replace(/[?&]im_w=\d+/g, '').replace(/[?&]aki_policy=[^&]+/g, ''))
    .map((url, i) => ({
      n: i + 1,
      url: url + (url.includes('?') ? '&' : '?') + 'im_w=1200',
      filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg'
    }));
}

// Regex fallback for when Airbnb serves JSON as text
function extractImagesFromText(text) {
  const matches = text.match(/https?:\/\/[^"]*muscache\.com[^"]*/g) || [];
  const urls = new Set(matches);
  return Array.from(urls)
    .filter(u => (u.includes('/im/pictures/') || u.includes('/pictures/')) && !/avatar|user|profile/i.test(u))
    .map(u => u.replace(/[?&]im_w=\d+/g, '').replace(/[?&]aki_policy=[^&]+/g, ''))
    .map((url, i) => ({
      n: i + 1,
      url: url + (url.includes('?') ? '&' : '?') + 'im_w=1200',
      filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg'
    }));
}

async function scrapeAirbnb(browserBinding, listingUrl) {
  let browser;
  try {
    browser = await puppeteer.launch(browserBinding);
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const scraped = await page.evaluate(() => {
      // Priority 1: legacy element
      const legacy = document.querySelector('#data-injected-user-state');
      if (legacy) {
        try { return { data: JSON.parse(legacy.textContent), source: 'legacy' }; } catch (e) {}
      }
      // Priority 2: current Airbnb 2024+ element
      const deferred = document.querySelector('[id^="data-deferred-state"]');
      if (deferred) {
        try { return { data: JSON.parse(deferred.textContent), source: 'deferred' }; } catch (e) {}
        return { data: deferred.textContent, source: 'deferred-text' };
      }
      // Priority 3: known data keys
      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          if (j && (j.bootstrapData || j.niobeMinimalClientData || j.niobeClientData)) {
            return { data: j, source: 'script-json' };
          }
        } catch (e) {}
      }
      // Priority 4: any script with muscache URLs
      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('/pictures/') && s.textContent.includes('muscache')) {
          return { data: s.textContent, source: 'script-text' };
        }
      }
      return null;
    });

    let images = [];
    if (scraped) {
      if (typeof scraped.data === 'string') {
        images = extractImagesFromText(scraped.data);
      } else {
        images = extractImages(scraped.data);
        if (images.length === 0) images = extractImagesFromText(JSON.stringify(scraped.data));
      }
    }

    return { listingUrl, images, property: {}, status: 'ok', error: null };
  } catch (err) {
    return { listingUrl, images: [], property: {}, status: 'error', error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', backend: 'cf-browser-rendering' }, { headers: CORS });
    }

    if (url.pathname === '/airbnb/extract' && request.method === 'POST') {
      const body = await request.json();
      const urls = body.urls;
      if (!Array.isArray(urls) || urls.length === 0) {
        return Response.json({ error: 'urls[] requerido' }, { status: 400, headers: CORS });
      }
      // CF processes one at a time (concurrent browser sessions limited on free plan)
      const results = [];
      for (const listingUrl of urls.slice(0, 30)) {
        const r = await scrapeAirbnb(env.BROWSER, listingUrl);
        results.push(r);
      }
      return Response.json({ results }, { headers: CORS });
    }

    return new Response('Not found', { status: 404, headers: CORS });
  }
};
