// Service worker de Pizarra: funciona sin conexión, revisa los avisos en
// segundo plano y alimenta el widget del panel de widgets de Windows 11.
import { API_DOLARES, normalizar, evaluarAlertas, textoAlerta, datosWidget } from './logic.js';

const VERSION = 'pizarra-v2';
const CACHE_APP = `${VERSION}-app`;
const CACHE_DATOS = 'pizarra-datos';
const CACHE_CONFIG = 'pizarra-config';
const CONFIG_URL = new URL('./__pizarra/config', self.registration.scope).href;
const SYNC_AVISOS = 'pizarra-cotizaciones';
const WIDGET_TAG = 'cotizaciones';

const ARCHIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'logic.js', 'manifest.webmanifest', 'privacidad.html',
  'icons/icon-192.png', 'icons/icon-512.png', 'widgets/cotizaciones.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k.endsWith('-app') && k !== CACHE_APP).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    // Archivos de la app: primero la caché, así abre al instante y sin conexión.
    event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((r) => r || fetch(event.request)));
  } else if (url.hostname === 'dolarapi.com' || url.hostname === 'api.argentinadatos.com') {
    // Cotizaciones: primero la red; si no hay conexión, lo último que se guardó.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_DATOS);
      try {
        const r = await fetch(event.request);
        if (r.ok) await cache.put(event.request.url, r.clone());
        return r;
      } catch (e) {
        const guardada = await cache.match(event.request.url);
        if (guardada) return guardada;
        throw e;
      }
    })());
  }
});

async function cotizacionesFrescas() {
  const r = await fetch(API_DOLARES, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const cache = await caches.open(CACHE_DATOS);
  await cache.put(API_DOLARES, r.clone());
  return normalizar(await r.json());
}

async function cotizacionesGuardadas() {
  const r = await (await caches.open(CACHE_DATOS)).match(API_DOLARES);
  return r ? normalizar(await r.json()) : [];
}

// --- Avisos en segundo plano --------------------------------------------------
async function revisarAvisos(cotizaciones) {
  const cache = await caches.open(CACHE_CONFIG);
  const r = await cache.match(CONFIG_URL);
  if (!r) return;
  const config = await r.json();
  const { alertas, disparadas } = evaluarAlertas(config.alertas, cotizaciones);
  await cache.put(CONFIG_URL, new Response(JSON.stringify({ ...config, alertas }), {
    headers: { 'Content-Type': 'application/json' },
  }));
  for (const d of disparadas) {
    const { titulo, cuerpo } = textoAlerta(d);
    await self.registration.showNotification(titulo, { body: cuerpo, icon: 'icons/icon-192.png', tag: `aviso-${d.alerta.id}` });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(abrirApp());
});

async function abrirApp() {
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (ventanas.length) return ventanas[0].focus();
  return self.clients.openWindow('./');
}

// --- Widget de Windows 11 ------------------------------------------------------
async function actualizarWidget(widget, cotizaciones) {
  if (!self.widgets || !widget) return;
  const template = await (await fetch(widget.definition.msAcTemplate)).text();
  const datos = datosWidget(cotizaciones.length ? cotizaciones : await cotizacionesGuardadas());
  await self.widgets.updateByTag(widget.definition.tag, { template, data: JSON.stringify(datos) });
}

async function cotizacionesParaWidget() {
  try { return await cotizacionesFrescas(); } catch { return cotizacionesGuardadas(); }
}

self.addEventListener('widgetinstall', (event) => {
  event.waitUntil((async () => {
    const tags = self.registration.periodicSync ? await self.registration.periodicSync.getTags() : [];
    if (self.registration.periodicSync && !tags.includes(event.widget.definition.tag)) {
      await self.registration.periodicSync.register(event.widget.definition.tag, {
        minInterval: (event.widget.definition.update || 900) * 1000,
      });
    }
    await actualizarWidget(event.widget, await cotizacionesParaWidget());
  })());
});

self.addEventListener('widgetuninstall', (event) => {
  event.waitUntil((async () => {
    if (self.registration.periodicSync && event.widget.instances.length <= 1) {
      await self.registration.periodicSync.unregister(event.widget.definition.tag);
    }
  })());
});

self.addEventListener('widgetresume', (event) => {
  event.waitUntil(cotizacionesParaWidget().then((c) => actualizarWidget(event.widget, c)));
});

self.addEventListener('widgetclick', (event) => {
  if (event.action === 'actualizar') {
    event.waitUntil(cotizacionesParaWidget().then((c) => actualizarWidget(event.widget, c)));
  } else if (event.action === 'abrir') {
    event.waitUntil(abrirApp());
  }
});

// --- Sincronización periódica (avisos y widget) ---------------------------------
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== SYNC_AVISOS && event.tag !== WIDGET_TAG) return;
  event.waitUntil((async () => {
    const cotizaciones = await cotizacionesFrescas();
    await revisarAvisos(cotizaciones);
    if (self.widgets) {
      const widget = await self.widgets.getByTag(WIDGET_TAG);
      if (widget) await actualizarWidget(widget, cotizaciones);
    }
  })());
});
