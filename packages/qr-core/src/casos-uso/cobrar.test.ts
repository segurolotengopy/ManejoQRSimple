import { describe, expect, it } from 'vitest';

import { esExito, type Resultado } from '../comun/resultado.js';
import { POLITICA_POR_DEFECTO } from '../conciliacion/conciliar.js';
import { registrarDeteccion, type DeteccionDePago } from '../conciliacion/deteccion.js';
import {
  AbonosSinConciliarEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
} from '../ports/mocks.js';
import type { ErrorPuerto, EvidenceStore, SolicitudQr } from '../ports/puertos.js';
import { bs, enMinutos, T0, unCobro, unCobroDeConsumidor } from '../pruebas/fixtures.js';
import {
  anular,
  conciliarDia,
  emitirQr,
  enviarQr,
  registrarComprobante,
  renovarYReenviar,
  verificarPago,
  vigilar,
  type Dependencias,
  type DepsCierre,
} from './cobrar.js';

const MONTO = 12_345;
const VENCE = enMinutos(72 * 60);
const REFERENCIA = 'mock-qr-000001';
const TRAS_VENCER = enMinutos(72 * 60 + 1);

/** Cuenta los QRs que se le pidieron al banco. */
class QrContado extends QrProviderEnMemoria {
  emitidos = 0;
  override emitir(solicitud: SolicitudQr): ReturnType<QrProviderEnMemoria['emitir']> {
    this.emitidos += 1;
    return super.emitir(solicitud);
  }
}

/** El cliente paga justo entre la última consulta y la anulación. */
class QrPagadoEnLaCarrera extends QrContado {
  alAnular: () => void = () => undefined;
  override anular(referencia: string): ReturnType<QrProviderEnMemoria['anular']> {
    this.alAnular();
    return super.anular(referencia);
  }
}

/** Un banco que emite pero no anula: está caído justo cuando hace falta. */
class QrQueNoAnula extends QrContado {
  override anular(): Promise<Resultado<void, ErrorPuerto>> {
    return Promise.resolve({
      ok: false,
      error: { tipo: 'INDISPONIBLE', mensaje: 'banco caído', reintentable: true, codigoProveedor: null },
    });
  }
}

// Con el reloj de la prueba: con el real, el QR sale emitido "hoy" y vence
// en una fecha fija del pasado, y la máquina de estados lo rechaza.
function armar(qr: QrContado = new QrContado(() => T0)) {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const mensajeria = new MessagingProviderEnMemoria();

  const abonosSinConciliar = new AbonosSinConciliarEnMemoria();

  const deps: Dependencias & DepsCierre = {
    cobros,
    evidencia,
    qr,
    watcher,
    mensajeria,
    politica: POLITICA_POR_DEFECTO,
    abonosSinConciliar,
  };
  return { deps, evidencia, cobros, watcher, mensajeria, qr, abonosSinConciliar };
}

function abono(sobrescribir: Partial<{ monto: number; ocurridoEn: Date }> = {}): DeteccionDePago {
  return registrarDeteccion({
    idDeduplicacion: 'baneco:mock-qr-000001:tx-1',
    montoCentavos: bs(sobrescribir.monto ?? MONTO),
    ocurridoEn: sobrescribir.ocurridoEn ?? enMinutos(30),
    origen: 'watcher-baneco',
    referencia: 'Pago',
  });
}

/** Lleva un cobro nuevo hasta ENVIADO, que es donde empieza la espera del pago. */
async function hastaEnviado(deps: Dependencias) {
  const emitido = await emitirQr(deps, unCobro({ montoCentavos: bs(MONTO) }), VENCE, T0);
  if (!esExito(emitido)) throw new Error('emitir debería funcionar');
  const enviado = await enviarQr(deps, emitido.valor, T0);
  if (!esExito(enviado)) throw new Error('enviar debería funcionar');
  return enviado.valor;
}

