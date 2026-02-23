# PDF Ficha de Propiedad — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Añadir un botón "📄 PDF" en cada tarjeta de propiedad que genera una ficha de marketing de 1 página lista para imprimir/guardar como PDF.

**Architecture:** Todo en el único fichero `zinto-crm-v4.html`. Se añade: (1) sección de configuración de branding en la sidebar, (2) función `generatePropPDF(propId)` que construye un Blob HTML con CSS @media print y lo abre en nueva pestaña, (3) botón 📄 PDF en cada tarjeta de `renderProps()`.

**Tech Stack:** HTML/CSS/JS puro, sin librerías externas. Logo como base64 en localStorage. Mismo patrón que el export de inventario existente (línea ~2086).

---

## Contexto del fichero

- **Fichero único:** `/Users/benjamincousino/zinto-crm/zinto-crm-v4.html`
- **Propiedad data model** (línea ~1849, función `saveProp`):
  `{ id, cId, tipo, op, ta, loc, via, num, planta, puerta, barrio, m2, m2u, h, b, est, fc, asc, eq, cal, en, extras[], orient[], pr, ref, desc, urlP, em, tel, images[], fecha }`
- **Cuentas:** `cuentas[]` con `{ id, nombre, gmail, tel, ip }`
- **Branding fijo:** "Benjamín Cousiño Propiedades", contacto@bcousinoprop.com, www.bcousinoprop.com
- **Export existente de referencia:** función `exportProps()` alrededor de línea 2078 — mismo patrón Blob HTML

---

## Task 1: Branding config en sidebar

**Archivos:**
- Modify: `zinto-crm-v4.html` — sección HTML sidebar + JS de branding

### Paso 1: Añadir sección de configuración en la sidebar

Buscar en el HTML el cierre de la sidebar (busca `</nav>` o el último `<div>` de la sidebar `.sb`).
Añadir justo antes del cierre de la sidebar:

```html
<!-- BRANDING CONFIG -->
<div style="padding:14px 16px;border-top:1px solid var(--b1);margin-top:auto">
  <div style="font-family:var(--mo);font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--t4);margin-bottom:10px">⚙ Branding PDF</div>
  <div id="bcp-logo-prev" style="margin-bottom:8px;min-height:32px;display:flex;align-items:center">
    <span id="bcp-logo-empty" style="font-size:9px;color:var(--t4);font-family:var(--mo)">Sin logo</span>
    <img id="bcp-logo-img" src="" style="max-height:32px;max-width:120px;display:none;object-fit:contain">
  </div>
  <label class="btn bg bs" style="font-size:9px;cursor:pointer;display:block;text-align:center;margin-bottom:6px">
    📷 Subir logo
    <input type="file" accept="image/*" style="display:none" onchange="uploadBrandLogo(this)">
  </label>
  <input class="fi" id="bcp-name" placeholder="Nombre empresa" style="font-size:9px;margin-bottom:4px"
    value="Benjamín Cousiño Propiedades" oninput="saveBrand()">
  <input class="fi" id="bcp-email" placeholder="Email" style="font-size:9px;margin-bottom:4px"
    value="contacto@bcousinoprop.com" oninput="saveBrand()">
  <input class="fi" id="bcp-web" placeholder="Web" style="font-size:9px"
    value="www.bcousinoprop.com" oninput="saveBrand()">
</div>
```

### Paso 2: Añadir funciones JS de branding

Añadir después de la función `saveAll()` (o en el bloque de funciones de utilidad):

```javascript
// ════════════════════════════════════════════════
// BRANDING CONFIG
// ════════════════════════════════════════════════
function loadBrand() {
  const logo = localStorage.getItem('bcp_logo') || '';
  const name = localStorage.getItem('bcp_name') || 'Benjamín Cousiño Propiedades';
  const email = localStorage.getItem('bcp_email') || 'contacto@bcousinoprop.com';
  const web = localStorage.getItem('bcp_web') || 'www.bcousinoprop.com';
  if ($('bcp-name')) $('bcp-name').value = name;
  if ($('bcp-email')) $('bcp-email').value = email;
  if ($('bcp-web')) $('bcp-web').value = web;
  _applyLogoPreview(logo);
}
function saveBrand() {
  localStorage.setItem('bcp_name', $('bcp-name')?.value || '');
  localStorage.setItem('bcp_email', $('bcp-email')?.value || '');
  localStorage.setItem('bcp_web', $('bcp-web')?.value || '');
}
function uploadBrandLogo(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result;
    localStorage.setItem('bcp_logo', b64);
    _applyLogoPreview(b64);
    showToast('✓ Logo guardado');
  };
  reader.readAsDataURL(file);
}
function _applyLogoPreview(b64) {
  const img = $('bcp-logo-img'); const empty = $('bcp-logo-empty');
  if (!img) return;
  if (b64) { img.src = b64; img.style.display = 'block'; if(empty) empty.style.display='none'; }
  else { img.style.display = 'none'; if(empty) empty.style.display='block'; }
}
function getBrand() {
  return {
    logo: localStorage.getItem('bcp_logo') || '',
    name: localStorage.getItem('bcp_name') || 'Benjamín Cousiño Propiedades',
    email: localStorage.getItem('bcp_email') || 'contacto@bcousinoprop.com',
    web: localStorage.getItem('bcp_web') || 'www.bcousinoprop.com',
  };
}
```

