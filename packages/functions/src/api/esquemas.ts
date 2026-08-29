/**
 * Validación de los cuerpos que entran por HTTP (regla #11).
 *
 * Todo lo que llega de la red se valida acá antes de tocar el dominio. El
 * monto merece una nota: entra como **texto decimal** (`"150.50"`), no como
 * número. Un `number` de JSON ya perdió la información de cuántos decimales
 * traía y arrastra el error de punto flotante que la regla #5 prohíbe; el texto
 * lo convierte `desdeDecimalBob`, que rechaza el tercer decimal en vez de
 * redondearlo.
 */

import { z } from 'zod';

/** Teléfono boliviano en E.164. El demo opera solo en +591. */
const telefonoBolivia = z
  .string()
  .regex(/^\+591\d{8}$/, 'el teléfono debe ser +591 seguido de 8 dígitos');

export const cuerpoCrearCobro = z.object({
  telefonoCliente: telefonoBolivia,
  concepto: z.string().min(1).max(100),
  /** Decimal con punto y hasta dos decimales: `"150.50"`. */
  monto: z.string().regex(/^\d+(\.\d{1,2})?$/, 'el monto debe ser un decimal con punto, p. ej. 150.50'),
  /** Vigencia del QR. El default sale de la política del proveedor. */
  horasDeVigencia: z.number().int().positive().max(24 * 365).optional(),
});

export const cuerpoRenovar = z.object({
  horasDeVigencia: z.number().int().positive().max(24 * 365).optional(),
});

export const cuerpoAnular = z.object({
  motivo: z.string().min(1).max(200),
});

export const cuerpoComprobante = z.object({
  /** Identificador del mensaje en WhatsApp. Deduplica la doble entrega. */
  referenciaComprobante: z.string().min(1).max(200),
});

export type CuerpoCrearCobro = z.infer<typeof cuerpoCrearCobro>;
