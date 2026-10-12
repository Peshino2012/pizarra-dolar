import {
  API_DOLARES, API_HISTORICO, CASAS, normalizar, buscar, brecha, convertir, leerMonto,
  haceCuanto, evaluarAlertas, textoAlerta, serieHistorica, variacion,
  formatoPesos, formatoDolares, formatoPrecio, formatoPorcentaje,
} from './logic.js';

const REFRESCO_MS = 5 * 60 * 1000;
const CLAVES = { cotizaciones: 'pizarra:cotizaciones', serie: 'pizarra:serie-blue', alertas: 'pizarra:alertas' };
const CONFIG_URL = './__pizarra/config';
const $ = (id) => document.getElementById(id);

// --- Guardado local: puede fallar (modo privado, almacenamiento bloqueado) ---
function leer(clave, porDefecto) {
  try {
    const v = localStorage.getItem(clave);
    return v ? JSON.parse(v) : porDefecto;
  } catch {
    return porDefecto;
  }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento: la app sigue andando */ }
}

const estado = {
  cotizaciones: leer(CLAVES.cotizaciones, { datos: [], guardado: null }),
  serie: leer(CLAVES.serie, []),
  alertas: leer(CLAVES.alertas, []),
  cargando: false,
  intentado: false,
  sinConexion: false,
};

async function pedirJson(url) {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(corte);
  }
}

// --- Render -----------------------------------------------------------------
function renderPizarra() {
  const c = estado.cotizaciones.datos;
  const blue = buscar(c, 'blue');
  $('hero-venta').textContent = formatoPrecio(blue?.venta ?? null);
  $('hero-compra').textContent = formatoPrecio(blue?.compra ?? null);

  const b = brecha(c);
  $('brecha').hidden = b == null;
  if (b != null) $('brecha').textContent = `Brecha con el oficial: ${formatoPorcentaje(b)}`;

  const filas = $('filas');
  filas.replaceChildren(...c.filter((x) => x.casa !== 'blue').map((x) => {
    const fila = document.createElement('div');
    fila.className = 'row';
    fila.setAttribute('role', 'row');
    fila.innerHTML = `
      <span class="name" role="cell"><b></b><small></small></span>
      <span class="num" role="cell"></span>
      <span class="num venta" role="cell"></span>`;
    fila.querySelector('b').textContent = x.titulo;
    fila.querySelector('small').textContent = x.detalle;
    const [compra, venta] = fila.querySelectorAll('.num');
    compra.textContent = formatoPrecio(x.compra);
    venta.textContent = formatoPrecio(x.venta);
    return fila;
  }));
  renderEstado();
}

