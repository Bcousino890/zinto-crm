# Airbnb Batch Extractor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extraer imágenes de 2-30 URLs de Airbnb en batch sin consumir tokens de IA, usando un servidor Puppeteer local con fallback a CF Browser Rendering.

**Architecture:** CRM hace ping a `localhost:3001/health`; si responde usa el server local (Node.js + Puppeteer), sino usa el CF Worker. Ambos backends exponen el mismo contrato POST `/airbnb/extract`. El CRM procesa resultados en una nueva tab "Airbnb Batch" con vista por anuncio + grid unificado.

**Tech Stack:** Node.js v22, Express, Puppeteer, Cloudflare Workers + @cloudflare/puppeteer, HTML/JS vanilla (zinto-crm-v4.html)

---

## Task 1: Local Puppeteer Server — scaffold

**Files:**
- Create: `zinto-puppeteer-server/package.json`
- Create: `zinto-puppeteer-server/server.js`

**Step 1: Crear package.json**

```json
{
  "name": "zinto-puppeteer-server",
  "version": "1.0.0",
  "description": "Local Puppeteer server for Airbnb image extraction",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "puppeteer": "^22.0.0"
  }
}
```

**Step 2: Instalar dependencias**

```bash
cd zinto-puppeteer-server && npm install
```

Esperar ~2 min (Puppeteer descarga Chromium). Verificar:
```bash
ls node_modules | grep -E "express|puppeteer"
```
Expected: `express` y `puppeteer` listados.

**Step 3: Crear server.js con /health y esqueleto**

```javascript
const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: 'local-puppeteer' });
});

app.post('/airbnb/extract', async (req, res) => {
  // TODO Task 2
  res.json({ results: [] });
});

app.listen(PORT, () =>
  console.log('Puppeteer server en http://localhost:' + PORT)
);
```

**Step 4: Verificar que arranca**

```bash
node server.js &
curl http://localhost:3001/health
```
Expected: `{"status":"ok","backend":"local-puppeteer"}`

**Step 5: Matar proceso y commit**

```bash
kill %1 && cd ..
git add zinto-puppeteer-server/
git commit -m "feat: scaffold zinto-puppeteer-server (Express + /health)"
```

---

## Task 2: Scraper de Airbnb en el server

**Files:**
- Modify: `zinto-puppeteer-server/server.js`

**Step 1: Reemplazar el archivo completo con la implementación**

Airbnb embebe todos los datos en `#data-injected-user-state` como JSON. Puppeteer navega, extrae ese script, y busca URLs de muscache.com.

```javascript
const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = 3001;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: 'local-puppeteer' });
});

// Extraer URLs de muscache.com recorriendo el JSON de Airbnb
function extractImages(data) {
  const urls = new Set();
  function walk(obj, depth) {
    if (!obj || depth > 15 || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(item => walk(item, depth + 1));
      return;
    }
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' && val.includes('muscache.com')) {
        urls.add(val);
      } else {
        walk(val, depth + 1);
      }
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
      filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg'
    }));
}

function extractProperty(data) {
  try {
    const str = JSON.stringify(data);
    const titleMatch = str.match(/"name"\s*:\s*"([^"]{5,80})"/);
    const priceMatch = str.match(/"price"\s*:\s*(\d+)/);
    return {
      title: titleMatch ? titleMatch[1] : '',
      price: priceMatch ? parseInt(priceMatch[1]) : 0
    };
  } catch (e) {
    return {};
  }
}

async function scrapeAirbnb(listingUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const data = await page.evaluate(() => {
      const el = document.querySelector('#data-injected-user-state');
      if (el) {
        try { return JSON.parse(el.textContent); } catch (e) {}
      }
      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          if (j && (j.bootstrapData || j.niobeMinimalClientData)) return j;
        } catch (e) {}
      }
      return null;
    });

    const images = extractImages(data);
    const property = extractProperty(data);
    return { listingUrl, images, property, status: 'ok', error: null };
  } catch (err) {
    return { listingUrl, images: [], property: {}, status: 'error', error: err.message };
  } finally {
    await browser.close();
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

app.post('/airbnb/extract', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls[] requerido' });
  }
  if (urls.length > 30) {
    return res.status(400).json({ error: 'Maximo 30 URLs' });
  }
  try {
    const results = await processWithConcurrency(urls, 3);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log('Puppeteer server en http://localhost:' + PORT)
);
```

**Step 2: Probar con URL real de Airbnb**

