# Airbnb Batch Image Extractor — Design Doc
**Date:** 2026-03-01
**Status:** Approved

## Objetivo

Extraer imágenes de múltiples URLs de Airbnb (2–30) en batch sin consumir tokens de IA, usando Puppeteer como scraper.

---

## Arquitectura

```
CRM (zinto-crm-v4.html)
    │
    ├─ ping localhost:3001/health (< 300ms)
    │      ├─ OK   → Local Puppeteer Server
    │      └─ FAIL → CF Browser Rendering Worker
    │
    ├─ Local Puppeteer Server  (zinto-puppeteer-server/)
    │      Node.js + Express + Puppeteer
    │      POST /airbnb/extract  { urls: string[] }
    │      Concurrencia: 3 en paralelo, 1 reintento
    │
    └─ CF Browser Rendering Worker  (zinto-airbnb-worker/)
           Cloudflare Worker + @cloudflare/puppeteer
           Mismo contrato de API — fallback automático
```

### Contrato de API (ambos backends)

```json
POST /airbnb/extract
Body: { "urls": ["https://airbnb.es/rooms/123", ...] }

Response:
{
  "results": [
    {
      "listingUrl": "https://airbnb.es/rooms/123",
      "images": [
        { "n": 1, "url": "https://a0.muscache.com/im/pictures/...?im_w=1200", "filename": "IMG_001.jpg" }
      ],
      "property": { "title": "", "price": 0, "rooms": 0 },
      "status": "ok",
      "error": null
    }
  ]
}
```

---

## Extracción de imágenes en Airbnb

Airbnb embebe los datos del listing en un script JSON dentro del HTML:
```html
<script id="data-injected-user-state" type="application/json">...</script>
```

Puppeteer navega a la URL, espera que cargue, y extrae ese JSON del DOM — sin renderizar JS adicional, sin IA.

### Normalización de URLs

Patrón Airbnb:
```
https://a0.muscache.com/im/pictures/XXXXX.jpg?im_w=720
```
Normalización: reemplazar `im_w=720` → `im_w=1200` para alta resolución.

---

## UI — Nueva tab "🏠 Airbnb Batch"

Se añade como tercera tab en el extractor existente (junto a "Paste" y "API IA").

```
┌─────────────────────────────────────────────────────┐
│ 📋 Pegar URLs  │  🤖 Extraer con IA  │  🏠 Airbnb Batch │
├─────────────────────────────────────────────────────┤
│ 🟢 Servidor local activo  /  🟡 Usando CF fallback  │
│                                                     │
│ ┌─ URLs de Airbnb (una por línea) ───────────────┐  │
│ │ https://www.airbnb.es/rooms/123                │  │
│ │ https://www.airbnb.es/rooms/456                │  │
│ └────────────────────────────────────────────────┘  │
│  [⚙ Extraer N anuncios]                            │
│                                                     │
│ Progreso: ████████░░  3/5                           │
│   ✓ rooms/123  ✓ rooms/456  ⏳ rooms/789            │
│                                                     │
│ ── Por anuncio ─────────────────────────────────── │
│  ▼ rooms/123 · "Piso en Gracia" · 18 fotos  [⬇]   │
│    [foto][foto][foto]...                            │
│  ▶ rooms/456 · "Estudio" · 12 fotos         [⬇]   │
│                                                     │
│ ── Grid unificado ──────────────────────────────── │
│  [☑ Todas] [☐ Ninguna]  [⬇ Descargar selección]   │
│  [foto][foto][foto][foto]...                        │
└─────────────────────────────────────────────────────┘
```

### Comportamiento
- Indicador de backend (local / CF) se actualiza al abrir la tab
- Procesamiento: 3 URLs en paralelo con límite de concurrencia
- Cada anuncio muestra estado en tiempo real (✓ / ⏳ / ✗)
- Anuncios fallidos muestran error pero no bloquean el resto
- Grid unificado acumula imágenes de todos los anuncios exitosos
- Vista por anuncio: acordeón colapsable con descarga por anuncio

---

## Archivos nuevos

```
zinto-puppeteer-server/
  ├── server.js        Express + Puppeteer (local)
  ├── package.json
  └── README.md

zinto-airbnb-worker/   CF Browser Rendering (fallback)
  ├── worker.js
  └── wrangler.toml
```

## Cambios en zinto-crm-v4.html

- Nueva tab `etab-airbnb` con su panel `ext-airbnb-mode`
- Función `checkAirbnbBackend()` — ping a localhost, fallback a CF
- Función `doAirbnbBatch()` — orquesta el batch, actualiza progreso
- Función `renderAirbnbResults()` — acordeón por anuncio + grid unificado
- Añadir `airbnb` como source en `normalizeImgUrls()`
