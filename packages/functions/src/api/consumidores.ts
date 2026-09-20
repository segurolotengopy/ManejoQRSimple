/**
 * Los handlers del contrato para proyectos consumidores (docs/10).
 *
 * Cuatro operaciones y ninguna más: crear un cobro, preguntar su estado,
 * anularlo y listar los propios. **No existe una operación que confirme un
 * pago**, y su ausencia es el contrato: lo que un consumidor diga sobre un
 * pago vale lo mismo que el comprobante que manda un pagador (reglas #1 y
 * BANECO-1). Solo la consulta saliente autenticada al banco transiciona un
 * cobro, y eso lo hace el satélite.
 *
 * Dos invariantes que esta capa hace cumplir en **todas** las rutas:
 *
 * 1. **Un consumidor solo ve y toca lo suyo.** Un cobro de otro consumidor —o
 *    del dueño— responde 404, no 403: un 403 confirmaría que ese cobro existe.
 * 2. **Los topes de la prueba en producción valen acá también.** Todo QR que
 *    se le pide al banco consume cupo, venga de la consola o del contrato; si
 *    no, el contrato sería una puerta de atrás a la barrera T11.
 */

import {
  aDecimalBob,
  anular as anularCobro,
  crearCobroDeConsumidor,
  desdeDecimalBob,
  esDelConsumidor,
  esExito,
  idDeCobroDeConsumidor,
  pagoDeCobro,
  type Cobro,
  type OrigenDeteccion,
  type PagoDeCobro,
} from '@mqs/qr-core';

import {
  comoHttp,
  consumirCupo,
  horasPermitidas,
  imagenDe,
  type ContextoApi,
} from './handlers.js';
import {
  consultaListado,
  cuerpoAnularConsumidor,
  cuerpoCrearCobroConsumidor,
  referenciaExterna as esquemaReferencia,
} from './esquemas.js';
import { creado, error, noEncontrado, ok, type Respuesta } from './tipos.js';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** Rango por defecto de `listarCobros` y tope de lo que se puede pedir. */
const RANGO_POR_DEFECTO_DIAS = 7;
const RANGO_MAXIMO_DIAS = 92;
const LIMITE_POR_DEFECTO = 50;

/**
 * Nombres del riel hacia afuera.
 *
 * Se traducen en vez de exponer los del dominio: `watcher-baneco` describe
 * nuestra implementación, y un contrato que la filtra no se puede refactorizar
 * sin romperle el código a quien lo consume.
 */
const RIEL_PUBLICO: Readonly<Record<OrigenDeteccion, string>> = {
  'watcher-baneco': 'api-baneco',
  'scraper-yape': 'scraping-yape',
};

/**
 * Lo que un consumidor ve de su cobro.
 *
 * Es una vista aparte de la de la consola, no un filtro sobre ella: acá no hay
 * `telefonoCliente` (no existe), ni `referenciaProveedor` del banco, ni la
 * clave de deduplicación del abono. El consumidor concilia contra su propia
 * referencia externa; los identificadores del banco no le hacen falta y no se
 * mandan (regla #4).
 */
function aVistaConsumidor(cobro: Cobro, pago: PagoDeCobro | null): Record<string, unknown> {
  return {
    id: cobro.id,
    referenciaExterna: cobro.consumidor?.referenciaExterna ?? null,
    estado: cobro.estado,
    monto: aDecimalBob(cobro.montoCentavos),
    moneda: cobro.moneda,
    concepto: cobro.concepto,
    creadoEn: cobro.creadoEn.toISOString(),
    qr:
      cobro.qrVigente === null
        ? null
        : {
            version: cobro.qrVigente.qrVersion,
            venceEn: cobro.qrVigente.venceEn.toISOString(),
            // El banco entrega el QR como imagen PNG y no como texto EMV: no
            // hay un `texto` que mandar sin decodificar el PNG, y este
            // proyecto no inventa lo que el proveedor no da (docs/10 §6).
            imagenDisponible: cobro.qrVigente.imagenRef !== null,
          },
    pago:
      pago === null
        ? null
        : {
            confirmadoEn: pago.confirmadoEn.toISOString(),
            ocurridoEn: pago.ocurridoEn?.toISOString() ?? null,
            monto: pago.montoCentavos === null ? null : aDecimalBob(pago.montoCentavos),
            riel: pago.riel === null ? null : RIEL_PUBLICO[pago.riel],
            confirmadoPor: pago.confirmadoPor === 'accion-manual' ? 'revision-manual' : 'automatico',
          },
  };
}

/**
 * Forma del id de un cobro de consumidor: `cons-` más el SHA-256 en hexa.
 *
 * Se valida antes de ir a la base y no solo por prolijidad: el id llega en la
 * ruta, y un `..` o un `/` codificado le hace lanzar a `doc()` de Firestore,
 * que saldría como 502 en vez del 404 que corresponde.
 */
