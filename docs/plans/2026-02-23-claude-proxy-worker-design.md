# Design: Cloudflare Worker Proxy para API de Anthropic

**Fecha:** 2026-02-23
**Proyecto:** zinto-crm-v4
**Estado:** Aprobado

## Problema

`callClaude()` en el CRM llama directamente a `https://api.anthropic.com/v1/messages` desde el browser, lo que falla con error CORS porque Anthropic no permite llamadas cross-origin desde `file://`.

## Solución

Cloudflare Worker `zinto-claude-proxy` que actúa de intermediario: recibe el body del CRM, añade la API key (secret de CF), hace fetch a Anthropic y devuelve la respuesta con headers CORS.

## Arquitectura

```
Browser (file://)
  └─ POST https://zinto-claude-proxy.<subdomain>.workers.dev/
       body: { model, messages, max_tokens, tools }
       headers: Content-Type: application/json

Cloudflare Worker (zinto-claude-proxy)
  ├─ Rate limit: 20 req/min por IP (in-memory Map, gratis)
  ├─ x-api-key: env.ANTHROPIC_KEY  (secret, nunca en código)
  ├─ anthropic-version: 2023-06-01
  └─ fetch https://api.anthropic.com/v1/messages

Anthropic API
  └─ respuesta JSON → Worker → Browser con Access-Control-Allow-Origin: *
```

## Worker: detalles técnicos

- **Nombre:** `zinto-claude-proxy`
- **Runtime:** Cloudflare Workers (ES modules)
- **Secret:** `ANTHROPIC_KEY` (se añade con `wrangler secret put ANTHROPIC_KEY`)
- **Rate limiting:** Map global `{ip → {count, windowStart}}`, ventana 60s, max 20 req
- **CORS:** `Access-Control-Allow-Origin: *` en todas las respuestas incluyendo OPTIONS
- **Métodos:** OPTIONS (preflight) + POST únicamente
- **Sin KV, sin Durable Objects, sin plan de pago**

## Cambios en CRM (callClaude)

- URL: `https://api.anthropic.com/v1/messages` → `https://zinto-claude-proxy.<subdomain>.workers.dev/`
- Eliminar header `x-api-key` (ahora lo pone el Worker)
- Eliminar header `anthropic-dangerous-allow-browser: true`
- URL del proxy guardada en `localStorage('zinto_proxy_url')` con fallback al valor hardcodeado post-deploy
- `testKey()` también actualizado para usar el proxy

## Coste

100% gratuito. Workers free tier: 100k req/día. Secrets: gratis. Rate limiting in-memory: gratis.