```bash
cd zinto-puppeteer-server && node server.js &
sleep 3
curl -s -X POST http://localhost:3001/airbnb/extract \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://www.airbnb.es/rooms/1190930"]}' | python3 -m json.tool | head -30
```

Expected: `results[0].images` con URLs `muscache.com...?im_w=1200`.

Si `images` es array vacío: inspeccionar estructura JSON de Airbnb con:
```bash
node -e "
const p = require('puppeteer');
(async () => {
  const b = await p.launch({headless:'new',args:['--no-sandbox']});
  const pg = await b.newPage();
  await pg.goto('https://www.airbnb.es/rooms/1190930',{waitUntil:'domcontentloaded'});
  const keys = await pg.evaluate(() => {
    const el = document.querySelector('#data-injected-user-state');
    if (!el) return ['NO ELEMENT'];
    const j = JSON.parse(el.textContent);
    return Object.keys(j).slice(0,10);
  });
  console.log(keys);
  await b.close();
})();"
```
Ajustar `extractImages` según la estructura real.

**Step 3: Commit**

```bash
kill %1 && cd ..
git add zinto-puppeteer-server/server.js
git commit -m "feat: Puppeteer scraper Airbnb con concurrencia 3"
```

---

## Task 3: CF Worker fallback

**Files:**
- Create: `zinto-airbnb-worker/wrangler.toml`
- Create: `zinto-airbnb-worker/package.json`
- Create: `zinto-airbnb-worker/worker.js`

**Step 1: wrangler.toml**

```toml
name = "zinto-airbnb-scraper"
main = "worker.js"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[browser]
binding = "BROWSER"
```

**Step 2: package.json**

```json
{
  "name": "zinto-airbnb-worker",
  "version": "1.0.0",
  "dependencies": {
    "@cloudflare/puppeteer": "^0.0.5"
  }
}
```

```bash
cd zinto-airbnb-worker && npm install && cd ..
```

**Step 3: worker.js**

```javascript
import puppeteer from '@cloudflare/puppeteer';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
    .filter(u => u.includes('/im/pictures/') && !/avatar|user|profile/i.test(u))
    .map(u => u.replace(/[?&]im_w=\d+/g, '') + '?im_w=1200')
    .map((url, i) => ({
      n: i + 1,
      url,
      filename: 'IMG_' + String(i + 1).padStart(3, '0') + '.jpg'
    }));
}

async function scrapeAirbnb(browserBinding, listingUrl) {
  let browser;
  try {
    browser = await puppeteer.launch(browserBinding);
    const page = await browser.newPage();
    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const data = await page.evaluate(() => {
      const el = document.querySelector('#data-injected-user-state');
      if (el) { try { return JSON.parse(el.textContent); } catch (e) {} }
      return null;
    });
    const images = extractImages(data);
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
      // CF procesa de a 1 (limite de sesiones concurrentes en plan free)
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
```

**Step 4: Deploy (requiere cuenta CF con Browser Rendering habilitado)**

```bash
cd zinto-airbnb-worker && npx wrangler deploy
```

Anotar la URL del worker que aparece al final: `https://zinto-airbnb-scraper.USUARIO.workers.dev`

**Step 5: Commit**

```bash
cd ..
git add zinto-airbnb-worker/
git commit -m "feat: CF Browser Rendering worker fallback para Airbnb"
```

---

## Task 4: CRM — Tab Airbnb Batch (HTML)

**Files:**
- Modify: `zinto-crm-v4.html` — linea ~1046 (constante) y ~424-475 (tabs + panels)

**Step 1: Añadir constante AIRBNB_CF_WORKER**

Buscar `const IMG_PROXY=` (~linea 1046). Añadir en la linea siguiente:

```javascript
const AIRBNB_CF_WORKER = 'https://zinto-airbnb-scraper.USUARIO.workers.dev';
```

Reemplazar `USUARIO` con el subdominio real del worker. Si el worker no esta desplegado aun, dejarlo con la URL de placeholder.

**Step 2: Añadir tercera tab**

Buscar (linea ~428-430):
```
            🤖 Extraer con API IA<br><span style="font-size:7.5px;opacity:.7">Requiere API key propia</span>
          </div>
```

