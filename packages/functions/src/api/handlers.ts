/**
 * Los handlers de la API.
 *
 * **Orquestan; no deciden.** Cada uno valida su entrada, llama a un caso de uso
 * de `qr-core` y traduce el resultado a HTTP. Ninguna regla de negocio vive
 * acá: si mañana cambia cuándo un cobro puede anularse, cambia la máquina de
 * estados y estos handlers no se enteran.
 *
 * Lo que sí es responsabilidad de esta capa: no filtrar hacia afuera más de lo
 * necesario. `aVista()` decide qué se ve de un cobro; el teléfono del cliente
 * sale **enmascarado** (regla #9).
 */

import {
  aDecimalBob,
  anular as anularCobro,
  buscarAbonoEnRevision,
  desdeDecimalBob,
  emitirQr,
  enmascararTelefono,
  enviarQr,
  esExito,
  listarRevision,
  POLITICA_REVISION_POR_DEFECTO,
  registrarComprobante,
  renovarYReenviar,
  resolverRevision,
  verificarPago,
  type CasoRevision,
  type Cobro,
  type Dependencias,
  type ErrorCasoUso,
  type EvidenceStore,
  type PoliticaRevision,
  type RegistroEvidencia,
} from '@mqs/qr-core';
import { randomUUID } from 'node:crypto';

import {
  cuerpoAnular,
  cuerpoComprobante,
  cuerpoCrearCobro,
  cuerpoRenovar,
  cuerpoResolver,
} from './esquemas.js';
import { creado, error, noEncontrado, ok, type Respuesta } from './tipos.js';

const HORA_MS = 3_600_000;

export type ContextoApi = {
  readonly deps: Dependencias;
  readonly evidencia: EvidenceStore;
  /** Vigencia por defecto de un QR nuevo. */
  readonly horasDeVigenciaPorDefecto: number;
  readonly ahora: () => Date;
  /** Umbrales de alerta de la cola de revisión. Por defecto, los del dominio. */
  readonly politicaRevision?: PoliticaRevision;
};

/** Vista pública de un cobro. Lo que la consola puede ver, y nada más. */
function aVista(cobro: Cobro): Record<string, unknown> {
  return {
    id: cobro.id,
    estado: cobro.estado,
    proveedor: cobro.proveedor,
    monto: aDecimalBob(cobro.montoCentavos),
    moneda: cobro.moneda,
    concepto: cobro.concepto,
    // Enmascarado: la consola no necesita el número completo para operar.
    telefonoCliente: enmascararTelefono(cobro.telefonoCliente),
    qrVersion: cobro.qrVersion,
    creadoEn: cobro.creadoEn.toISOString(),
    qrVigente:
      cobro.qrVigente === null
        ? null
        : {
            qrVersion: cobro.qrVigente.qrVersion,
            referenciaProveedor: cobro.qrVigente.referenciaProveedor,
            emitidoEn: cobro.qrVigente.emitidoEn.toISOString(),
            venceEn: cobro.qrVigente.venceEn.toISOString(),
            origen: cobro.qrVigente.origen,
            imagenRef: cobro.qrVigente.imagenRef,
          },
  };
}

/** Vista de un caso de revisión: el cobro, por qué está ahí y qué pagó el banco. */
function aVistaCaso(caso: CasoRevision): Record<string, unknown> {
  return {
    cobro: aVista(caso.cobro),
    motivo: caso.motivo,
    nivel: caso.nivel,
    enRevisionDesde: caso.enRevisionDesde.toISOString(),
    horasEnRevision: Math.floor(caso.horasEnRevision),
    // Sin un abono del banco no se puede confirmar, ni a mano (regla #1). La
    // consola lo usa para no ofrecer un botón que el dominio va a rechazar.
    confirmable: caso.abono !== null,
    abono:
      caso.abono === null
        ? null
        : {
            idDeduplicacion: caso.abono.idDeduplicacion,
            monto: aDecimalBob(caso.abono.montoCentavos),
            ocurridoEn: caso.abono.ocurridoEn.toISOString(),
          },
  };
}

function aVistaEvidencia(registro: RegistroEvidencia): Record<string, unknown> {
  return {
    desde: registro.desde,
    hacia: registro.hacia,
    evento: registro.evento,
    origen: registro.origen,
    registradoEn: registro.registradoEn.toISOString(),
    datos: registro.datos,
  };
}

