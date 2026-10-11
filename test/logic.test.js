import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizar, brecha, convertir, buscar, leerMonto, haceCuanto, evaluarAlertas,
  textoAlerta, datosWidget, serieHistorica, variacion, formatoPrecio,
} from '../logic.js';

// Respuestas reales de las APIs, guardadas por .github/workflows/dolar-samples.yml.
const muestra = JSON.parse(readFileSync(new URL('../samples/dolares.json', import.meta.url)));
const historico = JSON.parse(readFileSync(new URL('../samples/historico-blue.json', import.meta.url)));

test('normaliza la respuesta real de DolarApi en el orden de la pizarra', () => {
  const c = normalizar(muestra);
  assert.deepEqual(c.map((x) => x.casa), ['blue', 'oficial', 'bolsa', 'contadoconliqui', 'tarjeta', 'cripto', 'mayorista']);
  assert.equal(buscar(c, 'bolsa').titulo, 'MEP');
  for (const x of c) {
    assert.equal(typeof x.venta, 'number');
    assert.ok(x.actualizado);
  }
});

test('ignora casas desconocidas, valores no numéricos y respuestas inválidas', () => {
  assert.deepEqual(normalizar(null), []);
  assert.deepEqual(normalizar({ error: 'x' }), []);
  const c = normalizar([{ casa: 'blue', compra: 'n/d', venta: 100 }, { casa: 'nueva', venta: 1 }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].compra, null);
});

test('brecha blue/oficial usa precios de venta', () => {
  const c = normalizar([{ casa: 'blue', compra: 1, venta: 1100 }, { casa: 'oficial', compra: 1, venta: 1000 }]);
  assert.ok(Math.abs(brecha(c) - 0.1) < 1e-12);
  assert.equal(brecha(normalizar([{ casa: 'blue', venta: 1 }])), null);
});

test('convierte como una casa de cambio: compra dólares a precio de venta, los vende a precio de compra', () => {
  const blue = { compra: 1000, venta: 1050 };
  assert.equal(convertir(105000, blue, 'pesos-a-dolares'), 100);
  assert.equal(convertir(100, blue, 'dolares-a-pesos'), 100000);
  assert.equal(convertir(-1, blue, 'pesos-a-dolares'), null);
  assert.equal(convertir(10, { compra: null, venta: 1 }, 'dolares-a-pesos'), null);
  assert.equal(convertir(10, blue, 'otra'), null);
});

test('lee montos escritos a la argentina', () => {
  assert.equal(leerMonto('1.500.000,50'), 1500000.5);
  assert.equal(leerMonto('1500,5'), 1500.5);
  assert.equal(leerMonto('1500.5'), 1500.5);
  assert.equal(leerMonto('1.500'), 1500);
  assert.equal(leerMonto('$ 2.000'), 2000);
  assert.equal(leerMonto('USD 300'), 300);
  assert.ok(Number.isNaN(leerMonto('')));
  assert.ok(Number.isNaN(leerMonto('abc')));
});

test('dice hace cuánto se actualizó', () => {
  const ahora = Date.parse('2026-10-11T12:00:00Z');
  assert.equal(haceCuanto('2026-10-11T11:59:40Z', ahora), 'recién');
  assert.equal(haceCuanto('2026-10-11T11:55:00Z', ahora), 'hace 5 min');
  assert.equal(haceCuanto('2026-10-11T09:00:00Z', ahora), 'hace 3 h');
  assert.equal(haceCuanto('2026-10-10T10:00:00Z', ahora), 'ayer');
  assert.equal(haceCuanto('basura', ahora), '');
});

test('las alertas disparan solo al cruzar el umbral', () => {
  const alertas = [
    { id: 1, casa: 'blue', condicion: 'mayor', valor: 1500 },
    { id: 2, casa: 'blue', condicion: 'menor', valor: 1400 },
  ];
  const a1 = normalizar([{ casa: 'blue', compra: 1, venta: 1550 }]);
  const r1 = evaluarAlertas(alertas, a1);
  assert.deepEqual(r1.disparadas.map((d) => d.alerta.id), [1]);
  // Sigue arriba de 1500: no se repite el aviso.
  const r2 = evaluarAlertas(r1.alertas, a1);
  assert.equal(r2.disparadas.length, 0);
  // Baja y vuelve a subir: avisa de nuevo.
  const r3 = evaluarAlertas(r2.alertas, normalizar([{ casa: 'blue', compra: 1, venta: 1450 }]));
  const r4 = evaluarAlertas(r3.alertas, a1);
  assert.deepEqual(r4.disparadas.map((d) => d.alerta.id), [1]);
  const t = textoAlerta(r4.disparadas[0]);
  assert.match(t.titulo, /Blue llegó a \$ 1\.550/);
});

test('arma los datos del widget con las 4 cotizaciones principales', () => {
  const c = normalizar(muestra);
  const d = datosWidget(c, Date.parse('2026-10-11T12:00:00Z'));
  assert.deepEqual(d.filas.map((f) => f.titulo), ['Blue', 'Oficial', 'MEP', 'Tarjeta']);
  assert.equal(d.filas[0].venta, formatoPrecio(buscar(c, 'blue').venta));
  assert.equal(d.filas[2].venta, formatoPrecio(Math.round(buscar(c, 'bolsa').venta)));
  assert.ok(d.filas.every((f) => !f.venta.includes(',')), 'sin centavos en el widget');
  assert.match(d.brecha, /Brecha blue\/oficial: /);
  assert.equal(d.actualizado, 'Actualizado hace 3 min');
});

test('serie histórica real: últimos 30 días y variación', () => {
  const s = serieHistorica(historico, 30);
  assert.equal(s.length, 30);
  assert.ok(s.every((p) => typeof p.venta === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha)));
  assert.equal(typeof variacion(s), 'number');
  assert.equal(variacion([]), null);
});

test('precios: enteros sin decimales, con centavos siempre dos', () => {
  assert.equal(formatoPrecio(1540), '$ 1.540');
  assert.equal(formatoPrecio(1535.9), '$ 1.535,90');
  assert.equal(formatoPrecio(null), '—');
});
