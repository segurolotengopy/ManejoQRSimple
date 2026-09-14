import {
  CASOS_PAYMENT_WATCHER,
  CASOS_QR_PROVIDER,
  INSTANTE_DE_CONTRATO,
  centavos,
  esExito,
  type Centavos,
  type SolicitudQr,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { PaymentWatcherBaneco, QrProviderBaneco } from './adaptadores.js';
import { ProveedorDeToken } from './auth/token.js';
import { ClienteBaneco } from './client/qr.js';
import { descifrar } from './crypto/aes.js';
import {
  configDePrueba,
  PAGO_DE_EJEMPLO,
  QR_ACTIVO,
  QR_ANULADO,
  QR_PAGADO,
  TransporteFalso,
  type OpcionesTransporte,
} from './pruebas/fixtures.js';

function bs(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto de fixture inválido');
  return r.valor;
}

function armar(opciones: OpcionesTransporte = {}) {
  const config = configDePrueba();
  const transporte = new TransporteFalso(opciones);
  const tokens = new ProveedorDeToken(config, transporte.enviar);
  const cliente = new ClienteBaneco(config, transporte.enviar, tokens);
  return {
    config,
    transporte,
    // El reloj del contrato: con el real, el QR se emite después de la fecha
    // fija en que vence la solicitud de ejemplo.
    proveedor: new QrProviderBaneco(config, cliente, () => INSTANTE_DE_CONTRATO),
    watcher: new PaymentWatcherBaneco(cliente),
  };
}

const solicitud: SolicitudQr = {
  cobroId: 'cobro-1',
  montoCentavos: bs(15_050),
  venceEn: new Date('2026-08-30T12:00:00.000Z'),
  concepto: 'Pago Factura de Prueba',
  qrVersion: 1,
  origenEsperado: 'api-baneco',
};

describe('la imagen del QR', () => {
  function proveedorCon(almacen: ((qrId: string, png: string) => Promise<string | null>) | null) {
    const config = configDePrueba();
    const transporte = new TransporteFalso();
    const cliente = new ClienteBaneco(config, transporte.enviar, new ProveedorDeToken(config, transporte.enviar));
    return new QrProviderBaneco(config, cliente, () => INSTANTE_DE_CONTRATO, almacen);
  }

  it('se guarda por fuera y el QR lleva su referencia y su hash', async () => {
    const guardadas: string[] = [];
    const proveedor = proveedorCon((qrId, png) => {
      guardadas.push(`${qrId}:${png}`);
      return Promise.resolve(`archivo:${qrId}.png`);
    });

    const r = await proveedor.emitir(solicitud);
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;
    expect(r.valor.imagenRef).toBe(`archivo:${QR_ACTIVO}.png`);
    expect(r.valor.hashImagen).toMatch(/^[0-9a-f]{64}$/);
    expect(guardadas).toEqual([`${QR_ACTIVO}:iVBORw0KGgo=`]);
  });

  it('si no se pudo guardar, el QR existe igual pero sin referencia ni hash', async () => {
    const r = await proveedorCon(() => Promise.resolve(null)).emitir(solicitud);
    expect(esExito(r) && r.valor).toMatchObject({ imagenRef: null, hashImagen: null });
  });

  it('sin almacén no se guarda nada', async () => {
    const r = await proveedorCon(null).emitir(solicitud);
    expect(esExito(r) && r.valor.imagenRef).toBeNull();
  });
});

describe('tests de contrato de qr-core contra el adaptador de Baneco', () => {
  it.each(CASOS_QR_PROVIDER)('QrProvider — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(armar().proveedor)).resolves.toBeUndefined();
  });

  it.each(CASOS_PAYMENT_WATCHER)('PaymentWatcher — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(armar().watcher)).resolves.toBeUndefined();
  });
});