### Paso 3: Llamar `loadBrand()` en el init

Buscar la función de inicialización (busca `loadAll\|function init\|DOMContentLoaded\|renderDash()`).
Añadir `loadBrand();` junto a los otros calls de inicialización.

### Paso 4: Verificar en browser

Abrir `zinto-crm-v4.html` → en la sidebar debe aparecer la sección "⚙ Branding PDF" con los campos pre-rellenados → subir una imagen de logo → debe aparecer el preview.

### Paso 5: Commit

```bash
git add zinto-crm-v4.html
git commit -m "feat: branding config sidebar para PDF (logo + nombre + contacto)"
```

---

## Task 2: Función `generatePropPDF(propId)`

**Archivos:**
- Modify: `zinto-crm-v4.html` — añadir función JS

### Paso 1: Añadir función generatePropPDF

Añadir justo después de la función `exportProps()` (línea ~2100):

```javascript
// ════════════════════════════════════════════════
// PDF FICHA DE PROPIEDAD
// ════════════════════════════════════════════════
function generatePropPDF(propId) {
  const p = props.find(x => x.id === propId);
  if (!p) { showToast('⚠ Propiedad no encontrada'); return; }
  const brand = getBrand();
  const cnt = cuentas.find(c => c.id === p.cId);

  // Datos
  const precio = Number(p.pr || 0).toLocaleString('es-ES');
  const precioStr = `€${precio}${p.op === 'Alquiler' ? '/mes' : ''}`;
  const ubicacion = [p.via ? p.via + (p.num ? ' ' + p.num : '') : '', p.barrio, p.loc].filter(Boolean).join(' · ');
  const planta = p.planta && p.planta !== 'Selecciona' ? p.planta : '';
  const extras = [
    p.asc && p.asc !== 'No' ? 'Ascensor' : '',
    p.eq || '',
    p.fc || '',
    p.cal || '',
    p.en ? 'Cert. ' + p.en : '',
    ...( p.extras || []),
    ...( p.orient || []),
  ].filter(Boolean);
  const foto = p.images && p.images[0] ? p.images[0] : '';
  const desc = (p.desc || '').replace(/\n/g, '<br>');

  // Logo HTML
  const logoHtml = brand.logo
    ? `<img src="${brand.logo}" style="max-height:38px;max-width:140px;object-fit:contain">`
    : `<span style="font-size:13px;font-weight:700;color:#0d1a26;letter-spacing:-.3px">${brand.name}</span>`;

  // Foto HTML
  const fotoHtml = foto
    ? `<div class="hero" style="background-image:url('${foto}')"></div>`
    : `<div class="hero hero-empty"><span>${brand.name}</span></div>`;

  // Chips
  const chipsData = [
    { label: p.tipo || 'Piso', color: '#0d1a26' },
    { label: p.op || 'Alquiler', color: '#0d1a26' },
    p.m2 ? { label: (p.m2u || p.m2) + ' m²', color: '#0d5c42' } : null,
    p.h ? { label: p.h + ' hab', color: '#0d5c42' } : null,
    p.b ? { label: p.b + ' baño' + (p.b > 1 ? 's' : ''), color: '#0d5c42' } : null,
    planta ? { label: 'Planta ' + planta, color: '#334' } : null,
  ].filter(Boolean);
  const chipsHtml = chipsData.map(c =>
    `<span style="background:${c.color};color:#fff;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;white-space:nowrap">${c.label}</span>`
  ).join('');

  // Extras
  const extrasHtml = extras.length
    ? extras.map(e => `<span class="extra-tag">✓ ${e}</span>`).join('')
    : '';

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 portrait;margin:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff;width:210mm;min-height:297mm;padding:0}
    .page{width:210mm;min-height:297mm;padding:14mm 14mm 10mm;display:flex;flex-direction:column;gap:0}
    .header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid #0d1a26;margin-bottom:12px}
    .header-right{text-align:right}
    .header-right .co-name{font-size:11px;font-weight:700;color:#0d1a26;letter-spacing:-.2px}
    .header-right .ref{font-size:8.5px;color:#888;font-family:monospace;margin-top:2px}
    .hero{width:100%;height:195px;background-size:cover;background-position:center;border-radius:6px;margin-bottom:14px;flex-shrink:0}
    .hero-empty{background:#e8ecf0;display:flex;align-items:center;justify-content:center}
    .hero-empty span{font-size:14px;color:#aaa;font-weight:600;letter-spacing:.5px}
    .precio{font-size:24px;font-weight:800;color:#00a07a;margin-bottom:8px;letter-spacing:-.5px}
    .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .ubicacion{font-size:11px;color:#555;margin-bottom:12px;display:flex;align-items:center;gap:5px}
    .ubicacion::before{content:"📍";font-size:11px}
    .desc{font-size:10.5px;color:#2a2a2a;line-height:1.65;margin-bottom:12px;flex:1}
    .extras{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px}
    .extra-tag{font-size:9.5px;color:#0d5c42;background:#e8f7f2;padding:3px 9px;border-radius:12px;font-weight:500}
    .divider{height:1px;background:#e8ecf0;margin:0 0 12px}
    .footer{display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #e8ecf0;margin-top:auto}
    .footer-contact{font-size:10px;color:#555;display:flex;gap:18px}
    .footer-contact span{display:flex;align-items:center;gap:4px}
    .footer-web{font-size:9.5px;color:#aaa;font-family:monospace}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.btn-print{display:none!important}}
  `;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>Ficha · ${p.tipo || 'Propiedad'} ${ubicacion}</title>
  <style>${css}</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>${logoHtml}</div>
    <div class="header-right">
      <div class="co-name">${brand.name}</div>
      ${p.ref ? `<div class="ref">REF ${p.ref}</div>` : ''}
    </div>
  </div>

  ${fotoHtml}

  <div class="precio">${precioStr}</div>
  <div class="chips">${chipsHtml}</div>
  <div class="ubicacion">${ubicacion}</div>

  <div class="desc">${desc || '<em style="color:#aaa">Sin descripción</em>'}</div>

  ${extrasHtml ? `<div class="extras">${extrasHtml}</div>` : ''}

  <div class="footer">
    <div class="footer-contact">
      <span>✉ ${brand.email}</span>
      ${cnt && cnt.tel ? `<span>📞 ${cnt.tel}</span>` : ''}
    </div>
    <div class="footer-web">${brand.web}</div>
  </div>
