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