const ID_DE_CONSUMIDOR = /^cons-[0-9a-f]{64}$/;

/**
 * El cobro de **este** consumidor, o la respuesta de error.
 *
 * Un cobro que existe pero es de otro devuelve `noEncontrado()`, igual que uno
 * que no existe: la diferencia entre "no existe" y "no es tuyo" es
 * información, y no es suya.
 */
async function suCobro(
  ctx: ContextoApi,
  consumidorId: string,
  id: string,
): Promise<Cobro | Respuesta> {
  if (!ID_DE_CONSUMIDOR.test(id)) {
    return noEncontrado();
  }
  const encontrado = await ctx.deps.cobros.obtener(id);
  if (!esExito(encontrado)) {
    return comoHttpParaConsumidor({ tipo: 'PUERTO', error: encontrado.error });
  }
  const cobro = encontrado.valor;
  if (cobro === null || !esDelConsumidor(cobro, consumidorId)) {
    return noEncontrado();
  }
  return cobro;
}

/**
 * Traduce un error del dominio a HTTP **sin el detalle técnico**.
 *
 * `comoHttp` adjunta el tipo de falla, el `responseCode` y el mensaje técnico
 * del proveedor: sirve para que el dueño diagnostique en su consola. Hacia un
 * consumidor eso filtra qué banco hay detrás y sus códigos internos, que es
 * justo lo que el contrato promete no contar (docs/10 §7) — y lo que después
 * vuelve imposible cambiar de proveedor sin romperle el código a un tercero.
 */
function comoHttpParaConsumidor(err: Parameters<typeof comoHttp>[0]): Respuesta {
  const respuesta = comoHttp(err);
  const cuerpo = respuesta.cuerpo;
  if (typeof cuerpo !== 'object' || cuerpo === null || !('error' in cuerpo)) {
    return respuesta;
  }
  const { error: original } = cuerpo as { error: Record<string, unknown> };
  const { detalle: _descartado, ...publico } = original;
  return { status: respuesta.status, cuerpo: { error: publico } };
}

const esRespuesta = (v: Cobro | Respuesta): v is Respuesta => 'status' in v;

/** El pago del cobro, si está confirmado. Lee la evidencia solo cuando hace falta. */
async function pagoDe(ctx: ContextoApi, cobro: Cobro): Promise<PagoDeCobro | null> {
  if (cobro.estado !== 'CONFIRMADO') {
    return null;
  }
  const registros = await ctx.evidencia.listarDeCobro(cobro.id);
  return esExito(registros) ? pagoDeCobro(registros.valor) : null;
}

/**
 * `POST /api/v1/cobros` — crea el cobro y le emite el QR.
 *
 * Idempotente por referencia externa: el mismo pedido dos veces devuelve el
 * mismo cobro y un solo QR, con 200 en lugar de 201. Es lo que impide que un
 * reintento del consumidor le cobre dos veces a su cliente.
 */
export async function crearCobro(
  ctx: ContextoApi,
  consumidorId: string,
  cuerpo: unknown,
): Promise<Respuesta> {
  const datos = cuerpoCrearCobroConsumidor.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const monto = desdeDecimalBob(datos.data.monto);
  if (!esExito(monto)) {
    return error(400, 'MONTO_INVALIDO', 'El monto no es representable en centavos enteros.');
  }
  if (ctx.prueba !== undefined && monto.valor > ctx.prueba.montoCentavos) {
    return error(
      400,
      'MONTO_SOBRE_LIMITE_DE_PRUEBA',
      `En la prueba en producción el monto máximo es Bs ${aDecimalBob(ctx.prueba.montoCentavos)}.`,
    );
  }

  const ahora = ctx.ahora();
  const horas = horasPermitidas(ctx, datos.data.horasDeVigencia);

  // Tope por consumidor y por hora. Cada QR emitido queda pagable hasta la
  // medianoche (C4): un bucle con un token filtrado dejaría cientos vivos que
  // no se alcanzan a anular (T10 a escala).
  if (ctx.cupoConsumidores !== undefined && !ctx.cupoConsumidores.consumir(consumidorId, ahora)) {
    return error(
      429,
      'CUPO_POR_HORA_AGOTADO',
      `Este consumidor ya pidió ${String(ctx.cupoConsumidores.porHora)} QRs en la última hora. Esperá y reintentá.`,
    );
  }

  // El cupo de la prueba en producción se consume antes de llamar al dominio,
  // como en la consola: cuenta el intento de pedirle un QR al banco, salga o
  // no. Un reintento idempotente que devuelve el cobro existente no llega a
  // pedir nada, pero tampoco se puede saber de antemano sin leer, así que se
  // cuenta igual: el tope es de la prueba y pasarse de estricto es el lado
  // seguro.
  const sinCupo = consumirCupo(ctx);
  if (sinCupo !== null) {
    return sinCupo;
  }

  const resultado = await crearCobroDeConsumidor(
    ctx.deps,
    {
      consumidorId,
      referenciaExterna: datos.data.referenciaExterna,
      montoCentavos: monto.valor,
      concepto: datos.data.concepto,
      venceEn: new Date(ahora.getTime() + horas * HORA_MS),
      proveedor: 'baneco',
    },
    ahora,
  );
  if (!esExito(resultado)) {
    return comoHttpParaConsumidor(resultado.error);
  }

  const { cobro } = resultado.valor;
  // Sin el `includes`, un reintento idempotente anotaría el mismo cobro dos
  // veces en la corrida y el cierre de la prueba lo recorrería repetido.
  if (ctx.prueba !== undefined && !ctx.prueba.corrida.cobros.includes(cobro.id)) {
    ctx.prueba.corrida.cobros.push(cobro.id);
  }

  const cuerpoRespuesta = {
    cobro: aVistaConsumidor(cobro, await pagoDe(ctx, cobro)),
    // La imagen viene en la creación para que el consumidor la tenga en una
    // sola llamada: es lo que va a mostrarle a quien paga.
    imagenQrBase64: await imagenDe(ctx, cobro),
  };
  return resultado.valor.creado ? creado(cuerpoRespuesta) : ok(cuerpoRespuesta);
}

