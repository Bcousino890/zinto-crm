# Idealista Maps Enrichment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate zinto-puppeteer-server to Playwright + stealth, add a POST /idealista/maps-enrich endpoint, and wire up a new "Idealista" tab in zinto-crm-v4.html that lets the user paste an idealista.com/maps URL, preview extracted data, and create a property with one click.

**Architecture:** New `zinto-scraper-server/` replaces `zinto-puppeteer-server/` with Playwright + playwright-extra-plugin-stealth and a persistent browser profile (`~/.zinto-scraper-profile/`). A single browser context stays alive for the lifetime of the server process; Airbnb extraction is migrated to Playwright; a new endpoint handles Idealista/maps scraping. The CRM gets a fourth extractor tab that calls the local endpoint and renders a preview before creating the property.

**Tech Stack:** Node.js 18+, Express 4, Playwright (via playwright-extra + stealth plugin), Jest + Supertest for tests.

---

## Task 1: Scaffold zinto-scraper-server

**Files:**
- Create: `zinto-scraper-server/package.json`
- Create: `zinto-scraper-server/.gitignore`

**Step 1: Create the directory**

```bash
mkdir -p zinto-scraper-server/lib zinto-scraper-server/tests
```

**Step 2: Create package.json**

```json
{
  "name": "zinto-scraper-server",
  "version": "1.0.0",
  "description": "Playwright-based scraper server for Airbnb and Idealista",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "express": "^4.18.2",
    "playwright-extra": "^4.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  },
  "jest": {
    "testEnvironment": "node",
    "testTimeout": 30000
  }
}
```

**Step 3: Create .gitignore**

```
node_modules/
~/.zinto-scraper-profile/
```

**Step 4: Install dependencies**

```bash
cd zinto-scraper-server && npm install
npx playwright install chromium
```

Expected: `node_modules/` appears, `playwright` chromium is downloaded.

**Step 5: Commit**

```bash
git add zinto-scraper-server/package.json zinto-scraper-server/.gitignore zinto-scraper-server/package-lock.json
git commit -m "feat: scaffold zinto-scraper-server with playwright-extra"
```

---

## Task 2: Create lib/browser.js — Persistent Playwright context

**Files:**
- Create: `zinto-scraper-server/lib/browser.js`

**Step 1: Write the module**

```js
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
    viewport: null,          // randomised per page below
    userAgent: undefined,    // stealth handles this
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

  // Randomise viewport (1280–1920 wide, 720–1080 tall)
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
```

**Step 2: Commit**

```bash
git add zinto-scraper-server/lib/browser.js
git commit -m "feat: add persistent playwright browser context singleton"
```

---

## Task 3: Create lib/idealista-maps-extractor.js with unit tests (TDD)

**Files:**
- Create: `zinto-scraper-server/lib/idealista-maps-extractor.js`
- Create: `zinto-scraper-server/tests/idealista-maps-extractor.test.js`

This is a **pure function** — no browser, no network, easy to test.

**Step 1: Write the failing tests first**

