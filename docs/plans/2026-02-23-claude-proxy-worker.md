# Claude Proxy Worker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a Cloudflare Worker `zinto-claude-proxy` that proxies Anthropic API calls from the CRM, eliminando el error CORS de `file://`.

**Architecture:** Cloudflare Worker recibe POST del CRM, añade `x-api-key` desde un secret de CF, hace fetch a `api.anthropic.com/v1/messages`, devuelve respuesta con headers CORS. Rate limiting in-memory: 20 req/min por IP.

**Tech Stack:** Cloudflare Workers (ES modules), wrangler 4.67.0, vanilla JS en CRM

**Account ID CF:** `bdff58d4a8d372fe02101f5259bd16b8`

---

## Task 1: Crear archivos del Worker

**Files:**
- Create: `zinto-claude-proxy/worker.js`
- Create: `zinto-claude-proxy/wrangler.toml`

**Step 1: Crear directorio**

```bash
mkdir -p /Users/benjamincousino/zinto-crm/zinto-claude-proxy
```

**Step 2: Crear `wrangler.toml`**

```toml
name = "zinto-claude-proxy"
main = "worker.js"
compatibility_date = "2024-11-01"
account_id = "bdff58d4a8d372fe02101f5259bd16b8"
```

**Step 3: Crear `worker.js`**

```javascript
// In-memory rate limiter (resets per Worker instance, gratis)
const rl = new Map();
const RL_MAX = 20;
const RL_WIN = 60_000; // 1 minuto

function checkRL(ip) {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now - e.t > RL_WIN) { rl.set(ip, { n: 1, t: now }); return true; }
  if (e.n >= RL_MAX) return false;
  e.n++;
  return true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!checkRL(ip)) {
      return new Response(
        JSON.stringify({ error: { type: 'rate_limit_error', message: 'Proxy rate limit: max 20 req/min.' } }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Forward a Anthropic
    let body;
    try { body = await request.text(); }
    catch (e) { return new Response('Bad request', { status: 400, headers: CORS }); }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body,
    });

    const respText = await resp.text();
    return new Response(respText, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
        ...CORS,
      },
    });
  },
};
```

**Step 4: Commit**

```bash
cd /Users/benjamincousino/zinto-crm
git add zinto-claude-proxy/
git commit -m "feat: add zinto-claude-proxy worker files"
```

---

## Task 2: Deploy Worker y añadir secret

**Files:** ninguno (comandos CLI)

**Step 1: Deploy**

```bash
cd /Users/benjamincousino/zinto-crm/zinto-claude-proxy
npx wrangler deploy
```

Expected output:
```
✅ Deployed zinto-claude-proxy
https://zinto-claude-proxy.<subdomain>.workers.dev
```

Guardar la URL que aparece — se necesita en Task 3.

**Step 2: Añadir API key de Anthropic como secret**

```bash
npx wrangler secret put ANTHROPIC_KEY
```

El comando pide el valor de forma interactiva (no aparece en el terminal ni en logs).
Introduce la API key cuando la pida.

**Step 3: Verificar con curl**

```bash
curl -X POST https://zinto-claude-proxy.<subdomain>.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"Di hola"}]}'
```

Expected: JSON con `content[0].text` = algo como `"¡Hola!"`

---

## Task 3: Actualizar callClaude() en el CRM

**Files:**
- Modify: `zinto-crm-v4.html` — función `callClaude()` (~línea 2465)

**Step 1: Localizar la función**

```bash
grep -n "callClaude\|ANTHROPIC_PROXY\|api.anthropic" /Users/benjamincousino/zinto-crm/zinto-crm-v4.html | head -20
```

**Step 2: Reemplazar `callClaude()`**

Sustituir la implementación actual por:

