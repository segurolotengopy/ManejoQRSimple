/**
 * `@mqs/baneco-gateway` — adaptador de la API oficial de Cobros QR Simple de
 * Banco Económico S.A. (espec. "Api Market v1.3.0").
 *
 * Restricciones estructurales:
 * - **Único paquete que conoce la API de Baneco**: sus URLs, DTOs, cifrado y
 *   códigos de respuesta. Nada fuera de aquí los importa (validado en CI).
 * - Implementa dos puertos de `@mqs/qr-core` — `QrProvider` (generateQR /
 *   cancelQR) y `PaymentWatcher` (statusQR / paidQR) — y no importa a ningún
 *   otro adaptador.
 *
 * Regla de dominio propia de este proveedor (**BANECO-1**): el webhook
 * `notifyPaymentQR` del banco **jamás** confirma un pago. Es un disparador de
 * verificación; solo la consulta saliente autenticada (`statusQR`/`paidQR`)
 * es fuente de verdad. Es la misma lógica que ADR-005 aplica al comprobante
 * del cliente: lo que llega sin autenticar no confirma. Por eso este paquete
 * **no expone ningún handler de webhook** — la primera etapa opera por polling
 * (decisión D3), y el webhook solo llegaría en el Hito B3.
 *
 * ⚠️ Estado: Hito B1 — probado contra fixtures **derivadas de la
 * especificación**, no grabadas contra certificación. El Hito B0 espera
 * credenciales propias (pregunta A3 al banco). El esquema de cifrado (§2 del
 * manual) sigue siendo un supuesto hasta que B0 lo confirme.
 */

export const PAQUETE = '@mqs/baneco-gateway' as const;

/**
 * Regla BANECO-1 en forma ejecutable: ninguna evidencia entrante no autenticada
 * confirma un pago.
 */
export const EL_WEBHOOK_CONFIRMA_PAGOS = false;

export { PaymentWatcherBaneco, QrProviderBaneco } from './adaptadores.js';
export { ProveedorDeToken, leerExp, type Reloj } from './auth/token.js';
export { ClienteBaneco, type EstadoDeQr, type ResultadoGenerarQr } from './client/qr.js';
export {
  errorDeEstado,
  errorPuerto,
  transporteFetch,
  type PeticionHttp,
  type RespuestaHttp,
  type Transporte,
} from './client/http.js';
export {
  describir,
  leerConfig,
  type Ambiente,
  type ConfigBaneco,
  type ErrorConfig,
} from './config.js';
export { Secreto } from './secreto.js';
export {
  cifrar,
  descifrar,
  llaveAes,
  sonIgualesEnTiempoConstante,
  type ErrorCifrado,
  type LlaveAes,
} from './crypto/aes.js';
export {
  aCentavos,
  aDeteccion,
  aFechaBaneco,
  aFechaCompacta,
  instanteDelPago,
  type ErrorMapeo,
} from './mapeo.js';
export { ESTADO_QR, LIMITES, type PagoQr, type SolicitudGenerarQr } from './schemas.js';
