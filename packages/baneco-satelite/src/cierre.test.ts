import {
  AbonosSinConciliarEnMemoria,
  AvisosEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  centavos,
  esExito,
  registrarDeteccion,
  type DepsCierre,
  type PaymentWatcher,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import {
  cerrarDiasPendientes,
  cerroCompleto,
  describirCierre,
  diasACerrar,
  fueraDeVentana,
} from './cierre.js';

/** 12:00 UTC = 08:00 en Bolivia del 28: la ventana es 25, 26 y 27. */
const AHORA = new Date('2026-08-28T12:00:00.000Z');

function armar(watcherPropio?: PaymentWatcher) {
  const evidencia = new EvidenceStoreEnMemoria();
  const avisos = new AvisosEnMemoria();
  const watcher = new PaymentWatcherEnMemoria();
  const abonosSinConciliar = new AbonosSinConciliarEnMemoria();
  const deps: DepsCierre = {
    cobros: new CobroRepositoryEnMemoria(evidencia),
    evidencia,
    avisos,
    watcher: watcherPropio ?? watcher,
    mensajeria: new MessagingProviderEnMemoria(),
    politica: POLITICA_POR_DEFECTO,
    abonosSinConciliar,
  };
  return { deps, watcher, abonosSinConciliar };
}

function abonoHuerfano() {
  const monto = centavos(500);
  if (!esExito(monto)) throw new Error('monto inválido');
  return registrarDeteccion({
    idDeduplicacion: 'baneco:qr-de-nadie:tx-9',
    montoCentavos: monto.valor,
    ocurridoEn: new Date('2026-08-27T13:00:00.000Z'),
    origen: 'watcher-baneco',
    referencia: null,
  });
}

describe('diasACerrar() — días anteriores en hora de Bolivia (respuesta D7)', () => {
  it('revisa los últimos tres días, del más viejo al más nuevo', () => {
    expect(diasACerrar(AHORA, new Set()).map((d) => d.clave)).toEqual([
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
    ]);
  });

  it('pasada la medianoche boliviana, el día que terminó ya entra', () => {
    // 04:30 UTC = 00:30 del 28 en Bolivia.
    const claves = diasACerrar(new Date('2026-08-28T04:30:00.000Z'), new Set()).map((d) => d.clave);
    expect(claves.at(-1)).toBe('2026-08-27');
  });

  it('antes de la medianoche boliviana, el día en curso todavía no entra', () => {
    // 03:30 UTC del 28 = 23:30 del 27 en Bolivia: su reporte no está completo.
    const claves = diasACerrar(new Date('2026-08-28T03:30:00.000Z'), new Set()).map((d) => d.clave);
    expect(claves).not.toContain('2026-08-27');
  });

  it('no repite los días ya cerrados', () => {
    const cerrados = new Set(['2026-08-25', '2026-08-27']);
    expect(diasACerrar(AHORA, cerrados).map((d) => d.clave)).toEqual(['2026-08-26']);
  });
});

describe('fueraDeVentana()', () => {
  it('señala los días que ya no se van a reintentar solos', () => {
    expect(fueraDeVentana(AHORA, ['2026-08-24', '2026-08-25', '2026-08-27'])).toEqual(['2026-08-24']);
  });
});

describe('cerrarDiasPendientes()', () => {
  it('cierra la ventana y reporta el abono que ningún cobro explica', async () => {
    const { deps, watcher, abonosSinConciliar } = armar();
    watcher.cargarAbono('qr-de-nadie', abonoHuerfano());

    const resultados = await cerrarDiasPendientes(deps, AHORA, new Set());
    expect(resultados.map((r) => r.clave)).toEqual(['2026-08-25', '2026-08-26', '2026-08-27']);
    const ayer = resultados.at(-1);
    expect(ayer?.tipo === 'CERRADO' && ayer.resumen.huerfanos).toEqual(['baneco:qr-de-nadie:tx-9']);
    expect(resultados.every(cerroCompleto)).toBe(true);
    // Y quedó guardado para la pestaña Revisión, no solo en el log.
    const abiertos = await abonosSinConciliar.listarAbiertos(10);
    expect(esExito(abiertos) && abiertos.valor.map((a) => a.idDeduplicacion)).toEqual(['baneco:qr-de-nadie:tx-9']);
  });

  it('si el banco no responde, ningún día queda cerrado', async () => {
    // Un cierre que falla en silencio es un día sin red de seguridad.
    const caido: PaymentWatcher = {
      consultarCobro: () => Promise.resolve({ ok: true as const, valor: null }),
      listarAbonosDelDia: () =>
        Promise.resolve({
          ok: false as const,
          error: { tipo: 'INDISPONIBLE', mensaje: 'caído', reintentable: true, codigoProveedor: null },
        }),
    };
    const { deps } = armar(caido);

    const resultados = await cerrarDiasPendientes(deps, AHORA, new Set());
    expect(resultados.every((r) => r.tipo === 'ERROR')).toBe(true);
    expect(resultados.some(cerroCompleto)).toBe(false);
  });
});

describe('describirCierre()', () => {
  it('resume en conteos, sin datos del pagador (reglas #4 y #9)', () => {
    const linea = describirCierre('2026-08-27', {
      abonosLeidos: 3,
      confirmados: ['a'],
      enRevision: [],
      yaRegistrados: 1,
      sinCorroborar: [],
      huerfanos: ['baneco:qr-x:tx-1'],
      nuevosParaRevisar: [],
      conError: [],
    });
    expect(linea).toBe(
      'cierre 2026-08-27: abonos=3 confirmados=1 enRevision=0 yaRegistrados=1 sinCorroborar=0 huerfanos=1 ' +
        'nuevosParaRevisar=0',
    );
  });
});
