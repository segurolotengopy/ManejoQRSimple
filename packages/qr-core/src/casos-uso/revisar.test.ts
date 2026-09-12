import { describe, expect, it } from 'vitest';

import { esExito } from '../comun/resultado.js';
import { POLITICA_POR_DEFECTO } from '../conciliacion/conciliar.js';
import { registrarDeteccion } from '../conciliacion/deteccion.js';
import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
} from '../ports/mocks.js';
import { POLITICA_REVISION_POR_DEFECTO } from '../revision/revision.js';
import { bs, enMinutos, T0, unCobro } from '../pruebas/fixtures.js';
import {
  emitirQr,
  enviarQr,
  registrarComprobante,
  verificarPago,
  vigilar,
  type Dependencias,
} from './cobrar.js';
import { buscarAbonoEnRevision, listarRevision, resolverRevision } from './revisar.js';

const MONTO = 12_345;
const REFERENCIA = 'mock-qr-000001';
const ABONO_1 = `baneco:${REFERENCIA}:tx-1`;

function armar() {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const deps: Dependencias = {
    cobros,
    evidencia,
    qr: new QrProviderEnMemoria(() => T0),
    watcher,
    mensajeria: new MessagingProviderEnMemoria(),
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, cobros, evidencia, watcher };
}

function abono(monto = MONTO, ocurridoEn = enMinutos(30), idDeduplicacion = ABONO_1) {
  return registrarDeteccion({
    idDeduplicacion,
    montoCentavos: bs(monto),
    ocurridoEn,
    origen: 'watcher-baneco',
    referencia: null,
  });
}

async function enviado(deps: Dependencias, id = 'cobro-1') {
  const emitido = await emitirQr(deps, unCobro({ id, montoCentavos: bs(MONTO) }), enMinutos(72 * 60), T0);
  if (!esExito(emitido)) throw new Error('emitir debería funcionar');
  const r = await enviarQr(deps, emitido.valor, T0);
  if (!esExito(r)) throw new Error('enviar debería funcionar');
  return r.valor;
}

/** Un abono por un centavo menos: en revisión, con un pago del banco que aceptar. */
async function enRevisionConAbono() {
  const base = armar();
  const cobro = await enviado(base.deps);
  base.watcher.cargarAbono(REFERENCIA, abono(MONTO - 1));
  const r = await verificarPago(base.deps, cobro, enMinutos(31));
  if (!esExito(r) || r.valor.tipo !== 'EN_REVISION') throw new Error('debería quedar en revisión');
  return { ...base, cobro: r.valor.cobro };
}

/** Comprobante que el banco nunca vio: en revisión sin ningún pago. */
async function enRevisionSinAbono() {
  const base = armar();
  const cobro = await enviado(base.deps);
  const conComprobante = await registrarComprobante(base.deps, cobro, 'wa-1', enMinutos(20));
  if (!esExito(conComprobante)) throw new Error('el comprobante debería registrarse');
  const r = await vigilar(base.deps, conComprobante.valor, enMinutos(72 * 60 + 1));
  if (!esExito(r) || r.valor.tipo !== 'VENTANA_AGOTADA') throw new Error('debería agotarse la ventana');
  return { ...base, cobro: r.valor.cobro };
}

describe('listarRevision()', () => {
  it('arma la cola con motivo, abono y nivel de alerta', async () => {
    const { deps } = await enRevisionConAbono();

    // Cinco horas con plata recibida: ya está atrasado.
    const r = await listarRevision(deps, enMinutos(31 + 5 * 60));
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.resumen).toEqual({ total: 1, criticos: 0, atrasados: 1 });
    expect(r.valor.truncado).toBe(false);
    expect(r.valor.casos[0]).toMatchObject({ motivo: 'MONTO_NO_COINCIDE', nivel: 'ATRASADO' });
    expect(r.valor.casos[0]?.abono?.montoCentavos).toBe(MONTO - 1);
  });

  it('si hay más casos que el tope, lo dice en vez de callarlo', async () => {
    const { deps, watcher } = armar();
    for (const [i, id] of ['a', 'b'].entries()) {
      const cobro = await enviado(deps, id);
      const ref = `mock-qr-00000${String(i + 1)}`;
      watcher.cargarAbono(ref, abono(MONTO - 1, enMinutos(30), `baneco:${ref}:tx-1`));
      await verificarPago(deps, cobro, enMinutos(31));
    }

    const r = await listarRevision(deps, enMinutos(40), POLITICA_REVISION_POR_DEFECTO, 1);
    expect(esExito(r) && r.valor.truncado).toBe(true);
    expect(esExito(r) && r.valor.casos).toHaveLength(1);
  });
});