describe('camino feliz completo, de punta a punta', () => {
  it('BORRADOR → QR_ACTIVO → ENVIADO → PAGO_DETECTADO → CONFIRMADO', async () => {
    const { deps, watcher, mensajeria, evidencia } = armar();

    const cobro = await hastaEnviado(deps);
    expect(cobro.estado).toBe('ENVIADO');
    expect(cobro.qrVersion).toBe(1);

    // Antes del abono, el banco no reporta nada.
    const antes = await verificarPago(deps, cobro, enMinutos(10));
    expect(esExito(antes) && antes.valor.tipo).toBe('SIN_ABONO');

    // Llega el abono al banco.
    watcher.cargarAbono('mock-qr-000001', abono());

    const despues = await verificarPago(deps, cobro, enMinutos(31));
    expect(esExito(despues)).toBe(true);
    if (!esExito(despues)) return;
    expect(despues.valor.tipo).toBe('CONFIRMADO');
    expect(despues.valor.cobro.estado).toBe('CONFIRMADO');

    // Se le avisó al cliente.
    expect(mensajeria.enviados.map((m) => m.tipo)).toEqual(['qr', 'confirmacion']);

    // Y quedó el rastro completo, en orden (regla #8).
    const registros = await evidencia.listarDeCobro('cobro-1');
    expect(esExito(registros) && registros.valor.map((r) => r.hacia)).toEqual([
      'QR_ACTIVO',
      'ENVIADO',
      'PAGO_DETECTADO',
      'CONFIRMADO',
    ]);
  });
});

describe('el comprobante del cliente no confirma (regla #1 / ADR-005)', () => {
  it('un comprobante deja el cobro en COMPROBANTE_RECIBIDO y nada más', async () => {
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const conComprobante = await registrarComprobante(deps, cobro, 'wa-msg-1', enMinutos(20));
    expect(esExito(conComprobante) && conComprobante.valor.estado).toBe('COMPROBANTE_RECIBIDO');
  });

  it('con comprobante pero sin abono en el banco, el cobro NO se confirma', async () => {
    // Este es el vector de fraude nº 1 del dominio: comprobante falsificado.
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const conComprobante = await registrarComprobante(deps, cobro, 'wa-falsificado', enMinutos(20));
    expect(esExito(conComprobante)).toBe(true);
    if (!esExito(conComprobante)) return;

    const verificado = await verificarPago(deps, conComprobante.valor, enMinutos(25));
    expect(esExito(verificado) && verificado.valor.tipo).toBe('SIN_ABONO');
    expect(esExito(verificado) && verificado.valor.cobro.estado).toBe('COMPROBANTE_RECIBIDO');
  });

  it('el comprobante sí acelera: con abono real, confirma desde COMPROBANTE_RECIBIDO', async () => {
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    const conComprobante = await registrarComprobante(deps, cobro, 'wa-1', enMinutos(20));
    if (!esExito(conComprobante)) throw new Error('el comprobante debería registrarse');

    watcher.cargarAbono('mock-qr-000001', abono());
    const verificado = await verificarPago(deps, conComprobante.valor, enMinutos(31));
    expect(esExito(verificado) && verificado.valor.tipo).toBe('CONFIRMADO');
  });
});

