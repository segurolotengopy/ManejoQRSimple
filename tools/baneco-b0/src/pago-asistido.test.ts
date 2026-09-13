import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import {
  accionSegunEstado,
  hallazgosDelPago,
  leerEstado,
  leerModo,
  serializarEstado,
  type Captura,
} from './pago-asistido.js';

describe('leerModo()', () => {
  it('sin banderas es el sondeo de siempre', () => {
    const r = leerModo([]);
    expect(esExito(r) && r.valor).toBe('SONDEO');
  });

  it.each([
    ['--pago-asistido', 'EMITIR_PARA_PAGO'],
    ['--capturar-pago', 'CAPTURAR_PAGO'],
    ['--anular-pendiente', 'ANULAR_PENDIENTE'],
  ])('%s → %s', (bandera, modo) => {
    const r = leerModo([bandera]);
    expect(esExito(r) && r.valor).toBe(modo);
  });

  it('una bandera desconocida es un error, no el sondeo por defecto', () => {
    // Crea objetos reales en el banco: no se adivina qué quiso decir alguien.
    expect(esExito(leerModo(['--pago-asistdo']))).toBe(false);
  });

  it('dos modos a la vez es un error', () => {
    expect(esExito(leerModo(['--pago-asistido', '--capturar-pago']))).toBe(false);
  });
});

describe('archivo de estado', () => {
  const ESTADO = { qrId: '21061401016000000007', transactionId: 'B0-20260913-900', emitidoEn: '2026-09-13T12:00:00.000Z' };

  it('va y vuelve', () => {
    expect(leerEstado(serializarEstado(ESTADO))).toEqual(ESTADO);
  });

  it.each([
    ['no es JSON', 'no-json'],
    ['un qrId que escaparía del directorio', JSON.stringify({ ...ESTADO, qrId: '../../etc/x' })],
    ['un transactionId más largo que lo que admite el banco', JSON.stringify({ ...ESTADO, transactionId: 'x'.repeat(31) })],
    ['una fecha inválida', JSON.stringify({ ...ESTADO, emitidoEn: 'ayer' })],
    ['campos faltantes', JSON.stringify({ qrId: ESTADO.qrId })],
  ])('rechaza %s', (_caso, texto) => {
    expect(leerEstado(texto)).toBeNull();
  });
});

describe('accionSegunEstado()', () => {
  it('pagado se captura, activo se espera, anulado se da por terminado', () => {
    expect([1, 0, 9, 7].map(accionSegunEstado)).toEqual(['CAPTURAR', 'ESPERAR', 'YA_ANULADO', 'DESCONOCIDO']);
  });
});

describe('hallazgosDelPago()', () => {
  const BASE: Captura = {
    montosCentavos: [100],
    montoEsperadoCentavos: 100,
    enPaidQr: true,
    anulacion: { ok: false, tipo: 'RECHAZADO_POR_PROVEEDOR', codigo: '14' },
    estadoTrasAnular: 1,
  };
  const veredicto = (c: Captura, pregunta: string) =>
    hallazgosDelPago(c).find((h) => h.pregunta === pregunta)?.veredicto;

  it('el caso esperado confirma todo y anota el responseCode del rechazo', () => {
    const hallazgos = hallazgosDelPago(BASE);
    expect(hallazgos.map((h) => [h.pregunta, h.veredicto])).toEqual([
      ['A2', 'CONFIRMADO'],
      ['V4', 'CONFIRMADO'],
      ['D7', 'CONFIRMADO'],
      ['C5', 'CONFIRMADO'],
    ]);
    expect(hallazgos.find((h) => h.pregunta === 'C5')?.detalle).toContain('responseCode 14');
  });

  it('un monto distinto al del QR refuta el monto fijo', () => {
    expect(veredicto({ ...BASE, montosCentavos: [99] }, 'V4')).toBe('REFUTADO');
  });

  it('más de un pago o ninguno legible no concluye', () => {
    expect(veredicto({ ...BASE, montosCentavos: [100, 100] }, 'V4')).toBe('NO_CONCLUYENTE');
    expect(veredicto({ ...BASE, montosCentavos: [] }, 'V4')).toBe('NO_CONCLUYENTE');
  });

  it('un pago que no figura en paidQR de su día refuta el cierre diario', () => {
    expect(veredicto({ ...BASE, enPaidQr: false }, 'D7')).toBe('REFUTADO');
    expect(veredicto({ ...BASE, enPaidQr: null }, 'D7')).toBe('NO_CONCLUYENTE');
  });

  it('si el banco anula un QR pagado, se refuta: el pago dejaría de verse', () => {
    expect(veredicto({ ...BASE, anulacion: { ok: true }, estadoTrasAnular: 9 }, 'C5')).toBe('REFUTADO');
    expect(veredicto({ ...BASE, anulacion: { ok: true }, estadoTrasAnular: 1 }, 'C5')).toBe('CONFIRMADO');
    expect(veredicto({ ...BASE, estadoTrasAnular: null }, 'C5')).toBe('NO_CONCLUYENTE');
  });
});