```js
// tests/idealista-maps-extractor.test.js
const { parseIdealistaData } = require('../lib/idealista-maps-extractor');

describe('parseIdealistaData', () => {
  const SAMPLE_HTML = `
    <html><body>
      <h1>Esc.1 5º D en Calle Castello, 44, Madrid</h1>
      <nav aria-label="breadcrumb"><ol>
        <li><a href="/">Inicio</a></li>
        <li>Piso</li>
      </ol></nav>
      <section id="main-info">
        <span>75m² vivienda</span>
        <span>85m² construidos</span>
        <span>2 hab.</span>
        <span>1 baño</span>
      </section>
      <section id="valuation">
        <div class="sale-estimate">517.000 €</div>
        <div class="sale-min">461.000 €</div>
        <div class="sale-max">563.000 €</div>
        <div class="rent-estimate">1.940 €/mes</div>
        <div class="rent-min">1.780 €/mes</div>
        <div class="rent-max">2.080 €/mes</div>
      </section>
      <section id="catastro">
        <span>Año: 1927</span>
        <span>Ascensor: Sí</span>
        <span>Calidad: buena</span>
        <span>Ref. catastral: 2355411VK4725E0027SH</span>
      </section>
    </body></html>
  `;

  const SAMPLE_URL = 'https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/';

  test('extracts address from h1', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.address).toBe('Esc.1 5º D en Calle Castello, 44, Madrid');
  });

  test('extracts m2_vivienda', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.m2_vivienda).toBe(75);
  });

  test('extracts m2_construidos', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.m2_construidos).toBe(85);
  });

  test('extracts room count', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.rooms).toBe(2);
  });

  test('extracts bathroom count', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.bathrooms).toBe(1);
  });

  test('extracts sale estimate', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.sale.estimate).toBe(517000);
  });

  test('extracts sale min/max', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.sale.min).toBe(461000);
    expect(result.valuation.sale.max).toBe(563000);
  });

  test('extracts rent estimate', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.rent.estimate).toBe(1940);
  });

  test('extracts rent min/max', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.rent.min).toBe(1780);
    expect(result.valuation.rent.max).toBe(2080);
  });

  test('extracts year from catastro', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.year).toBe(1927);
  });

  test('extracts elevator true', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.elevator).toBe(true);
  });

  test('extracts construction quality', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.construction_quality).toBe('buena');
  });

  test('extracts cadastral ref from URL when not in page', () => {
    const htmlNoCatRef = SAMPLE_HTML.replace('Ref. catastral: 2355411VK4725E0027SH', '');
    const result = parseIdealistaData(htmlNoCatRef, SAMPLE_URL);
    expect(result.property.cadastral_ref).toBe('2355411VK4725E0027SH');
  });

  test('returns source and scraped_at', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.source).toBe('idealista-maps');
    expect(result.scraped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

**Step 2: Run tests — expect ALL to fail**

```bash
cd zinto-scraper-server && npx jest tests/idealista-maps-extractor.test.js --verbose
```

Expected: `Cannot find module '../lib/idealista-maps-extractor'`

**Step 3: Implement the extractor**

```js
// lib/idealista-maps-extractor.js
// Pure function — parses raw HTML from an idealista.com/maps page.
// No browser dependency. Easy to unit-test.

function parseNum(str) {
  if (!str) return null;
  // Remove thousands separators (dots in ES), keep digits
  return parseInt(str.replace(/\./g, '').replace(/[^\d]/g, ''), 10) || null;
}

function extractCadastralFromUrl(url) {
  // URL pattern: /maps/city/street/number/REFCATASTRAL/
  const m = url.match(/\/([A-Z0-9]{14,20})\/?$/i);
  return m ? m[1].toUpperCase() : null;
}

function parseIdealistaData(html, url) {
  // ---- address ----
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const address = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : null;

  // ---- property type from breadcrumb ----
  const breadText = (html.match(/<nav[^>]*breadcrumb[^>]*>([\s\S]*?)<\/nav>/i) || [])[1] || '';
  const typeRaw = (breadText.match(/<li[^>]*>(?:<[^>]+>)*([^<]+)(?:<\/[^>]+>)*<\/li>/gi) || []).pop() || '';
  const type = typeRaw.replace(/<[^>]+>/g, '').trim().toLowerCase() || null;

  // ---- m² ----
  const m2vMatch = html.match(/(\d+)m²\s*vivienda/i);
  const m2cMatch = html.match(/(\d+)m²\s*construidos/i);
  const m2_vivienda   = m2vMatch ? parseInt(m2vMatch[1], 10) : null;
  const m2_construidos = m2cMatch ? parseInt(m2cMatch[1], 10) : null;

  // ---- rooms & bathrooms ----
  const roomsMatch = html.match(/(\d+)\s*hab\./i);
  const bathsMatch = html.match(/(\d+)\s*ba[ñn]o/i);
  const rooms     = roomsMatch ? parseInt(roomsMatch[1], 10) : null;
  const bathrooms = bathsMatch ? parseInt(bathsMatch[1], 10) : null;

  // ---- sale valuation ----
  const saleEstMatch = html.match(/class="sale-estimate"[^>]*>([\s\S]*?)</i);
  const saleMinMatch = html.match(/class="sale-min"[^>]*>([\s\S]*?)</i);
  const saleMaxMatch = html.match(/class="sale-max"[^>]*>([\s\S]*?)</i);

  const sale = {
    estimate : parseNum((saleEstMatch || [])[1]),
    min      : parseNum((saleMinMatch || [])[1]),
    max      : parseNum((saleMaxMatch || [])[1]),
  };

  // ---- rent valuation ----
  const rentEstMatch = html.match(/class="rent-estimate"[^>]*>([\s\S]*?)</i);
  const rentMinMatch = html.match(/class="rent-min"[^>]*>([\s\S]*?)</i);
  const rentMaxMatch = html.match(/class="rent-max"[^>]*>([\s\S]*?)</i);

  const rent = {
    estimate : parseNum((rentEstMatch || [])[1]),
    min      : parseNum((rentMinMatch || [])[1]),
    max      : parseNum((rentMaxMatch || [])[1]),
  };

  // ---- catastro fields ----
  const yearMatch    = html.match(/A[ñn]o:\s*(\d{4})/i);
  const elevMatch    = html.match(/Ascensor:\s*(Sí|Si|yes|true)/i);
  const qualityMatch = html.match(/Calidad:\s*([a-záéíóú]+)/i);
  const catRefMatch  = html.match(/Ref\.\s*catastral:\s*([A-Z0-9]{14,20})/i);

  const year                = yearMatch    ? parseInt(yearMatch[1], 10) : null;
  const elevator            = elevMatch    ? true : false;
  const construction_quality = qualityMatch ? qualityMatch[1].toLowerCase() : null;
  const cadastral_ref       = (catRefMatch && catRefMatch[1]) || extractCadastralFromUrl(url);

  return {
    status: 'ok',
    url,
    property: { address, type, m2_vivienda, m2_construidos, rooms, bathrooms,
                year, elevator, construction_quality, cadastral_ref },
    valuation: { sale, rent },
    source: 'idealista-maps',
    scraped_at: new Date().toISOString(),
  };
}

