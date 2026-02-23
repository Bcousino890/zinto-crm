# Design: Ficha PDF de Propiedad

**Date:** 2026-02-23
**Status:** Approved

---

## Objetivo

Generar una ficha de marketing de 1 página en PDF para cada propiedad del CRM. Destino: enviar a clientes potenciales por WhatsApp/email.

---

## Branding (fijo)

| Campo | Valor |
|---|---|
| Empresa | Benjamín Cousiño Propiedades |
| Email | contacto@bcousinoprop.com |
| Web | www.bcousinoprop.com |
| Logo | Imagen subida por el usuario → base64 → `localStorage('bcp_logo')` |

---

## Layout (1 página A4 vertical)

```
┌──────────────────────────────────────────────┐
│ [LOGO]        Benjamín Cousiño Propiedades   │  header (logo izq, nombre der)
├──────────────────────────────────────────────┤
│                                              │
│          FOTO PRINCIPAL                      │  ~38% del alto · object-fit:cover
│                                              │
├────┬────┬──────┬────────┬────────┬───────────┤
│Tipo│ Op │ m²   │  Hab   │ Baños  │  Precio   │  chips de color verde/navy
├──────────────────────────────────────────────┤
│ 📍 Calle, Número · Barrio · Localidad        │  dirección
├──────────────────────────────────────────────┤
│ Descripción profesional completa...          │  texto · 2-3 párrafos
├──────────────────────────────────────────────┤
│ ✓ Ascensor  ✓ Amueblado  ✓ Exterior  ✓ Gas  │  extras (iconos o checkmarks)
├──────────────────────────────────────────────┤
│ ✉ contacto@bcousinoprop.com  🌐 bcousinoprop │  footer
└──────────────────────────────────────────────┘
```

**No incluye:** URL de Idealista, referencia interna, cuenta/IP.

---

## Decisiones técnicas

### Generación
- **HTML → `window.print()` → PDF** (misma técnica que el export existente)
- Se genera un `Blob` HTML con CSS `@media print` optimizado
- Se abre en nueva pestaña → usuario hace Ctrl+P → "Guardar como PDF"
- Sin librerías externas, funciona desde `file://`

### Logo
- Input `<input type="file" accept="image/*">` en una sección de Configuración de la sidebar
- Se convierte a base64 con `FileReader` y se guarda en `localStorage('bcp_logo')`
- En el PDF se embebe directamente como `<img src="data:...">` → no requiere red

### Foto de portada
- Primera imagen del array `p.images[]` de la propiedad
- Si no hay imágenes: placeholder gris con el nombre de la empresa

### Colores del PDF
- Fondo: blanco
- Header/chips: `#0d1a26` (navy del CRM) y `#00d4a0` (verde del CRM)
- Texto: `#1a1a1a`
- Footer: `#666`

---

## Punto de entrada

- Botón `📄 PDF` en cada tarjeta de propiedad (`renderProps()`)
- Función: `generatePropPDF(propId)`

---

## Config de branding (nueva sección en sidebar)

Pequeña sección en la sidebar del CRM (o modal):
- Input: nombre de empresa (pre-rellenado con "Benjamín Cousiño Propiedades")
- Input: email de contacto
- Input: website
- Botón: subir logo (→ base64 → localStorage)
- Preview del logo actual

---

## Estructura de implementación

1. **Branding config UI** — sección en sidebar con inputs + upload de logo
2. **`generatePropPDF(propId)`** — función principal que genera el HTML
3. **HTML template** — markup + CSS del PDF (A4, print-optimized)
4. **Botón en tarjetas** — añadir `📄 PDF` a `renderProps()`
