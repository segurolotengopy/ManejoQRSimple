import { describe, expect, it } from 'vitest';

import { esExito } from '../comun/resultado.js';
import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  QrProviderEnMemoria,
} from '../ports/mocks.js';
import type { SolicitudQr } from '../ports/puertos.js';
import { bs, enMinutos, T0 } from '../pruebas/fixtures.js';
import {
  crearCobroDeConsumidor,
  esDelConsumidor,
  idDeCobroDeConsumidor,
  pagoDeCobro,
  type DepsConsumidor,
  type SolicitudCobroConsumidor,
} from './consumidores.js';

const MONTO = 12_345;
const VENCE = enMinutos(72 * 60);

/** Cuenta los QRs que se le pidieron al banco: es lo que no puede duplicarse. */
class QrContado extends QrProviderEnMemoria {
  emitidos = 0;
  pedidosDeAnulacion: string[] = [];
  override emitir(solicitud: SolicitudQr): ReturnType<QrProviderEnMemoria['emitir']> {
    this.emitidos += 1;
    return super.emitir(solicitud);
  }
  override anular(referencia: string): ReturnType<QrProviderEnMemoria['anular']> {
    this.pedidosDeAnulacion.push(referencia);
    return super.anular(referencia);
  }
}

function armar(): { deps: DepsConsumidor; qr: QrContado; evidencia: EvidenceStoreEnMemoria } {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const qr = new QrContado(() => T0);
  return { deps: { cobros, evidencia, qr }, qr, evidencia };
}

function solicitud(sobrescribir: Partial<SolicitudCobroConsumidor> = {}): SolicitudCobroConsumidor {
  return {
    consumidorId: 'novuchat',
    referenciaExterna: 'plan-2026-09',
    montoCentavos: bs(MONTO),
    concepto: 'Plan mensual',
    venceEn: VENCE,
    proveedor: 'baneco',
    ...sobrescribir,
  };
}

describe('idDeCobroDeConsumidor()', () => {
  it('es estable: la misma clave da siempre el mismo id', () => {
    expect(idDeCobroDeConsumidor('novuchat', 'ref-1')).toBe(idDeCobroDeConsumidor('novuchat', 'ref-1'));
  });

  it('dos consumidores con la misma referencia no comparten cobro', () => {
    expect(idDeCobroDeConsumidor('novuchat', 'ref-1')).not.toBe(idDeCobroDeConsumidor('otra-app', 'ref-1'));
  });

  it('el separador no se puede simular moviendo el corte', () => {
    // El caso que importa lleva **el carácter que se usaría como separador si
    // no fuera un byte nulo**: un espacio. Con `("ab","c")` vs `("a","bc")`
    // el test pasa con cualquier separador y no defiende nada; con estos dos,
    // falla en cuanto el byte nulo se convierta en un espacio.
    expect(idDeCobroDeConsumidor('a b', 'c')).not.toBe(idDeCobroDeConsumidor('a', 'b c'));
    expect(idDeCobroDeConsumidor('ab', 'c')).not.toBe(idDeCobroDeConsumidor('a', 'bc'));
  });

  it('la derivación está fijada por un vector conocido', () => {
    // Sin esto, cambiar el separador o el prefijo pasa en verde — y el día que
    // pase, toda referencia externa que ya tenía cobro calcularía un id nuevo:
    // segundo cobro, segundo QR vivo, doble cobro al cliente del consumidor
    // (regla #7). Es el valor que hay que recalcular a mano si alguna vez se
    // cambia la derivación a propósito, y migrar los cobros existentes.
    expect(idDeCobroDeConsumidor('novuchat', 'ref-1')).toBe(
      'cons-052f0125bee5b1d6c9b455c0f128e72da520415b86f86a72177a03a6b546e536',
    );
  });
});