describe('abonos que no concilian van a EN_REVISION, no se descartan', () => {
  it('monto distinto', async () => {
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono('mock-qr-000001', abono({ monto: MONTO - 1 }));

    const r = await verificarPago(deps, cobro, enMinutos(31));
    expect(esExito(r)).toBe(true);
    if (!esExito(r) || r.valor.tipo !== 'EN_REVISION') {
      throw new Error('debería quedar en revisión');
    }
    expect(r.valor.cobro.estado).toBe('EN_REVISION');
    expect(r.valor.motivo.tipo).toBe('MONTO_NO_COINCIDE');
  });

  it('abono muy posterior al vencimiento', async () => {
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono('mock-qr-000001', abono({ ocurridoEn: enMinutos(72 * 60 + 60) }));

    const r = await verificarPago(deps, cobro, enMinutos(72 * 60 + 61));
    expect(esExito(r) && r.valor.tipo).toBe('EN_REVISION');
  });

  it('un abono ya conciliado antes no confirma dos veces (regla #7)', async () => {
    const { deps, cobros, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    cobros.registrarDeteccionAplicada(cobro.id, 'baneco:mock-qr-000001:tx-1');
    watcher.cargarAbono('mock-qr-000001', abono());

    const r = await verificarPago(deps, cobro, enMinutos(31));
    expect(esExito(r)).toBe(true);
    if (!esExito(r) || r.valor.tipo !== 'EN_REVISION') {
      throw new Error('un duplicado debería quedar en revisión');
    }
    expect(r.valor.motivo.tipo).toBe('DUPLICADO');
  });
});

/** El último registro de evidencia del cobro de fixture. */
async function ultimaEvidencia(evidencia: EvidenceStore) {
  const registros = await evidencia.listarDeCobro('cobro-1');
  return esExito(registros) ? registros.valor.at(-1) : undefined;
}

/** Estado guardado del cobro de fixture. */
async function estadoGuardado(cobros: CobroRepositoryEnMemoria) {
  const r = await cobros.obtener('cobro-1');
  return esExito(r) ? r.valor?.estado : undefined;
}

describe('vigilar(): vencimiento con el QR anulado en el banco (regla #6, Baneco C4)', () => {
  it('antes de la fecha no vence y no toca el QR', async () => {
    const { deps, qr } = armar();
    const cobro = await hastaEnviado(deps);

    const r = await vigilar(deps, cobro, enMinutos(60));
    expect(esExito(r) && r.valor.tipo).toBe('SIN_ABONO');
    expect(qr.estaAnulado(REFERENCIA)).toBe(false);
  });

  it('vencido sin pago: anula el QR en el banco y recién entonces vence', async () => {
    const { deps, qr, evidencia } = armar();
    const cobro = await hastaEnviado(deps);

    const r = await vigilar(deps, cobro, TRAS_VENCER);
    expect(esExito(r) && r.valor.tipo).toBe('VENCIDO');
    expect(qr.estaAnulado(REFERENCIA)).toBe(true);
    expect((await ultimaEvidencia(evidencia))?.datos['qrAnulado']).toBe(REFERENCIA);
  });

  it('primero el banco: un pago en término concilia aunque el QR ya haya vencido', async () => {
    // Si se venciera antes de preguntar, un pago de último minuto terminaría
    // en un cobro vencido con la plata adentro.
    const { deps, watcher, qr } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60 - 1) }));

    const r = await vigilar(deps, cobro, enMinutos(72 * 60 + 2));
    expect(esExito(r) && r.valor.tipo).toBe('CONFIRMADO');
    expect(qr.estaAnulado(REFERENCIA)).toBe(false);
  });

  it('si el cliente paga mientras se anula, concilia: no vence con la plata adentro', async () => {
    const qr = new QrPagadoEnLaCarrera(() => T0);
    const { deps, watcher, cobros } = armar(qr);
    const cobro = await hastaEnviado(deps);
    qr.alAnular = () => {
      watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60) }));
    };

    const r = await vigilar(deps, cobro, TRAS_VENCER);
    expect(esExito(r) && r.valor.tipo).toBe('CONFIRMADO');
    expect(await estadoGuardado(cobros)).toBe('CONFIRMADO');
  });

  it('un cobro que el satélite confirmó no lo pisa una copia vieja', async () => {
    // El dueño tenía el cobro abierto en ENVIADO; mientras tanto se confirmó.
    const { deps, watcher, cobros } = armar();
    const copiaVieja = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono());
    await verificarPago(deps, copiaVieja, enMinutos(31));

    const r = await registrarComprobante(deps, copiaVieja, 'wa-1', enMinutos(32));
    expect(!esExito(r) && r.error.tipo === 'PUERTO' && r.error.error.tipo).toBe('CONFLICTO');
    expect(await estadoGuardado(cobros)).toBe('CONFIRMADO');
  });

  it('si el banco no anula el QR, el cobro no vence: se reintenta en la próxima pasada', async () => {
    const { deps, cobros } = armar(new QrQueNoAnula(() => T0));
    const cobro = await hastaEnviado(deps);

    const r = await vigilar(deps, cobro, TRAS_VENCER);
    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error.tipo).toBe('PUERTO');
    // Sigue pendiente, así que el satélite lo sigue mirando.
    expect(await estadoGuardado(cobros)).toBe('ENVIADO');
  });

  it('con comprobante y sin pago al vencer: anula el QR y pasa a revisión', async () => {
    const { deps, qr } = armar();
    const cobro = await hastaEnviado(deps);
    const conComprobante = await registrarComprobante(deps, cobro, 'wa-1', enMinutos(20));
    if (!esExito(conComprobante)) throw new Error('el comprobante debería registrarse');

    const r = await vigilar(deps, conComprobante.valor, TRAS_VENCER);
    expect(esExito(r) && r.valor.tipo).toBe('VENTANA_AGOTADA');
    expect(esExito(r) && r.valor.cobro.estado).toBe('EN_REVISION');
    expect(qr.estaAnulado(REFERENCIA)).toBe(true);
  });
});

