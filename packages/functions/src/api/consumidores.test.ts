/**
 * El contrato para consumidores, probado desde el borde HTTP (docs/10).
 *
 * Lo que estos tests defienden, en orden de gravedad:
 *
 * 1. Que **no exista** ninguna ruta por la que un consumidor confirme un pago.
 * 2. Que un consumidor no vea ni toque lo de otro, ni lo del dueño.
 * 3. Que un reintento no emita un segundo QR.
 */

import {
  AbonosSinConciliarEnMemoria,
  AvisosEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  centavos,
  esExito,
  exito,
  fallo,
  registrarDeteccion,
  type Centavos,
  type QrProvider,
} from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { leerModoPrueba } from '../modo-prueba.js';
import { RegistroEventos } from '../registro.js';
import { crearServidor } from '../servidor.js';
import { cupoDeConsumidores } from './cupo-consumidor.js';
import { enrutar, type VerificadorDeToken } from './enrutador.js';
import type { ContextoApi } from './handlers.js';
import type { Metodo, Peticion } from './tipos.js';

const AHORA = new Date('2026-08-28T12:00:00.000Z');
const TOKEN_DUEÑO = 'token-de-prueba-del-dueño-local';
const TOKEN_A = 'token-de-prueba-del-consumidor-a';
const TOKEN_B = 'token-de-prueba-del-consumidor-b';

const verificador: VerificadorDeToken = (t) => {
  if (t === TOKEN_DUEÑO) return Promise.resolve({ tipo: 'dueño', id: 'dueño' });
  if (t === TOKEN_A) return Promise.resolve({ tipo: 'consumidor', consumidorId: 'novuchat' });
  if (t === TOKEN_B) return Promise.resolve({ tipo: 'consumidor', consumidorId: 'otra-app' });
  return Promise.resolve(null);
};

function monto(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto inválido');
  return r.valor;
}

function armar() {
  const evidencia = new EvidenceStoreEnMemoria();
  const avisos = new AvisosEnMemoria();
  const cobros = new CobroRepositoryEnMemoria(evidencia);
  const watcher = new PaymentWatcherEnMemoria();
  const ctx: ContextoApi = {
    abonosSinConciliar: new AbonosSinConciliarEnMemoria(),
    deps: {
      cobros,
      evidencia,
      avisos,
      qr: new QrProviderEnMemoria(() => AHORA),
      watcher,
      mensajeria: new MessagingProviderEnMemoria(),
      politica: POLITICA_POR_DEFECTO,
    },
    evidencia,
    horasDeVigenciaPorDefecto: 72,
    ahora: () => AHORA,
  };
  return { ctx, watcher, cobros, evidencia };
}

function pedir(
  metodo: Metodo,
  ruta: string,
  cuerpo: unknown = null,
  token: string | null = TOKEN_A,
  consulta: Readonly<Record<string, string>> = {},
): Peticion {
  return { metodo, ruta, consulta, cuerpo, token };
}

const COBRO = { referenciaExterna: 'plan-2026-09', concepto: 'Plan mensual', monto: '150.50' };

type Cuerpo = Record<string, unknown>;
const cuerpoDe = (r: { cuerpo: unknown }): Cuerpo => r.cuerpo as Cuerpo;
const cobroDe = (r: { cuerpo: unknown }): Cuerpo => cuerpoDe(r)['cobro'] as Cuerpo;
const codigoDe = (r: { cuerpo: unknown }): string =>
  (r.cuerpo as { error: { codigo: string } }).error.codigo;

async function crear(ctx: ContextoApi, token = TOKEN_A, cuerpo: unknown = COBRO) {
  return enrutar(ctx, verificador, pedir('POST', '/api/v1/cobros', cuerpo, token));
}