describe('QrProviderBaneco.emitir()', () => {
  it('pide un QR de un solo uso y monto no modificable', () => {
    // Es lo que hace conciliable al cobro: si el cliente pudiera cambiar el
    // importe, la conciliación por monto exacto dejaría de funcionar.
    const { proveedor, transporte } = armar();
    return proveedor.emitir(solicitud).then(() => {
      const generar = transporte.peticiones.find((p) => p.url.endsWith('/generateQR'));
      expect(generar?.cuerpo).toMatchObject({ singleUse: true, modifyAmount: false });
    });
  });

  it('manda el importe como decimal de dos posiciones, no como centavos', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.emitir(solicitud);
    const generar = transporte.peticiones.find((p) => p.url.endsWith('/generateQR'));
    expect(generar?.cuerpo).toMatchObject({ amount: '150.50', currency: 'BOB' });
  });

  it('manda la cuenta de abono cifrada, nunca en claro (regla #4)', async () => {
    const { proveedor, transporte, config } = armar();
    await proveedor.emitir(solicitud);

    const generar = transporte.peticiones.find((p) => p.url.endsWith('/generateQR'));
    const cuerpo = generar?.cuerpo as { accountCredit: string };

    const cuentaEnClaro = config.cuentaAbono.revelar();
    expect(cuerpo.accountCredit).not.toBe(cuentaEnClaro);
    expect(cuerpo.accountCredit).not.toContain(cuentaEnClaro);
    // Y descifra de vuelta a la cuenta real: está cifrada, no destruida.
    expect(descifrar(cuerpo.accountCredit, config.llave)).toEqual({
      ok: true,
      valor: cuentaEnClaro,
    });
  });

  it('manda dueDate en formato yyyy-MM-dd', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.emitir(solicitud);
    const generar = transporte.peticiones.find((p) => p.url.endsWith('/generateQR'));
    expect((generar?.cuerpo as { dueDate: string }).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('devuelve el QR con la versión pedida y la referencia del banco', async () => {
    const r = await armar().proveedor.emitir(solicitud);
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.qrVersion).toBe(1);
      expect(r.valor.referenciaProveedor).toBe(QR_ACTIVO);
      expect(r.valor.origen).toBe('api-baneco');
      // La imagen no viaja inline al dominio (docs/02 §3).
      expect(r.valor.imagenRef).toBeNull();
    }
  });

  it('recorta el concepto al máximo que acepta el gateway', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.emitir({ ...solicitud, concepto: 'x'.repeat(200) });
    const generar = transporte.peticiones.find((p) => p.url.endsWith('/generateQR'));
    expect((generar?.cuerpo as { description: string }).description).toHaveLength(100);
  });
});

describe('PaymentWatcherBaneco.consultarCobro()', () => {
  it('devuelve una detección cuando el QR está pagado', async () => {
    const r = await armar().watcher.consultarCobro(QR_PAGADO);
    expect(esExito(r)).toBe(true);
    if (esExito(r) && r.valor !== null) {
      expect(r.valor.montoCentavos).toBe(15_050);
      expect(r.valor.idDeduplicacion).toBe(`baneco:${QR_PAGADO}:1236342`);
      expect(r.valor.origen).toBe('watcher-baneco');
    }
  });

  it.each([
    ['activo', QR_ACTIVO],
    ['anulado', QR_ANULADO],
  ])('devuelve null si el QR está %s, sin tratarlo como error', async (_estado, qrId) => {
    expect(await armar().watcher.consultarCobro(qrId)).toEqual({ ok: true, valor: null });
  });

  it('absorbe la variante statusQRCode del nombre del campo', async () => {
    // La espec. no es consistente con las mayúsculas; equivocarse acá
    // significaría no detectar un pago.
    const { watcher } = armar({
      sobrescribir: {
        [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_PAGADO}`]: {
          status: 200,
          cuerpo: { statusQRCode: 1, payment: [PAGO_DE_EJEMPLO], responseCode: 0, message: '' },
        },
      },
    });
    const r = await watcher.consultarCobro(QR_PAGADO);
    expect(esExito(r) && r.valor !== null).toBe(true);
  });

  it('rechaza un "pagado" sin detalle del pago en vez de inventar un abono', async () => {
    const { watcher } = armar({
      sobrescribir: {
        [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_PAGADO}`]: {
          status: 200,
          cuerpo: { statusQrCode: 1, payment: [], responseCode: 0, message: '' },
        },
      },
    });
    const r = await watcher.consultarCobro(QR_PAGADO);
    expect(esExito(r)).toBe(false);
  });

  it('nunca propaga el nombre del pagador al dominio (reglas #4 y #9)', async () => {
    const r = await armar().watcher.consultarCobro(QR_PAGADO);
    expect(esExito(r)).toBe(true);
    if (esExito(r) && r.valor !== null) {
      const serializado = JSON.stringify(r.valor);
      expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderName);
      expect(serializado).not.toContain(PAGO_DE_EJEMPLO.senderAccount);
    }
  });
});

