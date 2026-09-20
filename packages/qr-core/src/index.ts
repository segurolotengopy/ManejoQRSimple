/**
 * `@mqs/qr-core` — dominio puro del cobro por QR.
 *
 * Restricción estructural (CLAUDE.md, docs/01 §4): este paquete **no importa a
 * nadie** — ni adaptadores, ni SDKs, ni I/O. Todo lo externo entra por los
 * puertos de `src/ports/`. La regla se valida en CI con dependency-cruiser.
 *
 * Las dos reglas críticas del dominio están sostenidas por el sistema de tipos,
 * no por disciplina:
 *
 * - `CONFIRMADO` exige una `ConciliacionAprobada`, y solo `conciliar()` puede
 *   fabricarla. Un comprobante de WhatsApp o un webhook del banco no llegan a
 *   producirla (reglas #1 y BANECO-1).
 * - Los montos son `Centavos`, un tipo marcado que solo se obtiene validando.
 *   Un `number` cualquiera no es asignable, así que "nunca floats para dinero"
 *   deja de depender de que alguien se acuerde (regla #5).
 */

export const PAQUETE = '@mqs/qr-core' as const;

// Común
export {
  aDecimalBob,
  centavos,
  desdeDecimalBob,
  formatearBob,
  sonIguales,
  sumar,
  type Centavos,
  type ErrorMonto,
} from './comun/dinero.js';
export {
  esExito,
  esFallo,
  exito,
  fallo,
  type Exito,
  type Fallo,
  type Resultado,
} from './comun/resultado.js';

// Cobro
export {
  enmascararTelefono,
  qrEstaVencido,
  PROVEEDORES,
  ORIGENES_QR,
  type Cobro,
  type DatosConsumidor,
  type OrigenQr,
  type Proveedor,
  type QrEmitido,
} from './cobro/cobro.js';
export {
  esTerminal,
  ESTADOS,
  ESTADOS_TERMINALES,
  ORIGENES,
  type EstadoCobro,
  type EstadoTerminal,
  type OrigenTransicion,
} from './cobro/estados.js';
export {
  tieneQrPagable,
  transicionar,
  verificarAdmision,
  type ErrorTransicion,
  type EventoCobro,
  type RegistroEvidencia,
  type TipoEvento,
  type TransicionAplicada,
  type ValorEvidencia,
} from './cobro/maquina-estados.js';

// La constancia de anulación se exporta como tipo, no su fábrica: solo los
// casos de uso la obtienen, anulando el QR de verdad.
export type { QrAnulado } from './cobro/anulacion.js';
export { aceptarAbono, type AbonoAceptado, type ErrorAceptacion } from './cobro/aceptacion.js';

// Conciliación
export {
  conciliar,
  POLITICA_POR_DEFECTO,
  type ConciliacionAprobada,
  type MotivoRechazo,
  type PoliticaConciliacion,
} from './conciliacion/conciliar.js';
export {
  claveBaneco,
  claveHash,
  registrarDeteccion,
  type DeteccionDePago,
  type OrigenDeteccion,
} from './conciliacion/deteccion.js';

// Revisión manual
export {
  construirCaso,
  MOTIVOS_REVISION,
  nivelDeAlerta,
  ordenarCasos,
  POLITICA_REVISION_POR_DEFECTO,
  resumirRevision,
  ultimaDeteccion,
  type AbonoRegistrado,
  type CasoRevision,
  type MotivoRevision,
  type NivelAlerta,
  type PoliticaRevision,
  type ResumenRevision,
  type UmbralesHoras,
} from './revision/revision.js';
export {
  construirCasoAbono,
  MOTIVO_MINIMO,
  MOTIVOS_ABONO_SIN_CONCILIAR,
  ordenarCasosAbono,
  type AbonoSinConciliar,
  type CasoAbono,
  type CobroDelAbono,
  type MotivoAbonoSinConciliar,
  type ResolucionAbono,
} from './revision/abono-sin-conciliar.js';
export {
  buscarAbonoEnRevision,
  cerrarAbonoSinConciliar,
  LIMITE_REVISION,
  listarRevision,
  resolverRevision,
  type ColaRevision,
  type DepsBusqueda,
  type DepsRevision,
  type Resolucion,
  type ResultadoBusqueda,
} from './casos-uso/revisar.js';

// Casos de uso: la orquestación del cobro sobre los puertos
export {
  anular,
  aplicar,
  conciliarDia,
  emitirQr,
  enviarQr,
  registrarComprobante,
  renovarYReenviar,
  verificarPago,
  vigilar,
  type Dependencias,
  type DepsAnulacion,
  type DepsCierre,
  type DepsEmision,
  type DepsPersistencia,
  type DepsRenovacion,
  type DepsVerificacion,
  type DepsVigilancia,
  type ErrorCasoUso,
  type ResultadoVerificacion,
  type ResultadoVigilancia,
  type ResumenConciliacionDiaria,
} from './casos-uso/cobrar.js';

// El aviso de confirmación al consumidor (docs/10 §4.6). Acelerador, nunca
// fuente de verdad: perder un aviso es tolerable, inventarlo no.
export {
  correspondeAvisar,
  encolarAviso,
  esperaDelReintento,
  horasEsperando,
  proximoIntento,
  DESENLACES_AVISO,
  type AvisoDeConfirmacion,
  type AvisoPendiente,
  type DesenlaceAviso,
} from './avisos/aviso.js';
export {
  describirAvisos,
  entregarAvisos,
  LIMITE_AVISOS_POR_PASADA,
  type DepsAviso,
  type ResumenAvisos,
} from './casos-uso/avisar.js';

// El contrato para proyectos consumidores (docs/10). No exporta —ni existe—
// ninguna operación que confirme un pago: la asimetría es el contrato.
export {
  crearCobroDeConsumidor,
  esDelConsumidor,
  idDeCobroDeConsumidor,
  pagoDeCobro,
  type DepsConsumidor,
  type PagoDeCobro,
  type ResultadoCreacion,
  type SolicitudCobroConsumidor,
} from './casos-uso/consumidores.js';

// Puertos y sus tests de contrato compartidos
export type {
  AbonosSinConciliarStore,
  AvisosStore,
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  MessagingProvider,
  NotificadorConsumidor,
  PaymentWatcher,
  QrProvider,
  ReferenciaMensaje,
  SolicitudQr,
} from './ports/puertos.js';
export {
  CASOS_ABONOS_SIN_CONCILIAR,
  CASOS_AVISOS,
  CASOS_COBRO_REPOSITORY,
  CASOS_EVIDENCE_STORE,
  CASOS_PAYMENT_WATCHER,
  CASOS_QR_PROVIDER,
  INSTANTE_DE_CONTRATO,
  type CasoDeContrato,
} from './ports/contrato.js';
export {
  AbonosSinConciliarEnMemoria,
  AvisosEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  NotificadorEnMemoria,
  NotificadorSinDestinos,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  type MensajeEnviado,
} from './ports/mocks.js';
