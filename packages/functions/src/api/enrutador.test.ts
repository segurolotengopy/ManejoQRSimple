import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  centavos,
  esExito,
  registrarDeteccion,
  type Centavos,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { enrutar, type VerificadorDeToken } from './enrutador.js';
import type { ContextoApi } from './handlers.js';
import type { Metodo, Peticion } from './tipos.js';

const AHORA = new Date('2026-08-28T12:00:00.000Z');
const TOKEN = 'token-de-prueba-suficientemente-largo';

const aceptaTodo: VerificadorDeToken = (t) => Promise.resolve(t === TOKEN ? 'dueño' : null);

function monto(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto inválido');
  return r.valor;
}

function armar() {
  const evidencia = new EvidenceStoreEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const mensajeria = new MessagingProviderEnMemoria();

  const ctx: ContextoApi = {
    deps: {
      cobros,
      evidencia,
      qr: new QrProviderEnMemoria(),
      watcher,
      mensajeria,
      politica: POLITICA_POR_DEFECTO,
    },
    evidencia,
    horasDeVigenciaPorDefecto: 72,
    ahora: () => AHORA,
  };
  return { ctx, watcher, mensajeria, evidencia };
}

function pedir(
  metodo: Metodo,
  ruta: string,
  cuerpo: unknown = null,
  token: string | null = TOKEN,
): Peticion {
  return { metodo, ruta, cuerpo, token };
}

const COBRO_VALIDO = {
  telefonoCliente: '+59171234567',
  concepto: 'Consulta odontológica',
  monto: '150.50',
};

async function crear(ctx: ContextoApi): Promise<{ id: string; cuerpo: Record<string, unknown> }> {
  const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', COBRO_VALIDO));
  const cuerpo = r.cuerpo as Record<string, unknown>;
  return { id: String(cuerpo['id']), cuerpo };
}

describe('autenticación', () => {
  const rutas: readonly (readonly [Metodo, string])[] = [
    ['GET', '/api/cobros'],
    ['POST', '/api/cobros'],
    ['GET', '/api/cobros/x'],
    ['POST', '/api/cobros/x/enviar'],
    ['POST', '/api/cobros/x/renovar'],
    ['POST', '/api/cobros/x/anular'],
    ['POST', '/api/cobros/x/comprobante'],
    ['POST', '/api/cobros/x/verificar'],
  ];

  it.each(rutas)('%s %s exige token', async (metodo, ruta) => {
    // No hay endpoint público: la consola opera la billetera del dueño.
    const sinToken = await enrutar(armar().ctx, aceptaTodo, pedir(metodo, ruta, null, null));
    expect(sinToken.status).toBe(401);
  });

  it.each(rutas)('%s %s rechaza un token equivocado', async (metodo, ruta) => {
    const malo = await enrutar(armar().ctx, aceptaTodo, pedir(metodo, ruta, null, 'otro-token'));
    expect(malo.status).toBe(401);
  });

  it('no revela si la ruta existe antes de autenticar', async () => {
    // Un 404 antes del 401 le diría a un desconocido qué rutas hay.
    const r = await enrutar(armar().ctx, aceptaTodo, pedir('GET', '/api/inventada', null, null));
    expect(r.status).toBe(401);
  });
});

describe('POST /api/cobros', () => {
  it('crea el cobro y le emite el primer QR', async () => {
    const { ctx } = armar();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', COBRO_VALIDO));

    expect(r.status).toBe(201);
    const cuerpo = r.cuerpo as Record<string, unknown>;
    expect(cuerpo['estado']).toBe('QR_ACTIVO');
    expect(cuerpo['monto']).toBe('150.50');
    expect(cuerpo['qrVersion']).toBe(1);
  });

  it('enmascara el teléfono en la respuesta (regla #9)', async () => {
    const { ctx } = armar();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', COBRO_VALIDO));
    const cuerpo = r.cuerpo as Record<string, unknown>;

    expect(cuerpo['telefonoCliente']).toBe('+591 7** ***67');
    expect(JSON.stringify(cuerpo)).not.toContain('+59171234567');
  });

  it.each([
    ['sin teléfono', { concepto: 'x', monto: '10.00' }],
    ['teléfono de otro país', { ...COBRO_VALIDO, telefonoCliente: '+595971234567' }],
    ['monto con coma', { ...COBRO_VALIDO, monto: '150,50' }],
    ['monto con tres decimales', { ...COBRO_VALIDO, monto: '150.505' }],
    ['monto negativo', { ...COBRO_VALIDO, monto: '-10.00' }],
    ['concepto vacío', { ...COBRO_VALIDO, concepto: '' }],
    ['cuerpo vacío', {}],
    ['cuerpo nulo', null],
  ])('rechaza %s con 400', async (_caso, cuerpo) => {
    const { ctx } = armar();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', cuerpo));
    expect(r.status).toBe(400);
  });

  it('el monto viaja como texto decimal, nunca como float', async () => {
    // 0.1 + 0.2 en float da 0.30000000000000004; acá tiene que dar exacto.
    const { ctx } = armar();
    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', '/api/cobros', { ...COBRO_VALIDO, monto: '0.30' }),
    );
    expect((r.cuerpo as Record<string, unknown>)['monto']).toBe('0.30');
  });
});

