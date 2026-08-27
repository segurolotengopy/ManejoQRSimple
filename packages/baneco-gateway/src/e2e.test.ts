/**
 * Flujo completo del cobro con el adaptador **real** de Baneco.
 *
 * La diferencia con el E2E de `qr-core` es el sujeto: allá los puertos son
 * mocks en memoria, acá son `QrProviderBaneco` y `PaymentWatcherBaneco`
 * hablando el protocolo del banco de verdad —cifrado, JWT, DTOs, `responseCode`—
 * contra un transporte de fixtures. Es lo más cerca de la certificación que se
 * puede llegar sin credenciales, y sin tocar la red desde CI.
 */

import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  centavos,
  emitirQr,
  enviarQr,
  esExito,
  registrarComprobante,
  vencerSiCorresponde,
  verificarPago,
  type Centavos,
  type Cobro,
  type Dependencias,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { PaymentWatcherBaneco, QrProviderBaneco } from './adaptadores.js';
import { ProveedorDeToken } from './auth/token.js';
import { ClienteBaneco } from './client/qr.js';
import {
  configDePrueba,
  PAGO_DE_EJEMPLO,
  QR_ACTIVO,
  TransporteFalso,
  type OpcionesTransporte,
} from './pruebas/fixtures.js';

/** El pago de ejemplo del banco es de 150.50 → el cobro tiene que coincidir. */
const MONTO_DEL_ABONO = 15_050;

const T0 = new Date('2021-06-14T12:00:00.000Z');
const VENCE = new Date('2021-06-17T12:00:00.000Z');
/** El abono del fixture ocurre a las 17:06:29 de Bolivia = 21:06:29 UTC. */
const TRAS_EL_PAGO = new Date('2021-06-14T21:10:00.000Z');

function bs(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto inválido');
  return r.valor;
}

