// server.js
const express = require('express');
const { processWithConcurrency } = require('./lib/airbnb-scraper');
const { scrapeIdealistaMaps } = require('./lib/idealista-maps-scraper');

const app = express();
const PORT = 3001;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

// Global async error handler for Express
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ status: 'error', error: 'Internal server error' });
});

app.listen(PORT, () =>
  console.log('zinto-scraper-server en http://localhost:' + PORT)
);
