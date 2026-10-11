// Lógica pura de Pizarra: sin DOM ni red, para poder probarla con node --test
// y reutilizarla desde la página y el service worker.

export const API_DOLARES = 'https://dolarapi.com/v1/dolares';
export const API_HISTORICO = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/';

// Orden y textos de cada cotización. `casa` es el identificador de DolarApi.
export const CASAS = [
  { casa: 'blue', titulo: 'Blue', detalle: 'Mercado informal' },
  { casa: 'oficial', titulo: 'Oficial', detalle: 'Banco Nación' },
  { casa: 'bolsa', titulo: 'MEP', detalle: 'Dólar bolsa' },
  { casa: 'contadoconliqui', titulo: 'CCL', detalle: 'Contado con liquidación' },
  { casa: 'tarjeta', titulo: 'Tarjeta', detalle: 'Con impuestos' },
  { casa: 'cripto', titulo: 'Cripto', detalle: 'USDT' },
  { casa: 'mayorista', titulo: 'Mayorista', detalle: 'Mercado de cambios' },
];

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normaliza la respuesta de /v1/dolares: ordena, agrega títulos y descarta lo desconocido. */
export function normalizar(respuesta) {
  if (!Array.isArray(respuesta)) return [];
  const porCasa = new Map(respuesta.map((c) => [c && c.casa, c]));
  return CASAS.filter(({ casa }) => porCasa.has(casa)).map((meta) => {
    const c = porCasa.get(meta.casa);
    return {
      ...meta,
      compra: numero(c.compra),
      venta: numero(c.venta),
      actualizado: c.fechaActualizacion || null,
    };
  });
}

export function buscar(cotizaciones, casa) {
  return cotizaciones.find((c) => c.casa === casa) || null;
}

/** Brecha entre dos cotizaciones, usando el precio de venta: 0.05 = 5%. */
export function brecha(cotizaciones, casa = 'blue', referencia = 'oficial') {
  const a = buscar(cotizaciones, casa);
  const b = buscar(cotizaciones, referencia);
  if (!a || !b || !a.venta || !b.venta) return null;
  return a.venta / b.venta - 1;
}

/**
 * Convierte entre pesos y dólares como lo haría una casa de cambio:
 * para comprar dólares se paga el precio de venta; al vender dólares se
 * cobra el precio de compra.
 */
export function convertir(monto, cotizacion, direccion) {
  if (!cotizacion || !Number.isFinite(monto) || monto < 0) return null;
  if (direccion === 'pesos-a-dolares') {
    return cotizacion.venta ? monto / cotizacion.venta : null;
  }
  if (direccion === 'dolares-a-pesos') {
    return cotizacion.compra ? monto * cotizacion.compra : null;
  }
  return null;
}

const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const fmtDolares = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 2 });
const fmtPrecio = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fmtPrecio2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPorcentaje = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatoPesos = (n) => (n == null ? '—' : fmtPesos.format(n));
export const formatoDolares = (n) => (n == null ? '—' : fmtDolares.format(n));
export const formatoPrecio = (n) => {
  if (n == null) return '—';
  // Enteros sin decimales ($ 1.540); con centavos, siempre dos ($ 1.535,90).
  return '$\u00a0' + (Number.isInteger(n) ? fmtPrecio.format(n) : fmtPrecio2.format(n));
};
export const formatoPorcentaje = (n) => (n == null ? '—' : fmtPorcentaje.format(n));

/** Acepta montos escritos a la argentina: "1.500.000,50", "1500,5" o "1500.5". */
export function leerMonto(texto) {
  if (typeof texto !== 'string') return NaN;
  let t = texto.trim().replace(/\s|\$|US?D?/gi, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** "hace 5 min", "hace 2 h", "ayer"... para mostrar qué tan fresco es el dato. */
export function haceCuanto(iso, ahora = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((ahora - t) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/**
 * Evalúa las alertas contra las cotizaciones. Una alerta solo "dispara"
 * cuando cruza el umbral (antes no se cumplía y ahora sí), para no repetir
 * el aviso cada vez que se actualiza.
 *
 * alerta: { id, casa, condicion: 'mayor' | 'menor', valor, cumplida? }
 * Devuelve { alertas (con `cumplida` actualizado), disparadas }.
 */
export function evaluarAlertas(alertas, cotizaciones) {
  const disparadas = [];
  const nuevas = (alertas || []).map((a) => {
    const c = buscar(cotizaciones, a.casa);
    if (!c || c.venta == null) return a;
    const cumple = a.condicion === 'menor' ? c.venta <= a.valor : c.venta >= a.valor;
    if (cumple && !a.cumplida) disparadas.push({ alerta: a, cotizacion: c });
    return { ...a, cumplida: cumple };
  });
  return { alertas: nuevas, disparadas };
}

export function textoAlerta({ alerta, cotizacion }) {
  const verbo = alerta.condicion === 'menor' ? 'bajó a' : 'llegó a';
  return {
    titulo: `Dólar ${cotizacion.titulo} ${verbo} ${formatoPrecio(cotizacion.venta)}`,
    cuerpo: `Tu aviso era ${alerta.condicion === 'menor' ? 'por debajo de' : 'por encima de'} ${formatoPrecio(alerta.valor)} (precio de venta).`,
  };
}

const redondo = (n) => (n == null ? null : Math.round(n));

/** Datos para el widget de Windows: las cotizaciones principales ya formateadas. */
export function datosWidget(cotizaciones, ahora = Date.now()) {
  const principales = ['blue', 'oficial', 'bolsa', 'tarjeta'];
  const filas = principales
    .map((casa) => buscar(cotizaciones, casa))
    .filter(Boolean)
    // En el widget el espacio es chico: precios redondeados, sin centavos.
    .map((c) => ({ titulo: c.titulo, compra: formatoPrecio(redondo(c.compra)), venta: formatoPrecio(redondo(c.venta)) }));
  const ultima = cotizaciones
    .map((c) => Date.parse(c.actualizado))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];
  const b = brecha(cotizaciones);
  return {
    filas,
    brecha: b == null ? '' : `Brecha blue/oficial: ${formatoPorcentaje(b)}`,
    actualizado: ultima ? `Actualizado ${haceCuanto(new Date(ultima).toISOString(), ahora)}` : '',
  };
}

/** Serie histórica de ArgentinaDatos → últimos `dias` puntos con venta numérica. */
export function serieHistorica(respuesta, dias = 30) {
  if (!Array.isArray(respuesta)) return [];
  return respuesta
    .filter((p) => p && numero(p.venta) != null && p.fecha)
    .slice(-dias)
    .map((p) => ({ fecha: p.fecha, venta: p.venta }));
}

/** Variación entre el primer y el último punto de una serie: 0.02 = +2%. */
export function variacion(serie) {
  if (!serie || serie.length < 2) return null;
  const inicio = serie[0].venta;
  const fin = serie[serie.length - 1].venta;
  return inicio ? fin / inicio - 1 : null;
}