describe('PaymentWatcherBaneco.listarAbonosDelDia()', () => {
  it('mapea los pagos del día a detecciones del dominio', async () => {
    const r = await armar().watcher.listarAbonosDelDia(new Date('2021-06-14T12:00:00.000Z'));
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor).toHaveLength(1);
      expect(r.valor[0]?.idDeduplicacion).toBe(`baneco:${QR_PAGADO}:1236342`);
    }
  });

  it('corta el día entero si un pago no se puede interpretar', async () => {
    // Descartarlo en silencio sería perder un abono sin que nadie se entere.
    const { watcher } = armar({
      sobrescribir: {
        '/ApiGateway/api/qrsimple/v2/paidQR/20210614': {
          status: 200,
          cuerpo: {
            paymentList: [{ ...PAGO_DE_EJEMPLO, amount: 1.005 }],
            responseCode: 0,
            message: '',
          },
        },
      },
    });
    const r = await watcher.listarAbonosDelDia(new Date('2021-06-14T12:00:00.000Z'));
    expect(esExito(r)).toBe(false);
  });
});

describe('manejo de errores del banco', () => {
  it('trata responseCode != 0 como error opaco, conservando el código', async () => {
    const { proveedor } = armar({
      sobrescribir: {
        '/ApiGateway/api/qrsimple/generateQR': {
          status: 200,
          cuerpo: { qrId: '', responseCode: 17, message: 'algo salió mal' },
        },
      },
    });
    const r = await proveedor.emitir(solicitud);
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('RECHAZADO_POR_PROVEEDOR');
      // El código se guarda para el catálogo empírico (pregunta E1)...
      expect(r.error.codigoProveedor).toBe('17');
      // ...pero no se ramifica lógica sobre un catálogo no documentado.
      expect(r.error.reintentable).toBe(false);
    }
  });

  it('renueva el token y reintenta UNA vez ante 401', async () => {
    const { proveedor, transporte } = armar({ unUnico401: true });
    const r = await proveedor.emitir(solicitud);

    expect(esExito(r)).toBe(true);
    const autenticaciones = transporte.peticiones.filter((p) => p.url.endsWith('/authenticate'));
    expect(autenticaciones).toHaveLength(2);
  });

  it('rechaza una respuesta con forma inesperada', async () => {
    const { proveedor } = armar({
      sobrescribir: {
        '/ApiGateway/api/qrsimple/generateQR': { status: 200, cuerpo: { inesperado: true } },
      },
    });
    const r = await proveedor.emitir(solicitud);
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('RESPUESTA_INVALIDA');
    }
  });

  it('marca reintentable un 500 del banco y no reintentable un 400', async () => {
    for (const [status, reintentable] of [
      [500, true],
      [400, false],
    ] as const) {
      const { proveedor } = armar({
        sobrescribir: { '/ApiGateway/api/qrsimple/generateQR': { status, cuerpo: null } },
      });
      const r = await proveedor.emitir(solicitud);
      expect(esExito(r)).toBe(false);
      if (!esExito(r)) {
        expect(r.error.reintentable).toBe(reintentable);
      }
    }
  });
});

