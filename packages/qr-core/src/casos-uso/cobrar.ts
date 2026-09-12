/**
 * Casos de uso: la orquestación del cobro.
 *
 * Viven en el dominio y no fuera porque **deciden**, y decidir es lo que el
 * dominio no delega. Solo dependen de los puertos —interfaces declaradas acá
 * mismo—, así que `qr-core` sigue sin importar nada (regla de dependencias).
 * `functions` y el satélite se limitan a construir las dependencias y llamar
 * a estas funciones; por eso no contienen reglas de negocio.
 *
 * Invariantes que sostienen todos:
 *
 * - **Ninguna transición se aplica sin dejar evidencia.** `aplicar()` es el
 *   único camino, escribe la evidencia primero y el estado después, y el
 *   estado solo se escribe si el guardado sigue en el estado del que partió
 *   la transición (una escritura concurrente no pisa a otra).
 * - **Antes de soltar un QR, se mira el banco y se lo anula allá.** El banco
 *   vence los QR por día, no por hora (respuesta C4 de Baneco): un cobro que
 *   vence, se renueva o se anula en nuestro reloj seguiría cobrable en el
 *   banco hasta la medianoche. La máquina de estados exige la constancia de
 *   anulación; estos casos de uso son los que la consiguen.
 * - **Después de anular, se vuelve a mirar.** Entre la consulta y la anulación
 *   el cliente pudo pagar. Una vez anulado, el QR ya no cambia: la segunda
 *   consulta es la definitiva.
 * - **Se pregunta si la transición corresponde antes de tocar el banco.** Un
 *   QR emitido o anulado en el banco por un pedido que después resulta
 *   inválido es un efecto real sin su registro.
 */

