/**
 * Casos de uso: la orquestación del cobro.
 *
 * Viven en el dominio y no fuera porque **deciden**, y decidir es lo que el
 * dominio no delega. Solo dependen de los puertos —interfaces declaradas acá
 * mismo—, así que `qr-core` sigue sin importar nada (regla de dependencias).
 * `functions` y el satélite se limitan a construir las dependencias y llamar
 * a estas funciones; por eso no contienen reglas de negocio.
 *
 * Invariante que sostienen todos: **ninguna transición se aplica sin dejar
 * evidencia**. `aplicar()` es el único camino, escribe la evidencia primero y
 * el estado después. El orden es deliberado — ver su comentario.
 */

import type { Cobro, QrEmitido } from '../cobro/cobro.js';
import {
  transicionar,
  type ErrorTransicion,
  type EventoCobro,
  type RegistroEvidencia,
} from '../cobro/maquina-estados.js';
import { esExito, exito, fallo, type Resultado } from '../comun/resultado.js';
import {
  conciliar,
  type MotivoRechazo,
  type PoliticaConciliacion,
} from '../conciliacion/conciliar.js';
import type {
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  MessagingProvider,
  PaymentWatcher,
  QrProvider,
} from '../ports/puertos.js';

export type Dependencias = {
  readonly cobros: CobroRepository;
  readonly evidencia: EvidenceStore;
  readonly qr: QrProvider;
  readonly watcher: PaymentWatcher;
  readonly mensajeria: MessagingProvider;
  readonly politica: PoliticaConciliacion;
};

export type ErrorCasoUso =
  | { readonly tipo: 'PUERTO'; readonly error: ErrorPuerto }
  | { readonly tipo: 'TRANSICION'; readonly error: ErrorTransicion }
  | { readonly tipo: 'SIN_QR_VIGENTE'; readonly cobroId: string };

const dePuerto = (error: ErrorPuerto): ErrorCasoUso => ({ tipo: 'PUERTO', error });
const deTransicion = (error: ErrorTransicion): ErrorCasoUso => ({ tipo: 'TRANSICION', error });

/**
 * Aplica una transición y la persiste.
 *
 * **La evidencia se escribe antes que el estado**, a propósito: si falla el
 * guardado del cobro queda un registro de evidencia sin cambio de estado, que
 * es una inconsistencia auditable y detectable. Al revés —estado guardado sin
 * evidencia— quedaría un cobro confirmado sin rastro de por qué, que es
 * exactamente lo que la regla #8 existe para impedir.
 */
export async function aplicar(
  deps: Dependencias,
  cobro: Cobro,
  evento: EventoCobro,
  ahora: Date,
): Promise<Resultado<{ readonly cobro: Cobro; readonly evidencia: RegistroEvidencia }, ErrorCasoUso>> {
  const transicion = transicionar(cobro, evento, ahora);
  if (!esExito(transicion)) {
    return fallo(deTransicion(transicion.error));
  }

  const guardadaEvidencia = await deps.evidencia.agregar(transicion.valor.evidencia);
  if (!esExito(guardadaEvidencia)) {
    return fallo(dePuerto(guardadaEvidencia.error));
  }

  const guardadoCobro = await deps.cobros.guardar(transicion.valor.cobro);
  if (!esExito(guardadoCobro)) {
    return fallo(dePuerto(guardadoCobro.error));
  }

  return exito(transicion.valor);
}

