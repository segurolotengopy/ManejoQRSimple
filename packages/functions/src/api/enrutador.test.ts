import {
  AbonosSinConciliarEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  centavos,
  esExito,
  registrarDeteccion,
  vigilar,
  exito,
  fallo,
  type Centavos,
  type QrProvider,
} from '@mqs/qr-core';

import { leerModoPrueba } from '../modo-prueba.js';
import { RegistroEventos } from '../registro.js';
import { describe, expect, it } from 'vitest';

import { enrutar, type VerificadorDeToken } from './enrutador.js';
import type { ContextoApi } from './handlers.js';
import type { Metodo, Peticion } from './tipos.js';

const AHORA = new Date('2026-08-28T12:00:00.000Z');
const TOKEN = 'token-de-prueba-suficientemente-largo';

const aceptaTodo: VerificadorDeToken = (t) =>
  Promise.resolve(t === TOKEN ? { tipo: 'dueño', id: 'dueño' } : null);

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
  const abonosSinConciliar = new AbonosSinConciliarEnMemoria();

  const ctx: ContextoApi = {
    abonosSinConciliar,
    deps: {
      cobros,
      evidencia,
      // El mismo reloj que la API: con el real, el QR se emite después de
      // la fecha fija en que vence.
      qr: new QrProviderEnMemoria(() => AHORA),
      watcher,
      mensajeria,
      politica: POLITICA_POR_DEFECTO,
    },
    evidencia,
    horasDeVigenciaPorDefecto: 72,
    ahora: () => AHORA,
  };
  return { ctx, watcher, mensajeria, evidencia, abonosSinConciliar };
}

function pedir(
  metodo: Metodo,
  ruta: string,
  cuerpo: unknown = null,
  token: string | null = TOKEN,
  consulta: Readonly<Record<string, string>> = {},
): Peticion {
  return { metodo, ruta, consulta, cuerpo, token };
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
    ['GET', '/api/revision'],
    ['POST', '/api/cobros/x/resolver'],
    ['POST', '/api/cobros/x/buscar-abono'],
    ['GET', '/api/pruebas'],
    ['POST', '/api/pruebas/qr'],
    ['POST', '/api/pruebas/cerrar'],
    ['GET', '/api/cobros/x/qr'],
    ['POST', '/api/cobros/x/sondear-anulacion'],
    ['POST', '/api/abonos/x/cerrar'],
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

  it('no anula un cobro que el banco reporta pagado: 409 ABONO_DETECTADO', async () => {
    // Anularlo dejaría la plata acreditada y el cobro muerto.
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
        montoCentavos: monto(15_050),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );

    const r = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/anular`, { motivo: 'x' }));
    expect(r.status).toBe(409);
    expect((r.cuerpo as { error: { codigo: string } }).error.codigo).toBe('ABONO_DETECTADO');
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

describe('revisión manual por la API', () => {
  /** Un cobro con abono por un centavo menos: en revisión y confirmable. */
  async function casoConAbono(ctx: ContextoApi, watcher: PaymentWatcherEnMemoria) {
    const { id, cuerpo } = await crear(ctx);
    const referencia = String((cuerpo['qrVigente'] as Record<string, unknown>)['referenciaProveedor']);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    watcher.cargarAbono(
      referencia,
      registrarDeteccion({
        idDeduplicacion: `baneco:${referencia}:tx-1`,
        montoCentavos: monto(15_049),
        ocurridoEn: AHORA,
        origen: 'watcher-baneco',
        referencia: null,
      }),
    );
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/verificar`));
    return { id, referencia };
  }

  /** Un comprobante que el banco nunca vio: en revisión y sin nada que aceptar. */
  async function casoSinAbono(ctx: ContextoApi) {
    const { id, cuerpo } = await crear(ctx);
    const referencia = String((cuerpo['qrVigente'] as Record<string, unknown>)['referenciaProveedor']);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/comprobante`, { referenciaComprobante: 'wa-1' }));
    const guardado = await ctx.deps.cobros.obtener(id);
    if (!esExito(guardado) || guardado.valor === null) throw new Error('el cobro debería existir');
    // El satélite, pasadas las 72 h: anula el QR y lo manda a revisión.
    await vigilar(ctx.deps, guardado.valor, new Date(AHORA.getTime() + 73 * 3_600_000));
    return { id, referencia };
  }

  it('GET /api/revision muestra el caso con su motivo, el abono y si es confirmable', async () => {
    const { ctx, watcher } = armar();
    await casoConAbono(ctx, watcher);

    const r = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/revision'));
    expect(r.status).toBe(200);
    const cuerpo = r.cuerpo as { casos: Record<string, unknown>[]; resumen: Record<string, number> };
    expect(cuerpo.resumen['total']).toBe(1);
    expect(cuerpo.casos[0]).toMatchObject({ motivo: 'MONTO_NO_COINCIDE', confirmable: true, abono: { monto: '150.49' } });
    // El teléfono sale enmascarado también acá (regla #9).
    expect(JSON.stringify(cuerpo)).not.toContain('+59171234567');
  });

  it('resolver exige un motivo de verdad, no un "ok"', async () => {
    const { ctx, watcher } = armar();
    const { id } = await casoConAbono(ctx, watcher);
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/resolver`, { decision: 'CONFIRMADO', motivo: 'ok' }));
    expect(r.status).toBe(400);
  });

  it('confirmar acepta el abono del banco que se vio en pantalla', async () => {
    const { ctx, watcher } = armar();
    const { id, referencia } = await casoConAbono(ctx, watcher);
    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/cobros/${id}/resolver`, {
        decision: 'CONFIRMADO',
        idDeduplicacion: `baneco:${referencia}:tx-1`,
        motivo: 'se acepta el centavo de diferencia',
      }),
    );
    expect(r.status).toBe(200);
    expect((r.cuerpo as Record<string, unknown>)['estado']).toBe('CONFIRMADO');
  });

  it('sin abono del banco no se confirma: 409 SIN_DETECCION_DEL_BANCO', async () => {
    const { ctx } = armar();
    const { id } = await casoSinAbono(ctx);
    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/cobros/${id}/resolver`, {
        decision: 'CONFIRMADO',
        idDeduplicacion: 'wa-1',
        motivo: 'el cliente mandó el comprobante',
      }),
    );
    expect(r.status).toBe(409);
    expect((r.cuerpo as { error: { codigo: string } }).error.codigo).toBe('SIN_DETECCION_DEL_BANCO');
  });

  it('buscar-abono pregunta al banco y, si aparece el pago, lo adjunta', async () => {
    const { ctx, watcher } = armar();
    const { id, referencia } = await casoSinAbono(ctx);

    const antes = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/buscar-abono`));
    expect((antes.cuerpo as Record<string, unknown>)['encontrado']).toBe(false);

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
    const despues = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/buscar-abono`));
    expect((despues.cuerpo as Record<string, unknown>)['encontrado']).toBe(true);
  });
});

