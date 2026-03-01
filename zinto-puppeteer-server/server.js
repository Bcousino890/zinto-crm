const express = require('express');
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
  res.json({ status: 'ok', backend: 'local-puppeteer' });
});

app.post('/airbnb/extract', async (req, res) => {
  // TODO Task 2
  res.json({ results: [] });
});

app.listen(PORT, () =>
  console.log('Puppeteer server en http://localhost:' + PORT)
);