describe('la asimetría del contrato', () => {
  it('no hay ninguna ruta por la que un consumidor confirme un pago', async () => {
    // Es la regla #1 vista desde afuera. Si alguna de estas empezara a existir,
    // un consumidor podría marcar como pagado un cobro que el banco nunca vio.
    const { ctx } = armar();
    const r = await crear(ctx);
    const id = String(cobroDe(r)['id']);

    const prohibidas: readonly (readonly [Metodo, string])[] = [
      ['POST', `/api/v1/cobros/${id}/confirmar`],
      ['POST', `/api/v1/cobros/${id}/verificar`],
      ['POST', `/api/v1/cobros/${id}/resolver`],
      ['POST', `/api/v1/cobros/${id}/comprobante`],
      ['POST', `/api/v1/cobros/${id}/enviar`],
      ['POST', `/api/v1/cobros/${id}/renovar`],
    ];
    for (const [metodo, ruta] of prohibidas) {
      const resp = await enrutar(ctx, verificador, pedir(metodo, ruta, {}));
      expect([ruta, resp.status]).toEqual([ruta, 404]);
    }
  });

  it('un token de consumidor no abre la consola del dueño', async () => {
    const { ctx } = armar();
    const rutas: readonly (readonly [Metodo, string])[] = [
      ['GET', '/api/cobros'],
      ['POST', '/api/cobros'],
      ['GET', '/api/revision'],
      ['GET', '/api/logs'],
      ['POST', '/api/cobros/x/resolver'],
    ];
    for (const [metodo, ruta] of rutas) {
      const r = await enrutar(ctx, verificador, pedir(metodo, ruta, {}, TOKEN_A));
      expect([ruta, r.status]).toEqual([ruta, 404]);
    }
  });

  it('el dueño tampoco entra por el contrato', async () => {
    const { ctx } = armar();
    const r = await enrutar(ctx, verificador, pedir('POST', '/api/v1/cobros', COBRO, TOKEN_DUEÑO));
    expect(r.status).toBe(404);
  });

  it('sin token no se llega a ninguna ruta del contrato', async () => {
    const { ctx } = armar();
    const r = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, null));
    expect(r.status).toBe(401);
  });
});

describe('POST /api/v1/cobros', () => {
  it('crea el cobro con su QR y devuelve la referencia externa, sin teléfono', async () => {
    const { ctx } = armar();
    const r = await crear(ctx);

    expect(r.status).toBe(201);
    expect(cobroDe(r)).toMatchObject({
      referenciaExterna: 'plan-2026-09',
      estado: 'QR_ACTIVO',
      monto: '150.50',
      moneda: 'BOB',
      pago: null,
    });
    expect((cobroDe(r)['qr'] as Cuerpo)['venceEn']).toBe(new Date(AHORA.getTime() + 72 * 3_600_000).toISOString());
    // El contrato no tiene teléfono ni identificadores del banco (regla #4).
    expect(JSON.stringify(r.cuerpo)).not.toContain('telefono');
    expect(JSON.stringify(r.cuerpo)).not.toContain('referenciaProveedor');
  });

  it('el reintento devuelve 200 con el mismo cobro, no 201 con otro', async () => {
    const { ctx } = armar();
    const primero = await crear(ctx);
    const segundo = await crear(ctx);

    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(200);
    expect(cobroDe(segundo)['id']).toBe(cobroDe(primero)['id']);
  });

  it('la misma referencia con otro importe se rechaza con 409', async () => {
    const { ctx } = armar();
    await crear(ctx);
    const r = await crear(ctx, TOKEN_A, { ...COBRO, monto: '160.00' });

    expect(r.status).toBe(409);
    expect(codigoDe(r)).toBe('IMPORTE_DISTINTO_CON_MISMA_REFERENCIA');
  });

  it.each([
    ['sin referencia', { concepto: 'x', monto: '10.00' }],
    ['referencia con espacios', { ...COBRO, referenciaExterna: 'plan de septiembre' }],
    ['referencia con arroba', { ...COBRO, referenciaExterna: 'cliente@ejemplo.com' }],
    ['referencia con barra', { ...COBRO, referenciaExterna: 'a/b' }],
    ['monto con coma', { ...COBRO, monto: '150,50' }],
    ['monto con tres decimales', { ...COBRO, monto: '150.505' }],
    ['concepto vacío', { ...COBRO, concepto: '' }],
    ['cuerpo vacío', {}],
  ])('rechaza %s con 400', async (_caso, cuerpo) => {
    const { ctx } = armar();
    const r = await crear(ctx, TOKEN_A, cuerpo);
    expect(r.status).toBe(400);
  });
});