describe('prueba controlada en producción', () => {
  function conPrueba(maxQrs = 10) {
    const base = armar();
    const modo = leerModoPrueba({ PRUEBA_MAX_QRS: String(maxQrs) }, 'qr=mock watcher=mock');
    if (!esExito(modo)) throw new Error('modo de prueba inválido');
    return { ...base, ctx: { ...base.ctx, prueba: modo.valor } };
  }

  const cuerpoDe = (r: { cuerpo: unknown }) => r.cuerpo as Record<string, unknown>;
  const codigoDe = (r: { cuerpo: unknown }) => (r.cuerpo as { error: { codigo: string } }).error.codigo;

  async function qrDePrueba(ctx: ContextoApi): Promise<string> {
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/qr', { vigenciaMinutos: 5 }));
    return String((cuerpoDe(r)['cobro'] as Record<string, unknown>)['id']);
  }

  it('sin modo prueba, las rutas de prueba no existen', async () => {
    const { ctx } = armar();
    expect((await enrutar(ctx, aceptaTodo, pedir('GET', '/api/pruebas'))).status).toBe(404);
    expect((await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/qr', {}))).status).toBe(404);
  });

  it('muestra los topes que fija el servidor', async () => {
    const r = await enrutar(conPrueba().ctx, aceptaTodo, pedir('GET', '/api/pruebas'));
    expect(r.status).toBe(200);
    expect(cuerpoDe(r)).toMatchObject({ activo: true, monto: '1.00', maxQrs: 10, restantes: 10 });
  });

  it('genera un QR por el monto de prueba y lo suma a la corrida', async () => {
    const { ctx } = conPrueba();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/qr', { vigenciaMinutos: 5 }));
    expect(r.status).toBe(201);
    expect(cuerpoDe(r)['cobro']).toMatchObject({ estado: 'QR_ACTIVO', monto: '1.00' });
    // El mock no devuelve imagen; el adaptador de Baneco sí.
    expect(cuerpoDe(r)['imagen']).toBeNull();

    const estado = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/pruebas'));
    expect(cuerpoDe(estado)).toMatchObject({ restantes: 9 });
    expect(cuerpoDe(estado)['cobros']).toHaveLength(1);
  });

  it('no pasa del tope de QRs de la corrida', async () => {
    const { ctx } = conPrueba(1);
    await qrDePrueba(ctx);
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/qr', {}));
    expect(r.status).toBe(409);
    expect(codigoDe(r)).toBe('LIMITE_DE_PRUEBA');
  });

  it('el formulario común tampoco supera el monto de prueba', async () => {
    const { ctx } = conPrueba();
    const caro = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', COBRO_VALIDO));
    expect(caro.status).toBe(400);
    expect(codigoDe(caro)).toBe('MONTO_SOBRE_LIMITE_DE_PRUEBA');

    const justo = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', { ...COBRO_VALIDO, monto: '1.00' }));
    expect(justo.status).toBe(201);
  });

  it('cerrar la prueba anula en el banco lo que no se pagó', async () => {
    const { ctx } = conPrueba();
    await qrDePrueba(ctx);
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/cerrar', {}));
    expect(r.status).toBe(200);
    expect((cuerpoDe(r)['resultados'] as { resultado: string }[])[0]?.resultado).toBe('ANULADO');
  });

  it('el sondeo de anulación solo va sobre QRs que nadie va a pagar', async () => {
    const { ctx } = conPrueba();
    const id = await qrDePrueba(ctx);

    const vivo = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/sondear-anulacion`, {}));
    expect(vivo.status).toBe(409);
    expect(codigoDe(vivo)).toBe('NO_SONDEABLE');

    await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/cerrar', {}));
    const anulado = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/sondear-anulacion`, {}));
    expect(anulado.status).toBe(200);
    expect(cuerpoDe(anulado)).toMatchObject({ anulado: true, detalle: null });
  });

  it('un cobro que no es de la corrida no se sondea', async () => {
    const { ctx } = conPrueba();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros/ajeno/sondear-anulacion', {}));
    expect(r.status).toBe(404);
    expect(codigoDe(r)).toBe('NO_ES_DE_PRUEBA');
  });

  it('el formulario común también consume cupo y entra en la corrida', async () => {
    // Si no, se podrían emitir QRs reales sin tope y "Cerrar la prueba" no los vería.
    const { ctx } = conPrueba(1);
    const creado = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', { ...COBRO_VALIDO, monto: '1.00' }));
    expect(creado.status).toBe(201);

    const otro = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/pruebas/qr', {}));
    expect(codigoDe(otro)).toBe('LIMITE_DE_PRUEBA');
    const estado = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/pruebas'));
    expect(cuerpoDe(estado)['cobros']).toEqual([cuerpoDe(creado)['id']]);
  });

  it('la vigencia de un cobro común queda topeada en 24 h', async () => {
    const { ctx } = conPrueba();
    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', '/api/cobros', { ...COBRO_VALIDO, monto: '1.00', horasDeVigencia: 24 * 30 }),
    );
    const qr = cuerpoDe(r)['qrVigente'] as { venceEn: string };
    expect(new Date(qr.venceEn).getTime() - AHORA.getTime()).toBe(24 * 3_600_000);
  });

  it('informa la hora del servidor, para no depender del reloj del navegador', async () => {
    const r = await enrutar(conPrueba().ctx, aceptaTodo, pedir('GET', '/api/pruebas'));
    expect(cuerpoDe(r)['ahora']).toBe(AHORA.toISOString());
  });

  it('sin imagen guardada, el QR no se sirve', async () => {
    const { ctx } = conPrueba();
    const id = await qrDePrueba(ctx);
    const r = await enrutar(ctx, aceptaTodo, pedir('GET', `/api/cobros/${id}/qr`));
    expect(r.status).toBe(404);
    expect(codigoDe(r)).toBe('SIN_IMAGEN');
  });

  it('un rechazo del banco trae el detalle técnico para diagnosticar', async () => {
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

    const r = await enrutar(ctx, aceptaTodo, pedir('POST', '/api/cobros', COBRO_VALIDO));
    expect(r.status).toBe(502);
    expect((r.cuerpo as { error: { detalle: unknown } }).error.detalle).toEqual({
      tipo: 'RECHAZADO_POR_PROVEEDOR',
      codigoProveedor: '99',
      mensajeTecnico: 'generateQR rechazado por el banco',
    });
  });
});