/**
 * Traduce un error del dominio a HTTP.
 *
 * Una transición no permitida es 409 y no 400: el pedido está bien formado, lo
 * que no corresponde es el estado en que está el cobro. La consola necesita
 * distinguirlos para saber si reintentar o refrescar.
 */
function comoHttp(err: ErrorCasoUso): Respuesta {
  switch (err.tipo) {
    case 'TRANSICION':
      return error(
        409,
        `TRANSICION_${err.error.tipo}`,
        'El cobro no está en un estado que admita esta operación.',
      );
    case 'SIN_QR_VIGENTE':
      return error(409, 'SIN_QR_VIGENTE', 'El cobro todavía no tiene un QR emitido.');
    case 'ABONO_DETECTADO':
      return error(
        409,
        'ABONO_DETECTADO',
        'El banco reporta un pago para este cobro: verificalo antes de anularlo.',
      );
    case 'ABONO_TARDIO':
      return error(
        409,
        'ABONO_TARDIO',
        'Llegó un pago al QR vencido: el cobro pasó a revisión y no se hizo la operación.',
      );
    case 'SIN_DETECCION_DEL_BANCO':
      return error(
        409,
        'SIN_DETECCION_DEL_BANCO',
        'El banco no reportó ningún pago para este cobro: buscalo en el banco antes de confirmarlo. Un comprobante no alcanza.',
      );
    case 'PUERTO':
      if (err.error.tipo === 'CONFLICTO') {
        return error(
          409,
          'CONFLICTO',
          'El cobro cambió mientras operabas (el satélite pudo haberlo actualizado). Actualizá y volvé a intentar.',
        );
      }
      return err.error.reintentable
        ? error(503, 'SERVICIO_NO_DISPONIBLE', 'Un servicio externo no respondió. Reintentá.')
        : error(502, 'PROVEEDOR_RECHAZO', 'Un servicio externo rechazó la operación.');
  }
}

async function buscar(ctx: ContextoApi, id: string): Promise<Cobro | Respuesta> {
  const encontrado = await ctx.deps.cobros.obtener(id);
  if (!esExito(encontrado)) {
    return comoHttp({ tipo: 'PUERTO', error: encontrado.error });
  }
  return encontrado.valor ?? noEncontrado();
}

const esRespuesta = (v: Cobro | Respuesta): v is Respuesta => 'status' in v;

/** `POST /api/cobros` — crea el cobro y le emite el primer QR. */
export async function crearCobro(ctx: ContextoApi, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoCrearCobro.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const monto = desdeDecimalBob(datos.data.monto);
  if (!esExito(monto)) {
    return error(400, 'MONTO_INVALIDO', 'El monto no es representable en centavos enteros.');
  }

  const ahora = ctx.ahora();
  const horas = datos.data.horasDeVigencia ?? ctx.horasDeVigenciaPorDefecto;

  const cobro: Cobro = {
    // randomUUID usa el generador criptográfico, nunca Math.random (regla #10).
    id: randomUUID(),
    proveedor: 'baneco',
    estado: 'BORRADOR',
    montoCentavos: monto.valor,
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: ahora,
    telefonoCliente: datos.data.telefonoCliente,
    concepto: datos.data.concepto,
  };

  const emitido = await emitirQr(ctx.deps, cobro, new Date(ahora.getTime() + horas * HORA_MS), ahora);
  return esExito(emitido) ? creado(aVista(emitido.valor)) : comoHttp(emitido.error);
}

/** Cuántos cobros muestra la consola de una vez. */
const LIMITE_LISTADO = 50;

/**
 * `GET /api/cobros` — los cobros más recientes, en cualquier estado.
 *
 * No usa `listarPendientes`: eso es la pregunta del satélite. Un cobro recién
 * creado está en `QR_ACTIVO` y el watcher no lo mira todavía, pero quien lo
 * acaba de crear necesita verlo — si la consola listara solo los pendientes,
 * crear un cobro parecería no hacer nada.
 */
export async function listarCobros(ctx: ContextoApi): Promise<Respuesta> {
  const recientes = await ctx.deps.cobros.listarRecientes(LIMITE_LISTADO);
  return esExito(recientes)
    ? ok({ cobros: recientes.valor.map(aVista) })
    : comoHttp({ tipo: 'PUERTO', error: recientes.error });
}