```javascript
// URL del proxy — se puede sobreescribir en localStorage('zinto_proxy_url')
const ANTHROPIC_PROXY = localStorage.getItem('zinto_proxy_url')
  || 'https://zinto-claude-proxy.<subdomain>.workers.dev/'; // ← reemplazar con URL real

async function callClaude({ messages, max_tokens = 2000, tools = null }) {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens, messages };
  if (tools) body.tools = tools;

  const res = await fetch(ANTHROPIC_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      errMsg = errBody?.error?.message || errMsg;
    } catch(e) {}
    if (res.status === 401) throw new Error('API key inválida. Verifica en console.anthropic.com');
    if (res.status === 403) throw new Error('API key sin permisos suficientes');
    if (res.status === 429) throw new Error('Rate limit alcanzado. Espera un momento.');
    throw new Error(`Error API: ${errMsg}`);
  }

  const data = await res.json();
  let txt = '';
  for (const b of data.content) { if (b.type === 'text') txt += b.text; }
  return { data, txt };
}
```

**Nota:** Reemplazar `<subdomain>` con el subdominio real del Step 1 de Task 2.

**Step 3: Actualizar `testKey()` para usar el proxy**

Localizar `testKey()` (~línea 2414) y reemplazar:

```javascript
async function testKey() {
  const st = $('key-st');
  const proxyUrl = localStorage.getItem('zinto_proxy_url')
    || 'https://zinto-claude-proxy.<subdomain>.workers.dev/'; // ← mismo subdominio
  if(st){st.textContent='⏳…';st.style.color='var(--wn)';}
  try {
    const r = await fetch(proxyUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:5,messages:[{role:'user',content:'Hi'}]})
    });
    if(r.ok){if(st){st.textContent='✅ OK';st.style.color='var(--ac)';}}
    else{const e=await r.json();if(st){st.textContent='❌ '+r.status;st.style.color='var(--rd)';}}
  } catch(e){if(st){st.textContent='❌ '+e.message;st.style.color='var(--rd)';}}
}
```

**Step 4: Eliminar el campo api-key-mo del modal** (ya no se necesita la key en el browser)

Buscar en el HTML el bloque `<!-- MODE: API -->` (~línea 676) y eliminar el input de API key y el botón "Probar":

```html
<!-- Eliminar estas líneas: -->
<div style="display:flex;gap:6px;margin-bottom:7px">
  <input class="fi" id="api-key-mo" .../>
  <button class="btn bg bs" onclick="testKey()" id="btn-tk">Probar</button>
  <span id="key-st" ...></span>
</div>
```

Reemplazar por un texto informativo:

```html
<div style="font-family:var(--mo);font-size:8px;color:var(--t3);margin-bottom:10px;padding:7px 10px;background:var(--acd);border-radius:6px">
  🔒 API key configurada en el servidor proxy · Introduce la URL del anuncio y pulsa Extraer
</div>
```

**Step 5: Limpiar referencias obsoletas a api-key en JS**

Eliminar o dejar como no-op las funciones `getApiKey`, `saveApiKey`, `testApiKey` y la línea del INIT que intenta restaurar la key en el campo:

```javascript
// Estas funciones ya no son necesarias — dejar vacías para no romper referencias
function getApiKey() { return ''; }
function saveApiKey(val) {}
async function testApiKey() { showToast('ℹ La API key está configurada en el proxy de Cloudflare'); }
```

**Step 6: Commit**

```bash
cd /Users/benjamincousino/zinto-crm
git add zinto-crm-v4.html
git commit -m "feat: use cloudflare proxy for anthropic API calls

- callClaude() apunta a zinto-claude-proxy worker
- elimina x-api-key y anthropic-dangerous-allow-browser del browser
- testKey() usa el proxy
- modal de api-key reemplazado por mensaje informativo

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Test end-to-end

**Step 1:** Abrir `zinto-crm-v4.html` en el browser
**Step 2:** Ir a "Nueva Propiedad" → pestaña "🤖 API Key"
**Step 3:** Verificar que aparece el mensaje informativo (no el campo de API key)
**Step 4:** Pegar una URL de Idealista real → pulsar "🤖 Extraer con IA"
**Step 5:** Verificar que los campos se rellenan sin error CORS