import { anularEnProveedor, type QrAnulado } from '../cobro/anulacion.js';
import { qrEstaVencido, type Cobro, type QrEmitido } from '../cobro/cobro.js';
import {
  tieneQrPagable,
  transicionar,
  verificarAdmision,
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
import type { DeteccionDePago } from '../conciliacion/deteccion.js';
import type {
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  MessagingProvider,
  PaymentWatcher,
  QrProvider,
} from '../ports/puertos.js';

/**
 * Todos los puertos que el sistema necesita.
 *
 * Cada caso de uso pide con `Pick` **solo los que usa**, no este objeto entero.
 * No es purismo: obligar a un proceso a construir un puerto que no usa lo
 * forzaría a fabricar uno falso — que es justo el tipo de pieza inerte que
 * después alguien conecta por error.
 */
export type Dependencias = {
  readonly cobros: CobroRepository;
  readonly evidencia: EvidenceStore;
  readonly qr: QrProvider;
  readonly watcher: PaymentWatcher;
  readonly mensajeria: MessagingProvider;
  readonly politica: PoliticaConciliacion;
};

/** Lo mínimo para aplicar una transición: guardarla y dejar su evidencia. */
export type DepsPersistencia = Pick<Dependencias, 'cobros' | 'evidencia'>;

/** Lo que necesita verificar un pago contra el banco y conciliarlo. */
export type DepsVerificacion = Pick<
  Dependencias,
  'cobros' | 'evidencia' | 'watcher' | 'mensajeria' | 'politica'
>;

/**
 * Lo que necesita vigilar un cobro: verificarlo y, si venció sin pago, anular
 * su QR en el proveedor. Es lo que corre el satélite en cada pasada.
 */
export type DepsVigilancia = DepsVerificacion & Pick<Dependencias, 'qr'>;

/** Lo que necesita emitir un QR y mandarlo al cliente. */
export type DepsEmision = Pick<Dependencias, 'cobros' | 'evidencia' | 'qr' | 'mensajeria'>;

/** Renovar: emitir, después de mirar si el QR anterior llegó a pagarse. */
export type DepsRenovacion = DepsEmision & Pick<Dependencias, 'watcher'>;

/** Anular: mirar el banco, anular el QR allá y dejar el registro. */
export type DepsAnulacion = DepsPersistencia & Pick<Dependencias, 'qr' | 'watcher'>;

export type ErrorCasoUso =
  | { readonly tipo: 'PUERTO'; readonly error: ErrorPuerto }
  | { readonly tipo: 'TRANSICION'; readonly error: ErrorTransicion }
  | { readonly tipo: 'SIN_QR_VIGENTE'; readonly cobroId: string }
  /**
   * El banco reporta un pago para el cobro que se quería anular. No se anula:
   * anular un cobro pagado dejaría la plata acreditada y el cobro muerto.
   */
  | { readonly tipo: 'ABONO_DETECTADO'; readonly cobroId: string }
  /** Llegó un pago sobre el QR vencido: el cobro pasó a `EN_REVISION`. */
  | { readonly tipo: 'ABONO_TARDIO'; readonly cobroId: string }
  /**
   * Se quiso confirmar a mano un caso sin ningún abono del banco en la
   * evidencia. Primero hay que buscarlo en el banco (regla #1).
   */
  | { readonly tipo: 'SIN_DETECCION_DEL_BANCO'; readonly cobroId: string }
  /**
   * Se quiso aceptar un abono que ya no es el último que reportó el banco: la
   * persona decidió mirando algo que cambió. Hay que volver a mirar.
   */
  | { readonly tipo: 'ABONO_DESACTUALIZADO'; readonly cobroId: string };

const dePuerto = (error: ErrorPuerto): ErrorCasoUso => ({ tipo: 'PUERTO', error });
const deTransicion = (error: ErrorTransicion): ErrorCasoUso => ({ tipo: 'TRANSICION', error });

/** Estados cuyo QR el cliente puede estar pagando ahora mismo. */
const ESPERANDO_PAGO = ['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO'] as const;
const esperaPago = (cobro: Cobro): boolean =>
  (ESPERANDO_PAGO as readonly string[]).includes(cobro.estado);

/**
 * Aplica una transición y la persiste.
 *
 * **La evidencia se escribe antes que el estado**, a propósito: si falla el
 * guardado del cobro queda un registro de evidencia sin cambio de estado, que
 * es una inconsistencia auditable y detectable. Al revés —estado guardado sin
 * evidencia— quedaría un cobro confirmado sin rastro de por qué, que es
 * exactamente lo que la regla #8 existe para impedir.
 *
 * El guardado exige que el cobro siga en el estado del que partió la
 * transición. Si otro proceso lo cambió mientras tanto (el satélite lo
 * confirmó mientras el dueño lo anulaba), falla con `CONFLICTO` en vez de
 * pisarlo.
 */
export async function aplicar(
  deps: DepsPersistencia,
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

  const guardadoCobro = await deps.cobros.guardar(transicion.valor.cobro, cobro.estado);
  if (!esExito(guardadoCobro)) {
    return fallo(dePuerto(guardadoCobro.error));
  }

  return exito(transicion.valor);
}

/** Pide el QR al proveedor y deja el cobro en `QR_ACTIVO`. */
export async function emitirQr(
  deps: Pick<DepsEmision, 'cobros' | 'evidencia' | 'qr'>,
  cobro: Cobro,
  venceEn: Date,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const tipo = cobro.estado === 'VENCIDO' ? 'QR_RENOVADO' : 'QR_EMITIDO';
  // Antes de pedirle nada al banco: un QR emitido para un cobro que no lo
  // admite quedaría vivo y pagable, sin ningún cobro que lo espere.
  const inadmisible = verificarAdmision(cobro, tipo);
  if (inadmisible !== null) {
    return fallo(deTransicion(inadmisible));
  }

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

  const resultado = await aplicar(deps, cobro, { tipo, qr: emitido.valor, origen: 'sistema' }, ahora);
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

/** Manda el QR al cliente por WhatsApp y deja el cobro en `ENVIADO`. */
export async function enviarQr(
  deps: Pick<DepsEmision, 'cobros' | 'evidencia' | 'mensajeria'>,
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
  deps: DepsPersistencia,
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

/**
 * Anula un cobro por decisión del dueño.
 *
 * En este orden:
 * 1. Se pregunta al banco si el QR ya se pagó. Si se pagó, no se anula: un
 *    cobro vigente queda como está para que se verifique; uno vencido pasa a
 *    `EN_REVISION`, porque ahí hay plata real que alguien tiene que mirar.
 * 2. Se anula el QR en el banco, si todavía era pagable. Si el banco no lo
 *    anula, el cobro tampoco: seguiría cobrable y nadie lo miraría.
 * 3. Se vuelve a preguntar: el cliente pudo pagar entre 1 y 2. Si pagó, el
 *    cobro no se anula (queda para que el satélite lo verifique).
 * 4. Se registra la anulación, con origen `accion-manual` (regla #8).
 */
export async function anular(
  deps: DepsAnulacion,
  cobro: Cobro,
  motivo: string,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const inadmisible = verificarAdmision(cobro, 'ANULADO');
  if (inadmisible !== null) {
    return fallo(deTransicion(inadmisible));
  }

  const qr = cobro.qrVigente;
  if (qr !== null) {
    const consulta = await deps.watcher.consultarCobro(qr.referenciaProveedor);
    if (!esExito(consulta)) {
      return fallo(dePuerto(consulta.error));
    }
    if (consulta.valor !== null) {
      return cobro.estado === 'VENCIDO'
        ? rechazarPorAbonoTardio(deps, cobro, consulta.valor, ahora)
        : fallo({ tipo: 'ABONO_DETECTADO', cobroId: cobro.id });
    }
  }

  let anulacion: QrAnulado | null = null;
  if (qr !== null && tieneQrPagable(cobro)) {
    const anulado = await anularQr(deps, qr, ahora);
    if (!esExito(anulado)) {
      return anulado;
    }
    anulacion = anulado.valor;

    const despues = await deps.watcher.consultarCobro(qr.referenciaProveedor);
    if (!esExito(despues)) {
      return fallo(dePuerto(despues.error));
    }
    if (despues.valor !== null) {
      return fallo({ tipo: 'ABONO_DETECTADO', cobroId: cobro.id });
    }
  }

  const resultado = await aplicar(
    deps,
    cobro,
    { tipo: 'ANULADO', motivo, anulacion, origen: 'accion-manual' },
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
  deps: DepsVerificacion,
  cobroInicial: Cobro,
  ahora: Date,
): Promise<Resultado<ResultadoVerificacion, ErrorCasoUso>> {
  if (!esperaPago(cobroInicial)) {
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

export type ResultadoVigilancia =
  | ResultadoVerificacion
  /** Venció sin pago; su QR quedó anulado en el banco. */
  | { readonly tipo: 'VENCIDO'; readonly cobro: Cobro }
  /** Tenía comprobante pero el banco nunca vio el abono: pasó a revisión. */
  | { readonly tipo: 'VENTANA_AGOTADA'; readonly cobro: Cobro };

/**
 * Lo que el satélite hace con cada cobro que espera un pago, en este orden:
 *
 * 1. **Primero, el banco.** Un pago hecho segundos antes del vencimiento
 *    tiene que conciliar, no terminar en un cobro vencido con la plata
 *    adentro. Por eso se verifica antes de mirar el reloj.
 * 2. Si no hay pago y el QR venció, **se anula en el banco**. Si el banco no
 *    anula, el cobro queda como estaba y se reintenta en la próxima pasada:
 *    sigue esperando pago, así que se lo sigue mirando.
 * 3. **Se vuelve a mirar el banco.** El cliente pudo pagar entre 1 y 2; ya
 *    anulado, el QR no cambia más, así que esta consulta es la última palabra.
 *    Si pagó, concilia como cualquier pago.
 * 4. Recién entonces el cobro vence (o pasa a revisión, si el cliente había
 *    mandado comprobante).
 */
export async function vigilar(
  deps: DepsVigilancia,
  cobro: Cobro,
  ahora: Date,
): Promise<Resultado<ResultadoVigilancia, ErrorCasoUso>> {
  if (!esperaPago(cobro)) {
    return exito({ tipo: 'NO_CORRESPONDE', cobro });
  }

  const antes = await verificarPago(deps, cobro, ahora);
  if (!esExito(antes) || antes.valor.tipo !== 'SIN_ABONO') {
    return antes;
  }

  const qr = cobro.qrVigente;
  if (qr === null || !qrEstaVencido(cobro, ahora)) {
    return antes;
  }

  const anulacion = await anularQr(deps, qr, ahora);
  if (!esExito(anulacion)) {
    return anulacion;
  }

  const despues = await verificarPago(deps, cobro, ahora);
  if (!esExito(despues) || despues.valor.tipo !== 'SIN_ABONO') {
    return despues;
  }

  const agotada = cobro.estado === 'COMPROBANTE_RECIBIDO';
  const resultado = await aplicar(
    deps,
    cobro,
    agotada
      ? { tipo: 'VENTANA_AGOTADA', anulacion: anulacion.valor, origen: 'sistema' }
      : { tipo: 'QR_VENCIDO', anulacion: anulacion.valor, origen: 'sistema' },
    ahora,
  );
  if (!esExito(resultado)) {
    return resultado;
  }
  return exito({ tipo: agotada ? 'VENTANA_AGOTADA' : 'VENCIDO', cobro: resultado.valor.cobro });
}

/**
 * Renueva el QR de un cobro vencido y lo reenvía.
 *
 * No crea un cobro nuevo: incrementa `qrVersion` sobre el mismo (regla #6).
 * Antes mira si el QR vencido llegó a pagarse: renovar un cobro ya pagado le
 * pediría al cliente que pague dos veces.
 */
export async function renovarYReenviar(
  deps: DepsRenovacion,
  cobro: Cobro,
  venceEn: Date,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  if (cobro.estado === 'VENCIDO' && cobro.qrVigente !== null) {
    const consulta = await deps.watcher.consultarCobro(cobro.qrVigente.referenciaProveedor);
    if (!esExito(consulta)) {
      return fallo(dePuerto(consulta.error));
    }
    if (consulta.valor !== null) {
      return rechazarPorAbonoTardio(deps, cobro, consulta.valor, ahora);
    }
  }

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
  /** Abonos que ya figuran en la evidencia de su cobro (el caso normal). */
  readonly yaRegistrados: number;
  /**
   * El banco reporta el pago, pero ni la consulta puntual ni la evidencia lo
   * respaldan. No se transiciona nada: lo mira una persona.
   */
  readonly sinCorroborar: readonly string[];
  /** Abonos que no corresponden a ningún cobro que los espere: plata sin dueño. */
  readonly huerfanos: readonly string[];
  /**
   * Abonos que no se pudieron procesar (un puerto falló). No cortan el resto
   * del día; el cierre se reintenta y, como es idempotente, no duplica nada.
   */
  readonly conError: readonly { readonly idDeduplicacion: string; readonly error: ErrorCasoUso }[];
};

type DestinoAbono =
  | 'confirmado'
  | 'enRevision'
  | 'yaRegistrado'
  | 'sinCorroborar'
  | 'huerfano';

/**
 * Cierre del día: contrasta los abonos que informa el banco contra los cobros.
 *
 * Es la red de seguridad del polling. Cada abono se busca por su QR, en
 * **cualquier** estado del cobro: un pago de un cobro ya confirmado es el caso
 * normal, no un huérfano — siempre que figure en su evidencia. Lo que nunca
 * pasa es descartar un abono en silencio.
 *
 * Es idempotente: correrlo dos veces sobre el mismo día no duplica nada, porque
 * lo que ya se registró la primera vez figura en la evidencia la segunda.
 */
export async function conciliarDia(
  deps: DepsVerificacion,
  fecha: Date,
  ahora: Date,
): Promise<Resultado<ResumenConciliacionDiaria, ErrorCasoUso>> {
  const abonos = await deps.watcher.listarAbonosDelDia(fecha);
  if (!esExito(abonos)) {
    return fallo(dePuerto(abonos.error));
  }

  const confirmados: string[] = [];
  const enRevision: string[] = [];
  const sinCorroborar: string[] = [];
  const huerfanos: string[] = [];
  const conError: { idDeduplicacion: string; error: ErrorCasoUso }[] = [];
  let yaRegistrados = 0;

  for (const abono of abonos.valor) {
    const destino = await destinoDelAbono(deps, abono, ahora);
    if (!esExito(destino)) {
      conError.push({ idDeduplicacion: abono.idDeduplicacion, error: destino.error });
      continue;
    }
    switch (destino.valor.destino) {
      case 'confirmado':
        confirmados.push(destino.valor.cobroId);
        break;
      case 'enRevision':
        enRevision.push(destino.valor.cobroId);
        break;
      case 'yaRegistrado':
        yaRegistrados += 1;
        break;
      case 'sinCorroborar':
        sinCorroborar.push(abono.idDeduplicacion);
        break;
      case 'huerfano':
        huerfanos.push(abono.idDeduplicacion);
        break;
    }
  }

  return exito({
    abonosLeidos: abonos.valor.length,
    confirmados,
    enRevision,
    yaRegistrados,
    sinCorroborar,
    huerfanos,
    conError,
  });
}

/** Qué hacer con un abono del reporte diario, según el cobro al que pertenece. */
async function destinoDelAbono(
  deps: DepsVerificacion,
  abono: DeteccionDePago,
  ahora: Date,
): Promise<Resultado<{ readonly destino: DestinoAbono; readonly cobroId: string }, ErrorCasoUso>> {
  const referencia = referenciaDe(abono.idDeduplicacion);
  const encontrado =
    referencia === null ? exito(null) : await deps.cobros.buscarPorReferenciaQr(referencia);
  if (!esExito(encontrado)) {
    return fallo(dePuerto(encontrado.error));
  }
  const cobro = encontrado.valor;
  if (cobro === null) {
    return exito({ destino: 'huerfano', cobroId: '' });
  }
  const cobroId = cobro.id;

  switch (cobro.estado) {
    case 'QR_ACTIVO':
    case 'ENVIADO':
    case 'COMPROBANTE_RECIBIDO': {
      const verificado = await verificarPago(deps, cobro, ahora);
      if (!esExito(verificado)) {
        return verificado;
      }
      const tipo = verificado.valor.tipo;
      return exito({
        destino:
          tipo === 'CONFIRMADO' ? 'confirmado' : tipo === 'EN_REVISION' ? 'enRevision' : 'sinCorroborar',
        cobroId,
      });
    }
    case 'VENCIDO': {
      // El reporte del banco es una consulta saliente autenticada: basta
      // como detección (BANECO-1). Pero sobre un QR vencido no concilia
      // sola: la decide una persona.
      const revisado = await registrarAbonoTardio(deps, cobro, abono, ahora);
      return esExito(revisado) ? exito({ destino: 'enRevision', cobroId }) : revisado;
    }
    case 'PAGO_DETECTADO':
    case 'CONFIRMADO':
    case 'EN_REVISION':
    case 'RECHAZADO': {
      // Solo es "ya registrado" si **este** abono figura en la evidencia. Un
      // cobro en revisión por comprobante sin pago, o uno ya confirmado con
      // otro abono, no explica este.
      const registros = await deps.evidencia.listarDeCobro(cobroId);
      if (!esExito(registros)) {
        return fallo(dePuerto(registros.error));
      }
      const figura = registros.valor.some(
        (r) => r.datos['idDeduplicacion'] === abono.idDeduplicacion,
      );
      if (figura) {
        return exito({ destino: 'yaRegistrado', cobroId });
      }
      if (cobro.estado !== 'EN_REVISION') {
        return exito({ destino: 'sinCorroborar', cobroId });
      }
      // En revisión y sin este abono: se adjunta, para que quien revise lo
      // vea y pueda aceptarlo. El cobro sigue en revisión.
      const adjuntado = await aplicar(
        deps,
        cobro,
        { tipo: 'DETECCION_EN_REVISION', deteccion: abono, origen: abono.origen },
        ahora,
      );
      return esExito(adjuntado) ? exito({ destino: 'enRevision', cobroId }) : adjuntado;
    }
    case 'BORRADOR':
    case 'ANULADO':
      // Pago sobre un QR que nunca se emitió o que se anuló: no hay cobro que
      // lo espere. Plata sin dueño, para una persona.
      return exito({ destino: 'huerfano', cobroId });
  }
}

/** Anula el QR en el proveedor y devuelve la constancia que exige la máquina. */
async function anularQr(
  deps: Pick<Dependencias, 'qr'>,
  qr: QrEmitido,
  ahora: Date,
): Promise<Resultado<QrAnulado, ErrorCasoUso>> {
  const anulado = await anularEnProveedor(deps.qr, qr, ahora);
  return esExito(anulado) ? anulado : fallo(dePuerto(anulado.error));
}

/** Lleva a `EN_REVISION` un cobro vencido cuyo QR el banco reporta pagado. */
async function registrarAbonoTardio(
  deps: DepsPersistencia,
  cobro: Cobro,
  deteccion: DeteccionDePago,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const resultado = await aplicar(
    deps,
    cobro,
    { tipo: 'ABONO_TARDIO', deteccion, origen: deteccion.origen },
    ahora,
  );
  return esExito(resultado) ? exito(resultado.valor.cobro) : resultado;
}

/**
 * Para renovar y anular: el QR vencido resultó pagado. El cobro pasa a
 * revisión y la operación pedida **no** se hace — y se avisa con un error, no
 * con un éxito, para que quien la pidió se entere de que pasó otra cosa.
 */
async function rechazarPorAbonoTardio(
  deps: DepsPersistencia,
  cobro: Cobro,
  deteccion: DeteccionDePago,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const revisado = await registrarAbonoTardio(deps, cobro, deteccion, ahora);
  return esExito(revisado) ? fallo({ tipo: 'ABONO_TARDIO', cobroId: cobro.id }) : revisado;
}

/** Extrae la referencia del proveedor de una clave `baneco:{qrId}:{transactionId}`. */
function referenciaDe(idDeduplicacion: string): string | null {
  const partes = idDeduplicacion.split(':');
  return partes.length === 3 ? (partes[1] ?? null) : null;
}

/** Reexportado para que el satélite arme un QR de prueba sin tocar el dominio. */
export type { QrEmitido };