Añadir DESPUES del cierre de ese div:
```html
          <div class="af-tab" id="etab-airbnb" onclick="switchExtTab('airbnb')" style="flex:1;padding:7px;border-radius:7px;border:1px solid var(--b1);color:var(--t4);font-family:var(--mo);font-size:8.5px;text-align:center;cursor:pointer">
            🏠 Airbnb Batch<br><span style="font-size:7.5px;opacity:.7">Sin IA · Puppeteer</span>
          </div>
```

**Step 3: Añadir panel Airbnb Batch**

Buscar el cierre del div `ext-api-mode`:
```
        </div>

        <div id="ext-results"
```

Entre esos dos divs, insertar:

```html
        <!-- AIRBNB BATCH MODE -->
        <div id="ext-airbnb-mode" style="display:none">
          <div id="airbnb-backend-st" style="font-family:var(--mo);font-size:8.5px;margin-bottom:10px;padding:6px 10px;border-radius:6px;background:var(--b1)">
            Detectando backend...
          </div>
          <div style="font-family:var(--mo);font-size:8px;color:var(--t3);margin-bottom:6px">
            Pega las URLs de Airbnb, una por linea (max 30):
          </div>
          <textarea class="fi" id="airbnb-urls" style="min-height:120px;font-size:9.5px;font-family:var(--mo);line-height:1.7;margin-bottom:8px" placeholder="https://www.airbnb.es/rooms/123456&#10;https://www.airbnb.es/rooms/789012"></textarea>
          <button class="btn bp" onclick="doAirbnbBatch()" id="btn-airbnb" style="width:100%">🏠 Extraer Imagenes</button>
          <div class="pb" id="airbnb-pb" style="display:none;margin-top:8px"><div class="pf" id="airbnb-pf"></div></div>
          <div id="airbnb-progress-list" style="font-family:var(--mo);font-size:8.5px;color:var(--t3);margin-top:8px;line-height:2"></div>
          <div id="airbnb-results-wrap" style="display:none;margin-top:14px">
            <div style="font-family:var(--mo);font-size:9px;color:var(--t4);margin-bottom:8px">
              <span id="airbnb-total-cnt" style="color:var(--ac);font-size:16px;font-weight:800">0</span> imagenes totales ·
              <span id="airbnb-listing-cnt" style="color:var(--t3)">0 anuncios</span>
            </div>
            <div id="airbnb-accordion"></div>
            <div style="margin-top:12px;border-top:1px solid var(--b1);padding-top:12px">
              <div style="font-family:var(--mo);font-size:8.5px;color:var(--t4);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span>Grid unificado</span>
                <button class="btn bg bs" onclick="airbnbSelAll()">Todas</button>
                <button class="btn bg bs" onclick="airbnbSelNone()">Ninguna</button>
                <button class="btn bp bs" onclick="downloadAirbnbSel()">Descargar sel.</button>
              </div>
              <div class="img-grid-ext" id="airbnb-unified-grid"></div>
            </div>
          </div>
        </div>
```

**Step 4: Verificar que la tab aparece**

Abrir `http://localhost:8080/zinto-crm-v4.html` -> Extractor -> ver tab "Airbnb Batch". Al clic no debe romper.

**Step 5: Commit**

```bash
git add zinto-crm-v4.html
git commit -m "feat: tab Airbnb Batch HTML en extractor"
```

---

## Task 5: CRM — JavaScript completo

**Files:**
- Modify: `zinto-crm-v4.html` — funcion switchExtTab + nuevas funciones Airbnb

**Step 1: Actualizar switchExtTab (~linea 2388)**

Reemplazar la funcion completa:

```javascript
function switchExtTab(mode) {
  ['etab-paste','etab-api','etab-airbnb'].forEach(id => {
    const t = $(id);
    if (!t) return;
    t.style.background = '';
    t.style.color = 'var(--t4)';
    t.style.borderColor = 'var(--b1)';
  });
  const tabId = mode === 'paste' ? 'etab-paste' : mode === 'api' ? 'etab-api' : 'etab-airbnb';
  const at = $(tabId);
  if (at) {
    at.style.background = 'var(--acd)';
    at.style.color = 'var(--ac)';
    at.style.borderColor = 'rgba(0,212,160,.3)';
  }
  $('ext-paste-mode').style.display = mode === 'paste' ? 'block' : 'none';
  $('ext-api-mode').style.display = mode === 'api' ? 'block' : 'none';
  $('ext-airbnb-mode').style.display = mode === 'airbnb' ? 'block' : 'none';
  if (mode === 'airbnb') checkAirbnbBackend();
}
```

**Step 2: Añadir normalizacion Airbnb en normalizeImgUrls (~linea 1347)**

