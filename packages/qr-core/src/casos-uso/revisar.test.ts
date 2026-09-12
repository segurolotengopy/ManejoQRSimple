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

function abono(monto = MONTO, ocurridoEn = enMinutos(30)) {
  return registrarDeteccion({
    idDeduplicacion: `baneco:${REFERENCIA}:tx-1`,
    montoCentavos: bs(monto),
    ocurridoEn,
    origen: 'watcher-baneco',
    referencia: null,
  });
}

async function enviado(deps: Dependencias) {
  const emitido = await emitirQr(deps, unCobro({ montoCentavos: bs(MONTO) }), enMinutos(72 * 60), T0);
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
    expect(r.valor.casos[0]).toMatchObject({ motivo: 'MONTO_NO_COINCIDE', nivel: 'ATRASADO' });
    expect(r.valor.casos[0]?.abono?.montoCentavos).toBe(MONTO - 1);
  });
});

describe('resolverRevision()', () => {
  it('confirmar acepta el abono del banco y queda como acción manual', async () => {
    const { deps, cobro, evidencia } = await enRevisionConAbono();

    const r = await resolverRevision(deps, cobro, 'CONFIRMADO', 'el cliente pagó un centavo menos, se acepta', enMinutos(60));
    expect(esExito(r) && r.valor.estado).toBe('CONFIRMADO');
    const registros = await evidencia.listarDeCobro(cobro.id);
    const ultimo = esExito(registros) ? registros.valor.at(-1) : undefined;
    expect(ultimo).toMatchObject({ origen: 'accion-manual', datos: { idDeduplicacion: `baneco:${REFERENCIA}:tx-1` } });
  });

  it('sin abono del banco no se puede confirmar, ni a mano (regla #1)', async () => {
    // El caso típico de fraude: comprobante falsificado, banco en silencio.
    const { deps, cobro, cobros } = await enRevisionSinAbono();

    const r = await resolverRevision(deps, cobro, 'CONFIRMADO', 'el cliente mandó el comprobante', enMinutos(72 * 60 + 5));
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
    const guardado = await cobros.obtener(cobro.id);
    expect(esExito(guardado) && guardado.valor?.estado).toBe('EN_REVISION');
  });

  it('rechazar no necesita abono', async () => {
    const { deps, cobro } = await enRevisionSinAbono();
    const r = await resolverRevision(deps, cobro, 'RECHAZADO', 'el banco no registra ningún pago', enMinutos(72 * 60 + 5));
    expect(esExito(r) && r.valor.estado).toBe('RECHAZADO');
  });

  it('solo resuelve cobros en revisión', async () => {
    const { deps } = armar();
    const cobro = await enviado(deps);
    const r = await resolverRevision(deps, cobro, 'RECHAZADO', 'no corresponde acá', enMinutos(5));
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

    const r = await resolverRevision(deps, primera.valor.cobro, 'CONFIRMADO', 'el banco sí registró el pago', enMinutos(72 * 60 + 7));
    expect(esExito(r) && r.valor.estado).toBe('CONFIRMADO');
  });
});