describe('el token nunca viaja en el cuerpo ni se repite de más', () => {
  it('autentica una sola vez para varias operaciones seguidas', async () => {
    const { proveedor, watcher, transporte } = armar();
    await proveedor.emitir(solicitud);
    await watcher.consultarCobro(QR_ACTIVO);
    await watcher.listarAbonosDelDia(new Date('2021-06-14T12:00:00.000Z'));

    const autenticaciones = transporte.peticiones.filter((p) => p.url.endsWith('/authenticate'));
    expect(autenticaciones).toHaveLength(1);
  });

  it('manda la contraseña cifrada al autenticar, nunca en claro', async () => {
    const { proveedor, transporte, config } = armar();
    await proveedor.emitir(solicitud);

    const auth = transporte.peticiones.find((p) => p.url.endsWith('/authenticate'));
    const cuerpo = auth?.cuerpo as { password: string };
    const passwordEnClaro = config.password.revelar();
    expect(cuerpo.password).not.toBe(passwordEnClaro);
    expect(descifrar(cuerpo.password, config.llave)).toEqual({ ok: true, valor: passwordEnClaro });
  });
});

describe('QrProviderBaneco.anular() con la respuesta real del banco', () => {
  // Prueba en producción (2026-09-13/14): cancelQR respondió HTTP 200 con
  // responseCode 403 sobre un QR ya anulado (P7) y sobre uno pagado (P6).
  const RECHAZO_403 = { status: 200, cuerpo: { responseCode: 403, message: 'no se puede anular' } };
  const CANCEL = '/ApiGateway/api/qrsimple/cancelQR';

  it('un 403 sobre un QR que el banco informa anulado es éxito: la anulación ya estaba hecha', async () => {
    const { proveedor, transporte } = armar({ sobrescribir: { [CANCEL]: RECHAZO_403 } });
    const r = await proveedor.anular(QR_ANULADO);
    expect(esExito(r)).toBe(true);
    // Se lo preguntó al banco, no lo supuso.
    expect(transporte.peticiones.some((p) => p.url.endsWith(`/statusQR/${QR_ANULADO}`))).toBe(true);
  });

  it('un 403 sobre un QR pagado sigue siendo error: nunca se da por anulado un QR con plata', async () => {
    const { proveedor } = armar({ sobrescribir: { [CANCEL]: RECHAZO_403 } });
    const r = await proveedor.anular(QR_PAGADO);
    expect(!esExito(r) && r.error).toMatchObject({ tipo: 'RECHAZADO_POR_PROVEEDOR', codigoProveedor: '403' });
  });

  it('un 403 sobre un QR que sigue activo sigue siendo error', async () => {
    const { proveedor } = armar({ sobrescribir: { [CANCEL]: RECHAZO_403 } });
    const r = await proveedor.anular(QR_ACTIVO);
    expect(!esExito(r) && r.error.codigoProveedor).toBe('403');
  });

  it('si la consulta del estado falla, se devuelve el rechazo original', async () => {
    const { proveedor } = armar({
      sobrescribir: {
        [CANCEL]: RECHAZO_403,
        [`/ApiGateway/api/qrsimple/v2/statusQR/${QR_ANULADO}`]: { status: 500, cuerpo: null },
      },
    });
    const r = await proveedor.anular(QR_ANULADO);
    expect(!esExito(r) && r.error.codigoProveedor).toBe('403');
  });

  it('un error sin responseCode (HTTP) no consulta el estado: el banco no dijo nada del QR', async () => {
    const { proveedor, transporte } = armar({ sobrescribir: { [CANCEL]: { status: 400, cuerpo: null } } });
    const r = await proveedor.anular(QR_ANULADO);
    expect(esExito(r)).toBe(false);
    expect(transporte.peticiones.some((p) => p.url.includes('/statusQR/'))).toBe(false);
  });
});
