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
 * del cliente: lo que llega sin autenticar no confirma.
 *
 * El contenido real (crypto/aes.ts, auth/token.ts, client/qr.ts, watcher/*,
 * schemas.ts) llega en el Hito B1, contra fixtures grabadas en certificación
 * — nunca contra la API viva en CI.
 */

/** Identidad del paquete. */
export const PAQUETE = '@mqs/baneco-gateway' as const;

/**
 * Regla BANECO-1 en forma ejecutable: ninguna evidencia entrante no autenticada
 * confirma un pago. Se expone como constante para que los tests de contrato del
 * Hito B1 puedan afirmarla explícitamente.
 */
export const EL_WEBHOOK_CONFIRMA_PAGOS = false;
