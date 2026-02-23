// ── Rate limiter in-memory (gratis, resetea por instancia) ──
const rl = new Map();
const RL_MAX = 20;     // max requests
const RL_WIN = 60_000; // por minuto

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
  'Access-Control-Allow-Headers': 'Content-Type, X-Anthropic-Key',
};

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // Rate limit por IP
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!checkRL(ip)) {
      return new Response(
        JSON.stringify({ error: { type: 'rate_limit_error', message: 'Proxy: máx 20 req/min.' } }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Leer API key del header del CRM
    const apiKey = request.headers.get('X-Anthropic-Key') || '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { type: 'auth_error', message: 'Falta X-Anthropic-Key. Introduce tu API key en el CRM.' } }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    // Leer body
    let body;
    try { body = await request.text(); }
    catch (e) { return new Response('Bad request', { status: 400, headers: CORS }); }

    // Forward a Anthropic
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