describe('GET /api/logs', () => {
  it('sin registro no hay logs', async () => {
    expect((await enrutar(armar().ctx, aceptaTodo, pedir('GET', '/api/logs'))).status).toBe(404);
  });

  it('devuelve las líneas del registro, ya saneadas', async () => {
    const registro = new RegistroEventos(() => AHORA);
    registro.agregar('aviso', 'banco', 'POST /api/qrsimple/generateQR → HTTP 200 · responseCode 57 · 90 ms');
    const r = await enrutar({ ...armar().ctx, registro }, aceptaTodo, pedir('GET', '/api/logs'));
    expect(r.status).toBe(200);
    expect((r.cuerpo as { lineas: { texto: string }[] }).lineas[0]?.texto).toContain('responseCode 57');
  });

  it('también exige token', async () => {
    const r = await enrutar(armar().ctx, aceptaTodo, pedir('GET', '/api/logs', null, null));
    expect(r.status).toBe(401);
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
  it('muestra también el cobro recién creado, que todavía no es "pendiente"', async () => {
    // Es la diferencia entre la pregunta de la consola y la del satélite: un
    // cobro en QR_ACTIVO no lo mira el watcher, pero quien acaba de crearlo
    // necesita verlo — si no, crear un cobro parecería no hacer nada.
    const { ctx } = armar();
    const { id } = await crear(ctx);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/enviar`));
    const otro = await crear(ctx); // queda en QR_ACTIVO

    const r = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/cobros'));
    const cuerpo = r.cuerpo as { cobros: { id: string }[] };
    const ids = cuerpo.cobros.map((c) => c.id);

    expect(ids).toContain(id);
    expect(ids).toContain(otro.id);
  });

  it('incluye los terminales: la consola muestra el historial reciente', async () => {
    const { ctx } = armar();
    const { id } = await crear(ctx);
    await enrutar(ctx, aceptaTodo, pedir('POST', `/api/cobros/${id}/anular`, { motivo: 'x' }));

    const r = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/cobros'));
    const cuerpo = r.cuerpo as { cobros: { id: string; estado: string }[] };
    expect(cuerpo.cobros.find((c) => c.id === id)?.estado).toBe('ANULADO');
  });
});

describe('abonos sin conciliar por la API', () => {
  const ID = 'baneco:qr-de-nadie:tx-9';

  async function conAbonoHuerfano() {
    const base = armar();
    await base.abonosSinConciliar.registrar({
      idDeduplicacion: ID,
      motivo: 'HUERFANO',
      cobroId: null,
      montoCentavos: monto(500),
      ocurridoEn: new Date(AHORA.getTime() - 20 * 3_600_000),
      origen: 'watcher-baneco',
      registradoEn: new Date(AHORA.getTime() - 5 * 3_600_000),
      resolucion: null,
    });
    return base;
  }

  it('la cola de revisión los muestra y las alertas los cuentan', async () => {
    const { ctx } = await conAbonoHuerfano();
    const r = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/revision'));
    expect(r.status).toBe(200);
    const cuerpo = r.cuerpo as { abonos: Record<string, unknown>[]; resumen: Record<string, number> };
    expect(cuerpo.abonos).toEqual([
      {
        idDeduplicacion: ID,
        motivo: 'HUERFANO',
        cobroId: null,
        cobroEstado: null,
        yaRegistradoEnElCobro: false,
        monto: '5.00',
        ocurridoEn: '2026-08-27T16:00:00.000Z',
        registradoEn: '2026-08-28T07:00:00.000Z',
        horasAbierto: 5,
        nivel: 'ATRASADO',
      },
    ]);
    expect(cuerpo.resumen).toEqual({ total: 1, criticos: 0, atrasados: 1 });
  });

  it('cerrar con motivo lo saca de la cola', async () => {
    const { ctx } = await conAbonoHuerfano();
    const r = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/abonos/${encodeURIComponent(ID)}/cerrar`, { motivo: 'Devuelto al pagador por transferencia' }),
    );
    expect(r.status).toBe(200);
    const cola = await enrutar(ctx, aceptaTodo, pedir('GET', '/api/revision'));
    expect((cola.cuerpo as { abonos: unknown[] }).abonos).toEqual([]);

    // Una segunda resolución no pisa la primera.
    const otraVez = await enrutar(
      ctx,
      aceptaTodo,
      pedir('POST', `/api/abonos/${encodeURIComponent(ID)}/cerrar`, { motivo: 'Otra decisión distinta' }),
    );
    expect(otraVez.status).toBe(409);
  });

  it('sin motivo suficiente no se cierra', async () => {
    const { ctx } = await conAbonoHuerfano();
    const r = await enrutar(ctx, aceptaTodo, pedir('POST', `/api/abonos/${encodeURIComponent(ID)}/cerrar`, { motivo: 'ok' }));
    expect(r.status).toBe(400);
  });

  it('rutas que no son de un abono responden 404, y otro método 405', async () => {
    const { ctx } = await conAbonoHuerfano();
    const casos: [Metodo, string, number][] = [
      ['POST', '/api/abonos/baneco%3Aqr-z%3Atx-1/cerrar', 404],
      ['POST', `/api/abonos/${encodeURIComponent('a/../b')}/cerrar`, 404],
      ['POST', '/api/abonos/%E0%A4%A/cerrar', 404],
      ['POST', `/api/abonos/${encodeURIComponent(ID)}/reabrir`, 404],
      ['GET', `/api/abonos/${encodeURIComponent(ID)}/cerrar`, 405],
    ];
    for (const [metodo, ruta, status] of casos) {
      const r = await enrutar(ctx, aceptaTodo, pedir(metodo, ruta, { motivo: 'Devuelto al pagador' }));
      expect([ruta, r.status]).toEqual([ruta, status]);
    }
  });
});