describe('renovación (regla #6)', () => {
  it('renovar incrementa la versión sobre el mismo cobro y lo reenvía', async () => {
    const { deps, mensajeria } = armar();
    const cobro = await hastaEnviado(deps);
    const vencido = await vigilar(deps, cobro, TRAS_VENCER);
    if (!esExito(vencido)) throw new Error('debería vencer');

    const renovado = await renovarYReenviar(
      deps,
      vencido.valor.cobro,
      enMinutos(144 * 60),
      enMinutos(72 * 60 + 2),
    );
    expect(esExito(renovado)).toBe(true);
    if (!esExito(renovado)) return;

    expect(renovado.valor.id).toBe(cobro.id);
    expect(renovado.valor.qrVersion).toBe(2);
    expect(renovado.valor.estado).toBe('ENVIADO');
    // Dos envíos de QR: el original y el renovado.
    expect(mensajeria.enviados.filter((m) => m.tipo === 'qr')).toHaveLength(2);
  });

  it('no renueva un QR vencido que llegó a pagarse: el cobro pasa a revisión', async () => {
    // Renovarlo le pediría al cliente que pague dos veces.
    const { deps, watcher, cobros, qr } = armar();
    const cobro = await hastaEnviado(deps);
    const vencido = await vigilar(deps, cobro, TRAS_VENCER);
    if (!esExito(vencido)) throw new Error('debería vencer');
    watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60) }));

    const r = await renovarYReenviar(deps, vencido.valor.cobro, enMinutos(144 * 60), enMinutos(72 * 60 + 5));
    expect(!esExito(r) && r.error.tipo).toBe('ABONO_TARDIO');
    expect(await estadoGuardado(cobros)).toBe('EN_REVISION');
    expect(qr.emitidos).toBe(1);
  });

  it('un cobro confirmado no se vigila ni se renueva, y no se le pide un QR al banco', async () => {
    const { deps, watcher, qr } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono());
    const confirmado = await verificarPago(deps, cobro, enMinutos(31));
    if (!esExito(confirmado)) throw new Error('debería confirmar');

    const vigilado = await vigilar(deps, confirmado.valor.cobro, TRAS_VENCER);
    expect(esExito(vigilado) && vigilado.valor.tipo).toBe('NO_CORRESPONDE');

    const r = await renovarYReenviar(deps, confirmado.valor.cobro, enMinutos(144 * 60), TRAS_VENCER);
    expect(!esExito(r) && r.error.tipo === 'TRANSICION' && r.error.error.tipo).toBe('COBRO_TERMINAL');
    // Se preguntó antes de pedir: un QR emitido para nada quedaría pagable.
    expect(qr.emitidos).toBe(1);
  });
});

describe('anular(): el QR se anula también en el banco', () => {
  it('anula el QR en el banco y lo deja en la evidencia', async () => {
    const { deps, qr, evidencia } = armar();
    const cobro = await hastaEnviado(deps);

    const r = await anular(deps, cobro, 'el cliente desistió', enMinutos(10));
    expect(esExito(r) && r.valor.estado).toBe('ANULADO');
    expect(qr.estaAnulado(REFERENCIA)).toBe(true);
    expect((await ultimaEvidencia(evidencia))?.datos['qrAnulado']).toBe(REFERENCIA);
  });

  it('no anula un cobro que el banco reporta pagado', async () => {
    const { deps, watcher, cobros, qr } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono());

    const r = await anular(deps, cobro, 'x', enMinutos(31));
    expect(!esExito(r) && r.error.tipo).toBe('ABONO_DETECTADO');
    expect(await estadoGuardado(cobros)).toBe('ENVIADO');
    expect(qr.estaAnulado(REFERENCIA)).toBe(false);
  });

  it('sobre un cobro vencido con pago tardío no anula: lo pasa a revisión', async () => {
    const { deps, watcher, cobros } = armar();
    const vencido = await vigilar(deps, await hastaEnviado(deps), TRAS_VENCER);
    if (!esExito(vencido)) throw new Error('debería vencer');
    watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60) }));

    const r = await anular(deps, vencido.valor.cobro, 'x', enMinutos(72 * 60 + 5));
    expect(!esExito(r) && r.error.tipo).toBe('ABONO_TARDIO');
    expect(await estadoGuardado(cobros)).toBe('EN_REVISION');
  });

  it('si el cliente paga mientras se anula, el cobro no se anula', async () => {
    const qr = new QrPagadoEnLaCarrera(() => T0);
    const { deps, watcher, cobros } = armar(qr);
    const cobro = await hastaEnviado(deps);
    qr.alAnular = () => {
      watcher.cargarAbono(REFERENCIA, abono());
    };

    const r = await anular(deps, cobro, 'x', enMinutos(31));
    expect(!esExito(r) && r.error.tipo).toBe('ABONO_DETECTADO');
    // Queda esperando pago: el satélite lo verifica y lo confirma.
    expect(await estadoGuardado(cobros)).toBe('ENVIADO');
  });

  it('si el banco no anula el QR, el cobro tampoco se anula', async () => {
    const { deps, cobros } = armar(new QrQueNoAnula(() => T0));
    const cobro = await hastaEnviado(deps);

    const r = await anular(deps, cobro, 'x', enMinutos(10));
    expect(!esExito(r) && r.error.tipo).toBe('PUERTO');
    expect(await estadoGuardado(cobros)).toBe('ENVIADO');
  });

  it('no toca el banco si el estado no admite anular', async () => {
    const { deps, qr } = armar();
    const cobro = await hastaEnviado(deps);
    const conComprobante = await registrarComprobante(deps, cobro, 'wa-1', enMinutos(20));
    if (!esExito(conComprobante)) throw new Error('el comprobante debería registrarse');

    const r = await anular(deps, conComprobante.valor, 'x', enMinutos(25));
    expect(!esExito(r) && r.error.tipo).toBe('TRANSICION');
    expect(qr.estaAnulado(REFERENCIA)).toBe(false);
  });

  it('un borrador se anula sin QR que anular', async () => {
    const { deps } = armar();
    const r = await anular(deps, unCobro(), 'x', T0);
    expect(esExito(r) && r.valor.estado).toBe('ANULADO');
  });
});