describe('estado del cobro', () => {
  it('por id y por referencia externa devuelven lo mismo', async () => {
    const { ctx } = armar();
    const creado = await crear(ctx);
    const id = String(cobroDe(creado)['id']);

    const porId = await enrutar(ctx, verificador, pedir('GET', `/api/v1/cobros/${id}`));
    const porRef = await enrutar(
      ctx,
      verificador,
      pedir('GET', '/api/v1/cobros/por-referencia/plan-2026-09'),
    );
    expect(porId.status).toBe(200);
    expect(porRef.cuerpo).toEqual(porId.cuerpo);
  });

  it('informa cuándo se pagó y por qué riel, una vez confirmado', async () => {
    const { ctx, watcher, cobros } = armar();
    const creado = await crear(ctx);
    const id = String(cobroDe(creado)['id']);

    const guardado = await cobros.obtener(id);
    if (!esExito(guardado) || guardado.valor?.qrVigente == null) throw new Error('debería tener QR');
    const referencia = guardado.valor.qrVigente.referenciaProveedor;
    watcher.cargarAbono(
      referencia,
      registrarDeteccion({
        idDeduplicacion: `baneco:${referencia}:tx-1`,
        montoCentavos: monto(15_050),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );
    // Lo confirma el satélite por la consulta autenticada, nunca el consumidor.
    const { verificarPago } = await import('@mqs/qr-core');
    await verificarPago(ctx.deps, guardado.valor, AHORA);

    const r = await enrutar(ctx, verificador, pedir('GET', `/api/v1/cobros/${id}`));
    expect(cobroDe(r)['estado']).toBe('CONFIRMADO');
    expect(cobroDe(r)['pago']).toMatchObject({
      riel: 'api-baneco',
      confirmadoPor: 'automatico',
      monto: '150.50',
    });
    // Ni la clave del banco ni el id de su QR salen hacia el consumidor.
    expect(JSON.stringify(r.cuerpo)).not.toContain(referencia);
  });

  it('un cobro de otro consumidor es 404, no 403', async () => {
    // Un 403 confirmaría que ese cobro existe.
    const { ctx } = armar();
    const creado = await crear(ctx, TOKEN_A);
    const id = String(cobroDe(creado)['id']);

    const ajeno = await enrutar(ctx, verificador, pedir('GET', `/api/v1/cobros/${id}`, null, TOKEN_B));
    expect(ajeno.status).toBe(404);

    // Y la misma referencia, desde otro consumidor, tampoco lo encuentra.
    const porRef = await enrutar(
      ctx,
      verificador,
      pedir('GET', '/api/v1/cobros/por-referencia/plan-2026-09', null, TOKEN_B),
    );
    expect(porRef.status).toBe(404);
  });

  it('un cobro que no existe es 404', async () => {
    const { ctx } = armar();
    const r = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros/no-existe'));
    expect(r.status).toBe(404);
  });
});

describe('POST /api/v1/cobros/:id/anular', () => {
  it('anula y es idempotente: repetirlo no falla', async () => {
    const { ctx } = armar();
    const creado = await crear(ctx);
    const id = String(cobroDe(creado)['id']);

    const primera = await enrutar(ctx, verificador, pedir('POST', `/api/v1/cobros/${id}/anular`, {}));
    expect(primera.status).toBe(200);
    expect(cuerpoDe(primera)['resultado']).toBe('ANULADO');

    const segunda = await enrutar(ctx, verificador, pedir('POST', `/api/v1/cobros/${id}/anular`, {}));
    expect(segunda.status).toBe(200);
    expect(cuerpoDe(segunda)['resultado']).toBe('ANULADO');
  });

  it('un cobro pagado no se anula, y se distingue de "ya estaba anulado"', async () => {
    // El banco devuelve el mismo `responseCode 403` en los dos casos
    // (`02-hallazgos-produccion.md` §3.1). Acá llegan desambiguados.
    const { ctx, watcher, cobros } = armar();
    const creado = await crear(ctx);
    const id = String(cobroDe(creado)['id']);
    const guardado = await cobros.obtener(id);
    if (!esExito(guardado) || guardado.valor?.qrVigente == null) throw new Error('debería tener QR');
    const referencia = guardado.valor.qrVigente.referenciaProveedor;
    watcher.cargarAbono(
      referencia,
      registrarDeteccion({
        idDeduplicacion: `baneco:${referencia}:tx-1`,
        montoCentavos: monto(15_050),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await enrutar(ctx, verificador, pedir('POST', `/api/v1/cobros/${id}/anular`, {}));
    expect(r.status).toBe(409);
    expect(codigoDe(r)).toBe('PAGADO_NO_SE_ANULA');
  });

  it('no se puede anular el cobro de otro consumidor', async () => {
    const { ctx } = armar();
    const creado = await crear(ctx, TOKEN_A);
    const id = String(cobroDe(creado)['id']);

    const r = await enrutar(ctx, verificador, pedir('POST', `/api/v1/cobros/${id}/anular`, {}, TOKEN_B));
    expect(r.status).toBe(404);

    // Y el cobro del dueño de la referencia sigue vivo.
    const suyo = await enrutar(ctx, verificador, pedir('GET', `/api/v1/cobros/${id}`, null, TOKEN_A));
    expect(cobroDe(suyo)['estado']).toBe('QR_ACTIVO');
  });
});

describe('GET /api/v1/cobros', () => {
  it('lista solo los propios y solo los del rango', async () => {
    const { ctx } = armar();
    await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: 'ref-a1' });
    await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: 'ref-a2' });
    await crear(ctx, TOKEN_B, { ...COBRO, referenciaExterna: 'ref-b1' });

    const r = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, TOKEN_A));
    expect(r.status).toBe(200);
    const cobros = cuerpoDe(r)['cobros'] as Cuerpo[];
    expect(cobros.map((c) => c['referenciaExterna']).sort()).toEqual(['ref-a1', 'ref-a2']);
  });

  it('un rango que no incluye la fecha no devuelve nada', async () => {
    const { ctx } = armar();
    await crear(ctx);
    const r = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, TOKEN_A, {
      desde: '2026-01-01T00:00:00.000Z',
      hasta: '2026-02-01T00:00:00.000Z',
    }));
    expect((cuerpoDe(r)['cobros'] as Cuerpo[]).length).toBe(0);
  });

  it.each([
    ['fecha sin zona', { desde: '2026-08-01T00:00:00' }],
    ['fecha inventada', { desde: 'ayer' }],
    ['límite fuera de rango', { limite: '999' }],
  ])('rechaza %s con 400', async (_caso, consulta) => {
    const { ctx } = armar();
    const r = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, TOKEN_A, consulta));
    expect(r.status).toBe(400);
  });

  it('un rango dado vuelta o demasiado largo se rechaza', async () => {
    const { ctx } = armar();
    const alReves = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, TOKEN_A, {
      desde: '2026-08-10T00:00:00.000Z',
      hasta: '2026-08-01T00:00:00.000Z',
    }));
    expect(codigoDe(alReves)).toBe('RANGO_INVALIDO');

    const largo = await enrutar(ctx, verificador, pedir('GET', '/api/v1/cobros', null, TOKEN_A, {
      desde: '2025-01-01T00:00:00.000Z',
      hasta: '2026-01-01T00:00:00.000Z',
    }));
    expect(codigoDe(largo)).toBe('RANGO_DEMASIADO_LARGO');
  });
});