</div>

<div style="text-align:center;padding:14px;font-family:sans-serif">
  <button class="btn-print" onclick="window.print()"
    style="background:#0d1a26;color:#fff;border:none;border-radius:7px;padding:10px 28px;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.2px">
    🖨 Imprimir / Guardar como PDF
  </button>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  showToast('📄 Ficha abierta · Ctrl+P para guardar como PDF');
}
```

### Paso 2: Verificar

Abrir CRM → propiedad con imágenes y descripción → llamar `generatePropPDF('p...')` desde consola → debe abrirse nueva pestaña con la ficha.

### Paso 3: Commit

```bash
git add zinto-crm-v4.html
git commit -m "feat: función generatePropPDF - ficha marketing 1-página HTML+CSS"
```

---

## Task 3: Botón 📄 PDF en tarjetas de propiedad

**Archivos:**
- Modify: `zinto-crm-v4.html` — función `renderProps()`

### Paso 1: Localizar renderProps

Buscar `function renderProps` (alrededor de línea 1100). Encontrar donde se genera el HTML de cada tarjeta (busca `pc-ref` o el botón de editar/borrar de la tarjeta).

### Paso 2: Añadir botón PDF a la tarjeta

En la parte de acciones de la tarjeta (donde estén los otros botones de la propiedad), añadir:

```javascript
<button class="btn bg bs" onclick="generatePropPDF('${p.id}')" style="font-size:8.5px">📄 PDF</button>
```

Ejemplo de cómo debería quedar el bloque de botones de la tarjeta:
```html
<div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap">
  <button class="btn bg bs" onclick="generatePropPDF('${p.id}')" style="font-size:8.5px">📄 PDF</button>
  <!-- otros botones existentes... -->
</div>
```

### Paso 3: Verificar en browser

Abrir CRM → sección Propiedades → cada tarjeta debe mostrar botón "📄 PDF" → al hacer click se abre la ficha en nueva pestaña.

### Paso 4: Verificar PDF final

En la nueva pestaña → Ctrl+P → "Guardar como PDF" → comprobar:
- [ ] Logo/nombre de empresa arriba
- [ ] Foto principal grande
- [ ] Precio destacado en verde
- [ ] Chips de tipo/operación/m²/habitaciones
- [ ] Descripción completa
- [ ] Extras como tags
- [ ] Footer con email y web
- [ ] Se imprime en 1 página A4

### Paso 5: Commit final

```bash
git add zinto-crm-v4.html
git commit -m "feat: botón PDF en tarjetas de propiedad - ficha marketing completa"
```

---

## Notas de implementación

- Las fotos de Idealista tienen `referrer-policy: no-referrer` en el `<meta>` del CRM — necesario para que carguen en el HTML del PDF (el CRM ya lo tiene en línea 5)
- El HTML del PDF debe incluir también `<meta name="referrer" content="no-referrer">` para que las imágenes carguen en la nueva pestaña
- Si las imágenes no cargan en la nueva pestaña (cross-origin), usar el proxy: `https://zinto-img-proxy.benjamincousino1.workers.dev/?url=` + encodeURIComponent(foto)