describe('crearCobroDeConsumidor()', () => {
  it('crea el cobro con su QR, sin teléfono y con la referencia del consumidor', async () => {
    const { deps, qr } = armar();
    const r = await crearCobroDeConsumidor(deps, solicitud(), T0);

    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.creado).toBe(true);
    expect(r.valor.cobro.estado).toBe('QR_ACTIVO');
    expect(r.valor.cobro.telefonoCliente).toBeNull();
    expect(r.valor.cobro.consumidor).toEqual({ consumidorId: 'novuchat', referenciaExterna: 'plan-2026-09' });
    expect(qr.emitidos).toBe(1);
  });

  it('el mismo pedido dos veces devuelve el mismo cobro y UN solo QR (regla #7)', async () => {
    // Es lo que impide que un reintento del consumidor le cobre dos veces a
    // su cliente: dos QRs vivos son dos pagos posibles.
    const { deps, qr } = armar();
    const primero = await crearCobroDeConsumidor(deps, solicitud(), T0);
    const segundo = await crearCobroDeConsumidor(deps, solicitud(), enMinutos(5));

    expect(esExito(primero) && esExito(segundo)).toBe(true);
    if (!esExito(primero) || !esExito(segundo)) return;
    expect(segundo.valor.creado).toBe(false);
    expect(segundo.valor.cobro.id).toBe(primero.valor.cobro.id);
    expect(segundo.valor.cobro.qrVigente?.referenciaProveedor).toBe(
      primero.valor.cobro.qrVigente?.referenciaProveedor,
    );
    expect(qr.emitidos).toBe(1);
  });

  it('dos consumidores pueden usar la misma referencia sin pisarse', async () => {
    const { deps } = armar();
    const uno = await crearCobroDeConsumidor(deps, solicitud({ consumidorId: 'novuchat' }), T0);
    const otro = await crearCobroDeConsumidor(deps, solicitud({ consumidorId: 'otra-app' }), T0);

    expect(esExito(uno) && esExito(otro)).toBe(true);
    if (!esExito(uno) || !esExito(otro)) return;
    expect(uno.valor.cobro.id).not.toBe(otro.valor.cobro.id);
    expect(otro.valor.creado).toBe(true);
  });

  it('la misma referencia con otro importe se rechaza, no se elige uno', async () => {
    const { deps, qr } = armar();
    await crearCobroDeConsumidor(deps, solicitud(), T0);
    const r = await crearCobroDeConsumidor(deps, solicitud({ montoCentavos: bs(MONTO + 1) }), T0);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error.tipo).toBe('IMPORTE_DISTINTO_CON_MISMA_REFERENCIA');
    expect(qr.emitidos).toBe(1);
  });

  it('un cobro que quedó reservado sin QR se retoma en el reintento', async () => {
    // Si el proceso murió entre la reserva y la emisión, el cobro quedó en
    // BORRADOR. Crear otro duplicaría la referencia; dejarlo así sería un
    // cobro inservible que nadie puede pagar.
    const { deps, qr } = armar();
    const s = solicitud();
    const id = idDeCobroDeConsumidor(s.consumidorId, s.referenciaExterna);
    await deps.cobros.crear({
      id,
      proveedor: 'baneco',
      estado: 'BORRADOR',
      montoCentavos: s.montoCentavos,
      moneda: 'BOB',
      qrVersion: 0,
      qrVigente: null,
      creadoEn: T0,
      telefonoCliente: null,
      concepto: s.concepto,
      consumidor: { consumidorId: s.consumidorId, referenciaExterna: s.referenciaExterna },
    });

    const r = await crearCobroDeConsumidor(deps, s, T0);
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.cobro.id).toBe(id);
    expect(r.valor.cobro.estado).toBe('QR_ACTIVO');
    expect(r.valor.creado).toBe(false);
    expect(qr.emitidos).toBe(1);
  });

  it('un cobro terminal se devuelve tal cual: el reintento no lo revive ni emite otro QR', async () => {
    const { deps, qr } = armar();
    const primero = await crearCobroDeConsumidor(deps, solicitud(), T0);
    if (!esExito(primero)) throw new Error('debería haberse creado');
    await deps.cobros.guardar({ ...primero.valor.cobro, estado: 'CONFIRMADO' });

    const r = await crearCobroDeConsumidor(deps, solicitud(), enMinutos(10));
    expect(esExito(r) && r.valor.cobro.estado).toBe('CONFIRMADO');
    expect(esExito(r) && r.valor.creado).toBe(false);
    expect(qr.emitidos).toBe(1);
  });

  it('dos pedidos simultáneos dejan un solo cobro, y el QR que perdió se anula en el banco', async () => {
    // La carrera existe —los dos leen antes de que ninguno escriba— y el
    // desenlace es el que importa: un cobro, un QR vivo, y el QR que no llegó
    // a adoptarse muerto en el banco, no cobrable hasta la medianoche (T10).
    const { deps, qr } = armar();
    const [uno, otro] = await Promise.all([
      crearCobroDeConsumidor(deps, solicitud(), T0),
      crearCobroDeConsumidor(deps, solicitud(), T0),
    ]);

    expect(esExito(uno) && esExito(otro)).toBe(true);
    if (!esExito(uno) || !esExito(otro)) return;
    expect(uno.valor.cobro.id).toBe(otro.valor.cobro.id);
    expect(uno.valor.cobro.qrVigente?.referenciaProveedor).toBe(
      otro.valor.cobro.qrVigente?.referenciaProveedor,
    );

    const vigente = uno.valor.cobro.qrVigente?.referenciaProveedor;
    const perdedores = qr.pedidosDeAnulacion.filter((r) => r !== vigente);
    expect(qr.emitidos - perdedores.length).toBe(1);
    expect(qr.pedidosDeAnulacion).not.toContain(vigente);
  });
});

