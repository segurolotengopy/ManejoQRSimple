import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  centavos,
  esExito,
  registrarDeteccion,
  type Centavos,
  type Cobro,
  type DepsVerificacion,
  type ErrorPuerto,
  type PaymentWatcher,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { MensajeriaNoConfigurada } from '@mqs/composicion';
import { describirPasada, unaPasada, type ResumenPasada } from './pasada.js';

const T0 = new Date('2026-08-27T12:00:00.000Z');
const MONTO = 12_345;

function bs(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto inválido');
  return r.valor;
}

function unCobro(sobrescribir: Partial<Cobro> = {}): Cobro {
  return {
    id: 'cobro-1',
    proveedor: 'baneco',
    estado: 'ENVIADO',
    montoCentavos: bs(MONTO),
    moneda: 'BOB',
    qrVersion: 1,
    qrVigente: {
      qrVersion: 1,
      referenciaProveedor: 'qr-1',
      emitidoEn: T0,
      venceEn: new Date(T0.getTime() + 72 * 3_600_000),
      origen: 'api-baneco',
      imagenRef: null,
      hashImagen: null,
    },
    creadoEn: T0,
    telefonoCliente: '+59171234567',
    concepto: 'Cobro de prueba',
    ...sobrescribir,
  };
}

function abono(referencia: string, monto = MONTO, cuando = new Date(T0.getTime() + 1_800_000)) {
  return registrarDeteccion({
    idDeduplicacion: `baneco:${referencia}:tx-1`,
    montoCentavos: bs(monto),
    ocurridoEn: cuando,
    origen: 'watcher-baneco',
    referencia: 'Pago',
  });
}

function armar(watcherPropio?: PaymentWatcher) {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const mensajeria = new MensajeriaNoConfigurada();

  const deps: DepsVerificacion = {
    cobros,
    evidencia,
    watcher: watcherPropio ?? watcher,
    mensajeria,
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, cobros, watcher, mensajeria, evidencia };
}

function comoResumen(r: Awaited<ReturnType<typeof unaPasada>>): ResumenPasada {
  if ('errorFatal' in r) {
    throw new Error('se esperaba un resumen, no un error fatal');
  }
  return r;
}