/** `GET /api/cobros/:id` — el cobro con su rastro de evidencia completo. */
export async function verCobro(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const registros = await ctx.evidencia.listarDeCobro(id);
  if (!esExito(registros)) {
    return comoHttp({ tipo: 'PUERTO', error: registros.error });
  }
  return ok({ cobro: aVista(cobro), evidencia: registros.valor.map(aVistaEvidencia) });
}

/** `POST /api/cobros/:id/enviar` — manda el QR al cliente. */
export async function enviar(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const enviado = await enviarQr(ctx.deps, cobro, ctx.ahora());
  return esExito(enviado) ? ok(aVista(enviado.valor)) : comoHttp(enviado.error);
}

/** `POST /api/cobros/:id/renovar` — QR nuevo sobre el mismo cobro (regla #6). */
export async function renovar(ctx: ContextoApi, id: string, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoRenovar.safeParse(cuerpo ?? {});
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const ahora = ctx.ahora();
  const horas = datos.data.horasDeVigencia ?? ctx.horasDeVigenciaPorDefecto;
  const renovado = await renovarYReenviar(
    ctx.deps,
    cobro,
    new Date(ahora.getTime() + horas * HORA_MS),
    ahora,
  );
  return esExito(renovado) ? ok(aVista(renovado.valor)) : comoHttp(renovado.error);
}

/** `POST /api/cobros/:id/anular` */
export async function anular(ctx: ContextoApi, id: string, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoAnular.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const anulado = await anularCobro(ctx.deps, cobro, datos.data.motivo, ctx.ahora());
  return esExito(anulado) ? ok(aVista(anulado.valor)) : comoHttp(anulado.error);
}

/**
 * `POST /api/cobros/:id/comprobante` — registra el comprobante del cliente.
 *
 * **No confirma nada** (regla #1 / ADR-005). Deja constancia y, sobre todo,
 * es una señal de que conviene ir a mirar el banco antes de que el QR venza.
 */
export async function comprobante(ctx: ContextoApi, id: string, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoComprobante.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const registrado = await registrarComprobante(
    ctx.deps,
    cobro,
    datos.data.referenciaComprobante,
    ctx.ahora(),
  );
  return esExito(registrado) ? ok(aVista(registrado.valor)) : comoHttp(registrado.error);
}

/** `GET /api/revision` — la cola de revisión manual, lo más urgente primero. */
export async function verRevision(ctx: ContextoApi): Promise<Respuesta> {
  const cola = await listarRevision(
    ctx.deps,
    ctx.ahora(),
    ctx.politicaRevision ?? POLITICA_REVISION_POR_DEFECTO,
  );
  return esExito(cola)
    ? ok({ casos: cola.valor.casos.map(aVistaCaso), resumen: cola.valor.resumen })
    : comoHttp(cola.error);
}

/**
 * `POST /api/cobros/:id/resolver` — la decisión del dueño sobre un caso.
 *
 * Confirmar acepta el último abono que reportó el banco; sin abono, el dominio
 * lo rechaza con 409. Esta capa no decide nada de eso: valida y traduce.
 */
export async function resolver(ctx: ContextoApi, id: string, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoResolver.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }

  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const resuelto = await resolverRevision(
    ctx.deps,
    cobro,
    datos.data.decision,
    datos.data.motivo,
    ctx.ahora(),
  );
  return esExito(resuelto) ? ok(aVista(resuelto.valor)) : comoHttp(resuelto.error);
}

/** `POST /api/cobros/:id/buscar-abono` — pregunta al banco por un cobro en revisión. */
export async function buscarAbono(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const busqueda = await buscarAbonoEnRevision(ctx.deps, cobro, ctx.ahora());
  return esExito(busqueda)
    ? ok({ encontrado: busqueda.valor.encontrado, cobro: aVista(busqueda.valor.cobro) })
    : comoHttp(busqueda.error);
}

/**
 * `POST /api/cobros/:id/verificar` — le pregunta al banco ahora mismo.
 *
 * Es el mismo camino que corre el satélite; acá solo se dispara a pedido, para
 * no esperar al próximo intervalo. Sigue exigiendo conciliación: este endpoint
 * **no puede** confirmar un cobro por su cuenta.
 */
export async function verificar(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const verificado = await verificarPago(ctx.deps, cobro, ctx.ahora());
  if (!esExito(verificado)) {
    return comoHttp(verificado.error);
  }
  return ok({ resultado: verificado.valor.tipo, cobro: aVista(verificado.valor.cobro) });
}