/** `GET /api/v1/cobros/:id` — estado del cobro y, si está pagado, cuándo y por qué riel. */
export async function verCobro(
  ctx: ContextoApi,
  consumidorId: string,
  id: string,
): Promise<Respuesta> {
  const cobro = await suCobro(ctx, consumidorId, id);
  if (esRespuesta(cobro)) return cobro;
  return ok({ cobro: aVistaConsumidor(cobro, await pagoDe(ctx, cobro)) });
}

/**
 * `GET /api/v1/cobros/por-referencia/:referencia` — lo mismo, por la referencia
 * del consumidor.
 *
 * No consulta por referencia: **deriva el id** y lee por id. La referencia es
 * la clave de la que sale el id, así que esta es la respuesta exacta y no una
 * búsqueda que podría discrepar de la derivación. De paso hereda de `suCobro`
 * el mismo 404 para "no existe" y para "no es tuyo".
 */
export async function verCobroPorReferencia(
  ctx: ContextoApi,
  consumidorId: string,
  referencia: string,
): Promise<Respuesta> {
  const validada = esquemaReferencia.safeParse(referencia);
  if (!validada.success) {
    return noEncontrado();
  }
  const cobro = await suCobro(ctx, consumidorId, idDeCobroDeConsumidor(consumidorId, validada.data));
  if (esRespuesta(cobro)) return cobro;
  return ok({ cobro: aVistaConsumidor(cobro, await pagoDe(ctx, cobro)) });
}

/** `GET /api/v1/cobros/:id/qr` — la imagen PNG del QR vigente, en base64. */
export async function verQr(
  ctx: ContextoApi,
  consumidorId: string,
  id: string,
): Promise<Respuesta> {
  const cobro = await suCobro(ctx, consumidorId, id);
  if (esRespuesta(cobro)) return cobro;

  const png = await imagenDe(ctx, cobro);
  return png === null
    ? error(404, 'SIN_IMAGEN', 'Este cobro no tiene la imagen del QR guardada.')
    : ok({ imagenQrBase64: png, venceEn: cobro.qrVigente?.venceEn.toISOString() ?? null });
}

/**
 * `POST /api/v1/cobros/:id/anular`.
 *
 * Distingue los tres desenlaces que al banco le salen con el mismo código
 * (`responseCode 403` tanto para un QR ya anulado como para uno pagado —
 * `02-hallazgos-produccion.md` §3.1). Acá llegan desambiguados porque el
 * adaptador ya consultó el estado:
 *
 * - **200 `ANULADO`**: el QR quedó muerto en el banco. Repetirlo sobre un
 *   cobro ya anulado devuelve lo mismo, para que un reintento sea inofensivo.
 * - **409 `PAGADO_NO_SE_ANULA`**: hay plata. No se anula nada.
 * - **409 `PAGO_TARDIO_EN_REVISION`**: llegó un pago sobre el QR vencido; el
 *   cobro pasó a revisión manual y lo decide una persona.
 *
 * Los dos últimos son errores y no un `resultado` en un 200 a propósito: un
 * consumidor que solo mira el código HTTP tiene que enterarse de que **no**
 * anuló, no creer que sí.
 */
