/**
 * El aviso de confirmación, del lado del dominio (docs/10 §4.6).
 *
 * Lo que estos tests defienden, en orden de gravedad:
 *
 * 1. Que **nunca** se avise un pago que no llegó a registrarse.
 * 2. Que un aviso no se entregue dos veces.
 * 3. Que un consumidor caído no demore ni haga fracasar un cobro.
 */

import { describe, expect, it } from 'vitest';

import { esExito, fallo, type Resultado } from '../comun/resultado.js';
import { POLITICA_POR_DEFECTO } from '../conciliacion/conciliar.js';
import { registrarDeteccion } from '../conciliacion/deteccion.js';
import {
  AvisosEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  NotificadorEnMemoria,
  NotificadorSinDestinos,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
} from '../ports/mocks.js';
import type { AvisoDeConfirmacion } from '../avisos/aviso.js';
import type { ErrorPuerto, NotificadorConsumidor } from '../ports/puertos.js';
import { bs, enMinutos, T0, unCobro, unCobroDeConsumidor } from '../pruebas/fixtures.js';
import { emitirQr, verificarPago } from './cobrar.js';
import { describirAvisos, entregarAvisos } from './avisar.js';

const MONTO = 12_345;
const VENCE = enMinutos(72 * 60);
const REFERENCIA = 'mock-qr-000001';

/** Cola de avisos que no puede aceptar nada: el peor momento para encolar. */
class ColaRota extends AvisosEnMemoria {
  override encolar(): Promise<Resultado<boolean, ErrorPuerto>> {
    return Promise.resolve(
      fallo({
        tipo: 'INDISPONIBLE',
        mensaje: 'sin cola',
        reintentable: true,
        codigoProveedor: null,
      }),
    );
  }
}

/** Notificador que siempre falla: el consumidor está caído. */
class NotificadorCaido implements NotificadorConsumidor {
  intentos = 0;
  entregar(): Promise<Resultado<'ENTREGADO' | 'SIN_DESTINO', ErrorPuerto>> {
    this.intentos += 1;
    return Promise.resolve(
      fallo({
        tipo: 'INDISPONIBLE',
        mensaje: 'no se pudo alcanzar al consumidor',
        reintentable: true,
        codigoProveedor: null,
      }),
    );
  }
}

function armar(notificador: NotificadorConsumidor = new NotificadorEnMemoria()) {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const avisos = new AvisosEnMemoria();
  const watcher = new PaymentWatcherEnMemoria();
  const deps = {
    cobros,
    evidencia,
    avisos,
    qr: new QrProviderEnMemoria(() => T0),
    watcher,
    mensajeria: new MessagingProviderEnMemoria(),
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, avisos, watcher, notificador, depsAviso: { ...deps, notificador } };
}

/** Lleva un cobro de consumidor hasta CONFIRMADO por el camino real. */
async function hastaConfirmado(
  deps: ReturnType<typeof armar>['deps'],
  watcher: PaymentWatcherEnMemoria,
  cobro = unCobroDeConsumidor({ montoCentavos: bs(MONTO) }),
) {
  const emitido = await emitirQr(deps, cobro, VENCE, T0);
  if (!esExito(emitido)) throw new Error('emitir debería funcionar');

  watcher.cargarAbono(
    REFERENCIA,
    registrarDeteccion({
      idDeduplicacion: `baneco:${REFERENCIA}:tx-1`,
      montoCentavos: bs(MONTO),
      ocurridoEn: enMinutos(30),
      origen: 'watcher-baneco',
      referencia: null,
    }),
  );
  const verificado = await verificarPago(deps, emitido.valor, enMinutos(31));
  if (!esExito(verificado) || verificado.valor.tipo !== 'CONFIRMADO') {
    throw new Error('debería haber confirmado');
  }
  return verificado.valor.cobro;
}

describe('encolar el aviso', () => {
  it('confirmar un cobro de consumidor lo encola', async () => {
    const { deps, avisos, watcher } = armar();
    const cobro = await hastaConfirmado(deps, watcher);

    const pendientes = await avisos.listarParaEnviar(enMinutos(31), 10);
    expect(esExito(pendientes) && pendientes.valor.map((a) => a.cobroId)).toEqual([cobro.id]);
    expect(avisos.ver(cobro.id)?.consumidorId).toBe('novuchat');
  });

  it('un cobro del dueño no encola nada: no hay a quién avisarle', async () => {
    const { deps, avisos, watcher } = armar();
    await hastaConfirmado(deps, watcher, unCobro({ montoCentavos: bs(MONTO) }));

    const pendientes = await avisos.listarParaEnviar(enMinutos(31), 10);
    expect(esExito(pendientes) && pendientes.valor).toEqual([]);
  });

  it('una transición que no confirma no encola nada', async () => {
    const { deps, avisos } = armar();
    await emitirQr(deps, unCobroDeConsumidor({ montoCentavos: bs(MONTO) }), VENCE, T0);

    expect(esExito(await avisos.contarPendientes()) && (await avisos.contarPendientes())).toBeTruthy();
    const pendientes = await avisos.listarParaEnviar(T0, 10);
    expect(esExito(pendientes) && pendientes.valor).toEqual([]);
  });

  it('si la cola falla, el cobro igual queda confirmado', async () => {
    // El aviso es un acelerador: perderlo es tolerable, y no puede hacer
    // fracasar la confirmación de un pago que el banco ya reportó.
    const { deps, watcher } = armar();
    const cobro = await hastaConfirmado({ ...deps, avisos: new ColaRota() }, watcher);
    expect(cobro.estado).toBe('CONFIRMADO');
  });
});