function renderSerie() {
  const s = estado.serie;
  const fig = $('spark');
  if (s.length < 2) { fig.hidden = true; return; }
  const valores = s.map((p) => p.venta);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const puntos = s.map((p, i) => {
    const x = (i / (s.length - 1)) * 240;
    const y = 60 - ((p.venta - min) / rango) * 56;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  $('spark-line').setAttribute('points', puntos.join(' '));
  const v = variacion(s);
  const signo = v > 0 ? '+' : '';
  $('spark-txt').textContent = `Últimos ${s.length} días: ${signo}${formatoPorcentaje(v)}`;
  fig.hidden = false;
}

function renderEstado() {
  const el = $('estado');
  const { datos, guardado } = estado.cotizaciones;
  if (!datos.length && (estado.cargando || !estado.intentado)) { el.textContent = 'Cargando cotizaciones…'; return; }
  if (!datos.length) {
    el.innerHTML = '<span class="offline">No se pudieron cargar las cotizaciones.</span> Revisá tu conexión.';
    return;
  }
  if (estado.sinConexion) {
    el.innerHTML = '<span class="offline">Sin conexión.</span> Mostrando los últimos datos guardados.';
    return;
  }
  const blue = buscar(datos, 'blue');
  el.textContent = `Actualizado ${haceCuanto(blue?.actualizado || guardado)}`;
}

function opcionesCasas(select, elegida) {
  select.replaceChildren(...CASAS.map(({ casa, titulo }) => {
    const o = document.createElement('option');
    o.value = casa;
    o.textContent = titulo;
    o.selected = casa === elegida;
    return o;
  }));
}

function renderConversor() {
  const monto = leerMonto($('monto').value);
  const direccion = $('direccion').value;
  const cot = buscar(estado.cotizaciones.datos, $('casa-conv').value);
  const r = Number.isNaN(monto) ? null : convertir(monto, cot, direccion);
  $('resultado').textContent = r == null ? '—'
    : direccion === 'pesos-a-dolares' ? formatoDolares(r) : formatoPesos(r);
  $('resultado-nota').textContent = !cot ? ''
    : direccion === 'pesos-a-dolares'
      ? `Comprando a ${formatoPrecio(cot.venta)} por dólar (${cot.titulo}, precio de venta).`
      : `Vendiendo a ${formatoPrecio(cot.compra)} por dólar (${cot.titulo}, precio de compra).`;
}

function renderAlertas() {
  const lista = $('lista-avisos');
  lista.replaceChildren(...estado.alertas.map((a) => {
    const li = document.createElement('li');
    const meta = CASAS.find((c) => c.casa === a.casa);
    const texto = document.createElement('span');
    texto.textContent = `${meta ? meta.titulo : a.casa} ${a.condicion === 'menor' ? 'baja a' : 'sube a'} ${formatoPrecio(a.valor)}`;
    if (a.cumplida) {
      const tag = document.createElement('span');
      tag.className = 'cumplida';
      tag.textContent = 'cumplido';
      texto.append(tag);
    }
    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.textContent = 'Quitar';
    borrar.setAttribute('aria-label', `Quitar aviso: ${texto.textContent}`);
    borrar.addEventListener('click', () => {
      estado.alertas = estado.alertas.filter((x) => x.id !== a.id);
      persistirAlertas();
      renderAlertas();
    });
    li.append(texto, borrar);
    return li;
  }));
  const necesitaPermiso = estado.alertas.length > 0 && 'Notification' in window && Notification.permission === 'default';
  $('permiso').hidden = !necesitaPermiso;
}

function toast(texto) {
  const t = $('toast');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
}

// --- Datos ------------------------------------------------------------------
async function actualizar() {
  if (estado.cargando) return;
  estado.cargando = true;
  $('actualizar').disabled = true;
  renderEstado();
  try {
    const datos = normalizar(await pedirJson(API_DOLARES));
    if (!datos.length) throw new Error('respuesta vacía');
    estado.cotizaciones = { datos, guardado: new Date().toISOString() };
    estado.sinConexion = false;
    guardar(CLAVES.cotizaciones, estado.cotizaciones);
    renderPizarra();
    renderConversor();
    await revisarAlertas();
  } catch {
    estado.sinConexion = true;
  } finally {
    estado.cargando = false;
    estado.intentado = true;
    $('actualizar').disabled = false;
    renderEstado();
  }
  // El histórico es un extra: si falla, la pizarra sigue igual.
  try {
    estado.serie = serieHistorica(await pedirJson(API_HISTORICO + 'blue'), 30);
    guardar(CLAVES.serie, estado.serie);
    renderSerie();
  } catch { /* se mantiene la serie guardada */ }
}

// --- Avisos -----------------------------------------------------------------
async function persistirAlertas() {
  guardar(CLAVES.alertas, estado.alertas);
  // El service worker lee los avisos desde la caché para revisarlos en segundo plano.
  try {
    const cache = await caches.open('pizarra-config');
    await cache.put(CONFIG_URL, new Response(JSON.stringify({ alertas: estado.alertas }), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch { /* sin caché: los avisos funcionan con la app abierta */ }
}

async function revisarAlertas() {
  if (!estado.alertas.length) return;
  const { alertas, disparadas } = evaluarAlertas(estado.alertas, estado.cotizaciones.datos);
  estado.alertas = alertas;
  await persistirAlertas();
  renderAlertas();
  for (const d of disparadas) {
    const { titulo, cuerpo } = textoAlerta(d);
    toast(titulo);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) await reg.showNotification(titulo, { body: cuerpo, icon: 'icons/icon-192.png', tag: `aviso-${d.alerta.id}` });
        else new Notification(titulo, { body: cuerpo });
      } catch { /* el toast ya avisó */ }
    }
  }
}

async function activarSegundoPlano() {
  const nota = $('segundo-plano');
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) {
      nota.textContent = 'Los avisos se revisan mientras la app está abierta.';
      nota.hidden = !estado.alertas.length;
      return;
    }
    const permiso = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (permiso.state === 'granted') {
      await reg.periodicSync.register('pizarra-cotizaciones', { minInterval: 30 * 60 * 1000 });
      nota.textContent = 'Los avisos también se revisan en segundo plano, cada 30 minutos aprox.';
    } else {
      nota.textContent = 'Los avisos se revisan mientras la app está abierta. Instalala para que también funcionen en segundo plano.';
    }
    nota.hidden = !estado.alertas.length;
  } catch {
    nota.hidden = true;
  }
}

// --- Eventos ----------------------------------------------------------------
function iniciar() {
  // El botón de la Store solo tiene sentido en el navegador, no dentro de la app instalada.
  const instalada = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches;
  $('link-store').hidden = instalada;
  opcionesCasas($('casa-conv'), 'blue');
  opcionesCasas($('aviso-casa'), 'blue');
  renderPizarra();
  renderSerie();
  renderConversor();
  renderAlertas();

  $('actualizar').addEventListener('click', actualizar);
  for (const id of ['monto', 'direccion', 'casa-conv']) {
    $(id).addEventListener('input', renderConversor);
    $(id).addEventListener('change', renderConversor);
  }
  $('conversor').addEventListener('submit', (e) => e.preventDefault());

  $('form-aviso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = leerMonto($('aviso-valor').value);
    const error = $('aviso-error');
    if (Number.isNaN(valor) || valor <= 0) {
      error.textContent = 'Escribí un valor en pesos, por ejemplo 1.600.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    const nuevo = { id: Date.now(), casa: $('aviso-casa').value, condicion: $('aviso-cond').value, valor };
    // Si ya se cumple al crearlo, se marca como cumplido para avisar recién en el próximo cruce.
    const { alertas } = evaluarAlertas([nuevo], estado.cotizaciones.datos);
    estado.alertas = [...estado.alertas, alertas[0]];
    $('aviso-valor').value = '';
    await persistirAlertas();
    renderAlertas();
    activarSegundoPlano();
    if (alertas[0].cumplida) toast('Ese valor ya se cumple ahora: te avisamos la próxima vez que lo cruce.');
  });

  $('btn-permiso').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* el navegador no lo permite */ }
    renderAlertas();
    activarSegundoPlano();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const viejo = Date.now() - Date.parse(estado.cotizaciones.guardado || 0) > REFRESCO_MS;
    if (viejo) actualizar();
  });
  setInterval(() => { if (document.visibilityState === 'visible') actualizar(); }, REFRESCO_MS);
  setInterval(renderEstado, 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { type: 'module' }).then(activarSegundoPlano).catch(() => {});
  }
  persistirAlertas();
  actualizar();
}

iniciar();