En la funcion `normalizeImgUrls`, ANTES del bloque `if (seen.has(url))`:

```javascript
    if (source === 'airbnb') {
      if (!url.includes('muscache.com')) return null;
      if (/avatar|user|profile/i.test(url)) return null;
      url = url.replace(/[?&]im_w=\d+/g, '').replace(/[?&]aki_policy=[^&]+/g, '');
      url = url + (url.includes('?') ? '&' : '?') + 'im_w=1200';
    }
```

**Step 3: Añadir bloque de funciones Airbnb**

Buscar `// ════════ PARSE MANUAL TEXT` (~linea 2402). ANTES de esa seccion, añadir:

```javascript
// ════════════════════════════════════════════════
// AIRBNB BATCH EXTRACTOR
// ════════════════════════════════════════════════
let airbnbBackendUrl = null;
let airbnbAllImages = [];
let airbnbSelSet = new Set();

async function checkAirbnbBackend() {
  const st = $('airbnb-backend-st');
  if (!st) return;
  st.textContent = 'Detectando backend...';
  st.style.background = 'var(--b1)';
  st.style.color = 'var(--t4)';

  // Intentar server local primero
  try {
    const res = await Promise.race([
      fetch('http://localhost:3001/health'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 800))
    ]);
    if (res.ok) {
      airbnbBackendUrl = 'http://localhost:3001';
      st.textContent = 'Servidor local activo (Puppeteer)';
      st.style.background = 'rgba(0,212,160,.1)';
      st.style.color = 'var(--ac)';
      return;
    }
  } catch (_) {}

  // Fallback CF Worker
  try {
    const res2 = await fetch(AIRBNB_CF_WORKER + '/health');
    if (res2.ok) {
      airbnbBackendUrl = AIRBNB_CF_WORKER;
      st.textContent = 'CF Worker activo (fallback)';
      st.style.background = 'rgba(255,200,0,.1)';
      st.style.color = '#b8900a';
      return;
    }
  } catch (_) {}

  airbnbBackendUrl = null;
  st.textContent = 'Sin backend — inicia: node zinto-puppeteer-server/server.js';
  st.style.background = 'rgba(255,0,80,.08)';
  st.style.color = '#cc0040';
}

async function doAirbnbBatch() {
  if (!airbnbBackendUrl) {
    await checkAirbnbBackend();
    if (!airbnbBackendUrl) {
      showToast('Sin backend disponible. Inicia el server local.');
      return;
    }
  }

  const raw = ($('airbnb-urls') || {value:''}).value.trim();
  if (!raw) { showToast('Pega al menos una URL de Airbnb'); return; }

  const urls = raw.split('\n')
    .map(u => u.trim())
    .filter(u => u.startsWith('http'));

  if (urls.length === 0) { showToast('No se detectaron URLs validas'); return; }
  if (urls.length > 30) { showToast('Maximo 30 URLs por extraccion'); return; }

  const btn = $('btn-airbnb');
  btn.disabled = true;
  btn.textContent = 'Extrayendo ' + urls.length + ' anuncios...';
  $('airbnb-pb').style.display = 'block';
  $('airbnb-results-wrap').style.display = 'none';
  airbnbAllImages = [];
  airbnbSelSet = new Set();

  // Mostrar lista de progreso
  const pl = $('airbnb-progress-list');
  pl.textContent = '';
  urls.forEach((u, i) => {
    const id = u.split('/').filter(Boolean).pop();
    const row = document.createElement('div');
    row.id = 'aprog-' + i;
    row.textContent = 'Pendiente: ' + id;
    pl.appendChild(row);
  });

  progAnim('airbnb-pf', 85, urls.length * 4000);

  try {
    const res = await fetch(airbnbBackendUrl + '/airbnb/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });
    const data = await res.json();

    (data.results || []).forEach((r, i) => {
      const el = $('aprog-' + i);
      if (!el) return;
      const id = r.listingUrl.split('/').filter(Boolean).pop();
      el.textContent = (r.status === 'ok' ? 'OK' : 'Error') + ': ' + id +
        (r.status === 'ok' ? ' · ' + r.images.length + ' fotos' : ' · ' + (r.error || ''));
    });

    progAnim('airbnb-pf', 100, 300);
    setTimeout(() => { $('airbnb-pb').style.display = 'none'; }, 700);
    renderAirbnbResults(data.results || []);
  } catch (e) {
    showToast('Error: ' + e.message);
    $('airbnb-pb').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extraer Imagenes';
  }
}

function renderAirbnbResults(results) {
  window._airbnbResults = results;
  const accordion = $('airbnb-accordion');
  accordion.textContent = '';
  airbnbAllImages = [];
  airbnbSelSet = new Set();

  results.forEach((r, ri) => {
    const id = r.listingUrl.split('/').filter(Boolean).pop();
    const title = (r.property && r.property.title) ? r.property.title : 'rooms/' + id;

    (r.images || []).forEach(img => airbnbAllImages.push({ img }));

    // Cabecera del acordeon
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--b1);border-radius:7px;margin-bottom:8px;overflow:hidden';

    const header = document.createElement('div');
    header.style.cssText = 'padding:9px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:var(--b1);font-family:var(--mo);font-size:9px;gap:8px';

    const arrowSpan = document.createElement('span');
    arrowSpan.id = 'acc-arrow-' + ri;
    arrowSpan.textContent = '▶ ';

    const titleSpan = document.createElement('span');
    const statusMark = r.status === 'ok' ? 'OK' : 'Error';
    titleSpan.textContent = statusMark + ' ' + title + ' · ' + (r.images || []).length + ' fotos';

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn bg bs';
    dlBtn.style.fontSize = '8px';
    dlBtn.textContent = 'Descargar anuncio';
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      downloadListingImages(ri);
    });

    const leftWrap = document.createElement('span');
    leftWrap.appendChild(arrowSpan);
    leftWrap.appendChild(titleSpan);
    header.appendChild(leftWrap);
    header.appendChild(dlBtn);
    header.addEventListener('click', () => toggleAirbnbAccordion(ri));

    // Cuerpo del acordeon
    const body = document.createElement('div');
    body.id = 'acc-body-' + ri;
    body.style.cssText = 'display:none;padding:10px';

    if (r.status === 'error') {
      const errMsg = document.createElement('div');
      errMsg.style.cssText = 'color:#cc0040;font-family:var(--mo);font-size:9px';
      errMsg.textContent = 'Error: ' + (r.error || 'desconocido');
      body.appendChild(errMsg);
    } else {
      const grid = document.createElement('div');
      grid.className = 'img-grid-ext';
      (r.images || []).forEach(img => {
        const th = document.createElement('div');
        th.className = 'img-th';
        const im = document.createElement('img');
        im.alt = img.filename;
        im.loading = 'lazy';
        im.src = IMG_PROXY + encodeURIComponent(img.url);
        im.onerror = function() { this.style.opacity = '.15'; };
        const lbl = document.createElement('div');
        lbl.className = 'img-th-n';
        lbl.textContent = '#' + img.n;
        th.appendChild(im);
        th.appendChild(lbl);
        grid.appendChild(th);
      });
      body.appendChild(grid);
    }

    card.appendChild(header);
    card.appendChild(body);
    accordion.appendChild(card);
  });

  renderAirbnbUnifiedGrid();

  set('airbnb-total-cnt', airbnbAllImages.length);
  set('airbnb-listing-cnt', results.filter(r => r.status === 'ok').length + ' anuncios');
  $('airbnb-results-wrap').style.display = 'block';
}

function toggleAirbnbAccordion(ri) {
  const body = $('acc-body-' + ri);
  const arrow = $('acc-arrow-' + ri);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = isOpen ? '▶ ' : '▼ ';
}

function renderAirbnbUnifiedGrid() {
  const grid = $('airbnb-unified-grid');
  grid.textContent = '';
  airbnbAllImages.forEach(({ img }, i) => {
    const th = document.createElement('div');
    th.className = 'img-th' + (airbnbSelSet.has(i) ? ' sel' : '');
    th.dataset.idx = i;
    const im = document.createElement('img');
    im.alt = img.filename;
    im.loading = 'lazy';
    im.src = IMG_PROXY + encodeURIComponent(img.url);
    im.onerror = function() { this.style.opacity = '.15'; };
    const lbl = document.createElement('div');
    lbl.className = 'img-th-n';
    lbl.textContent = '#' + (i + 1);
    const ck = document.createElement('div');
    ck.className = 'sel-ck';
    ck.textContent = 'sel';
    th.appendChild(im);
    th.appendChild(lbl);
    th.appendChild(ck);
    th.addEventListener('dblclick', e => { toggleAirbnbImg(i); e.stopPropagation(); });
    grid.appendChild(th);
  });
}

function toggleAirbnbImg(i) {
  if (airbnbSelSet.has(i)) airbnbSelSet.delete(i);
  else airbnbSelSet.add(i);
  const th = document.querySelector('#airbnb-unified-grid .img-th[data-idx="' + i + '"]');
  if (th) th.classList.toggle('sel', airbnbSelSet.has(i));
}

function airbnbSelAll() {
  airbnbAllImages.forEach((_, i) => airbnbSelSet.add(i));
  document.querySelectorAll('#airbnb-unified-grid .img-th').forEach(t => t.classList.add('sel'));
}

function airbnbSelNone() {
  airbnbSelSet.clear();
  document.querySelectorAll('#airbnb-unified-grid .img-th').forEach(t => t.classList.remove('sel'));
}

async function downloadAirbnbSel() {
  const selected = airbnbAllImages.filter((_, i) => airbnbSelSet.has(i));
  if (selected.length === 0) { showToast('Selecciona imagenes primero (doble clic)'); return; }
  for (const { img } of selected) {
    try {
      const r = await fetch(IMG_PROXY + encodeURIComponent(img.url));
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = img.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (_) {}
  }
}

async function downloadListingImages(ri) {
  const r = window._airbnbResults && window._airbnbResults[ri];
  if (!r || !r.images) return;
  for (const img of r.images) {
    try {
      const res = await fetch(IMG_PROXY + encodeURIComponent(img.url));
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = img.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (_) {}
  }
}
```

