import { describe, expect, it } from 'vitest';

import type { MotivoRevision } from './api.js';
import {
  antiguedad,
  describirMotivo,
  diferencia,
  nuevosCriticos,
  recomendacion,
  revisionPendiente,
  textoUltimaRevision,
  tituloDePagina,
  tonoInsignia,
} from './alertas.js';

const MOTIVOS: readonly MotivoRevision[] = [
  'MONTO_NO_COINCIDE',
  'FUERA_DE_VIGENCIA',
  'DUPLICADO',
  'ABONO_TARDIO',
  'VENTANA_AGOTADA',
  'OTRO',
];

describe('motivos y recomendaciones', () => {
  it.each(MOTIVOS)('%s tiene descripción y recomendación', (motivo) => {
    expect(describirMotivo(motivo)).toBeTruthy();
    expect(recomendacion(motivo)).toBeTruthy();
  });

  it('ante un comprobante sin pago, la recomendación es no confirmar por el comprobante', () => {
    // Es el fraude nº 1: la consola lo dice en el momento de decidir.
    expect(recomendacion('VENTANA_AGOTADA')).toMatch(/No confirmes por el comprobante/);
  });

  it('ante un abono tardío, advierte no cobrar dos veces', () => {
    expect(recomendacion('ABONO_TARDIO')).toMatch(/No renueves/);
  });
});

describe('alertas', () => {
  const vacio = { total: 0, criticos: 0, atrasados: 0 };

  it('el título lleva la cantidad de casos solo si hay alguno', () => {
    expect(tituloDePagina('Cobros', null)).toBe('Cobros');
    expect(tituloDePagina('Cobros', vacio)).toBe('Cobros');
    expect(tituloDePagina('Cobros', { total: 3, criticos: 1, atrasados: 1 })).toBe('(3) Cobros');
  });

  it('la insignia toma el color del caso más urgente', () => {
    expect(tonoInsignia({ total: 2, criticos: 1, atrasados: 1 })).toBe('mal');
    expect(tonoInsignia({ total: 2, criticos: 0, atrasados: 1 })).toBe('atencion');
    expect(tonoInsignia({ total: 1, criticos: 0, atrasados: 0 })).toBe('espera');
  });

  it('avisa solo por los críticos nuevos, no por los que ya avisó', () => {
    expect(nuevosCriticos(null, { total: 2, criticos: 2, atrasados: 0 })).toBe(2);
    expect(nuevosCriticos({ total: 2, criticos: 2, atrasados: 0 }, { total: 2, criticos: 2, atrasados: 0 })).toBe(0);
    expect(nuevosCriticos({ total: 2, criticos: 1, atrasados: 0 }, { total: 3, criticos: 2, atrasados: 0 })).toBe(1);
    expect(nuevosCriticos({ total: 2, criticos: 2, atrasados: 0 }, { total: 1, criticos: 1, atrasados: 0 })).toBe(0);
  });
});

describe('revisión periódica', () => {
  const AHORA = new Date('2026-09-12T12:00:00.000Z');

  it('toca revisar si hay casos y pasaron 24 h, o si nunca se revisó', () => {
    expect(revisionPendiente(null, AHORA, true)).toBe(true);
    expect(revisionPendiente('2026-09-11T11:00:00.000Z', AHORA, true)).toBe(true);
    expect(revisionPendiente('2026-09-12T08:00:00.000Z', AHORA, true)).toBe(false);
  });

  it('sin casos no hay nada que revisar', () => {
    expect(revisionPendiente(null, AHORA, false)).toBe(false);
  });

  it('una marca ilegible cuenta como que nunca se revisó', () => {
    expect(revisionPendiente('basura', AHORA, true)).toBe(true);
    expect(textoUltimaRevision('basura', AHORA)).toMatch(/Todavía no/);
  });

  it('dice hace cuánto fue la última', () => {
    expect(textoUltimaRevision('2026-09-12T09:00:00.000Z', AHORA)).toBe('Última revisión: hace 3 h.');
  });
});

describe('antiguedad()', () => {
  it.each([
    [0.5, 'hace menos de una hora'],
    [5, 'hace 5 h'],
    [72, 'hace 3 días'],
  ])('%p h → %s', (horas, esperado) => {
    expect(antiguedad(horas)).toBe(esperado);
  });
});

describe('diferencia() — aritmética entera, nunca float (regla #5)', () => {
  it.each([
    ['150.50', '150.49', 'Bs 0.01 de menos'],
    ['150.50', '160.50', 'Bs 10.00 de más'],
    ['0.10', '0.30', 'Bs 0.20 de más'],
  ])('esperado %s, pagado %s → %s', (esperado, pagado, texto) => {
    expect(diferencia(esperado, pagado)).toBe(texto);
  });

  it('si coinciden o no son montos legibles, no inventa una diferencia', () => {
    expect(diferencia('150.50', '150.50')).toBeNull();
    expect(diferencia('150,50', '150.49')).toBeNull();
  });
});
