import { describe, expect, it } from 'vitest';

import { bs, enMinutos, T0 } from '../pruebas/fixtures.js';
import { construirCasoAbono, ordenarCasosAbono, type AbonoSinConciliar } from './abono-sin-conciliar.js';
import { POLITICA_REVISION_POR_DEFECTO } from './revision.js';

function abono(registradoEn: Date, id = 'baneco:qr-x:tx-1'): AbonoSinConciliar {
  return {
    idDeduplicacion: id,
    motivo: 'HUERFANO',
    cobroId: null,
    montoCentavos: bs(500),
    // El pago es de mucho antes: la alerta no corre desde acá.
    ocurridoEn: new Date(T0.getTime() - 20 * 3_600_000),
    origen: 'watcher-baneco',
    registradoEn,
    resolucion: null,
  };
}

describe('construirCasoAbono()', () => {
  it('siempre hay plata: usa los umbrales "con abono" (4 h y 24 h)', () => {
    const nivel = (horas: number) =>
      construirCasoAbono(abono(T0), enMinutos(horas * 60), POLITICA_REVISION_POR_DEFECTO).nivel;
    expect([nivel(3), nivel(4), nivel(23), nivel(24)]).toEqual(['AL_DIA', 'ATRASADO', 'ATRASADO', 'CRITICO']);
  });

  it('cuenta desde que el cierre lo encontró, no desde el pago', () => {
    // El cierre corre de madrugada sobre el día anterior: medir desde el pago
    // haría nacer crítico a todo abono.
    const caso = construirCasoAbono(abono(T0), enMinutos(30), POLITICA_REVISION_POR_DEFECTO);
    expect(caso.horasAbierto).toBe(0.5);
    expect(caso.nivel).toBe('AL_DIA');
  });
});

describe('ordenarCasosAbono()', () => {
  it('lo más urgente primero y, a igual urgencia, lo más viejo', () => {
    const ahora = enMinutos(30 * 60);
    const casos = [
      construirCasoAbono(abono(enMinutos(29 * 60), 'nuevo'), ahora, POLITICA_REVISION_POR_DEFECTO),
      construirCasoAbono(abono(enMinutos(2 * 60), 'critico-reciente'), ahora, POLITICA_REVISION_POR_DEFECTO),
      construirCasoAbono(abono(T0, 'critico-viejo'), ahora, POLITICA_REVISION_POR_DEFECTO),
    ];
    expect(ordenarCasosAbono(casos).map((c) => c.abono.idDeduplicacion)).toEqual([
      'critico-viejo',
      'critico-reciente',
      'nuevo',
    ]);
  });
});
