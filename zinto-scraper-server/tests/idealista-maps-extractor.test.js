const { parseIdealistaData } = require('../lib/idealista-maps-extractor');

describe('parseIdealistaData', () => {
  const SAMPLE_HTML = `
    <html><body>
      <h1>Esc.1 5 D en Calle Castello, 44, Madrid</h1>
      <nav aria-label="breadcrumb"><ol>
        <li><a href="/">Inicio</a></li>
        <li>Piso</li>
      </ol></nav>
      <section id="main-info">
        <span>75m&#xB2; vivienda</span>
        <span>85m&#xB2; construidos</span>
        <span>2 hab.</span>
        <span>1 bano</span>
      </section>
      <section id="valuation">
        <div class="sale-estimate">517.000 EUR</div>
        <div class="sale-min">461.000 EUR</div>
        <div class="sale-max">563.000 EUR</div>
        <div class="rent-estimate">1.940 EUR/mes</div>
        <div class="rent-min">1.780 EUR/mes</div>
        <div class="rent-max">2.080 EUR/mes</div>
      </section>
      <section id="catastro">
        <span>Anno: 1927</span>
        <span>Ascensor: Si</span>
        <span>Calidad: buena</span>
        <span>Ref. catastral: 2355411VK4725E0027SH</span>
      </section>
    </body></html>
  `;

  const SAMPLE_URL = 'https://www.idealista.com/maps/madrid-madrid/calle-castello/44/2355411VK4725E0027SH/';

  test('extracts address from h1', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.address).toContain('Calle Castello');
  });

  test('extracts m2_vivienda', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.m2_vivienda).toBe(75);
  });

  test('extracts m2_construidos', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.m2_construidos).toBe(85);
  });

  test('extracts room count', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.rooms).toBe(2);
  });

  test('extracts bathroom count', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.bathrooms).toBe(1);
  });

  test('extracts sale estimate', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.sale.estimate).toBe(517000);
  });

  test('extracts sale min', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.sale.min).toBe(461000);
  });

  test('extracts sale max', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.sale.max).toBe(563000);
  });

  test('extracts rent estimate', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.rent.estimate).toBe(1940);
  });

  test('extracts rent min', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.rent.min).toBe(1780);
  });

  test('extracts rent max', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.valuation.rent.max).toBe(2080);
  });

  test('extracts year from catastro', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.year).toBe(1927);
  });

  test('extracts elevator true', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.elevator).toBe(true);
  });

  test('extracts construction quality', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.property.construction_quality).toBe('buena');
  });

  test('extracts cadastral ref from URL when not in page', () => {
    const htmlNoCatRef = SAMPLE_HTML.replace('Ref. catastral: 2355411VK4725E0027SH', '');
    const result = parseIdealistaData(htmlNoCatRef, SAMPLE_URL);
    expect(result.property.cadastral_ref).toBe('2355411VK4725E0027SH');
  });

  test('returns source and scraped_at', () => {
    const result = parseIdealistaData(SAMPLE_HTML, SAMPLE_URL);
    expect(result.source).toBe('idealista-maps');
    expect(result.scraped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
