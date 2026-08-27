/**
 * `@mqs/functions` — Cloud Functions del demo: API HTTP y triggers de Firestore.
 *
 * Restricciones estructurales:
 * - **Orquesta; no decide.** Ninguna regla de negocio vive aquí: toda
 *   transición de estado pasa por la función única de `@mqs/qr-core`.
 * - Expone endpoints (webhook de comprobantes de wa-bridge y, si el dueño
 *   aprueba el Hito B3, el de `notifyPaymentQR` de Baneco), pero la evidencia
 *   que reciben no confirma pagos por sí sola.
 * - El despliegue a Firebase nunca es automático: lo pide el dueño explícitamente.
 */

/** Identidad del paquete. */
export const PAQUETE = '@mqs/functions' as const;

/** Las reglas de negocio viven en el dominio, no en la capa de orquestación. */
export const CONTIENE_REGLAS_DE_NEGOCIO = false;