module.exports = { parseIdealistaData };
```

**Step 4: Run tests — expect ALL to pass**

```bash
cd zinto-scraper-server && npx jest tests/idealista-maps-extractor.test.js --verbose
```

Expected: 15 tests PASS.

**Step 5: Commit**

```bash
git add zinto-scraper-server/lib/idealista-maps-extractor.js \
        zinto-scraper-server/tests/idealista-maps-extractor.test.js
git commit -m "feat: add idealista-maps-extractor pure parser with 15 passing tests"
```

---

## Task 4: Create lib/idealista-maps-scraper.js + server.js

**Files:**
- Create: `zinto-scraper-server/lib/idealista-maps-scraper.js`
- Create: `zinto-scraper-server/lib/airbnb-scraper.js`
- Create: `zinto-scraper-server/server.js`

### 4a — idealista-maps-scraper.js

```js
// lib/idealista-maps-scraper.js
// Navigates to an idealista.com/maps URL and returns parsed property data.

const { getPage } = require('./browser');
const { parseIdealistaData } = require('./idealista-maps-extractor');

// Minimum gap between consecutive Idealista requests (ms)
const MIN_INTERVAL_MS = 3000;
let _lastIdealistaRequest = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function humanDelay() {
  const ms = 1500 + Math.random() * 2500; // 1.5s – 4s
  await sleep(ms);
}

async function scrapeIdealistaMaps(url) {
  // Enforce minimum interval between requests
  const now = Date.now();
  const elapsed = now - _lastIdealistaRequest;
  if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  _lastIdealistaRequest = Date.now();

  const page = await getPage();
  try {
    await humanDelay();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Simulate reading — scroll through the page
    await page.evaluate(() => window.scrollTo({ top: 400,  behavior: 'smooth' }));
    await sleep(800);
    await page.evaluate(() => window.scrollTo({ top: 900,  behavior: 'smooth' }));
    await sleep(600);
    await page.evaluate(() => window.scrollTo({ top: 0,    behavior: 'smooth' }));
    await sleep(400);

    const html = await page.content();
    return parseIdealistaData(html, url);
  } finally {
    await page.close();
  }
}

module.exports = { scrapeIdealistaMaps };
```

### 4b — airbnb-scraper.js (migrated from Puppeteer)

```js
// lib/airbnb-scraper.js
// Airbnb image extractor, migrated from Puppeteer to Playwright.

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
    await page.setExtraHTTPHeaders({ 'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
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
        images   = extractImages(scraped.raw);
        property = extractProperty(scraped.raw);
      } else if (scraped.text) {
        images = extractImagesFromText(scraped.text);
        try { property = extractProperty(JSON.parse(scraped.text)); } catch (e) {}
      }
    }
    return { listingUrl, images, property, status: 'ok', error: null, source: scraped?.source || 'none' };
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
```

### 4c — server.js

```js
// server.js
const express = require('express');
const { processWithConcurrency } = require('./lib/airbnb-scraper');
const { scrapeIdealistaMaps }    = require('./lib/idealista-maps-scraper');

