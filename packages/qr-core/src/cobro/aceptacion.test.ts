import { describe, expect, it } from 'vitest';

import { esExito } from '../comun/resultado.js';
import { unQr } from '../pruebas/fixtures.js';
import { aceptarAbono, type RegistroConDetecciones } from './aceptacion.js';

const COBRO = { id: 'cobro-1', qrVigente: null };

function deteccion(evento: string, idDeduplicacion: string, cobroId = 'cobro-1'): RegistroConDetecciones {
  return { cobroId, evento, datos: { idDeduplicacion } };
}

describe('aceptarAbono()', () => {
  it('acepta el último abono que el banco reportó para el cobro', () => {
    const r = aceptarAbono(COBRO, [deteccion('PAGO_DETECTADO', 'tx-1')], 'tx-1');
    expect(esExito(r) && r.valor).toMatchObject({ cobroId: 'cobro-1', idDeduplicacion: 'tx-1' });
  });

  it('sin ninguna detección del banco no hay nada que aceptar', () => {
    // Un comprobante deja evidencia, pero no es una detección.
    const comprobante: RegistroConDetecciones = {
      cobroId: 'cobro-1',
      evento: 'COMPROBANTE_RECIBIDO',
      datos: { referenciaComprobante: 'wa-1' },
    };
    expect(aceptarAbono(COBRO, [comprobante], 'wa-1')).toEqual({
      ok: false,
      error: { tipo: 'SIN_DETECCION_DEL_BANCO' },
    });
  });

  it('rechaza un abono que ya no es el último: la persona miró algo que cambió', () => {
    const registros = [deteccion('PAGO_DETECTADO', 'tx-1'), deteccion('DETECCION_EN_REVISION', 'tx-2')];
    expect(aceptarAbono(COBRO, registros, 'tx-1')).toEqual({
      ok: false,
      error: { tipo: 'ABONO_DESACTUALIZADO', ultimo: 'tx-2' },
    });
  });

  it('ignora las detecciones de otro cobro', () => {
    const r = aceptarAbono(COBRO, [deteccion('PAGO_DETECTADO', 'tx-9', 'cobro-2')], 'tx-9');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });
});

describe('aceptarAbono(): el riel de la detección tiene que ser el del QR vigente', () => {
  const COBRO_REAL = { id: 'cobro-1', qrVigente: unQr({ origen: 'api-baneco' }) };
  const registro = (idDeduplicacion: string, origenDeteccion: string): RegistroConDetecciones => ({
    cobroId: 'cobro-1',
    evento: 'PAGO_DETECTADO',
    datos: { idDeduplicacion, origenDeteccion },
  });

  it('con un solo abono simulado sobre un QR real, no hay nada que aceptar', () => {
    const r = aceptarAbono(COBRO_REAL, [registro('sim-1', 'watcher-simulado')], 'sim-1');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('el abono del banco acepta aunque un simulado haya llegado después', () => {
    const registros = [registro('baneco:qr-1:tx-1', 'watcher-baneco'), registro('sim-1', 'watcher-simulado')];
    expect(esExito(aceptarAbono(COBRO_REAL, registros, 'baneco:qr-1:tx-1'))).toBe(true);
  });

  it('un QR simulado se acepta con su propio riel y no con el del banco', () => {
    const cobroSimulado = { id: 'cobro-1', qrVigente: unQr({ origen: 'simulado' }) };
    expect(esExito(aceptarAbono(cobroSimulado, [registro('sim-1', 'watcher-simulado')], 'sim-1'))).toBe(true);
    const r = aceptarAbono(cobroSimulado, [registro('baneco:qr-1:tx-1', 'watcher-baneco')], 'baneco:qr-1:tx-1');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('sin QR vigente no hay con qué comparar: se comporta como antes', () => {
    expect(esExito(aceptarAbono({ id: 'cobro-1', qrVigente: null }, [registro('sim-1', 'watcher-simulado')], 'sim-1'))).toBe(true);
    expect(esExito(aceptarAbono({ id: 'cobro-1', qrVigente: null }, [deteccion('PAGO_DETECTADO', 'tx-1')], 'tx-1'))).toBe(true);
  });

  it('con QR vigente el filtro es cerrado: un registro sin riel declarado no es «del banco»', () => {
    const r = aceptarAbono(COBRO_REAL, [deteccion('PAGO_DETECTADO', 'baneco:qr-1:tx-1')], 'baneco:qr-1:tx-1');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('un riel desconocido tampoco cuenta', () => {
    const r = aceptarAbono(COBRO_REAL, [registro('baneco:qr-1:tx-1', 'watcher-inventado')], 'baneco:qr-1:tx-1');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('evidencia heredada: dice watcher-baneco pero su clave es simulada, y no cuenta', () => {
    // El incidente 4B2 dejó registros así: el origen se copiaba del documento.
    const r = aceptarAbono(COBRO_REAL, [registro('simulado:qr-1:12345', 'watcher-baneco')], 'simulado:qr-1:12345');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('y al revés: un simulado con una clave baneco: no cuenta sobre un QR simulado', () => {
    const cobroSimulado = { id: 'cobro-1', qrVigente: unQr({ origen: 'simulado' }) };
    const r = aceptarAbono(cobroSimulado, [registro('baneco:qr-1:tx-1', 'watcher-simulado')], 'baneco:qr-1:tx-1');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });
});
