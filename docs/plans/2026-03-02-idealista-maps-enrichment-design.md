# Idealista Maps Enrichment — Design

**Date:** 2026-03-02
**Scope:** Fase 1 — extraer datos de valoración e información catastral desde idealista/maps y crear una propiedad en el CRM a partir de esos datos.

---

## Contexto

Idealista tiene dos secciones completamente distintas:

| Sección | URL ejemplo | Propósito |
|---|---|---|
| `idealista/maps` | `/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/` | Valoración + catastro de un inmueble concreto |
| `idealista/maps` (zona) | `/maps/madrid/barrio-de-salamanca/` | Stats del barrio: precio medio, histórico |
| `idealista/venta-viviendas` | `/venta-viviendas/madrid/barrio-de-salamanca/` | Anuncios reales con filtros (Fase 2) |

Esta fase cubre **solo** el primer caso: una URL concreta de maps → datos → nueva propiedad en el CRM.

---

## Arquitectura

### Renombre del server
`zinto-puppeteer-server/` → `zinto-scraper-server/`

### Motor: Playwright + stealth
- Reemplaza Puppeteer completamente
- Contexto persistente con perfil en disco (`~/.zinto-scraper-profile/`)
- Un solo browser que arranca con el server y nunca se cierra entre requests
- Las cookies y fingerprint se acumulan como usuario real — clave contra Akamai/Cloudflare

**Dependencias:**
```json
{
  "playwright-extra": "^4.x",
  "puppeteer-extra-plugin-stealth": "^2.x",
  "express": "^4.x"
}
```

### Endpoints

```
GET  /health                  → estado + versión
POST /airbnb/extract          → sin cambios (backward compat)
POST /idealista/maps-enrich   → NUEVO — extrae datos desde URL de maps
```

---

## Endpoint: POST /idealista/maps-enrich

### Input
```json
{
  "url": "https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/"
}
```

### Datos que extrae de la página

Del screenshot real de Idealista/maps se pueden extraer:

| Campo | Ejemplo | Selector/fuente |
|---|---|---|
| Dirección | "Esc.1 5º D en Calle Castello, 44, Madrid" | `h1` / título |
| Tipo | Piso | breadcrumb / texto |
| m² vivienda | 75 | texto "75m² vivienda" |
| m² construidos | 85 | "Información del inmueble" |
| Habitaciones | 2 | "2 hab." o sección catastro |
| Baños | 1 | "1 baño" |
| Año construcción | 1927 | sección catastro |
| Ascensor | true | texto |
| Valor venta estimado | 517000 | bloque valoración |
| Venta min/max | 461000 / 563000 | bloque valoración |
| Valor alquiler estimado | 1940 | bloque valoración |
| Alquiler min/max | 1780 / 2080 | bloque valoración |
| Referencia catastral | 2355411VK4725E0027SH | URL o página |
| Calidad construcción | "buena" | sección catastro |

### Output
```json
{
  "status": "ok",
  "url": "https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/",
  "property": {
    "address": "Esc.1 5º D en Calle Castello, 44, Madrid",
    "type": "piso",
    "m2_vivienda": 75,
    "m2_construidos": 85,
    "rooms": 2,
    "bathrooms": 1,
    "year": 1927,
    "elevator": true,
    "construction_quality": "buena",
    "cadastral_ref": "2355411VK4725E0027SH"
  },
  "valuation": {
    "sale": { "estimate": 517000, "min": 461000, "max": 563000 },
    "rent": { "estimate": 1940, "min": 1780, "max": 2080 }
  },
  "source": "idealista-maps",
  "scraped_at": "2026-03-02T03:00:00Z"
}
```

### Anti-detección
- Contexto persistente (cookies reales persisten entre reinicios)
- Delay aleatorio 1.5s–4s antes de navegar
- Scroll simulado antes de extraer
- Viewport aleatorio 1280–1920px
- Concurrencia 1 en Idealista (nunca paralelo)
- Mínimo 3s entre requests a Idealista

---

## CRM — Nueva funcionalidad "Importar desde Idealista"

### Flujo de usuario
1. Usuario pega una URL de `idealista.com/maps/...` en un input del CRM
2. CRM hace `POST /idealista/maps-enrich` al server local
3. Se muestran los datos extraídos en un panel de previsualización
4. Usuario revisa y hace clic en "Crear Propiedad"
5. Se crea la propiedad en la BD del CRM con todos los campos rellenados automáticamente

### Ubicación en el CRM
Nueva tab/botón en el panel de extracción existente (Extractor de Imágenes) o como botón "Importar desde Idealista" en la sección de propiedades.

### Campos mapeados al crear la propiedad

| Campo CRM | Fuente Idealista |
|---|---|
| Dirección | `property.address` |
| Tipo | `property.type` |
| Superficie (m²) | `property.m2_construidos` |
| Habitaciones | `property.rooms` |
| Baños | `property.bathrooms` |
| Año construcción | `property.year` |
| Ascensor | `property.elevator` |
| Ref. catastral | `property.cadastral_ref` |
| Precio estimado venta | `valuation.sale.estimate` |
| Rango venta | `valuation.sale.min` / `.max` |
| Precio estimado alquiler | `valuation.rent.estimate` |
| URL fuente | `url` |

---

## Fuera de scope (Fase 2)

- Búsqueda de anuncios con filtros (`/venta-viviendas/...`)
- Stats de barrio (`/maps/madrid/barrio-de-salamanca/`)
- CF Worker fallback para Idealista
- Extracción de fotos de Idealista

---

## Decisiones técnicas

| Decisión | Elección | Razón |
|---|---|---|
| Browser engine | Playwright | Mejor stealth, API moderna, contexto persistente |
| Stealth | playwright-extra + stealth plugin | Probado contra Akamai |
| Perfil | Disco persistente | Cookies acumuladas = fingerprint realista |
| Concurrencia Idealista | 1 | Akamai detecta patrones paralelos |
| Backward compat | Airbnb endpoint sin cambios | El CRM sigue funcionando durante migración |