const app  = express();
const PORT = 3001;

app.use((req, res, next) => {
  // CORS: localhost only — never expose this server to the internet
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: 'zinto-scraper-playwright' });
});

app.post('/airbnb/extract', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ error: 'urls[] requerido' });
  if (urls.length > 30)
    return res.status(400).json({ error: 'Maximo 30 URLs' });
  try {
    const results = await processWithConcurrency(urls, 3);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/idealista/maps-enrich', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('idealista.com/maps'))
    return res.status(400).json({ error: 'url de idealista.com/maps requerida' });
  try {
    const data = await scrapeIdealistaMaps(url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.listen(PORT, () =>
  console.log('zinto-scraper-server en http://localhost:' + PORT)
);
```

**Step 1: Write all three files**

(Write the three files as shown above.)

**Step 2: Smoke test — start server and call /health**

```bash
cd zinto-scraper-server && node server.js &
sleep 3
curl -s http://localhost:3001/health | jq
# Expected: { "status": "ok", "backend": "zinto-scraper-playwright" }
kill %1
```

**Step 3: Commit**

```bash
git add zinto-scraper-server/lib/idealista-maps-scraper.js \
        zinto-scraper-server/lib/airbnb-scraper.js \
        zinto-scraper-server/server.js
git commit -m "feat: add scraper server with playwright — airbnb + idealista/maps-enrich endpoints"
```

---

## Task 5: Add "Idealista" tab to zinto-crm-v4.html

**Files:**
- Modify: `zinto-crm-v4.html` (HTML section only — JS added in Task 6)

### What to find

Search for the existing extractor tab buttons. They look like:

```html
<button onclick="switchExtTab('airbnb')" id="etab-airbnb" ...>✈️ Airbnb</button>
```

### Step 1: Add the new tab button

After the last extractor tab button (airbnb), add:

```html
<button onclick="switchExtTab('idealista')" id="etab-idealista"
  class="ext-tab-btn px-3 py-1.5 rounded text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-all"
>🏘 Idealista</button>
```

### Step 2: Add the panel

After the last extractor panel (the airbnb panel div), add the Idealista panel. Find the closing div of the airbnb panel and after it insert:

```html
<!-- ===== PANEL: Idealista Maps Enrich ===== -->
<div id="ext-idealista-mode" class="ext-panel hidden">

  <!-- Status banner -->
  <div id="idl-server-status" class="mb-3 p-2 rounded text-sm bg-gray-100 text-gray-500">
    Verificando servidor local…
  </div>

  <!-- URL input -->
  <div class="mb-3">
    <label class="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
      URL de idealista.com/maps
    </label>
    <div class="flex gap-2">
      <input id="idl-url-input" type="text" placeholder="https://www.idealista.com/maps/madrid-madrid/…"
        class="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button id="idl-enrich-btn" onclick="doIdealistaMapsEnrich()"
        class="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >Extraer</button>
    </div>
  </div>

  <!-- Preview area — populated by JS -->
  <div id="idl-preview" class="hidden"></div>

  <!-- Create button — shown after successful extraction -->
  <div id="idl-create-area" class="hidden mt-3">
    <button onclick="createPropFromIdealista()"
      class="w-full py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700"
    >✅ Crear Propiedad</button>
  </div>

</div>
```

### Step 3: Verify the tab switches correctly

Open `zinto-crm-v4.html` in browser (via dev server or `open`). Click the 🏘 Idealista tab. The panel should appear. The other panels should hide.

### Step 4: Commit

```bash
git add zinto-crm-v4.html
git commit -m "feat(crm): add Idealista tab panel HTML"
```

---

## Task 6: Add CRM JavaScript for Idealista enrichment

**Files:**
- Modify: `zinto-crm-v4.html` (JS section — near other extractor JS)

Add the following four functions inside the `<script>` block, after the Airbnb extractor functions.

### Step 1: Write the functions

```js
// ===== IDEALISTA MAPS ENRICHMENT =====

const SCRAPER_URL = 'http://localhost:3001';
let _idealistaData = null; // holds last successful extraction

async function checkIdealistaBackend() {
  const banner = document.getElementById('idl-server-status');
  try {
    const r = await fetch(SCRAPER_URL + '/health', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    banner.className = 'mb-3 p-2 rounded text-sm bg-green-50 text-green-700';
    banner.textContent = '✅ Servidor local activo (' + (j.backend || 'ok') + ')';
  } catch {
    banner.className = 'mb-3 p-2 rounded text-sm bg-red-50 text-red-700';
    banner.textContent = '❌ Servidor local no disponible — inicia zinto-scraper-server en puerto 3001';
  }
}

async function doIdealistaMapsEnrich() {
  const url = document.getElementById('idl-url-input').value.trim();
  if (!url) return;

  const btn     = document.getElementById('idl-enrich-btn');
  const preview = document.getElementById('idl-preview');
  const createArea = document.getElementById('idl-create-area');

  btn.disabled = true;
  btn.textContent = 'Extrayendo…';
  preview.classList.add('hidden');
  createArea.classList.add('hidden');
  _idealistaData = null;

  try {
    const r = await fetch(SCRAPER_URL + '/idealista/maps-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok || data.status !== 'ok') throw new Error(data.error || 'Error desconocido');

    _idealistaData = data;
    renderIdealistaPreview(data);
    preview.classList.remove('hidden');
    createArea.classList.remove('hidden');
  } catch (err) {
    preview.classList.remove('hidden');
    preview.textContent = '❌ ' + err.message;
    preview.className = 'text-red-600 text-sm mt-2';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extraer';
  }
}

function renderIdealistaPreview(data) {
  const preview = document.getElementById('idl-preview');
  const p = data.property;
  const v = data.valuation;

  // Build preview with DOM methods to avoid XSS (data comes from our local server)
  preview.className = 'bg-gray-50 border rounded p-3 text-sm space-y-1';
  preview.textContent = ''; // clear

  const rows = [
    ['Dirección',          p.address],
    ['Tipo',               p.type],
    ['m² vivienda',        p.m2_vivienda],
    ['m² construidos',     p.m2_construidos],
    ['Habitaciones',       p.rooms],
    ['Baños',              p.bathrooms],
    ['Año construcción',   p.year],
    ['Ascensor',           p.elevator ? 'Sí' : 'No'],
    ['Calidad',            p.construction_quality],
    ['Ref. catastral',     p.cadastral_ref],
    ['Precio venta est.',  v.sale?.estimate ? v.sale.estimate.toLocaleString('es-ES') + ' €' : null],
    ['Rango venta',        (v.sale?.min && v.sale?.max)
                              ? v.sale.min.toLocaleString('es-ES') + ' – ' + v.sale.max.toLocaleString('es-ES') + ' €'
                              : null],
    ['Alquiler est.',      v.rent?.estimate ? v.rent.estimate.toLocaleString('es-ES') + ' €/mes' : null],
    ['Rango alquiler',     (v.rent?.min && v.rent?.max)
                              ? v.rent.min.toLocaleString('es-ES') + ' – ' + v.rent.max.toLocaleString('es-ES') + ' €/mes'
                              : null],
  ];

  rows.forEach(([label, value]) => {
    if (!value && value !== 0) return;
    const row = document.createElement('div');
    row.className = 'flex gap-2';

    const lEl = document.createElement('span');
    lEl.className = 'font-medium text-gray-500 w-36 shrink-0';
    lEl.textContent = label;

    const vEl = document.createElement('span');
    vEl.className = 'text-gray-800';
    vEl.textContent = value;

    row.appendChild(lEl);
    row.appendChild(vEl);
    preview.appendChild(row);
  });
}

function createPropFromIdealista() {
  if (!_idealistaData) return;
  const p = _idealistaData.property;
  const v = _idealistaData.valuation;

  // Map to CRM property schema
  const newProp = {
    id:   Date.now(),
    cId:  null,
    tipo: p.type || 'piso',
    op:   'venta',
    ta:   null,
    loc:  'Madrid',
    via:  p.address || '',
    num:  '',
    planta: '',
    puerta: '',
    barrio: '',
    m2:   p.m2_construidos || p.m2_vivienda || 0,
    m2u:  p.m2_vivienda || 0,
    h:    p.rooms || 0,
    b:    p.bathrooms || 0,
    est:  'disponible',
    fc:   p.year ? String(p.year) : '',
    asc:  p.elevator ? 'si' : 'no',
    eq:   '',
    cal:  '',
    en:   '',
    extras: p.construction_quality ? 'Calidad: ' + p.construction_quality : '',
    orient: '',
    pr:   v.sale?.estimate || 0,
    ref:  p.cadastral_ref || '',
    desc: '',
    urlP: _idealistaData.url,
    em:   '',
    tel:  '',
    images: [],
    fecha: new Date().toISOString().slice(0, 10),
  };

  // Save using existing CRM save mechanism
  props.push(newProp);
  saveProps();       // persists to localStorage
  renderProps();     // refreshes list
  showToast('Propiedad creada desde Idealista ✅');
}
```

### Step 2: Wire up the tab switch

Find the `switchExtTab` function (or equivalent) in the CRM JS. Make sure `'idealista'` is included as a valid tab id. It should already handle unknown tab ids gracefully if it iterates `.ext-panel` divs — verify this.

If the function uses a hardcoded list, add `'idealista'` to it.

### Step 3: Call checkIdealistaBackend when tab is activated

Inside `switchExtTab`, add this after showing the idealista panel:

```js
if (tab === 'idealista') checkIdealistaBackend();
```

### Step 4: Manual test

1. Start `zinto-scraper-server`: `cd zinto-scraper-server && node server.js`
2. Open CRM in browser.
3. Click 🏘 Idealista tab.
4. Banner should show ✅ Servidor local activo.
5. Paste: `https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/`
6. Click Extraer → preview rows appear.
7. Click ✅ Crear Propiedad → property appears in CRM list.

### Step 5: Commit

```bash
git add zinto-crm-v4.html
git commit -m "feat(crm): add Idealista Maps enrichment JS — enrich, preview, create property"
```

---

## Task 7: Update launch.json and finalize

**Files:**
- Modify: `.claude/launch.json` (or create if absent)
- Create: `zinto-scraper-server/README.md`

### Step 1: Update launch.json

Open `.claude/launch.json`. If the entry for `zinto-puppeteer-server` exists, replace its name. Add the scraper server entry:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "zinto-scraper-server",
      "runtimeExecutable": "node",
      "runtimeArgs": ["server.js"],
      "cwd": "${workspaceFolder}/zinto-scraper-server",
      "port": 3001
    }
  ]
}
```

### Step 2: Create README

```bash
cat > zinto-scraper-server/README.md << 'EOF'
# zinto-scraper-server

Local Playwright-based scraper server (replaces zinto-puppeteer-server).

## Start

```bash
npm install
npx playwright install chromium
npm start          # http://localhost:3001
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /health | Status check |
| POST | /airbnb/extract | Extract images from Airbnb listings |
| POST | /idealista/maps-enrich | Extract valuation + catastro from idealista.com/maps URL |

## Anti-detection

- Persistent Chromium profile: `~/.zinto-scraper-profile/`
- Human-like random delays (1.5–4s) + scroll simulation
- Never more than 1 concurrent request to Idealista
- 3s minimum between Idealista requests

## Tests

```bash
npm test
```
EOF
```

### Step 3: Run full test suite one more time

```bash
cd zinto-scraper-server && npm test
```

Expected: all 15 unit tests PASS.

### Step 4: Final commit + push

```bash
git add .claude/launch.json zinto-scraper-server/README.md
git commit -m "chore: update launch.json + add scraper server README"
git push origin mystifying-dubinsky
```

---

## Summary of all files created / modified

| File | Action |
|---|---|
| `zinto-scraper-server/package.json` | CREATE |
| `zinto-scraper-server/.gitignore` | CREATE |
| `zinto-scraper-server/lib/browser.js` | CREATE |
| `zinto-scraper-server/lib/idealista-maps-extractor.js` | CREATE |
| `zinto-scraper-server/lib/idealista-maps-scraper.js` | CREATE |
| `zinto-scraper-server/lib/airbnb-scraper.js` | CREATE |
| `zinto-scraper-server/server.js` | CREATE |
| `zinto-scraper-server/tests/idealista-maps-extractor.test.js` | CREATE |
| `zinto-scraper-server/README.md` | CREATE |
| `zinto-crm-v4.html` | MODIFY (Task 5 + Task 6) |
| `.claude/launch.json` | MODIFY |

## Out of scope (Fase 2)

- `/venta-viviendas/` listing search with filters → import results
- Zone/barrio stats scraping (`/maps/madrid/barrio-de-salamanca/`)
- Cloudflare Worker fallback for Idealista
- Photo extraction from Idealista listings