describe('esDelConsumidor()', () => {
  it('un cobro del dueño no es de ningún consumidor', async () => {
    const { deps } = armar();
    const r = await crearCobroDeConsumidor(deps, solicitud(), T0);
    if (!esExito(r)) throw new Error('debería haberse creado');

    expect(esDelConsumidor(r.valor.cobro, 'novuchat')).toBe(true);
    expect(esDelConsumidor(r.valor.cobro, 'otra-app')).toBe(false);
    expect(esDelConsumidor({ ...r.valor.cobro, consumidor: null }, 'novuchat')).toBe(false);
  });
});

describe('pagoDeCobro()', () => {
  it('sin confirmación no hay pago', () => {
    expect(
      pagoDeCobro([
        {
          cobroId: 'c1',
          desde: 'BORRADOR',
          hacia: 'QR_ACTIVO',
          evento: 'QR_EMITIDO',
          origen: 'sistema',
          registradoEn: T0,
          datos: {},
        },
      ]),
    ).toBeNull();
  });

  it('reconstruye el pago desde la evidencia: cuándo, cuánto y por qué riel', () => {
    const pago = pagoDeCobro([
      {
        cobroId: 'c1',
        desde: 'ENVIADO',
        hacia: 'PAGO_DETECTADO',
        evento: 'PAGO_DETECTADO',
        origen: 'watcher-baneco',
        registradoEn: enMinutos(10),
        datos: {
          idDeduplicacion: 'baneco:qr-1:tx-1',
          montoCentavos: MONTO,
          ocurridoEn: enMinutos(9).toISOString(),
          origenDeteccion: 'watcher-baneco',
        },
      },
      {
        cobroId: 'c1',
        desde: 'PAGO_DETECTADO',
        hacia: 'CONFIRMADO',
        evento: 'PAGO_CONCILIADO',
        origen: 'sistema',
        registradoEn: enMinutos(10),
        datos: { idDeduplicacion: 'baneco:qr-1:tx-1', montoCentavos: MONTO },
      },
    ]);

    expect(pago).toEqual({
      idDeduplicacion: 'baneco:qr-1:tx-1',
      ocurridoEn: enMinutos(9),
      confirmadoEn: enMinutos(10),
      montoCentavos: MONTO,
      riel: 'watcher-baneco',
      confirmadoPor: 'sistema',
    });
  });

  it('una resolución manual queda marcada como tal, con el riel que la detectó', () => {
    const pago = pagoDeCobro([
      {
        cobroId: 'c1',
        desde: 'VENCIDO',
        hacia: 'EN_REVISION',
        evento: 'ABONO_TARDIO',
        origen: 'watcher-baneco',
        registradoEn: enMinutos(20),
        datos: {
          idDeduplicacion: 'baneco:qr-1:tx-9',
          montoCentavos: MONTO,
          ocurridoEn: enMinutos(19).toISOString(),
          origenDeteccion: 'watcher-baneco',
        },
      },
      {
        cobroId: 'c1',
        desde: 'EN_REVISION',
        hacia: 'CONFIRMADO',
        evento: 'RESUELTO_MANUALMENTE',
        origen: 'accion-manual',
        registradoEn: enMinutos(30),
        datos: { idDeduplicacion: 'baneco:qr-1:tx-9', motivo: 'pago tardío aceptado' },
      },
    ]);

    expect(pago?.confirmadoPor).toBe('accion-manual');
    expect(pago?.riel).toBe('watcher-baneco');
    expect(pago?.confirmadoEn).toEqual(enMinutos(30));
  });
});
