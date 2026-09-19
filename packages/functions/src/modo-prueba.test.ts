import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { leerModoPrueba, reanudarCorrida } from './modo-prueba.js';

describe('reanudarCorrida() — reiniciar la API no reinicia la prueba', () => {
  it('retoma los cobros del emulador y cuenta el cupo de las últimas 24 h', () => {
    const r = leerModoPrueba({}, 'x');
    if (!esExito(r)) throw new Error('modo inválido');
    const ahora = new Date('2026-09-12T20:00:00.000Z');
    reanudarCorrida(
      r.valor,
      [
        { id: 'nuevo', creadoEn: new Date('2026-09-12T19:00:00.000Z') },
        { id: 'de-hoy', creadoEn: new Date('2026-09-12T10:00:00.000Z') },
        { id: 'de-ayer', creadoEn: new Date('2026-09-11T10:00:00.000Z') },
      ],
      ahora,
    );
    expect(r.valor.corrida.intentos).toBe(2);
    // Del más viejo al más nuevo, como los agrega la API.
    expect(r.valor.corrida.cobros).toEqual(['de-ayer', 'de-hoy', 'nuevo']);
  });
});

describe('topes de la prueba en producción', () => {
  it('por defecto: Bs 1 y 10 QRs', () => {
    const r = leerModoPrueba({}, 'qr=baneco');
    expect(esExito(r) && { monto: r.valor.montoCentavos, max: r.valor.maxQrs }).toEqual({ monto: 100, max: 10 });
  });

  it.each([
    ['PRUEBA_MONTO_CENTAVOS', '1001'],
    ['PRUEBA_MONTO_CENTAVOS', '0'],
    ['PRUEBA_MONTO_CENTAVOS', '1.5'],
    ['PRUEBA_MAX_QRS', '31'],
    ['PRUEBA_MAX_QRS', 'muchos'],
  ])('%s=%s está fuera del techo y no arranca', (variable, valor) => {
    const r = leerModoPrueba({ [variable]: valor }, 'x');
    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error).toContain(variable);
  });

  it('solo se declara producción si de verdad se habla con el banco', () => {
    const simulado = leerModoPrueba({ QR_PROVIDER: 'mock' }, 'x');
    expect(esExito(simulado) && simulado.valor.produccion).toBe(false);
    const real = leerModoPrueba({ BANECO_ENV: 'prod', QR_PROVIDER: 'baneco' }, 'x');
    expect(esExito(real) && real.valor.produccion).toBe(true);
  });

  it('acepta el techo exacto', () => {
    expect(esExito(leerModoPrueba({ PRUEBA_MONTO_CENTAVOS: '1000', PRUEBA_MAX_QRS: '30' }, 'x'))).toBe(true);
  });
});

describe('cuenta de cobro de la corrida', () => {
  it('sin CUENTA, la primera cuenta', () => {
    const r = leerModoPrueba({}, 'x');
    expect(esExito(r) && r.valor.cuenta).toBe('prod');
  });

  it('con CUENTA, ese alias: es lo que ve el dueño en la consola', () => {
    const r = leerModoPrueba({ PRUEBA_CUENTA: 'sucursal-2' }, 'x');
    expect(esExito(r) && r.valor.cuenta).toBe('sucursal-2');
  });

  it('un alias que no sirve como nombre de archivo no arranca', () => {
    // Si CUENTA está mal escrita, el archivo de credenciales que cargó `node
    // --env-file` no es el que el dueño cree: mejor no arrancar.
    const r = leerModoPrueba({ PRUEBA_CUENTA: '../otra' }, 'x');
    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error).toContain('CUENTA');
  });
});