describe('la prueba controlada en producción alcanza también al contrato', () => {
  function conPrueba(maxQrs = 10) {
    const base = armar();
    const modo = leerModoPrueba({ PRUEBA_MAX_QRS: String(maxQrs) }, 'qr=mock watcher=mock');
    if (!esExito(modo)) throw new Error('modo de prueba inválido');
    return { ...base, ctx: { ...base.ctx, prueba: modo.valor } };
  }

  it('el contrato no es una puerta de atrás al tope de monto', async () => {
    const { ctx } = conPrueba();
    const caro = await crear(ctx);
    expect(caro.status).toBe(400);
    expect(codigoDe(caro)).toBe('MONTO_SOBRE_LIMITE_DE_PRUEBA');
  });

  it('ni al cupo de QRs de la corrida', async () => {
    const { ctx } = conPrueba(1);
    const primero = await crear(ctx, TOKEN_A, { ...COBRO, monto: '1.00', referenciaExterna: 'r1' });
    expect(primero.status).toBe(201);

    const segundo = await crear(ctx, TOKEN_A, { ...COBRO, monto: '1.00', referenciaExterna: 'r2' });
    expect(segundo.status).toBe(409);
    expect(codigoDe(segundo)).toBe('LIMITE_DE_PRUEBA');
  });
});

describe('rutas y métodos del contrato', () => {
  it.each([
    ['GET', '/api/v1/cobros/x/anular', 405],
    ['POST', '/api/v1/cobros/x', 405],
    ['POST', '/api/v1/cobros/x/qr', 405],
    ['POST', '/api/v1/cobros/por-referencia/x', 405],
    ['GET', '/api/v1/cobros/x/inventada', 404],
    ['GET', '/api/v1/cobros/x/y/z', 404],
    ['GET', '/api/v1/otra-cosa', 404],
  ])('%s %s responde %i', async (metodo, ruta, status) => {
    const { ctx } = armar();
    const r = await enrutar(ctx, verificador, pedir(metodo as Metodo, ruta, {}));
    expect([ruta, r.status]).toEqual([ruta, status]);
  });

  it('sin imagen guardada, el QR no se sirve', async () => {
    const { ctx } = armar();
    const creado = await crear(ctx);
    const id = String(cobroDe(creado)['id']);
    const r = await enrutar(ctx, verificador, pedir('GET', `/api/v1/cobros/${id}/qr`));
    expect(r.status).toBe(404);
    expect(codigoDe(r)).toBe('SIN_IMAGEN');
  });
});

