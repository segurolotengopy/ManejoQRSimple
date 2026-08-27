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
  transicionar,
  type ErrorTransicion,
  type EventoCobro,
  type RegistroEvidencia,
  type TipoEvento,
  type TransicionAplicada,
  type ValorEvidencia,
} from './cobro/maquina-estados.js';

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

// Casos de uso: la orquestación del cobro sobre los puertos
export {
  aplicar,
  conciliarDia,
  emitirQr,
  enviarQr,
  registrarComprobante,
  renovarYReenviar,
  vencerSiCorresponde,
  verificarPago,
  type Dependencias,
  type ErrorCasoUso,
  type ResultadoVerificacion,
  type ResumenConciliacionDiaria,
} from './casos-uso/cobrar.js';

// Puertos y sus tests de contrato compartidos
export type {
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  MessagingProvider,
  PaymentWatcher,
  QrProvider,
  ReferenciaMensaje,
  SolicitudQr,
} from './ports/puertos.js';
export {
  CASOS_COBRO_REPOSITORY,
  CASOS_EVIDENCE_STORE,
  CASOS_PAYMENT_WATCHER,
  CASOS_QR_PROVIDER,
  type CasoDeContrato,
} from './ports/contrato.js';
export {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  type MensajeEnviado,
} from './ports/mocks.js';
