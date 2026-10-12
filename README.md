# Pizarra — Dólar en Argentina

**[Descargar en Microsoft Store](https://apps.microsoft.com/detail/9mx0hpkjtclz)** · [Usar en el navegador](https://peshino2012.github.io/pizarra-dolar/)

App web instalable (PWA) para Windows 11 con todas las cotizaciones del dólar
en Argentina, conversor, avisos con notificaciones y widget para el panel de
widgets. Pensada para publicarse en Microsoft Store empaquetada con PWABuilder.

- Datos: [DolarApi.com](https://dolarapi.com) (cotizaciones) y
  [ArgentinaDatos](https://argentinadatos.com) (histórico). Ambas son públicas,
  gratuitas y permiten consultas desde el navegador (CORS abierto).
- Sin servidor propio, sin cuentas, sin seguimiento. Todo queda en el equipo.
- Tests: `npm test` (lógica de cotizaciones, conversor, avisos y widget,
  probados con respuestas reales guardadas en `samples/`).

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `logic.js` | Lógica pura (cotizaciones, conversor, avisos, datos del widget) |
| `sw.js` | Service worker: sin conexión, avisos en segundo plano, widget |
| `widgets/` | Plantilla Adaptive Card del widget y datos iniciales |
| `manifest.webmanifest` | Manifiesto de la PWA (incluye el widget) |
| `privacidad.html` | Política de privacidad (la pide la Store) |
| `store/` | Capturas y textos para la ficha de Microsoft Store |

## Cómo publicarla

1. **Sitio público:** este repo se publica con GitHub Pages (rama `main`,
   carpeta raíz) en `https://peshino2012.github.io/pizarra-dolar/`.
2. **Partner Center:** en storedeveloper.microsoft.com (cuenta individual,
   gratis) → Apps and games → New product → MSIX or PWA app → reservar el nombre.
   En *Product identity* copiar **Package/Identity/Name**, **Publisher** (CN=…)
   y **Publisher display name**.
3. **PWABuilder:** en pwabuilder.com pegar la URL de Pages → *Package for
   stores* → *Windows* → completar los tres datos del paso 2 → descargar el zip.
4. **Envío:** en Partner Center, *Packages*: subir el `.msixbundle` del zip;
   *Pricing*: gratis; *Properties*: categoría Finanzas y URL de privacidad;
   *Age ratings*: cuestionario; *Store listings*: textos y capturas de
   `store/ficha-store.md`. Enviar a certificación (suele tardar unos días).

## Para la versión Pro (más adelante)

Avisos ilimitados e histórico extendido como compra dentro de la app, usando la
API de bienes digitales de Microsoft Store para PWAs (Microsoft se queda con el 15%).
