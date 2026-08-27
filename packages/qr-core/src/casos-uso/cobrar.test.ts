import { describe, expect, it } from 'vitest';

import { esExito, type Resultado } from '../comun/resultado.js';
import { POLITICA_POR_DEFECTO } from '../conciliacion/conciliar.js';
import { registrarDeteccion, type DeteccionDePago } from '../conciliacion/deteccion.js';
import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
} from '../ports/mocks.js';
import type { ErrorPuerto, EvidenceStore } from '../ports/puertos.js';
import { bs, enMinutos, T0, unCobro } from '../pruebas/fixtures.js';
import {
  conciliarDia,
  emitirQr,
  enviarQr,
  registrarComprobante,
  renovarYReenviar,
  vencerSiCorresponde,
  verificarPago,
  type Dependencias,
} from './cobrar.js';

const MONTO = 12_345;
const VENCE = enMinutos(72 * 60);

function armar() {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const mensajeria = new MessagingProviderEnMemoria();
  const qr = new QrProviderEnMemoria();

  const deps: Dependencias = {
    cobros,
    evidencia,
    qr,
    watcher,
    mensajeria,
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, evidencia, cobros, watcher, mensajeria, qr };
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

describe('vencimiento y renovación (regla #6)', () => {
  it('vence solo cuando pasó la fecha, no antes', async () => {
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const temprano = await vencerSiCorresponde(deps, cobro, enMinutos(60));
    expect(esExito(temprano) && temprano.valor.estado).toBe('ENVIADO');

    const tarde = await vencerSiCorresponde(deps, cobro, enMinutos(72 * 60 + 1));
    expect(esExito(tarde) && tarde.valor.estado).toBe('VENCIDO');
  });

  it('renovar incrementa la versión sobre el mismo cobro y lo reenvía', async () => {
    const { deps, mensajeria } = armar();
    const cobro = await hastaEnviado(deps);
    const vencido = await vencerSiCorresponde(deps, cobro, enMinutos(72 * 60 + 1));
    if (!esExito(vencido)) throw new Error('debería vencer');

    const renovado = await renovarYReenviar(
      deps,
      vencido.valor,
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

  it('un cobro confirmado ya no se puede vencer ni renovar', async () => {
    const { deps, watcher } = armar();
    const cobro = await hastaEnviado(deps);
    watcher.cargarAbono('mock-qr-000001', abono());
    const confirmado = await verificarPago(deps, cobro, enMinutos(31));
    if (!esExito(confirmado)) throw new Error('debería confirmar');

    const r = await vencerSiCorresponde(deps, confirmado.valor.cobro, enMinutos(72 * 60 + 1));
    expect(esExito(r)).toBe(false);
    if (!esExito(r) && r.error.tipo === 'TRANSICION') {
      expect(r.error.error.tipo).toBe('COBRO_TERMINAL');
    }
  });
});

describe('verificarPago() en estados que no corresponden', () => {
  it.each(['BORRADOR', 'QR_ACTIVO'] as const)('no hace nada si el cobro está en %s', async (estado) => {
    const { deps } = armar();
    const cobro = unCobro({ estado, montoCentavos: bs(MONTO) });
    const r = await verificarPago(deps, cobro, T0);
    expect(esExito(r) && r.valor.tipo).toBe('NO_CORRESPONDE');
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