describe('cupo por consumidor y por hora', () => {
  function conCupo(porHora: number) {
    const base = armar();
    return {
      ...base,
      ctx: { ...base.ctx, cupoConsumidores: cupoDeConsumidores({ CONSUMIDOR_MAX_QRS_POR_HORA: String(porHora) }) },
    };
  }

  it('corta el bucle de QRs de un token filtrado', async () => {
    // Cada QR queda pagable hasta la medianoche (C4): cientos vivos no se
    // alcanzan a anular de a uno. Es T10 a escala.
    const { ctx } = conCupo(2);
    for (const ref of ['r1', 'r2']) {
      const r = await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: ref });
      expect([ref, r.status]).toEqual([ref, 201]);
    }
    const tercero = await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: 'r3' });
    expect(tercero.status).toBe(429);
    expect(codigoDe(tercero)).toBe('CUPO_POR_HORA_AGOTADO');
  });

  it('el cupo es de cada consumidor, no compartido', async () => {
    const { ctx } = conCupo(1);
    expect((await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: 'r1' })).status).toBe(201);
    expect((await crear(ctx, TOKEN_A, { ...COBRO, referenciaExterna: 'r2' })).status).toBe(429);
    // El otro consumidor no paga el bucle del primero.
    expect((await crear(ctx, TOKEN_B, { ...COBRO, referenciaExterna: 'r3' })).status).toBe(201);
  });
});

describe('lo que el contrato no filtra hacia afuera', () => {
  it('un rechazo del banco no le cuenta al consumidor qué banco hay detrás', async () => {
    // La consola sí recibe el detalle técnico, para diagnosticar. Un tercero
    // no: `generateQR` y su `responseCode` son de la API de Baneco, y el
    // contrato se vendió como "sin conocer nada del banco" (docs/10 §7).
    const base = armar();
    const rechaza: QrProvider = {
      emitir: () =>
        Promise.resolve(
          fallo({
            tipo: 'RECHAZADO_POR_PROVEEDOR',
            mensaje: 'generateQR rechazado por el banco',
            reintentable: false,
            codigoProveedor: '99',
          }),
        ),
      anular: () => Promise.resolve(exito(undefined)),
    };
    const ctx = { ...base.ctx, deps: { ...base.ctx.deps, qr: rechaza } };

    const r = await crear(ctx, TOKEN_A);
    expect(r.status).toBe(502);
    const texto = JSON.stringify(r.cuerpo);
    expect(texto).not.toContain('generateQR');
    expect(texto).not.toContain('99');
    expect((r.cuerpo as { error: Record<string, unknown> }).error['detalle']).toBeUndefined();
  });
});

describe('la anulación de un consumidor queda atribuida', () => {
  it('no se firma como una acción del dueño, y el consumidor no puede borrar quién fue', async () => {
    // `accion-manual` es el único origen que produce una persona, y la
    // evidencia es lo único que después explica por qué murió un QR.
    const { ctx, evidencia } = armar();
    const creadoR = await crear(ctx);
    const id = String(cobroDe(creadoR)['id']);

    await enrutar(
      ctx,
      verificador,
      pedir('POST', `/api/v1/cobros/${id}/anular`, { motivo: 'el cliente canceló el plan' }),
    );

    const registros = await evidencia.listarDeCobro(id);
    if (!esExito(registros)) throw new Error('debería haber evidencia');
    const anulacion = registros.valor.find((r) => r.evento === 'ANULADO');
    expect(anulacion?.origen).toBe('contrato-consumidor');
    expect(String(anulacion?.datos['motivo'])).toContain('consumidor:novuchat');
    expect(String(anulacion?.datos['motivo'])).toContain('el cliente canceló el plan');
  });
});

describe('la referencia externa no llega al disco', () => {
  it('la ruta que la lleva se registra anonimizada', async () => {
    // El query string nunca se registra, pero esta referencia va en la ruta, y
    // el enmascarado de la bitácora no cubre un celular boliviano de 8 dígitos.
    const { ctx } = armar();
    const registro = new RegistroEventos(() => AHORA);
    const servidor = crearServidor({
      ctx: { ...ctx, registro },
      verificador,
      origenPermitido: 'http://localhost:5173',
      registro,
    });

    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const direccion = servidor.address();
    const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : 0;
    await fetch(`http://127.0.0.1:${String(puerto)}/api/v1/cobros/por-referencia/cliente-71234567`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    await new Promise<void>((resolver) => servidor.close(() => { resolver(); }));

    const lineas = registro.listar().map((l) => l.texto).join('\n');
    expect(lineas).toContain('/api/v1/cobros/por-referencia/***');
    expect(lineas).not.toContain('71234567');
  });
});
