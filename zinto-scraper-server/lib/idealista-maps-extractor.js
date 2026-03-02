// lib/idealista-maps-extractor.js
// Pure function - parses raw HTML from an idealista.com/maps page.

function parseNum(str) {
  if (!str) return null;
  return parseInt(str.replace(/\./g, '').replace(/[^\d]/g, ''), 10) || null;
}

function extractCadastralFromUrl(url) {
  const m = url.match(/\/([A-Z0-9]{14,20})\/?$/i);
  return m ? m[1].toUpperCase() : null;
}

function parseIdealistaData(html, url) {
  // address
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const address = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : null;

  // type from breadcrumb
  const breadText = (html.match(/<nav[^>]*breadcrumb[^>]*>([\s\S]*?)<\/nav>/i) || [])[1] || '';
  const typeItems = breadText.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
  const lastItem = typeItems[typeItems.length - 1] || '';
  const type = lastItem.replace(/<[^>]+>/g, '').trim().toLowerCase() || null;

  // m2 - handle both m2 and m squared unicode
  const m2vMatch = html.match(/(\d+)(?:m2|m\u00B2|m&#xB2;)\s*vivienda/i);
  const m2cMatch = html.match(/(\d+)(?:m2|m\u00B2|m&#xB2;)\s*construidos/i);
  const m2_vivienda = m2vMatch ? parseInt(m2vMatch[1], 10) : null;
  const m2_construidos = m2cMatch ? parseInt(m2cMatch[1], 10) : null;

  // rooms & bathrooms
  const roomsMatch = html.match(/(\d+)\s*hab\./i);
  const bathsMatch = html.match(/(\d+)\s*(?:ba[nN]o|ba\u00F1o)/i);
  const rooms = roomsMatch ? parseInt(roomsMatch[1], 10) : null;
  const bathrooms = bathsMatch ? parseInt(bathsMatch[1], 10) : null;

  // sale valuation
  const saleEstMatch = html.match(/class="sale-estimate"[^>]*>([\s\S]*?)(?:<|$)/i);
  const saleMinMatch = html.match(/class="sale-min"[^>]*>([\s\S]*?)(?:<|$)/i);
  const saleMaxMatch = html.match(/class="sale-max"[^>]*>([\s\S]*?)(?:<|$)/i);
  const sale = {
    estimate: parseNum((saleEstMatch || [])[1]),
    min: parseNum((saleMinMatch || [])[1]),
    max: parseNum((saleMaxMatch || [])[1]),
  };

  // rent valuation
  const rentEstMatch = html.match(/class="rent-estimate"[^>]*>([\s\S]*?)(?:<|$)/i);
  const rentMinMatch = html.match(/class="rent-min"[^>]*>([\s\S]*?)(?:<|$)/i);
  const rentMaxMatch = html.match(/class="rent-max"[^>]*>([\s\S]*?)(?:<|$)/i);
  const rent = {
    estimate: parseNum((rentEstMatch || [])[1]),
    min: parseNum((rentMinMatch || [])[1]),
    max: parseNum((rentMaxMatch || [])[1]),
  };

  // catastro fields - handle both Anno and Ano
  const yearMatch = html.match(/(?:An[no]o|A\u00F1o):\s*(\d{4})/i);
  const elevMatch = html.match(/Ascensor:\s*(?:S\u00ED|Si|yes|true)/i);
  const qualityMatch = html.match(/Calidad:\s*([a-z\u00e0-\u00ff]+)/i);
  const catRefMatch = html.match(/Ref\.\s*catastral:\s*([A-Z0-9]{14,20})/i);

  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const elevator = elevMatch ? true : false;
  const construction_quality = qualityMatch ? qualityMatch[1].toLowerCase() : null;
  const cadastral_ref = (catRefMatch && catRefMatch[1]) || extractCadastralFromUrl(url);

  return {
    status: 'ok',
    url,
    property: { address, type, m2_vivienda, m2_construidos, rooms, bathrooms,
                year, elevator, construction_quality, cadastral_ref },
    valuation: { sale, rent },
    source: 'idealista-maps',
    scraped_at: new Date().toISOString(),
  };
}

module.exports = { parseIdealistaData };
