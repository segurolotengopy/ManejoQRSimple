import { describe, expect, it } from 'vitest';

import { informe, PRUEBAS } from './planPruebas.js';

describe('plan de pruebas en producción', () => {
  it('son las nueve pruebas de la guía, con ids únicos', () => {
    expect(PRUEBAS.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']);
  });

  it('el informe lleva cada resultado, su nota y los cobros de la corrida', () => {
    const texto = informe(
      new Date('2026-09-12T20:00:00.000Z'),
      { P1: { resultado: 'ok', nota: 'login en 1 s' }, P6: { resultado: 'falla', nota: 'code 57 | raro' } },
      [{ id: 'abcdef0123456789', estado: 'CONFIRMADO', monto: '1.00' }],
      'sucursal-2',
    );
    // El alias de la cuenta encabeza el informe: la prueba se repite por cada
    // cuenta nueva y los informes se archivan juntos.
    expect(texto).toContain('## Prueba en producción — 2026-09-12 — cuenta `sucursal-2`');
    expect(texto).toContain('| P1 | Autenticación en producción | ✅ ok | login en 1 s |');
    // Un "|" en la nota rompería la tabla.
    expect(texto).toContain('| ❌ falla | code 57 / raro |');
    expect(texto).toContain('| P2 | Pago desde la app de Banco Económico | ⏳ pendiente |  |');
    expect(texto).toContain('- `abcdef01` — Bs 1.00 — CONFIRMADO');
  });
});