**Step 4: Verificar flujo completo**

1. Abrir `http://localhost:8080/zinto-crm-v4.html`
2. Ir a Extractor -> tab "Airbnb Batch"
3. Verificar indicador de backend detecta el server local
4. Pegar 2 URLs reales de Airbnb
5. Clic "Extraer Imagenes" -> ver progreso en tiempo real
6. Verificar que aparece el acordeon con fotos por anuncio
7. Verificar que el grid unificado muestra todas las fotos
8. Doble clic en fotos del grid -> se seleccionan (borde verde)
9. "Descargar sel." -> descarga las imagenes seleccionadas

**Step 5: Commit**

```bash
git add zinto-crm-v4.html
git commit -m "feat: Airbnb Batch JS completo — batch, acordeon, grid, descargas"
```

---

## Task 6: launch.json + README + push final

**Files:**
- Modify: `.claude/launch.json`
- Create: `zinto-puppeteer-server/README.md`

**Step 1: Añadir server a launch.json**

En `.claude/launch.json`, añadir al array `configurations`:

```json
{
  "name": "Airbnb Puppeteer Server",
  "runtimeExecutable": "node",
  "runtimeArgs": ["/Users/benjamincousino/zinto-crm/zinto-puppeteer-server/server.js"],
  "port": 3001
}
```