describe('verificarPago() según el estado', () => {
  it.each(['BORRADOR', 'VENCIDO', 'EN_REVISION'] as const)(
    'no hace nada si el cobro está en %s',
    async (estado) => {
      const { deps } = armar();
      const cobro = unCobro({ estado, montoCentavos: bs(MONTO) });
      const r = await verificarPago(deps, cobro, T0);
      expect(esExito(r) && r.valor.tipo).toBe('NO_CORRESPONDE');
    },
  );

  it('un QR_ACTIVO que el cliente igual pagó concilia: manda el banco, no el envío', async () => {
    // WhatsApp pudo entregar el QR y reportar una falla: el cobro nunca pasó
    // a ENVIADO, pero la plata está.
    const { deps, watcher } = armar();
    const emitido = await emitirQr(deps, unCobro({ montoCentavos: bs(MONTO) }), VENCE, T0);
    if (!esExito(emitido)) throw new Error('emitir debería funcionar');
    watcher.cargarAbono(REFERENCIA, abono());

    const r = await verificarPago(deps, emitido.valor, enMinutos(31));
    expect(esExito(r) && r.valor.tipo).toBe('CONFIRMADO');
  });
});

describe('conciliarDia()', () => {
  it('confirma los cobros pendientes que aparecen en el reporte del banco', async () => {
    const { deps, watcher } = armar();
    await hastaEnviado(deps);
    watcher.cargarAbono('mock-qr-000001', abono());

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(35));
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.abonosLeidos).toBe(1);
    expect(r.valor.confirmados).toEqual(['cobro-1']);
    expect(r.valor.huerfanos).toEqual([]);
  });

  it('reporta como huérfano un abono que no corresponde a ningún cobro', async () => {
    // Descartarlo en silencio sería plata acreditada que nadie concilia.
    const { deps, watcher } = armar();
    await hastaEnviado(deps);
    watcher.cargarAbono(
      'qr-de-otro-sistema',
      registrarDeteccion({
        idDeduplicacion: 'baneco:qr-de-otro-sistema:tx-9',
        montoCentavos: bs(500),
        ocurridoEn: enMinutos(30),
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(35));
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.confirmados).toEqual([]);
    expect(r.valor.huerfanos).toEqual(['baneco:qr-de-otro-sistema:tx-9']);
  });

  it('el abono de un cobro ya confirmado no es huérfano: es el caso normal', async () => {
    // El reporte del día trae todos los pagos, también los que el polling ya
    // confirmó. Reportarlos como huérfanos llenaría la revisión de ruido.
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono());
    await verificarPago(deps, cobro, enMinutos(31));

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(40));
    expect(esExito(r) && r.valor).toMatchObject({ yaRegistrados: 1, huerfanos: [], confirmados: [] });
  });

  it('un abono sobre un cobro vencido lo manda a revisión, no lo descarta', async () => {
    const { deps, watcher, cobros, evidencia } = armar();
    const vencido = await vigilar(deps, await hastaEnviado(deps), TRAS_VENCER);
    if (!esExito(vencido)) throw new Error('debería vencer');
    watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60 + 30) }));

    const r = await conciliarDia(deps, enMinutos(72 * 60 + 30), enMinutos(72 * 60 + 60));
    expect(esExito(r) && r.valor.enRevision).toEqual(['cobro-1']);
    expect(await estadoGuardado(cobros)).toBe('EN_REVISION');
    expect((await ultimaEvidencia(evidencia))?.evento).toBe('ABONO_TARDIO');

    // Idempotente: repetir el cierre (el satélite reinició) no duplica nada.
    const otraVez = await conciliarDia(deps, enMinutos(72 * 60 + 30), enMinutos(72 * 60 + 90));
    expect(esExito(otraVez) && otraVez.valor).toMatchObject({ enRevision: [], yaRegistrados: 1 });
  });

  it('un abono para un cobro en revisión que no lo tenía se adjunta: queda para decidir', async () => {
    // Comprobante sin pago → ventana agotada → EN_REVISION sin ninguna
    // detección. Si el reporte del día trae el pago, no es "ya registrado":
    // se adjunta a la evidencia para que quien revise lo vea y pueda aceptarlo.
    const { deps, watcher, evidencia } = armar();
    const cobro = await hastaEnviado(deps);
    const conComprobante = await registrarComprobante(deps, cobro, 'wa-1', enMinutos(20));
    if (!esExito(conComprobante)) throw new Error('el comprobante debería registrarse');
    const agotada = await vigilar(deps, conComprobante.valor, TRAS_VENCER);
    expect(esExito(agotada) && agotada.valor.tipo).toBe('VENTANA_AGOTADA');
    watcher.cargarAbono(REFERENCIA, abono({ ocurridoEn: enMinutos(72 * 60 + 30) }));

    const r = await conciliarDia(deps, enMinutos(72 * 60 + 30), enMinutos(72 * 60 + 60));
    expect(esExito(r) && r.valor).toMatchObject({ enRevision: ['cobro-1'], yaRegistrados: 0, sinCorroborar: [] });
    expect((await ultimaEvidencia(evidencia))?.evento).toBe('DETECCION_EN_REVISION');
  });

  it('un segundo abono sobre un cobro ya confirmado no se da por registrado', async () => {
    // El cobro se confirmó con tx-1; si el banco reporta además tx-2, ese
    // pago no lo explica nada de lo que el sistema sabe.
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono(REFERENCIA, abono());
    await verificarPago(deps, cobro, enMinutos(31));
    watcher.cargarAbono(
      REFERENCIA,
      registrarDeteccion({
        idDeduplicacion: 'baneco:mock-qr-000001:tx-2',
        montoCentavos: bs(MONTO),
        ocurridoEn: enMinutos(40),
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(50));
    expect(esExito(r) && r.valor).toMatchObject({
      yaRegistrados: 1,
      sinCorroborar: ['baneco:mock-qr-000001:tx-2'],
    });
  });

  it('un abono que no se puede procesar no corta el resto del día', async () => {
    class RepoConUnQrRoto extends CobroRepositoryEnMemoria {
      override buscarPorReferenciaQr(referencia: string): ReturnType<CobroRepositoryEnMemoria['buscarPorReferenciaQr']> {
        return referencia === 'qr-roto'
          ? Promise.resolve({
              ok: false,
              error: { tipo: 'INDISPONIBLE', mensaje: 'caído', reintentable: true, codigoProveedor: null },
            })
          : super.buscarPorReferenciaQr(referencia);
      }
    }
    const base = armar();
    const deps = { ...base.deps, cobros: new RepoConUnQrRoto(base.evidencia) };
    for (const ref of ['qr-roto', 'qr-de-nadie']) {
      base.watcher.cargarAbono(
        ref,
        registrarDeteccion({
          idDeduplicacion: `baneco:${ref}:tx-1`,
          montoCentavos: bs(500),
          ocurridoEn: enMinutos(30),
          origen: 'watcher-baneco',
          referencia: null,
        }),
      );
    }

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(40));
    expect(esExito(r) && r.valor.huerfanos).toEqual(['baneco:qr-de-nadie:tx-1']);
    expect(esExito(r) && r.valor.conError.map((e) => e.idDeduplicacion)).toEqual(['baneco:qr-roto:tx-1']);
  });

  it('un abono sobre un cobro anulado es plata sin dueño', async () => {
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    await anular(deps, cobro, 'x', enMinutos(10));
    watcher.cargarAbono(REFERENCIA, abono());

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(40));
    expect(esExito(r) && r.valor.huerfanos).toEqual(['baneco:mock-qr-000001:tx-1']);
  });

  it('guarda los abonos sin conciliar para la pestaña Revisión, no solo el log', async () => {
    const { deps, watcher, abonosSinConciliar } = armar();
    const cobro = await hastaEnviado(deps);
    await anular(deps, cobro, 'x', enMinutos(10));
    watcher.cargarAbono(REFERENCIA, abono());

    await conciliarDia(deps, enMinutos(30), enMinutos(40));
    const abiertos = await abonosSinConciliar.listarAbiertos(10);
    expect(esExito(abiertos) && abiertos.valor).toEqual([
      {
        idDeduplicacion: 'baneco:mock-qr-000001:tx-1',
        motivo: 'HUERFANO',
        cobroId: 'cobro-1',
        montoCentavos: bs(MONTO),
        ocurridoEn: enMinutos(30),
        origen: 'watcher-baneco',
        registradoEn: enMinutos(40),
        resolucion: null,
      },
    ]);
  });

  it('repetir el cierre no duplica el abono ni reabre uno ya cerrado', async () => {
    const { deps, watcher, abonosSinConciliar } = armar();
    watcher.cargarAbono(
      'qr-de-nadie',
      registrarDeteccion({
        idDeduplicacion: 'baneco:qr-de-nadie:tx-1',
        montoCentavos: bs(500),
        ocurridoEn: enMinutos(30),
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );
    const primero = await conciliarDia(deps, enMinutos(30), enMinutos(40));
    expect(esExito(primero) && primero.valor.nuevosParaRevisar).toEqual(['baneco:qr-de-nadie:tx-1']);
    await abonosSinConciliar.cerrar('baneco:qr-de-nadie:tx-1', {
      motivo: 'Devuelto al pagador',
      resueltoEn: enMinutos(50),
    });

    const otraVez = await conciliarDia(deps, enMinutos(30), enMinutos(60));
    expect(esExito(otraVez) && otraVez.valor.huerfanos).toEqual(['baneco:qr-de-nadie:tx-1']);
    // Lo vuelve a ver, pero no es novedad: el satélite no repite el aviso.
    expect(esExito(otraVez) && otraVez.valor.nuevosParaRevisar).toEqual([]);
    const abiertos = await abonosSinConciliar.listarAbiertos(10);
    expect(esExito(abiertos) && abiertos.valor).toEqual([]);
  });

  it('si el abono no se puede guardar, no cuenta como reportado: el día no cierra', async () => {
    // Reportarlo sin guardarlo sería volver a dejar la plata solo en un log.
    class AlmacenCaido extends AbonosSinConciliarEnMemoria {
      override registrar(): ReturnType<AbonosSinConciliarEnMemoria['registrar']> {
        return Promise.resolve({
          ok: false,
          error: { tipo: 'INDISPONIBLE', mensaje: 'caído', reintentable: true, codigoProveedor: null },
        });
      }
    }
    const base = armar();
    const deps = { ...base.deps, abonosSinConciliar: new AlmacenCaido() };
    base.watcher.cargarAbono(
      'qr-de-nadie',
      registrarDeteccion({
        idDeduplicacion: 'baneco:qr-de-nadie:tx-1',
        montoCentavos: bs(500),
        ocurridoEn: enMinutos(30),
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await conciliarDia(deps, enMinutos(30), enMinutos(40));
    expect(esExito(r) && r.valor.huerfanos).toEqual([]);
    expect(esExito(r) && r.valor.conError.map((e) => e.idDeduplicacion)).toEqual(['baneco:qr-de-nadie:tx-1']);
  });
});

describe('evidencia antes que estado', () => {
  it('si falla el guardado de la evidencia, el estado no avanza', async () => {
    // Un cobro confirmado sin rastro de por qué es justo lo que la regla #8
    // existe para impedir.
    const { deps, cobros } = armar();
    const evidenciaRota: EvidenceStore = {
      agregar: () =>
        Promise.resolve<Resultado<void, ErrorPuerto>>({
          ok: false,
          error: {
            tipo: 'INDISPONIBLE',
            mensaje: 'firestore caído',
            reintentable: true,
            codigoProveedor: null,
          },
        }),
      listarDeCobro: () => Promise.resolve({ ok: true, valor: [] }),
    };

    const r = await emitirQr(
      { ...deps, evidencia: evidenciaRota },
      unCobro({ montoCentavos: bs(MONTO) }),
      VENCE,
      T0,
    );

    expect(esExito(r)).toBe(false);
    // Y el cobro no quedó guardado en otro estado.
    const guardado = await cobros.obtener('cobro-1');
    expect(esExito(guardado) && guardado.valor).toBeNull();
  });
});

describe('cobros sin teléfono (los del contrato de consumidores, docs/10)', () => {
  it('no se pueden enviar: SIN_CANAL_DE_ENVIO, y sin llamar a la mensajería', async () => {
    // El envío al pagador es del consumidor, por su canal. Pedirle a la
    // mensajería que mande un QR sin destinatario sería pedirle que lo invente.
    const { deps, mensajeria } = armar();
    const emitido = await emitirQr(deps, unCobroDeConsumidor({ montoCentavos: bs(MONTO) }), VENCE, T0);
    if (!esExito(emitido)) throw new Error('emitir debería funcionar');

    const r = await enviarQr(deps, emitido.valor, T0);
    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error.tipo).toBe('SIN_CANAL_DE_ENVIO');
    expect(mensajeria.enviados).toHaveLength(0);
  });

  it('renovar deja el QR nuevo listo y no manda nada', async () => {
    // El dueño renueva desde su consola un cobro que pidió otro producto: la
    // renovación tiene que salir bien igual, y el QR nuevo lo retira el
    // consumidor. Devolver un error acá haría parecer fallida una renovación
    // que funcionó.
    const { deps, mensajeria, cobros } = armar();
    const emitido = await emitirQr(deps, unCobroDeConsumidor({ montoCentavos: bs(MONTO) }), VENCE, T0);
    if (!esExito(emitido)) throw new Error('emitir debería funcionar');

    const vencido = await vigilar(deps, emitido.valor, TRAS_VENCER);
    expect(esExito(vencido) && vencido.valor.tipo).toBe('VENCIDO');

    const guardado = await cobros.obtener(emitido.valor.id);
    if (!esExito(guardado) || guardado.valor === null) throw new Error('debería estar guardado');

    const renovado = await renovarYReenviar(
      deps,
      guardado.valor,
      enMinutos(72 * 60 + 60, TRAS_VENCER),
      TRAS_VENCER,
    );
    expect(esExito(renovado)).toBe(true);
    expect(esExito(renovado) && renovado.valor.estado).toBe('QR_ACTIVO');
    expect(esExito(renovado) && renovado.valor.qrVersion).toBe(2);
    expect(mensajeria.enviados).toHaveLength(0);
  });
});

describe('la anulación compensatoria de emitirQr', () => {
  it('no anula el QR si el cobro sí lo adoptó', async () => {
    // Hay caminos en los que el guardado falla con el estado ya escrito (el
    // historial que no se pudo escribir después del commit, un reintento que
    // ve el estado nuevo). Anular a ciegas dejaría un cobro QR_ACTIVO
    // apuntando a un QR muerto y al pagador sin poder pagar.
    const qr = new QrContado(() => T0);
    const { deps, cobros } = armar(qr);
    const cobro = unCobro({ montoCentavos: bs(MONTO) });

    // Guarda de verdad, pero informa un fallo: el caso que importa.
    const cobrosMentirosos: typeof cobros = Object.create(cobros) as typeof cobros;
    cobrosMentirosos.guardar = async (c, estadoEsperado) => {
      await cobros.guardar(c, estadoEsperado);
      return {
        ok: false,
        error: {
          tipo: 'INDISPONIBLE',
          mensaje: 'la respuesta del commit se perdió',
          reintentable: true,
          codigoProveedor: null,
        },
      };
    };

    const r = await emitirQr({ ...deps, cobros: cobrosMentirosos }, cobro, VENCE, T0);

    expect(esExito(r)).toBe(false);
    const guardado = await cobros.obtener(cobro.id);
    const referencia =
      esExito(guardado) && guardado.valor !== null ? guardado.valor.qrVigente?.referenciaProveedor : null;
    expect(referencia).not.toBeNull();
    expect(qr.estaAnulado(referencia ?? '')).toBe(false);
  });

  it('si el QR quedó suelto y el banco tampoco lo anula, lo dice', async () => {
    // Es lo peor que puede pasar: un QR vivo que ningún cobro mira. Tiene que
    // salir con su propio tipo de error para que quede registrado, no
    // confundido con el fallo que lo originó.
    const { deps } = armar(new QrQueNoAnula(() => T0));
    const evidenciaRota: EvidenceStore = {
      agregar: () =>
        Promise.resolve({
          ok: false,
          error: { tipo: 'INDISPONIBLE', mensaje: 'sin evidencia', reintentable: true, codigoProveedor: null },
        }),
      listarDeCobro: () => Promise.resolve({ ok: true, valor: [] }),
    };

    const r = await emitirQr(
      { ...deps, evidencia: evidenciaRota },
      unCobro({ montoCentavos: bs(MONTO) }),
      VENCE,
      T0,
    );

    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error.tipo).toBe('QR_SUELTO_EN_EL_PROVEEDOR');
  });
});
