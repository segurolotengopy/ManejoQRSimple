import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { aCentavos, aDeteccion, aFechaBaneco, aFechaCompacta, instanteDelPago } from './mapeo.js';
import { PAGO_DE_EJEMPLO } from './pruebas/fixtures.js';
import type { PagoQr } from './schemas.js';

function pago(sobrescribir: Partial<PagoQr> = {}): PagoQr {
  return { ...PAGO_DE_EJEMPLO, ...sobrescribir };
}

describe('aCentavos()', () => {
  it.each([
    [150.5, 15_050],
    [2.5, 250],
    [1, 100],
    [0.01, 1],
    ['150.50', 15_050],
  ])('convierte el importe %p a %p centavos', (amount, esperado) => {
    expect(aCentavos(pago({ amount }))).toEqual({ ok: true, valor: esperado });
  });

  it('rechaza un importe con tres decimales en vez de redondearlo', () => {
    // Redondear en silencio es lo que produce confirmaciones por montos que no
    // coinciden con el cobro.
    const r = aCentavos(pago({ amount: 1.005 }));
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('IMPORTE_NO_REPRESENTABLE');
    }
  });
});

describe('instanteDelPago()', () => {
  it('interpreta fecha y hora del banco en hora boliviana (UTC-4)', () => {
    // 17:06:29 en Bolivia son las 21:06:29 UTC.
    const r = instanteDelPago(pago({ paymentDate: '2021-06-14T00:00:00', paymentTime: '17:06:29' }));
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.toISOString()).toBe('2021-06-14T21:06:29.000Z');
    }
  });

  it('acepta la fecha sin la parte de hora', () => {
    const r = instanteDelPago(pago({ paymentDate: '2021-06-14', paymentTime: '00:00:00' }));
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.toISOString()).toBe('2021-06-14T04:00:00.000Z');
    }
  });

  it('usa paymentTime y no la hora que venga dentro de paymentDate', () => {
    // paymentDate trae T00:00:00 en todos los ejemplos del banco; la hora real
    // está en paymentTime. Tomar la de paymentDate perdería la hora del pago.
    const r = instanteDelPago(pago({ paymentDate: '2021-06-14T00:00:00', paymentTime: '13:34:28' }));
    expect(esExito(r) && r.valor.toISOString()).toBe('2021-06-14T17:34:28.000Z');
  });

  it('rechaza una fecha imposible', () => {
    const r = instanteDelPago(pago({ paymentDate: '2021-13-45', paymentTime: '99:99:99' }));
    expect(esExito(r)).toBe(false);
  });
});

describe('aDeteccion()', () => {
  it('arma la clave de deduplicación con qrId y transactionId (regla #7)', () => {
    const r = aDeteccion(pago());
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.idDeduplicacion).toBe(
        `baneco:${PAGO_DE_EJEMPLO.qrId}:${PAGO_DE_EJEMPLO.transactionId}`,
      );
    }
  });

  it('descarta el nombre y el documento del pagador (reglas #4 y #9)', () => {
    const r = aDeteccion(pago());
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      const serializado = JSON.stringify(r.valor);
      expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderName);
      expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderAccount);
      expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderDocumentId);
    }
  });

  it('conserva la glosa como referencia', () => {
    const r = aDeteccion(pago({ description: 'Factura 42' }));
    expect(esExito(r) && r.valor.referencia).toBe('Factura 42');
  });

  it('acepta la glosa ausente', () => {
    const r = aDeteccion(pago({ description: null }));
    expect(esExito(r) && r.valor.referencia).toBeNull();
  });

  it('no concilia solo un pago en dólares: lo deja para revisión humana', () => {
    // Convertirlo con un tipo de cambio inventado sería peor que no procesarlo.
    const r = aDeteccion(pago({ currency: 'USD' }));
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('MONEDA_NO_SOPORTADA');
    }
  });
});

describe('formatos de fecha del banco', () => {
  it('aFechaBaneco produce yyyy-MM-dd en hora boliviana', () => {
    expect(aFechaBaneco(new Date('2026-08-30T12:00:00.000Z'))).toBe('2026-08-30');
  });

  it('cruza bien el cambio de día: 02:00 UTC todavía es el día anterior en Bolivia', () => {
    expect(aFechaBaneco(new Date('2026-08-30T02:00:00.000Z'))).toBe('2026-08-29');
  });

  it('aFechaCompacta produce yyyyMMdd para el path de paidQR', () => {
    expect(aFechaCompacta(new Date('2026-08-25T12:00:00.000Z'))).toBe('20260825');
  });
});