/** Pide el QR al proveedor y deja el cobro en `QR_ACTIVO`. */
export async function emitirQr(
  deps: Dependencias,
  cobro: Cobro,
  venceEn: Date,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const emitido = await deps.qr.emitir({
    cobroId: cobro.id,
    montoCentavos: cobro.montoCentavos,
    venceEn,
    concepto: cobro.concepto,
    qrVersion: cobro.qrVersion + 1,
    origenEsperado: 'api-baneco',
  });
  if (!esExito(emitido)) {
    return fallo(dePuerto(emitido.error));
  }

  const evento: EventoCobro =
    cobro.estado === 'VENCIDO'
      ? { tipo: 'QR_RENOVADO', qr: emitido.valor, origen: 'sistema' }
      : { tipo: 'QR_EMITIDO', qr: emitido.valor, origen: 'sistema' };

  const resultado = await aplicar(deps, cobro, evento, ahora);
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

/** Manda el QR al cliente por WhatsApp y deja el cobro en `ENVIADO`. */
export async function enviarQr(
  deps: Dependencias,
  cobro: Cobro,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const qr = cobro.qrVigente;
  if (qr === null) {
    return fallo({ tipo: 'SIN_QR_VIGENTE', cobroId: cobro.id });
  }

  const enviado = await deps.mensajeria.enviarQr(cobro, qr);
  if (!esExito(enviado)) {
    return fallo(dePuerto(enviado.error));
  }

  const resultado = await aplicar(deps, cobro, { tipo: 'QR_ENVIADO', origen: 'sistema' }, ahora);
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

/**
 * Registra el comprobante que mandó el cliente.
 *
 * No confirma nada ni acerca el cobro a `CONFIRMADO` (regla #1 / ADR-005): es
 * evidencia auxiliar y, sobre todo, una señal de que conviene ir a mirar el
 * banco antes de que el QR venza.
 */
export async function registrarComprobante(
  deps: Dependencias,
  cobro: Cobro,
  referenciaComprobante: string,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const resultado = await aplicar(
    deps,
    cobro,
    { tipo: 'COMPROBANTE_RECIBIDO', referenciaComprobante, origen: 'webhook-whatsapp' },
    ahora,
  );
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

export type ResultadoVerificacion =
  /** El cobro no está en un estado que admita verificación. */
  | { readonly tipo: 'NO_CORRESPONDE'; readonly cobro: Cobro }
  /** El banco todavía no reporta el abono. */
  | { readonly tipo: 'SIN_ABONO'; readonly cobro: Cobro }
  | { readonly tipo: 'CONFIRMADO'; readonly cobro: Cobro }
  /** Hubo abono pero no concilió: lo mira una persona. */
  | { readonly tipo: 'EN_REVISION'; readonly cobro: Cobro; readonly motivo: MotivoRechazo };

/**
 * El caso de uso central: preguntarle al banco y, si hay abono, conciliarlo.
 *
 * Es el **único** camino automático hacia `CONFIRMADO`, y pasa sí o sí por
 * `conciliar()`. No existe una variante que confirme por un comprobante, por un
 * webhook ni por un parámetro: no hay forma de escribirla sin una
 * `ConciliacionAprobada`, y esa solo la fabrica la conciliación.
 */
export async function verificarPago(
  deps: Dependencias,
  cobroInicial: Cobro,
  ahora: Date,
): Promise<Resultado<ResultadoVerificacion, ErrorCasoUso>> {
  if (cobroInicial.estado !== 'ENVIADO' && cobroInicial.estado !== 'COMPROBANTE_RECIBIDO') {
    return exito({ tipo: 'NO_CORRESPONDE', cobro: cobroInicial });
  }

  const qr = cobroInicial.qrVigente;
  if (qr === null) {
    return fallo({ tipo: 'SIN_QR_VIGENTE', cobroId: cobroInicial.id });
  }

  const consulta = await deps.watcher.consultarCobro(qr.referenciaProveedor);
  if (!esExito(consulta)) {
    return fallo(dePuerto(consulta.error));
  }
  if (consulta.valor === null) {
    return exito({ tipo: 'SIN_ABONO', cobro: cobroInicial });
  }
  const deteccion = consulta.valor;

  const detectado = await aplicar(
    deps,
    cobroInicial,
    { tipo: 'PAGO_DETECTADO', deteccion, origen: deteccion.origen },
    ahora,
  );
  if (!esExito(detectado)) {
    return detectado;
  }
  const cobro = detectado.valor.cobro;

  const previas = await deps.cobros.deteccionesAplicadas(cobro.id);
  if (!esExito(previas)) {
    return fallo(dePuerto(previas.error));
  }

  const conciliacion = conciliar({
    cobro,
    deteccion,
    deteccionesPrevias: previas.valor,
    politica: deps.politica,
    ahora,
  });

  if (!esExito(conciliacion)) {
    const revisado = await aplicar(
      deps,
      cobro,
      { tipo: 'CONCILIACION_FALLIDA', motivo: conciliacion.error, origen: 'sistema' },
      ahora,
    );
    if (!esExito(revisado)) {
      return revisado;
    }
    return exito({
      tipo: 'EN_REVISION',
      cobro: revisado.valor.cobro,
      motivo: conciliacion.error,
    });
  }

  const confirmado = await aplicar(
    deps,
    cobro,
    { tipo: 'PAGO_CONCILIADO', conciliacion: conciliacion.valor, origen: 'sistema' },
    ahora,
  );
  if (!esExito(confirmado)) {
    return confirmado;
  }

  // Avisarle al cliente es cortesía, no parte de la confirmación: si el mensaje
  // falla, el cobro ya está confirmado y no se deshace por eso.
  await deps.mensajeria.enviarConfirmacion(confirmado.valor.cobro);

  return exito({ tipo: 'CONFIRMADO', cobro: confirmado.valor.cobro });
}

/** Marca vencido un cobro cuyo QR pasó su fecha, sin renovarlo todavía. */
export async function vencerSiCorresponde(
  deps: Dependencias,
  cobro: Cobro,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const qr = cobro.qrVigente;
  if (qr === null || ahora.getTime() < qr.venceEn.getTime()) {
    return exito(cobro);
  }

  const resultado = await aplicar(deps, cobro, { tipo: 'QR_VENCIDO', origen: 'sistema' }, ahora);
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

/**
 * Renueva el QR de un cobro vencido y lo reenvía.
 *
 * No crea un cobro nuevo: incrementa `qrVersion` sobre el mismo (regla #6).
 */
export async function renovarYReenviar(
  deps: Dependencias,
  cobro: Cobro,
  venceEn: Date,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const renovado = await emitirQr(deps, cobro, venceEn, ahora);
  if (!esExito(renovado)) {
    return renovado;
  }
  return enviarQr(deps, renovado.valor, ahora);
}

export type ResumenConciliacionDiaria = {
  readonly abonosLeidos: number;
  readonly confirmados: readonly string[];
  readonly enRevision: readonly string[];
  /** Abonos del banco que no corresponden a ningún cobro conocido. */
  readonly huerfanos: readonly string[];
};

/**
 * Cierre del día: contrasta los abonos que informa el banco contra los cobros
 * pendientes.
 *
 * Es la red de seguridad del polling: si una consulta puntual se perdió un
 * abono, acá aparece. Un abono sin cobro asociado no se descarta — se reporta
 * como huérfano para que alguien lo mire.
 */
export async function conciliarDia(
  deps: Dependencias,
  fecha: Date,
  ahora: Date,
): Promise<Resultado<ResumenConciliacionDiaria, ErrorCasoUso>> {
  const abonos = await deps.watcher.listarAbonosDelDia(fecha);
  if (!esExito(abonos)) {
    return fallo(dePuerto(abonos.error));
  }

  const pendientes = await deps.cobros.listarPendientes();
  if (!esExito(pendientes)) {
    return fallo(dePuerto(pendientes.error));
  }

  const porReferencia = new Map<string, Cobro>();
  for (const cobro of pendientes.valor) {
    if (cobro.qrVigente !== null) {
      porReferencia.set(cobro.qrVigente.referenciaProveedor, cobro);
    }
  }

  const confirmados: string[] = [];
  const enRevision: string[] = [];
  const huerfanos: string[] = [];

  for (const abono of abonos.valor) {
    const referencia = referenciaDe(abono.idDeduplicacion);
    const cobro = referencia === null ? undefined : porReferencia.get(referencia);
    if (cobro === undefined) {
      huerfanos.push(abono.idDeduplicacion);
      continue;
    }

    const verificado = await verificarPago(deps, cobro, ahora);
    if (!esExito(verificado)) {
      return verificado;
    }
    if (verificado.valor.tipo === 'CONFIRMADO') {
      confirmados.push(cobro.id);
    } else if (verificado.valor.tipo === 'EN_REVISION') {
      enRevision.push(cobro.id);
    }
  }

  return exito({
    abonosLeidos: abonos.valor.length,
    confirmados,
    enRevision,
    huerfanos,
  });
}

/** Extrae la referencia del proveedor de una clave `baneco:{qrId}:{transactionId}`. */
function referenciaDe(idDeduplicacion: string): string | null {
  const partes = idDeduplicacion.split(':');
  return partes.length === 3 ? (partes[1] ?? null) : null;
}

/** Reexportado para que el satélite arme un QR de prueba sin tocar el dominio. */
export type { QrEmitido };