/** Hace que statusQR informe el QR como pagado. */
const PAGADO: OpcionesTransporte = {
  sobrescribir: {
    [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_ACTIVO}`]: {
      status: 200,
      cuerpo: {
        statusQrCode: 1,
        payment: [{ ...PAGO_DE_EJEMPLO, qrId: QR_ACTIVO }],
        responseCode: 0,
        message: '',
      },
    },
  },
};

function armar(opciones: OpcionesTransporte = {}) {
  const config = configDePrueba();
  const transporte = new TransporteFalso(opciones);
  const tokens = new ProveedorDeToken(config, transporte.enviar);
  const cliente = new ClienteBaneco(config, transporte.enviar, tokens);

  const evidencia = new EvidenceStoreEnMemoria();
  const deps: Dependencias = {
    cobros: new CobroRepositoryEnMemoria(evidencia),
    evidencia,
    qr: new QrProviderBaneco(config, cliente, () => T0),
    watcher: new PaymentWatcherBaneco(cliente),
    mensajeria: new MessagingProviderEnMemoria(),
    politica: POLITICA_POR_DEFECTO,
  };
  return { deps, evidencia, transporte };
}

const cobroInicial: Cobro = {
  id: 'cobro-e2e-1',
  proveedor: 'baneco',
  estado: 'BORRADOR',
  montoCentavos: bs(MONTO_DEL_ABONO),
  moneda: 'BOB',
  qrVersion: 0,
  qrVigente: null,
  creadoEn: T0,
  telefonoCliente: '+59171234567',
  concepto: 'Pago Factura de Prueba',
};

async function hastaEnviado(deps: Dependencias) {
  const emitido = await emitirQr(deps, cobroInicial, VENCE, T0);
  if (!esExito(emitido)) throw new Error('emitir debería funcionar');
  const enviado = await enviarQr(deps, emitido.valor, T0);
  if (!esExito(enviado)) throw new Error('enviar debería funcionar');
  return enviado.valor;
}

describe('flujo completo contra el adaptador real de Baneco', () => {
  it('emite, envía, detecta el abono y confirma', async () => {
    const { deps, evidencia } = armar(PAGADO);

    const cobro = await hastaEnviado(deps);
    expect(cobro.estado).toBe('ENVIADO');
    expect(cobro.qrVigente?.referenciaProveedor).toBe(QR_ACTIVO);
    expect(cobro.qrVigente?.origen).toBe('api-baneco');

    const verificado = await verificarPago(deps, cobro, TRAS_EL_PAGO);
    expect(esExito(verificado)).toBe(true);
    if (!esExito(verificado)) return;
    expect(verificado.valor.tipo).toBe('CONFIRMADO');

    const registros = await evidencia.listarDeCobro('cobro-e2e-1');
    expect(esExito(registros) && registros.valor.map((r) => r.hacia)).toEqual([
      'QR_ACTIVO',
      'ENVIADO',
      'PAGO_DETECTADO',
      'CONFIRMADO',
    ]);
  });

  it('mientras el banco informa el QR como activo, no confirma nada', async () => {
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const verificado = await verificarPago(deps, cobro, TRAS_EL_PAGO);
    expect(esExito(verificado) && verificado.valor.tipo).toBe('SIN_ABONO');
    expect(esExito(verificado) && verificado.valor.cobro.estado).toBe('ENVIADO');
  });

  it('un comprobante de WhatsApp no confirma aunque el banco no reporte nada', async () => {
    // El vector de fraude nº 1: comprobante falsificado con el banco en silencio.
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const conComprobante = await registrarComprobante(deps, cobro, 'wa-falso', T0);
    if (!esExito(conComprobante)) throw new Error('debería registrarse');

    const verificado = await verificarPago(deps, conComprobante.valor, TRAS_EL_PAGO);
    expect(esExito(verificado) && verificado.valor.tipo).toBe('SIN_ABONO');
    expect(esExito(verificado) && verificado.valor.cobro.estado).toBe('COMPROBANTE_RECIBIDO');
  });

  it('un abono por monto distinto al del cobro va a EN_REVISION', async () => {
    const { deps } = armar({
      sobrescribir: {
        [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_ACTIVO}`]: {
          status: 200,
          cuerpo: {
            statusQrCode: 1,
            payment: [{ ...PAGO_DE_EJEMPLO, qrId: QR_ACTIVO, amount: 150.49 }],
            responseCode: 0,
            message: '',
          },
        },
      },
    });
    const cobro = await hastaEnviado(deps);

    const verificado = await verificarPago(deps, cobro, TRAS_EL_PAGO);
    expect(esExito(verificado)).toBe(true);
    if (!esExito(verificado) || verificado.valor.tipo !== 'EN_REVISION') {
      throw new Error('un centavo de diferencia debería quedar en revisión');
    }
    expect(verificado.valor.motivo.tipo).toBe('MONTO_NO_COINCIDE');
  });

  it('el cobro vencido sin pago se puede renovar con versión nueva', async () => {
    const { deps } = armar();
    const cobro = await hastaEnviado(deps);

    const vencido = await vencerSiCorresponde(deps, cobro, new Date('2021-06-18T12:00:00.000Z'));
    expect(esExito(vencido) && vencido.valor.estado).toBe('VENCIDO');
    if (!esExito(vencido)) return;

    const renovado = await emitirQr(
      deps,
      vencido.valor,
      new Date('2021-06-21T12:00:00.000Z'),
      new Date('2021-06-18T12:01:00.000Z'),
    );
    expect(esExito(renovado)).toBe(true);
    if (esExito(renovado)) {
      expect(renovado.valor.id).toBe(cobro.id);
      expect(renovado.valor.qrVersion).toBe(2);
    }
  });

  it('la evidencia no filtra datos del pagador ni del cliente (reglas #4 y #9)', async () => {
    const { deps, evidencia } = armar(PAGADO);
    const cobro = await hastaEnviado(deps);
    await verificarPago(deps, cobro, TRAS_EL_PAGO);

    const registros = await evidencia.listarDeCobro('cobro-e2e-1');
    expect(esExito(registros)).toBe(true);
    if (!esExito(registros)) return;

    const serializado = JSON.stringify(registros.valor);
    expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderName);
    expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderDocumentId);
    expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderAccount);
    expect(serializado).not.toContain(cobroInicial.telefonoCliente);
  });

  it('si el banco está caído, el cobro no cambia de estado', async () => {
    const { deps } = armar({
      sobrescribir: {
        [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_ACTIVO}`]: { status: 500, cuerpo: null },
      },
    });
    const cobro = await hastaEnviado(deps);

    const verificado = await verificarPago(deps, cobro, TRAS_EL_PAGO);
    expect(esExito(verificado)).toBe(false);
    if (!esExito(verificado) && verificado.error.tipo === 'PUERTO') {
      // Reintentable: el satélite vuelve a intentar en la próxima pasada.
      expect(verificado.error.error.reintentable).toBe(true);
    }
  });
});
