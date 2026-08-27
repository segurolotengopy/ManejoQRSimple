/**
 * `@mqs/wa-bridge` — adaptador `MessagingProvider` contra WhatsAppModular:
 * envío del QR con los datos del cobro y recepción del comprobante del cliente.
 *
 * Restricciones estructurales:
 * - **Único paquete que conoce WhatsAppModular.** No importa a ningún otro
 *   adaptador (validado en CI).
 * - El comprobante que entra por aquí es **evidencia auxiliar**, jamás una
 *   confirmación de pago (ADR-005, regla de negocio #1). Este paquete no
 *   transiciona estados: entrega el hecho al dominio.
 * - Los teléfonos se registran enmascarados (`+591 7** ***56`, regla #9).
 */

/** Identidad del paquete. */
export const PAQUETE = '@mqs/wa-bridge' as const;

/** El comprobante del cliente nunca confirma un pago (ADR-005). */
export const EL_COMPROBANTE_CONFIRMA_PAGOS = false;