export async function anular(
  ctx: ContextoApi,
  consumidorId: string,
  id: string,
  cuerpo: unknown,
): Promise<Respuesta> {
  const datos = cuerpoAnularConsumidor.safeParse(cuerpo ?? {});
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const cobro = await suCobro(ctx, consumidorId, id);
  if (esRespuesta(cobro)) return cobro;

  if (cobro.estado === 'ANULADO') {
    // Ya estaba: un reintento después de un timeout no puede fallar.
    return ok({ resultado: 'ANULADO', cobro: aVistaConsumidor(cobro, null) });
  }
  if (cobro.estado === 'CONFIRMADO') {
    return error(
      409,
      'PAGADO_NO_SE_ANULA',
      'Este cobro ya está pagado: no se anula.',
      { estado: cobro.estado },
    );
  }

  // El consumidor puede explicar por qué, pero no puede borrar quién: el
  // prefijo lo pone el servidor. Junto con el origen `contrato-consumidor`, es
  // lo que deja la evidencia auditable (regla #8) — si no, una anulación en
  // lote de un tercero queda firmada igual que una del dueño en su consola.
  const motivo = `consumidor:${consumidorId} · ${datos.data.motivo ?? 'sin motivo declarado'}`;
  const anulado = await anularCobro(ctx.deps, cobro, motivo, ctx.ahora(), 'contrato-consumidor');
  if (esExito(anulado)) {
    return ok({ resultado: 'ANULADO', cobro: aVistaConsumidor(anulado.valor, null) });
  }

  switch (anulado.error.tipo) {
    case 'ABONO_DETECTADO':
      return error(
        409,
        'PAGADO_NO_SE_ANULA',
        'El banco reporta un pago para este cobro: no se anula. Consultá su estado.',
      );
    case 'ABONO_TARDIO':
      return error(
        409,
        'PAGO_TARDIO_EN_REVISION',
        'Llegó un pago sobre el QR vencido: el cobro pasó a revisión manual y no se anuló.',
      );
    default:
      return comoHttpParaConsumidor(anulado.error);
  }
}

/**
 * `GET /api/v1/cobros?desde=&hasta=&limite=` — los cobros propios de un rango,
 * para conciliar contra el sistema del consumidor.
 *
 * `hasta` es exclusivo, para que dos rangos contiguos no compartan un cobro.
 */
export async function listarCobros(
  ctx: ContextoApi,
  consumidorId: string,
  consulta: Readonly<Record<string, string>>,
): Promise<Respuesta> {
  const datos = consultaListado.safeParse(consulta);
  if (!datos.success) {
    return error(400, 'CONSULTA_INVALIDA', datos.error.issues[0]?.message ?? 'consulta inválida');
  }

  const ahora = ctx.ahora();
  // `hasta` es exclusivo para que dos rangos contiguos no compartan un cobro,
  // así que el default es un milisegundo después de ahora: sin eso, un cobro
  // recién creado quedaría justo afuera de su propio listado.
  const hasta =
    datos.data.hasta === undefined ? new Date(ahora.getTime() + 1) : new Date(datos.data.hasta);
  const desde =
    datos.data.desde === undefined
      ? new Date(hasta.getTime() - RANGO_POR_DEFECTO_DIAS * DIA_MS)
      : new Date(datos.data.desde);

  if (desde.getTime() >= hasta.getTime()) {
    return error(400, 'RANGO_INVALIDO', '`desde` tiene que ser anterior a `hasta`.');
  }
  if (hasta.getTime() - desde.getTime() > RANGO_MAXIMO_DIAS * DIA_MS) {
    return error(
      400,
      'RANGO_DEMASIADO_LARGO',
      `El rango máximo es de ${String(RANGO_MAXIMO_DIAS)} días. Pedí el período en tramos.`,
    );
  }

  const limite = datos.data.limite ?? LIMITE_POR_DEFECTO;
  const cobros = await ctx.deps.cobros.listarDeConsumidor(consumidorId, desde, hasta, limite);
  if (!esExito(cobros)) {
    return comoHttpParaConsumidor({ tipo: 'PUERTO', error: cobros.error });
  }

  // La evidencia solo se lee de los confirmados: son los únicos que tienen
  // pago que informar, y leerla de todos multiplicaría las consultas sin dar
  // ningún dato nuevo.
  const vistas = await Promise.all(
    cobros.valor.map(async (cobro) => aVistaConsumidor(cobro, await pagoDe(ctx, cobro))),
  );

  return ok({
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    limite,
    // Si vinieron tantos como el límite, puede haber más: el consumidor tiene
    // que acortar el rango en vez de creer que ya los vio todos.
    truncado: vistas.length === limite,
    cobros: vistas,
  });
}