describe('resolverRevision()', () => {
  it('confirmar acepta el abono del banco y queda como acción manual', async () => {
    const { deps, cobro, evidencia } = await enRevisionConAbono();

    const r = await resolverRevision(
      deps,
      cobro,
      { decision: 'CONFIRMADO', idDeduplicacion: ABONO_1, motivo: 'el cliente pagó un centavo menos, se acepta' },
      enMinutos(60),
    );
    expect(esExito(r) && r.valor.estado).toBe('CONFIRMADO');
    const registros = await evidencia.listarDeCobro(cobro.id);
    const ultimo = esExito(registros) ? registros.valor.at(-1) : undefined;
    expect(ultimo).toMatchObject({ origen: 'accion-manual', datos: { idDeduplicacion: ABONO_1 } });
  });

  it('sin abono del banco no se puede confirmar, ni a mano (regla #1)', async () => {
    // El caso típico de fraude: comprobante falsificado, banco en silencio.
    const { deps, cobro, cobros } = await enRevisionSinAbono();

    const r = await resolverRevision(
      deps,
      cobro,
      { decision: 'CONFIRMADO', idDeduplicacion: 'wa-1', motivo: 'el cliente mandó el comprobante' },
      enMinutos(72 * 60 + 5),
    );
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
    const guardado = await cobros.obtener(cobro.id);
    expect(esExito(guardado) && guardado.valor?.estado).toBe('EN_REVISION');
  });

  it('no confirma un abono que ya no es el último que reportó el banco', async () => {
    // La persona miró el abono tx-1; mientras decidía, el banco reportó tx-2.
    const { deps, cobro, watcher, cobros } = await enRevisionConAbono();
    watcher.cargarAbono(REFERENCIA, abono(MONTO, enMinutos(35), `baneco:${REFERENCIA}:tx-2`));
    const busqueda = await buscarAbonoEnRevision(deps, cobro, enMinutos(40));
    expect(esExito(busqueda) && busqueda.valor.encontrado).toBe(true);

    const r = await resolverRevision(
      deps,
      cobro,
      { decision: 'CONFIRMADO', idDeduplicacion: ABONO_1, motivo: 'se acepta el centavo de diferencia' },
      enMinutos(45),
    );
    expect(!esExito(r) && r.error.tipo).toBe('ABONO_DESACTUALIZADO');
    const guardado = await cobros.obtener(cobro.id);
    expect(esExito(guardado) && guardado.valor?.estado).toBe('EN_REVISION');
  });

  it('rechazar no necesita abono', async () => {
    const { deps, cobro } = await enRevisionSinAbono();
    const r = await resolverRevision(
      deps,
      cobro,
      { decision: 'RECHAZADO', motivo: 'el banco no registra ningún pago' },
      enMinutos(72 * 60 + 5),
    );
    expect(esExito(r) && r.valor.estado).toBe('RECHAZADO');
  });

  it('solo resuelve cobros en revisión', async () => {
    const { deps } = armar();
    const cobro = await enviado(deps);
    const r = await resolverRevision(deps, cobro, { decision: 'RECHAZADO', motivo: 'no corresponde acá' }, enMinutos(5));
    expect(!esExito(r) && r.error.tipo).toBe('TRANSICION');
  });
});

describe('buscarAbonoEnRevision()', () => {
  it('si el banco no reporta nada, lo dice y no cambia el caso', async () => {
    const { deps, cobro } = await enRevisionSinAbono();
    const r = await buscarAbonoEnRevision(deps, cobro, enMinutos(72 * 60 + 5));
    expect(esExito(r) && r.valor.encontrado).toBe(false);
  });

  it('si el banco reporta el pago, lo adjunta una sola vez y el caso pasa a ser confirmable', async () => {
    const { deps, cobro, watcher, evidencia } = await enRevisionSinAbono();
    watcher.cargarAbono(REFERENCIA, abono(MONTO, enMinutos(72 * 60 - 5)));

    const primera = await buscarAbonoEnRevision(deps, cobro, enMinutos(72 * 60 + 5));
    expect(esExito(primera) && primera.valor.encontrado).toBe(true);
    if (!esExito(primera)) return;
    await buscarAbonoEnRevision(deps, primera.valor.cobro, enMinutos(72 * 60 + 6));

    const registros = await evidencia.listarDeCobro(cobro.id);
    const adjuntadas = esExito(registros)
      ? registros.valor.filter((r) => r.evento === 'DETECCION_EN_REVISION')
      : [];
    expect(adjuntadas).toHaveLength(1);

    const r = await resolverRevision(
      deps,
      primera.valor.cobro,
      { decision: 'CONFIRMADO', idDeduplicacion: ABONO_1, motivo: 'el banco sí registró el pago' },
      enMinutos(72 * 60 + 7),
    );
    expect(esExito(r) && r.valor.estado).toBe('CONFIRMADO');
  });
});
