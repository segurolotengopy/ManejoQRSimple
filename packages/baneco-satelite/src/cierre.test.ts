import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  centavos,
  esExito,
  registrarDeteccion,
  type DepsVerificacion,
  type PaymentWatcher,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { cerrarDiaSiCorresponde, describirCierre, diaACerrar } from './cierre.js';

/** 12:00 UTC = 08:00 en Bolivia del 28: el día a cerrar es el 27. */
const AHORA = new Date('2026-08-28T12:00:00.000Z');

function armar(watcherPropio?: PaymentWatcher) {
  const evidencia = new EvidenceStoreEnMemoria();
  const watcher = new PaymentWatcherEnMemoria();
  const deps: DepsVerificacion = {
    cobros: new CobroRepositoryEnMemoria(evidencia),
    evidencia,
    watcher: watcherPropio ?? watcher,
    mensajeria: new MessagingProviderEnMemoria(),
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, watcher };
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

describe('diaACerrar() — el día anterior en hora de Bolivia (respuesta D7)', () => {
  it('pasada la medianoche boliviana, cierra el día que acaba de terminar', () => {
    // 04:30 UTC = 00:30 del 28 en Bolivia.
    expect(diaACerrar(new Date('2026-08-28T04:30:00.000Z')).clave).toBe('2026-08-27');
  });

  it('antes de la medianoche boliviana, todavía no cierra ese día', () => {
    // 03:30 UTC del 28 = 23:30 del 27 en Bolivia: el 27 sigue abierto.
    expect(diaACerrar(new Date('2026-08-28T03:30:00.000Z')).clave).toBe('2026-08-26');
  });
});

describe('cerrarDiaSiCorresponde()', () => {
  it('no repite un día ya cerrado', async () => {
    const { deps } = armar();
    expect(await cerrarDiaSiCorresponde(deps, AHORA, '2026-08-27')).toEqual({ tipo: 'YA_CERRADO' });
  });

  it('cierra el día y reporta el abono que ningún cobro explica', async () => {
    const { deps, watcher } = armar();
    watcher.cargarAbono('qr-de-nadie', abonoHuerfano());

    const r = await cerrarDiaSiCorresponde(deps, AHORA, null);
    expect(r.tipo).toBe('CERRADO');
    if (r.tipo === 'CERRADO') {
      expect(r.clave).toBe('2026-08-27');
      expect(r.resumen.huerfanos).toEqual(['baneco:qr-de-nadie:tx-9']);
    }
  });

  it('si el banco no responde, el día no queda marcado como cerrado', async () => {
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

    const r = await cerrarDiaSiCorresponde(deps, AHORA, null);
    expect(r).toMatchObject({ tipo: 'ERROR', clave: '2026-08-27' });
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
    });
    expect(linea).toBe(
      'cierre 2026-08-27: abonos=3 confirmados=1 enRevision=0 yaRegistrados=1 sinCorroborar=0 huerfanos=1',
    );
  });
});