describe('unaPasada()', () => {
  it('no hace nada si no hay cobros pendientes', async () => {
    const { deps } = armar();
    const resumen = comoResumen(await unaPasada(deps, T0));
    expect(resumen.revisados).toBe(0);
  });

  it('confirma un cobro cuyo abono ya está en el banco', async () => {
    const { deps, cobros, watcher } = armar();
    await cobros.guardar(unCobro());
    watcher.cargarAbono('qr-1', abono('qr-1'));

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 1_900_000)));
    expect(resumen.confirmados).toEqual(['cobro-1']);
    expect(resumen.revisados).toBe(1);

    const guardado = await cobros.obtener('cobro-1');
    expect(esExito(guardado) && guardado.valor?.estado).toBe('CONFIRMADO');
  });

  it('deja en sinAbono el cobro que el banco todavía no reporta', async () => {
    const { deps, cobros } = armar();
    await cobros.guardar(unCobro());

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 600_000)));
    expect(resumen.sinAbono).toEqual(['cobro-1']);
    expect(resumen.confirmados).toEqual([]);
  });

  it('manda a revisión un abono que no concilia', async () => {
    const { deps, cobros, watcher } = armar();
    await cobros.guardar(unCobro());
    watcher.cargarAbono('qr-1', abono('qr-1', MONTO - 1));

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 1_900_000)));
    expect(resumen.enRevision).toEqual(['cobro-1']);
  });

  it('vence el cobro antes de consultar al banco, no después', async () => {
    // Un QR vencido no puede confirmarse solo, y dejarlo en ENVIADO haría que
    // el satélite lo consultara para siempre.
    const { deps, cobros, watcher } = armar();
    await cobros.guardar(unCobro());
    watcher.cargarAbono('qr-1', abono('qr-1'));

    const muyTarde = new Date(T0.getTime() + 100 * 3_600_000);
    const resumen = comoResumen(await unaPasada(deps, muyTarde));

    expect(resumen.vencidos).toEqual(['cobro-1']);
    expect(resumen.confirmados).toEqual([]);
    const guardado = await cobros.obtener('cobro-1');
    expect(esExito(guardado) && guardado.valor?.estado).toBe('VENCIDO');
  });

  it('procesa varios cobros en una pasada', async () => {
    const { deps, cobros, watcher } = armar();
    await cobros.guardar(unCobro({ id: 'a', qrVigente: { ...unCobro().qrVigente!, referenciaProveedor: 'qr-a' } }));
    await cobros.guardar(unCobro({ id: 'b', qrVigente: { ...unCobro().qrVigente!, referenciaProveedor: 'qr-b' } }));
    watcher.cargarAbono('qr-a', abono('qr-a'));

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 1_900_000)));
    expect(resumen.revisados).toBe(2);
    expect(resumen.confirmados).toEqual(['a']);
    expect(resumen.sinAbono).toEqual(['b']);
  });

  it('un cobro que falla no corta la pasada: los demás se siguen mirando', async () => {
    const rompeUno: PaymentWatcher = {
      consultarCobro: (referencia) =>
        Promise.resolve(
          referencia === 'qr-a'
            ? {
                ok: false as const,
                error: {
                  tipo: 'INDISPONIBLE',
                  mensaje: 'banco caído',
                  reintentable: true,
                  codigoProveedor: null,
                } satisfies ErrorPuerto,
              }
            : { ok: true as const, valor: null },
        ),
      listarAbonosDelDia: () => Promise.resolve({ ok: true as const, valor: [] }),
    };

    const { deps, cobros } = armar(rompeUno);
    await cobros.guardar(unCobro({ id: 'a', qrVigente: { ...unCobro().qrVigente!, referenciaProveedor: 'qr-a' } }));
    await cobros.guardar(unCobro({ id: 'b', qrVigente: { ...unCobro().qrVigente!, referenciaProveedor: 'qr-b' } }));

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 600_000)));
    expect(resumen.conError.map((e) => e.cobroId)).toEqual(['a']);
    expect(resumen.sinAbono).toEqual(['b']);
  });

  it('si no se puede listar los pendientes, la pasada entera es un error', async () => {
    // Sin la lista no hay forma de saber qué cobros quedaron sin mirar.
    const { deps } = armar();
    const cobrosRotos = {
      ...deps.cobros,
      listarPendientes: () =>
        Promise.resolve({
          ok: false as const,
          error: {
            tipo: 'INDISPONIBLE',
            mensaje: 'firestore caído',
            reintentable: true,
            codigoProveedor: null,
          } satisfies ErrorPuerto,
        }),
    };

    const r = await unaPasada({ ...deps, cobros: cobrosRotos }, T0);
    expect('errorFatal' in r).toBe(true);
  });

  it('el mismo abono en dos pasadas no confirma dos veces (regla #7)', async () => {
    const { deps, cobros, watcher, evidencia } = armar();
    await cobros.guardar(unCobro());
    watcher.cargarAbono('qr-1', abono('qr-1'));

    const cuando = new Date(T0.getTime() + 1_900_000);
    await unaPasada(deps, cuando);
    const segunda = comoResumen(await unaPasada(deps, cuando));

    // Tras confirmar, el cobro deja de estar pendiente: no vuelve a revisarse.
    expect(segunda.revisados).toBe(0);

    const registros = await evidencia.listarDeCobro('cobro-1');
    expect(esExito(registros) && registros.valor.filter((r) => r.hacia === 'CONFIRMADO')).toHaveLength(1);
  });
});

describe('mensajería no configurada', () => {
  it('el cobro se confirma aunque el aviso al cliente no salga', async () => {
    // El aviso es cortesía, no parte de la confirmación.
    const { deps, cobros, watcher, mensajeria } = armar();
    await cobros.guardar(unCobro());
    watcher.cargarAbono('qr-1', abono('qr-1'));

    const resumen = comoResumen(await unaPasada(deps, new Date(T0.getTime() + 1_900_000)));
    expect(resumen.confirmados).toEqual(['cobro-1']);
    // Y el aviso pendiente queda anotado, no se pierde en silencio.
    expect(mensajeria.pendientes).toEqual(['confirmación del cobro cobro-1']);
  });

  it('falla en vez de fingir éxito', async () => {
    const mensajeria = new MensajeriaNoConfigurada();
    const r = await mensajeria.enviarConfirmacion(unCobro());
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.mensaje).toContain('wa-bridge');
    }
  });
});

describe('describirPasada()', () => {
  it('resume sin filtrar datos personales (reglas #4 y #9)', () => {
    const linea = describirPasada({
      revisados: 3,
      confirmados: ['cobro-1'],
      enRevision: [],
      vencidos: ['cobro-2'],
      sinAbono: ['cobro-3'],
      conError: [],
    });
    expect(linea).toBe('revisados=3 confirmados=1 enRevision=0 vencidos=1 sinAbono=1');
    expect(linea).not.toMatch(/\+591/);
  });

  it('destaca los errores solo cuando los hay', () => {
    const base = { revisados: 1, confirmados: [], enRevision: [], vencidos: [], sinAbono: [] };
    expect(describirPasada({ ...base, conError: [] })).not.toContain('conError');
    expect(
      describirPasada({
        ...base,
        conError: [{ cobroId: 'x', error: { tipo: 'SIN_QR_VIGENTE', cobroId: 'x' } }],
      }),
    ).toContain('conError=1');
  });
});