**Step 2: Crear README**

```markdown
# zinto-puppeteer-server

Servidor local Node.js + Puppeteer para extraer imagenes de Airbnb sin consumir tokens de IA.

## Arrancar

npm install   (solo la primera vez)
npm start

Corre en http://localhost:3001

## Endpoints

GET  /health           - estado del servidor
POST /airbnb/extract   - extrae imagenes de URLs de Airbnb

Body: { "urls": ["https://airbnb.es/rooms/123", ...] }
Max: 30 URLs por request. Concurrencia: 3 en paralelo.

## Uso

Abrir el CRM -> Extractor de Imagenes -> tab "Airbnb Batch".
El CRM detecta automaticamente si este server esta corriendo.
Si no esta corriendo, usa el CF Worker como fallback automaticamente.
```

**Step 3: Push final**

```bash
git add .claude/launch.json zinto-puppeteer-server/README.md
git commit -m "chore: launch.json Puppeteer server + README"
git push origin main
```

---

## Verificacion Final

Con `node zinto-puppeteer-server/server.js` corriendo:

1. CRM -> Extractor -> Airbnb Batch -> indicador muestra "Servidor local activo"
2. Pegar 3 URLs de Airbnb -> Extraer -> fotos aparecen en acordeon y grid
3. Doble clic en fotos -> seleccion funciona en grid unificado
4. "Descargar anuncio" -> descarga todas las fotos de ese listing
5. "Descargar sel." -> descarga solo las seleccionadas en el grid

Sin server corriendo (solo CF Worker desplegado):
1. Indicador muestra "CF Worker activo (fallback)"
2. Extraccion funciona igual (mas lenta, sin concurrencia)
