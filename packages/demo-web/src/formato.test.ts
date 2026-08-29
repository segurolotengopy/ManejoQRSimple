import { describe, expect, it } from 'vitest';

import type { EstadoCobro } from './api.js';
import {
  accionesPosibles,
  describirEstado,
  montoParaMostrar,
  tonoDeEstado,
  vigenciaRestante,
} from './formato.js';

const TODOS: readonly EstadoCobro[] = [
  'BORRADOR',
  'QR_ACTIVO',
  'ENVIADO',
  'COMPROBANTE_RECIBIDO',
  'PAGO_DETECTADO',
  'CONFIRMADO',
  'EN_REVISION',
  'RECHAZADO',
  'VENCIDO',
  'ANULADO',
];

describe('estados', () => {
  it.each(TODOS)('%s tiene descripción y tono', (estado) => {
    // Un estado sin traducción aparecería como `undefined` en pantalla.
    expect(describirEstado(estado)).toBeTruthy();
    expect(tonoDeEstado(estado)).toBeTruthy();
  });
});

describe('accionesPosibles()', () => {
  it.each(['CONFIRMADO', 'RECHAZADO', 'ANULADO'] as const)(
    '%s es terminal: no ofrece ninguna acción',
    (estado) => {
      expect(accionesPosibles(estado)).toEqual([]);
    },
  );

  it('nunca ofrece renovar salvo sobre un cobro vencido (regla #6)', () => {
    for (const estado of TODOS) {
      if (estado !== 'VENCIDO') {
        expect(accionesPosibles(estado)).not.toContain('renovar');
      }
    }
    expect(accionesPosibles('VENCIDO')).toContain('renovar');
  });

  it('solo ofrece verificar donde el cobro está esperando un pago', () => {
    const conVerificar = TODOS.filter((e) => accionesPosibles(e).includes('verificar'));
    expect(conVerificar).toEqual(['ENVIADO', 'COMPROBANTE_RECIBIDO']);
  });

  it('no ofrece nada que confirme un cobro: eso no se decide desde la consola', () => {
    // La única vía a CONFIRMADO es la conciliación (regla #1). Un botón
    // "confirmar" en la consola sería el agujero exacto que el dominio impide.
    for (const estado of TODOS) {
      expect(accionesPosibles(estado)).not.toContain('confirmar');
    }
  });
});

describe('vigenciaRestante()', () => {
  const AHORA = new Date('2026-08-29T12:00:00.000Z');

  it.each([
    ['2026-08-29T12:30:00.000Z', 'vence en 30 min'],
    ['2026-08-29T18:00:00.000Z', 'vence en 6 h'],
    ['2026-09-01T12:00:00.000Z', 'vence en 3 días'],
  ])('%s → %s', (venceEn, esperado) => {
    expect(vigenciaRestante(venceEn, AHORA)).toBe(esperado);
  });

  it('un QR pasado dice "vencido", no un número negativo', () => {
    expect(vigenciaRestante('2026-08-29T11:00:00.000Z', AHORA)).toBe('vencido');
  });

  it('una fecha ilegible devuelve null en vez de "NaN"', () => {
    expect(vigenciaRestante('no-es-fecha', AHORA)).toBeNull();
  });
});

describe('montoParaMostrar()', () => {
  it('conserva el texto exacto que mandó la API', () => {
    // Sin pasar por Number: 150.50 se volvería "150.5".
    expect(montoParaMostrar({ monto: '150.50' })).toBe('Bs 150.50');
    expect(montoParaMostrar({ monto: '0.05' })).toBe('Bs 0.05');
  });
});
