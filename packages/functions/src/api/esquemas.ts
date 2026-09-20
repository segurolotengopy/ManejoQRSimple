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

/**
 * Resolución manual de un caso en revisión. El motivo es obligatorio y no
 * trivial: es lo que un auditor va a leer para entender por qué una persona
 * confirmó o rechazó un pago que el sistema no pudo decidir (regla #8).
 */
const motivoResolucion = z
  .string()
  .trim()
  .min(10, 'contá en al menos 10 caracteres por qué decidís esto')
  .max(300);

/**
 * Confirmar nombra el abono del banco que la persona vio en pantalla: si
 * mientras decidía el banco reportó otro, el dominio lo rechaza y hay que
 * volver a mirar.
 */
export const cuerpoResolver = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CONFIRMADO'),
    idDeduplicacion: z.string().min(1).max(200),
    motivo: motivoResolucion,
  }),
  z.object({ decision: z.literal('RECHAZADO'), motivo: motivoResolucion }),
]);

/** Cerrar un abono sin conciliar: qué se hizo con la plata. */
export const cuerpoCerrarAbono = z.object({ motivo: motivoResolucion });

/** QR de prueba: el monto lo fija el servidor; acá solo se elige la vigencia. */
export const cuerpoQrDePrueba = z.object({
  vigenciaMinutos: z.number().int().min(2).max(24 * 60).optional(),
});

export const cuerpoComprobante = z.object({
  /** Identificador del mensaje en WhatsApp. Deduplica la doble entrega. */
  referenciaComprobante: z.string().min(1).max(200),
});

export type CuerpoCrearCobro = z.infer<typeof cuerpoCrearCobro>;

// --- Contrato para proyectos consumidores (docs/10)

/**
 * Referencia externa de un consumidor: **opaca**, corta y segura en una URL.
 *
 * El juego de caracteres es deliberadamente chico. No impide que un consumidor
 * mande un dato personal —nada puede—, pero deja afuera de entrada los `@` de
 * un correo y los espacios de un nombre, que es por donde se colaría sin
 * querer (decisión #4 del contrato). Que sea segura en una URL importa porque
 * `GET /api/v1/cobros/por-referencia/:referencia` la lleva en la ruta.
 */
export const referenciaExterna = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9:_.-]{1,120}$/,
    'la referencia externa admite letras, números y : _ . - (hasta 120 caracteres)',
  );

export const cuerpoCrearCobroConsumidor = z.object({
  referenciaExterna,
  concepto: z.string().min(1).max(100),
  /** Decimal con punto y hasta dos decimales: `"150.50"` (regla #5). */
  monto: z.string().regex(/^\d+(\.\d{1,2})?$/, 'el monto debe ser un decimal con punto, p. ej. 150.50'),
  horasDeVigencia: z.number().int().positive().max(24 * 365).optional(),
});

/** Anular: el motivo es opcional, pero si viene queda en la evidencia (regla #8). */
export const cuerpoAnularConsumidor = z.object({
  motivo: z.string().trim().min(1).max(200).optional(),
});

/**
 * Rango de un listado. Las fechas van en ISO 8601 **con zona** (`Z` o `±hh:mm`).
 *
 * Exigir la zona evita la ambigüedad más cara de este dominio: el banco
 * informa en hora de Bolivia (respuesta D7) y el consumidor puede estar en
 * otra. Una fecha sin zona obligaría a adivinar cuál, y adivinar mal corre un
 * cierre de día entero.
 */
export const consultaListado = z.object({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
  limite: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform((v) => Number(v))
    .refine((v) => v >= 1 && v <= 100, 'el límite va de 1 a 100')
    .optional(),
});
