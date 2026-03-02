# zinto-scraper-server

Servidor local basado en Playwright + stealth. Reemplaza a zinto-puppeteer-server.

## Instalación

```bash
npm install
npx playwright install chromium
```

## Iniciar

```bash
npm start   # http://localhost:3001
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | /health | Estado del servidor |
| POST | /airbnb/extract | Extrae imágenes de listings de Airbnb |
| POST | /idealista/maps-enrich | Extrae valoración y catastro desde una URL de idealista.com/maps |

### POST /idealista/maps-enrich

**Request:**
```json
{ "url": "https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/" }
```

**Response:**
```json
{
  "status": "ok",
  "url": "...",
  "property": { "address": "...", "type": "piso", "m2_vivienda": 75, "rooms": 2, ... },
  "valuation": { "sale": { "estimate": 517000, "min": 461000, "max": 563000 }, "rent": { ... } },
  "source": "idealista-maps",
  "scraped_at": "2026-03-02T..."
}
```

## Anti-detección

- Perfil Chromium persistente: `~/.zinto-scraper-profile/`
- Delays aleatorios 1.5–4s + simulación de scroll
- Máximo 1 request concurrente a Idealista
- Mínimo 3s entre requests a Idealista

## Tests

```bash
npm test
```