describe('GET /api/cobros/:id', () => {
  it('devuelve el cobro con su rastro de evidencia', async () => {
    const { ctx } = armar();
    const { id } = await crear(ctx);

    const r = await enrutar(ctx, aceptaTodo, pedir('GET', `/api/cobros/${id}`));
    expect(r.status).toBe(200);

    const cuerpo = r.cuerpo as { evidencia: { hacia: string }[] };
    expect(cuerpo.evidencia.map((e) => e.hacia)).toEqual(['QR_ACTIVO']);
  });

  it('404 si no existe', async () => {
    const r = await enrutar(armar().ctx, aceptaTodo, pedir('GET', '/api/cobros/no-existe'));
    expect(r.status).toBe(404);
  });
});

describe('ciclo de vida por la API', () => {
  it('crear → enviar → verificar con abono → CONFIRMADO', async () => {
    const { ctx, watcher } = armar();
    const { id, cuerpo } = await crear(ctx);
    const referencia = String(
      (cuerpo['qrVigente'] as Record<string, unknown>)['referenciaProveedor'],
    );

    const enviado = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    expect((enviado.cuerpo as Record<string, unknown>)['estado']).toBe('ENVIADO');

    watcher.cargarAbono(
      referencia,
      registrarDeteccion({
        idDeduplicacion: `simulado:${referencia}`,
        montoCentavos: monto(15_050),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const verificado = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/verificar`));
    expect(verificado.status).toBe(200);
    expect((verificado.cuerpo as Record<string, unknown>)['resultado']).toBe('CONFIRMADO');
  });

  it('un abono por monto distinto deja el cobro EN_REVISION, no confirmado', async () => {
    const { ctx, watcher } = armar();
    const { id, cuerpo } = await crear(ctx);
    const referencia = String(
      (cuerpo['qrVigente'] as Record<string, unknown>)['referenciaProveedor'],
    );
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));

    watcher.cargarAbono(
      referencia,
      registrarDeteccion({
        idDeduplicacion: `simulado:${referencia}`,
        montoCentavos: monto(15_049),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/verificar`));
    expect((r.cuerpo as Record<string, unknown>)['resultado']).toBe('EN_REVISION');
  });

  it('el comprobante NO confirma: solo cambia a COMPROBANTE_RECIBIDO', async () => {
    // El vector de fraude nº 1 del dominio, probado desde el borde HTTP.
    const { ctx } = armar();
    const { id } = await crear(ctx);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));

    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/cobros/${id}/comprobante`, { referenciaComprobante: 'wa-1' }),
    );
    expect((r.cuerpo as Record<string, unknown>)['estado']).toBe('COMPROBANTE_RECIBIDO');

    // Y sin abono en el banco, verificar tampoco lo confirma.
    const verificado = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/verificar`));
    expect((verificado.cuerpo as Record<string, unknown>)['resultado']).toBe('SIN_ABONO');
  });

  it('anular exige un motivo y deja el cobro ANULADO', async () => {
    const { ctx } = armar();
    const { id } = await crear(ctx);

    expect((await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/anular`, {}))).status).toBe(
      400,
    );

    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/cobros/${id}/anular`, { motivo: 'el cliente desistió' }),
    );
    expect((r.cuerpo as Record<string, unknown>)['estado']).toBe('ANULADO');
  });

  it('una operación sobre un cobro terminal responde 409, no 400', async () => {
    // El pedido está bien formado; lo que no corresponde es el estado.
    const { ctx } = armar();
    const { id } = await crear(ctx);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/anular`, { motivo: 'x' }));

    const r = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    expect(r.status).toBe(409);
  });
});

describe('rutas y métodos', () => {
  it.each([
    ['GET', '/api/cobros/x/enviar'],
    ['POST', '/api/cobros/x'],
  ])('%s %s responde 405', async (metodo, ruta) => {
    const r = await enrutar(armar().ctx, aceptaTodo, pedir(metodo as Metodo, ruta));
    expect(r.status).toBe(405);
  });

  it.each(['/api/otra-cosa', '/api/cobros/x/inventada', '/api/cobros/x/y/z'])(
    'la ruta %s responde 404',
    async (ruta) => {
      const r = await enrutar(armar().ctx, aceptaTodo, pedir('POST', ruta, {}));
      expect(r.status).toBe(404);
    },
  );
});

describe('GET /api/cobros', () => {
  it('lista solo los pendientes', async () => {
    const { ctx } = armar();
    const { id } = await crear(ctx);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    const otro = await crear(ctx); // queda en QR_ACTIVO, no pendiente

    const r = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/cobros'));
    const cuerpo = r.cuerpo as { cobros: { id: string }[] };
    expect(cuerpo.cobros.map((c) => c.id)).toEqual([id]);
    expect(cuerpo.cobros.map((c) => c.id)).not.toContain(otro.id);
  });
});
