import { esExito, type AvisoDeConfirmacion, type Centavos } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import type { Destino } from './destinos.js';
import { CABECERA_FIRMA, verificarFirma } from './firma.js';
import { NotificadorHttp, cuerpoDelAviso, type Transporte } from './notificador.js';

const AHORA = new Date('2026-09-20T12:00:00.000Z');
const SECRETO = 'secreto-de-mentira-de-32-caracter';

const DESTINO: Destino = {
  consumidorId: 'novuchat',
  url: 'https://novuchat.example/avisos',
  secreto: SECRETO,
};

function unAviso(sobrescribir: Partial<AvisoDeConfirmacion> = {}): AvisoDeConfirmacion {
  return {
    evento: 'cobro.confirmado',
    idEvento: 'cons-abc',
    consumidorId: 'novuchat',
    cobroId: 'cons-abc',
    referenciaExterna: 'plan-2026-09',
    montoCentavos: 15_050 as Centavos,
    confirmadoEn: AHORA,
    ocurridoEn: new Date(AHORA.getTime() - 10_000),
    riel: 'watcher-baneco',
    ...sobrescribir,
  };
}

/** Transporte que anota lo que le pidieron y devuelve el estado que se le diga. */
function transporteQueResponde(status: number) {
  const pedidos: { url: string; headers: Record<string, string>; body: string }[] = [];
  const transporte: Transporte = (url, opciones) => {
    pedidos.push({ url, headers: { ...opciones.headers }, body: opciones.body });
    return Promise.resolve({ status, text: () => Promise.resolve('lo que conteste el consumidor') });
  };
  return { transporte, pedidos };
}

describe('cuerpoDelAviso()', () => {
  it('lleva lo mínimo del cobro y nada del banco ni del pagador', () => {
    const cuerpo = JSON.parse(cuerpoDelAviso(unAviso())) as Record<string, unknown>;
    expect(cuerpo).toEqual({
      evento: 'cobro.confirmado',
      idEvento: 'cons-abc',
      cobro: {
        id: 'cons-abc',
        referenciaExterna: 'plan-2026-09',
        estado: 'CONFIRMADO',
        monto: '150.50',
        moneda: 'BOB',
        confirmadoEn: AHORA.toISOString(),
        ocurridoEn: new Date(AHORA.getTime() - 10_000).toISOString(),
        riel: 'api-baneco',
      },
    });
  });

  it('el monto va como texto decimal, nunca como número', () => {
    // 150.50 como `number` se serializa "150.5" y pierde la forma del importe.
    expect(cuerpoDelAviso(unAviso())).toContain('"monto":"150.50"');
    expect(cuerpoDelAviso(unAviso({ montoCentavos: 5 as Centavos }))).toContain('"monto":"0.05"');
  });

  it('traduce el riel a su nombre público, no al interno del dominio', () => {
    // `watcher-baneco` describe nuestra implementación; filtrarlo ataría el
    // contrato a ella.
    expect(cuerpoDelAviso(unAviso())).toContain('"riel":"api-baneco"');
    expect(cuerpoDelAviso(unAviso({ riel: null }))).toContain('"riel":null');
  });
});

describe('NotificadorHttp', () => {
  it('entrega firmado, y la firma verifica contra el cuerpo exacto', async () => {
    const { transporte, pedidos } = transporteQueResponde(200);
    const notificador = new NotificadorHttp(new Map([['novuchat', DESTINO]]), () => AHORA, transporte);

    const r = await notificador.entregar(unAviso());
    expect(esExito(r) && r.valor).toBe('ENTREGADO');

    const pedido = pedidos[0];
    expect(pedido?.url).toBe(DESTINO.url);
    const cabecera = pedido?.headers[CABECERA_FIRMA] ?? '';
    expect(verificarFirma(pedido?.body ?? '', cabecera, SECRETO, AHORA)).toBe(true);
    // Y no verifica con otro secreto: la firma es de este consumidor.
    expect(verificarFirma(pedido?.body ?? '', cabecera, 'otro-secreto-de-mentira-distinto', AHORA)).toBe(false);
  });

  it('un consumidor sin destino no es una falla', async () => {
    const { transporte, pedidos } = transporteQueResponde(200);
    const notificador = new NotificadorHttp(new Map(), () => AHORA, transporte);

    const r = await notificador.entregar(unAviso());
    expect(esExito(r) && r.valor).toBe('SIN_DESTINO');
    expect(pedidos).toHaveLength(0);
  });

  it('el aviso va al destino de SU consumidor, no al de otro', async () => {
    const { transporte, pedidos } = transporteQueResponde(200);
    const otro: Destino = { consumidorId: 'otra-app', url: 'https://otra.example/hook', secreto: SECRETO };
    const notificador = new NotificadorHttp(
      new Map([
        ['novuchat', DESTINO],
        ['otra-app', otro],
      ]),
      () => AHORA,
      transporte,
    );

    await notificador.entregar(unAviso({ consumidorId: 'otra-app' }));
    expect(pedidos[0]?.url).toBe(otro.url);
  });

  it.each([
    [500, 'INDISPONIBLE'],
    [503, 'INDISPONIBLE'],
    [404, 'RECHAZADO_POR_PROVEEDOR'],
    [401, 'RECHAZADO_POR_PROVEEDOR'],
  ])('un HTTP %i se reporta como %s y es reintentable', async (status, tipo) => {
    // Hasta un 404 se reintenta: puede ser un despliegue a medio camino, y
    // abandonar un aviso por un código es perderlo para siempre.
    const { transporte } = transporteQueResponde(status);
    const notificador = new NotificadorHttp(new Map([['novuchat', DESTINO]]), () => AHORA, transporte);

    const r = await notificador.entregar(unAviso());
    expect(esExito(r)).toBe(false);
    expect(!esExito(r) && r.error.tipo).toBe(tipo);
    expect(!esExito(r) && r.error.reintentable).toBe(true);
  });

  it('un consumidor inalcanzable se reporta sin transportar el motivo crudo', async () => {
    const transporte: Transporte = () => Promise.reject(new Error('ENOTFOUND novuchat.example'));
    const notificador = new NotificadorHttp(new Map([['novuchat', DESTINO]]), () => AHORA, transporte);

    const r = await notificador.entregar(unAviso());
    expect(esExito(r)).toBe(false);
    // El texto de la excepción puede traer cualquier cosa; no llega al error.
    expect(JSON.stringify(r)).not.toContain('ENOTFOUND');
    expect(!esExito(r) && r.error.reintentable).toBe(true);
  });

  it('lo que conteste el consumidor no viaja en el resultado', async () => {
    const { transporte } = transporteQueResponde(500);
    const notificador = new NotificadorHttp(new Map([['novuchat', DESTINO]]), () => AHORA, transporte);

    const r = await notificador.entregar(unAviso());
    expect(JSON.stringify(r)).not.toContain('lo que conteste el consumidor');
  });
});