describe('entregar los avisos', () => {
  it('entrega lo que el cobro y su evidencia dicen hoy', async () => {
    const notificador = new NotificadorEnMemoria();
    const { deps, watcher, depsAviso } = armar(notificador);
    const cobro = await hastaConfirmado(deps, watcher);

    const r = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(r) && r.valor.entregados).toEqual([cobro.id]);

    const entregado: AvisoDeConfirmacion | undefined = notificador.entregados[0];
    expect(entregado).toMatchObject({
      evento: 'cobro.confirmado',
      idEvento: cobro.id,
      consumidorId: 'novuchat',
      referenciaExterna: 'ref-0001',
      montoCentavos: MONTO,
      riel: 'watcher-baneco',
    });
    expect(entregado?.ocurridoEn?.toISOString()).toBe(enMinutos(30).toISOString());
  });

  it('entregado una vez, no se entrega de nuevo', async () => {
    // Un aviso repetido es un cobro repetido del lado del consumidor si no
    // deduplica. Acá directamente no se manda dos veces.
    const notificador = new NotificadorEnMemoria();
    const { deps, watcher, depsAviso } = armar(notificador);
    await hastaConfirmado(deps, watcher);

    await entregarAvisos(depsAviso, enMinutos(32));
    const segunda = await entregarAvisos(depsAviso, enMinutos(33));

    expect(notificador.entregados).toHaveLength(1);
    expect(esExito(segunda) && segunda.valor.intentados).toBe(0);
  });

  it('un consumidor caído se reintenta con espera creciente, no en cada pasada', async () => {
    const caido = new NotificadorCaido();
    const { deps, watcher, avisos, depsAviso } = armar(caido);
    const cobro = await hastaConfirmado(deps, watcher);

    const primera = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(primera) && primera.valor.reintentar).toEqual([cobro.id]);
    expect(avisos.ver(cobro.id)?.intentos).toBe(1);

    // Enseguida no se vuelve a intentar: sin esto, un consumidor caído
    // recibiría un intento cada 30 segundos, para siempre.
    const enseguida = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(enseguida) && enseguida.valor.intentados).toBe(0);
    expect(caido.intentos).toBe(1);

    // Pasada la espera, sí.
    const despues = await entregarAvisos(depsAviso, enMinutos(33));
    expect(esExito(despues) && despues.valor.reintentar).toEqual([cobro.id]);
    expect(caido.intentos).toBe(2);
  });

  it('un aviso que falla para siempre queda pendiente y visible, no se descarta', async () => {
    const caido = new NotificadorCaido();
    const { deps, watcher, avisos, depsAviso } = armar(caido);
    await hastaConfirmado(deps, watcher);

    let ahora = enMinutos(32);
    for (let i = 0; i < 12; i += 1) {
      await entregarAvisos(depsAviso, ahora);
      ahora = new Date(ahora.getTime() + 86_400_000);
    }
    const pendientes = await avisos.contarPendientes();
    expect(esExito(pendientes) && pendientes.valor).toBe(1);
  });

  it('un consumidor sin destino cierra el aviso en vez de reintentar para siempre', async () => {
    const sinDestinos = new NotificadorSinDestinos();
    const { deps, watcher, avisos, depsAviso } = armar(sinDestinos);
    const cobro = await hastaConfirmado(deps, watcher);

    const r = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(r) && r.valor.sinDestino).toEqual([cobro.id]);
    expect(avisos.ver(cobro.id)?.desenlace).toBe('SIN_DESTINO');
    expect(esExito(await avisos.contarPendientes()) && (await avisos.contarPendientes())).toBeTruthy();
  });

  it('no se entrega un aviso cuyo cobro ya no está confirmado', async () => {
    // El aviso dice "te pagaron". Si el cobro no lo sostiene, no se manda:
    // el consumidor podría entregar lo que vendió.
    const notificador = new NotificadorEnMemoria();
    const { deps, watcher, avisos, depsAviso } = armar(notificador);
    const cobro = await hastaConfirmado(deps, watcher);
    await deps.cobros.guardar({ ...cobro, estado: 'EN_REVISION' });

    const r = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(r) && r.valor.inconsistentes).toEqual([cobro.id]);
    expect(notificador.entregados).toHaveLength(0);
    expect(avisos.ver(cobro.id)?.desenlace).toBe('COBRO_INCONSISTENTE');
  });

  it('no se entrega el aviso de un cobro que cambió de consumidor', async () => {
    const notificador = new NotificadorEnMemoria();
    const { deps, watcher, depsAviso } = armar(notificador);
    const cobro = await hastaConfirmado(deps, watcher);
    await deps.cobros.guardar({
      ...cobro,
      consumidor: { consumidorId: 'otra-app', referenciaExterna: 'ref-0001' },
    });

    const r = await entregarAvisos(depsAviso, enMinutos(32));
    expect(esExito(r) && r.valor.inconsistentes).toEqual([cobro.id]);
    expect(notificador.entregados).toHaveLength(0);
  });
});

describe('describirAvisos()', () => {
  it('resume sin nombrar a nadie', () => {
    const linea = describirAvisos({
      intentados: 3,
      entregados: ['cons-a'],
      sinDestino: ['cons-b'],
      inconsistentes: [],
      reintentar: ['cons-c'],
      pendientes: 1,
    });
    expect(linea).toBe(
      'intentados=3 entregados=1 sinDestino=1 reintentar=1 inconsistentes=0 pendientes=1',
    );
  });
});
