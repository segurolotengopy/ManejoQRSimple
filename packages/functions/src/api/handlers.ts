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
  cerrarAbonoSinConciliar,
  verificarAdmision,
  verificarPago,
  type AbonosSinConciliarStore,
  type CasoAbono,
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
  cuerpoCerrarAbono,
  cuerpoComprobante,
  cuerpoCrearCobro,
  cuerpoQrDePrueba,
  cuerpoRenovar,
  cuerpoResolver,
} from './esquemas.js';
import type { CupoDeConsumidores } from './cupo-consumidor.js';
import type { ModoPrueba } from '../modo-prueba.js';
import type { RegistroEventos } from '../registro.js';
import { creado, error, noEncontrado, ok, type Respuesta } from './tipos.js';

const HORA_MS = 3_600_000;

export type ContextoApi = {
  readonly deps: Dependencias;
  readonly evidencia: EvidenceStore;
  /** Abonos que el cierre diario no pudo atar a un cobro: van a la cola de revisión. */
  readonly abonosSinConciliar: AbonosSinConciliarStore;
  /** Vigencia por defecto de un QR nuevo. */
  readonly horasDeVigenciaPorDefecto: number;
  readonly ahora: () => Date;
  /** Umbrales de alerta de la cola de revisión. Por defecto, los del dominio. */
  readonly politicaRevision?: PoliticaRevision;
  /** Lee el PNG de un QR por su referencia. Sin él, la API no sirve imágenes. */
  readonly leerImagenQr?: (imagenRef: string) => Promise<string | null>;
  /**
   * Presente **solo** en la prueba controlada en producción: activa los
   * endpoints `/api/pruebas` y el tope de monto de todos los cobros.
   */
  readonly prueba?: ModoPrueba;
  /** Logs de depuración para la pestaña Logs. */
  readonly registro?: RegistroEventos;
  /**
   * Cuántos QRs por hora puede pedir cada consumidor del contrato (docs/10).
   * Sin esto, el contrato no tiene tope fuera de la prueba en producción.
   */
  readonly cupoConsumidores?: CupoDeConsumidores;
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
    // `null` en los cobros de consumidor, que no tienen teléfono (docs/10).
    telefonoCliente: enmascararTelefono(cobro.telefonoCliente),
    // Quién pidió el cobro, si lo pidió un consumidor. La referencia externa
    // es opaca por contrato, así que mostrarla no filtra datos de nadie.
    consumidor: cobro.consumidor,
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

/**
 * Vista de un abono sin conciliar. Solo lo que guarda el dominio: monto,
 * momento y la clave del banco. Nada del pagador (reglas #4 y #9).
 */
function aVistaAbono(caso: CasoAbono): Record<string, unknown> {
  const { abono } = caso;
  return {
    idDeduplicacion: abono.idDeduplicacion,
    motivo: abono.motivo,
    cobroId: abono.cobroId,
    // Cómo está ahora ese cobro y si ya registra este pago: un "sin
    // corroborar" que después se confirmó no es plata para devolver.
    cobroEstado: caso.cobro?.estado ?? null,
    yaRegistradoEnElCobro: caso.cobro?.registraElPago ?? false,
    monto: aDecimalBob(abono.montoCentavos),
    ocurridoEn: abono.ocurridoEn.toISOString(),
    registradoEn: abono.registradoEn.toISOString(),
    horasAbierto: Math.floor(caso.horasAbierto),
    nivel: caso.nivel,
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
export function comoHttp(err: ErrorCasoUso): Respuesta {
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
    case 'ABONO_DESACTUALIZADO':
      return error(
        409,
        'ABONO_DESACTUALIZADO',
        'El banco reportó otro pago mientras revisabas: actualizá y volvé a mirar el caso antes de decidir.',
      );
    case 'ABONO_INEXISTENTE':
      return noEncontrado();
    case 'QR_SUELTO_EN_EL_PROVEEDOR':
      // Quedó un QR pagable que ningún cobro mira. El pedido falló igual, así
      // que hacia afuera es el error de su causa; lo que cambia es que esto
      // tiene que quedar registrado y revisarse en el cierre del día.
      return error(
        502,
        'QR_SUELTO_EN_EL_PROVEEDOR',
        'No se pudo registrar el QR y el banco tampoco lo anuló: quedó un QR cobrable sin cobro. Revisalo en el cierre del día antes de emitir otro.',
        { causa: err.causa.tipo },
      );
    case 'SIN_CANAL_DE_ENVIO':
      return error(
        409,
        'SIN_CANAL_DE_ENVIO',
        'Este cobro no tiene teléfono: lo pidió un consumidor, y el envío al pagador es suyo.',
      );
    case 'REFERENCIA_EXTERNA_EN_USO':
      return error(
        409,
        'REFERENCIA_EXTERNA_EN_USO',
        'Esa referencia externa ya identifica otro cobro. Usá una distinta.',
      );
    case 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA':
      return error(
        409,
        'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA',
        'Ya existe un cobro con esa referencia externa y otro importe. Un reintento tiene que pedir lo mismo; un cobro nuevo, otra referencia.',
        { registrado: aDecimalBob(err.registrado) },
      );
    case 'MOTIVO_INSUFICIENTE':
      return error(
        400,
        'MOTIVO_INSUFICIENTE',
        `Contá en al menos ${String(err.minimo)} caracteres qué se hizo con la plata.`,
      );
    case 'PUERTO': {
      // Para diagnosticar: qué tipo de falla y qué código devolvió el banco
      // (su `responseCode`, o el HTTP). Son códigos, no datos de nadie.
      const detalle = {
        tipo: err.error.tipo,
        codigoProveedor: err.error.codigoProveedor,
        mensajeTecnico: err.error.mensaje,
      };
      if (err.error.tipo === 'CONFLICTO') {
        return error(
          409,
          'CONFLICTO',
          'El dato cambió mientras operabas (otra pestaña o el satélite pudo haberlo actualizado). Actualizá y volvé a intentar.',
          detalle,
        );
      }
      return err.error.reintentable
        ? error(503, 'SERVICIO_NO_DISPONIBLE', 'Un servicio externo no respondió. Reintentá.', detalle)
        : error(502, 'PROVEEDOR_RECHAZO', 'Un servicio externo rechazó la operación.', detalle);
    }
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
  // En la prueba en producción el tope vale para todo cobro, no solo para los
  // del botón de pruebas: el formulario común también emite QRs reales.
  if (ctx.prueba !== undefined && monto.valor > ctx.prueba.montoCentavos) {
    return error(
      400,
      'MONTO_SOBRE_LIMITE_DE_PRUEBA',
      `En la prueba en producción el monto máximo es Bs ${aDecimalBob(ctx.prueba.montoCentavos)}.`,
    );
  }
  // Y también el cupo: todo QR que se le pide al banco cuenta, venga de donde venga.
  const sinCupo = consumirCupo(ctx);
  if (sinCupo !== null) {
    return sinCupo;
  }

  const ahora = ctx.ahora();
  const horas = horasPermitidas(ctx, datos.data.horasDeVigencia);

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
    // Lo creó el dueño desde la consola, no un consumidor (docs/10).
    consumidor: null,
  };

  const emitido = await emitirQr(ctx.deps, cobro, new Date(ahora.getTime() + horas * HORA_MS), ahora);
  if (!esExito(emitido)) {
    return comoHttp(emitido.error);
  }
  ctx.prueba?.corrida.cobros.push(emitido.valor.id);
  return creado(aVista(emitido.valor));
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
  // Renovar le pide al banco un QR nuevo: en la prueba, consume cupo.
  const sinCupo = consumirCupo(ctx);
  if (sinCupo !== null) {
    return sinCupo;
  }
  if (ctx.prueba !== undefined && !ctx.prueba.corrida.cobros.includes(cobro.id)) {
    ctx.prueba.corrida.cobros.push(cobro.id);
  }

  const ahora = ctx.ahora();
  const horas = horasPermitidas(ctx, datos.data.horasDeVigencia);
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
    { ...ctx.deps, abonosSinConciliar: ctx.abonosSinConciliar },
    ctx.ahora(),
    ctx.politicaRevision ?? POLITICA_REVISION_POR_DEFECTO,
  );
  return esExito(cola)
    ? ok({
        casos: cola.valor.casos.map(aVistaCaso),
        abonos: cola.valor.abonos.map(aVistaAbono),
        resumen: cola.valor.resumen,
        truncado: cola.valor.truncado,
      })
    : comoHttp(cola.error);
}

/**
 * `POST /api/abonos/:id/cerrar` — cierra un abono sin conciliar con lo que se
 * hizo con la plata. No toca ningún cobro.
 */
export async function cerrarAbono(ctx: ContextoApi, id: string, cuerpo: unknown): Promise<Respuesta> {
  const datos = cuerpoCerrarAbono.safeParse(cuerpo);
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }
  const cerrado = await cerrarAbonoSinConciliar(ctx, id, datos.data.motivo, ctx.ahora());
  if (!esExito(cerrado)) {
    return comoHttp(cerrado.error);
  }
  ctx.registro?.agregar('info', 'api', `abono sin conciliar cerrado: ${id}`);
  return ok({ idDeduplicacion: cerrado.valor.idDeduplicacion, cerrado: true });
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

  const resuelto = await resolverRevision(ctx.deps, cobro, datos.data, ctx.ahora());
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

/** `GET /api/cobros/:id/qr` — la imagen del QR, para escanearla y pagar. */
export async function verQr(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await buscar(ctx, id);
  if (esRespuesta(cobro)) return cobro;

  const png = await imagenDe(ctx, cobro);
  return png === null
    ? error(404, 'SIN_IMAGEN', 'Este cobro no tiene la imagen del QR guardada.')
    : ok({ png });
}

export async function imagenDe(ctx: ContextoApi, cobro: Cobro): Promise<string | null> {
  const ref = cobro.qrVigente?.imagenRef ?? null;
  return ref === null || ctx.leerImagenQr === undefined ? null : ctx.leerImagenQr(ref);
}

// --- Prueba controlada en producción (docs/Integraciones/baneco/03-prueba-en-produccion.md)

/** Teléfono visiblemente falso: los cobros de prueba no tienen cliente. */
const TELEFONO_DE_PRUEBA = '+59100000000';
const VIGENCIA_DE_PRUEBA_MINUTOS = 30;
/** En la prueba ningún QR vive más de un día: la prueba dura un día. */
const HORAS_MAXIMAS_EN_PRUEBA = 24;

/**
 * En la prueba, cuenta un pedido de QR al banco y lo rechaza si se acabó el
 * cupo. Fuera de la prueba no hace nada. Se cuenta el intento, salga o no.
 */
export function consumirCupo(ctx: ContextoApi): Respuesta | null {
  const prueba = ctx.prueba;
  if (prueba === undefined) {
    return null;
  }
  if (prueba.corrida.intentos >= prueba.maxQrs) {
    return error(
      409,
      'LIMITE_DE_PRUEBA',
      `Ya se pidieron los ${String(prueba.maxQrs)} QRs de la prueba. Cerrala; para más, subí PRUEBA_MAX_QRS y reiniciá la API.`,
    );
  }
  prueba.corrida.intentos += 1;
  return null;
}

/** La vigencia pedida, topeada en la prueba. */
export function horasPermitidas(ctx: ContextoApi, pedidas: number | undefined): number {
  const horas = pedidas ?? ctx.horasDeVigenciaPorDefecto;
  return ctx.prueba === undefined ? horas : Math.min(horas, HORAS_MAXIMAS_EN_PRUEBA);
}

/** `GET /api/logs` — los logs de depuración de la API (últimas 500 líneas). */
export function verLogs(ctx: ContextoApi): Respuesta {
  return ctx.registro === undefined ? noEncontrado() : ok({ lineas: ctx.registro.listar() });
}

/** `GET /api/pruebas` — si la prueba está activa, sus topes y sus cobros. */
export function verPrueba(ctx: ContextoApi): Respuesta {
  const prueba = ctx.prueba;
  if (prueba === undefined) {
    return noEncontrado();
  }
  return ok({
    activo: true,
    // La hora del servidor: la consola la usa para no depender del reloj del navegador.
    ahora: ctx.ahora().toISOString(),
    produccion: prueba.produccion,
    monto: aDecimalBob(prueba.montoCentavos),
    maxQrs: prueba.maxQrs,
    intentos: prueba.corrida.intentos,
    restantes: Math.max(0, prueba.maxQrs - prueba.corrida.intentos),
    adaptadores: prueba.adaptadores,
    cuenta: prueba.cuenta,
    cobros: [...prueba.corrida.cobros],
  });
}

/**
 * `POST /api/pruebas/qr` — emite un QR real por el monto de prueba.
 *
 * El monto lo fija el servidor. Se cuenta el **intento**, no el éxito: el tope
 * limita cuántas veces se le pide un QR al banco, salga o no.
 */
export async function generarQrDePrueba(ctx: ContextoApi, cuerpo: unknown): Promise<Respuesta> {
  const prueba = ctx.prueba;
  if (prueba === undefined) {
    return noEncontrado();
  }
  const datos = cuerpoQrDePrueba.safeParse(cuerpo ?? {});
  if (!datos.success) {
    return error(400, 'CUERPO_INVALIDO', datos.error.issues[0]?.message ?? 'cuerpo inválido');
  }
  const sinCupo = consumirCupo(ctx);
  if (sinCupo !== null) {
    return sinCupo;
  }

  const ahora = ctx.ahora();
  const minutos = datos.data.vigenciaMinutos ?? VIGENCIA_DE_PRUEBA_MINUTOS;
  const cobro: Cobro = {
    id: randomUUID(),
    proveedor: 'baneco',
    estado: 'BORRADOR',
    montoCentavos: prueba.montoCentavos,
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: ahora,
    telefonoCliente: TELEFONO_DE_PRUEBA,
    // Es la nota que ve quien paga en su app: que diga que es una prueba.
    concepto: `PRUEBA ${String(prueba.corrida.intentos)} ManejoQRSimple`,
    consumidor: null,
  };

  const emitido = await emitirQr(ctx.deps, cobro, new Date(ahora.getTime() + minutos * 60_000), ahora);
  if (!esExito(emitido)) {
    return comoHttp(emitido.error);
  }
  prueba.corrida.cobros.push(emitido.valor.id);
  return creado({ cobro: aVista(emitido.valor), imagen: await imagenDe(ctx, emitido.valor) });
}

/** Un cobro de esta corrida de prueba, o la respuesta de error. */
async function cobroDePrueba(ctx: ContextoApi, id: string): Promise<Cobro | Respuesta> {
  if (ctx.prueba === undefined) {
    return noEncontrado();
  }
  if (!ctx.prueba.corrida.cobros.includes(id)) {
    return error(404, 'NO_ES_DE_PRUEBA', 'Ese cobro no es de esta corrida de prueba.');
  }
  return buscar(ctx, id);
}

/** Estados en los que sondear la anulación no puede dejar a un cliente sin poder pagar. */
const SONDEABLES = new Set(['CONFIRMADO', 'ANULADO', 'VENCIDO', 'RECHAZADO']);

/**
 * `POST /api/cobros/:id/sondear-anulacion` — le pide al banco anular el QR **sin
 * tocar el cobro**, para ver qué responde (pruebas 6 y 7: anular un QR ya pagado
 * y anular dos veces). Es un sondeo, como los de B0: no aplica ninguna
 * transición. Solo en la prueba, y solo sobre cobros cuyo QR ya no se espera
 * que nadie pague.
 */
export async function sondearAnulacion(ctx: ContextoApi, id: string): Promise<Respuesta> {
  const cobro = await cobroDePrueba(ctx, id);
  if (esRespuesta(cobro)) return cobro;
  if (!SONDEABLES.has(cobro.estado) || cobro.qrVigente === null) {
    return error(
      409,
      'NO_SONDEABLE',
      'Solo se sondea la anulación de un QR pagado, anulado o vencido: sobre uno vivo dejaría al cliente sin poder pagar.',
    );
  }

  const r = await ctx.deps.qr.anular(cobro.qrVigente.referenciaProveedor);
  return ok({
    anulado: esExito(r),
    detalle: esExito(r)
      ? null
      : { tipo: r.error.tipo, codigoProveedor: r.error.codigoProveedor, mensajeTecnico: r.error.mensaje },
  });
}

/** Cuántos cobros revisa el cierre. En la prueba, el emulador solo tiene los de la prueba. */
const LIMITE_CIERRE = 500;

/**
 * `POST /api/pruebas/cerrar` — anula en el banco todo QR que quedó sin pagar.
 * Pasa por `anular()`, así que antes mira si alguien lo pagó.
 *
 * Recorre **todos** los cobros del emulador de la prueba, no solo los de esta
 * corrida de la API: si la API se reinició a mitad de la prueba, los de antes
 * también se cierran.
 */
export async function cerrarPrueba(ctx: ContextoApi): Promise<Respuesta> {
  if (ctx.prueba === undefined) {
    return noEncontrado();
  }
  const todos = await ctx.deps.cobros.listarRecientes(LIMITE_CIERRE);
  if (!esExito(todos)) {
    return comoHttp({ tipo: 'PUERTO', error: todos.error });
  }

  const resultados: { id: string; resultado: string }[] = [];
  for (const cobro of todos.valor) {
    const id = cobro.id;
    if (cobro.estado === 'COMPROBANTE_RECIBIDO') {
      // No admite ANULADO: su QR sigue vivo hasta que el satélite lo venza.
      resultados.push({ id, resultado: 'QR VIVO (COMPROBANTE_RECIBIDO): lo anula el satélite al vencer' });
      continue;
    }
    if (verificarAdmision(cobro, 'ANULADO') !== null) {
      // Terminal, en revisión o con pago detectado: no hay nada que cerrar.
      resultados.push({ id, resultado: cobro.estado });
      continue;
    }
    const anulado = await anularCobro(ctx.deps, cobro, 'cierre de la prueba en producción', ctx.ahora());
    resultados.push({ id, resultado: esExito(anulado) ? 'ANULADO' : `ERROR ${anulado.error.tipo}` });
  }
  return ok({ resultados });
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
