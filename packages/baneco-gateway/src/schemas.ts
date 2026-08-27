/**
 * DTOs de la API de Baneco, validados con Zod en el borde (regla #11).
 *
 * Nada de lo que llega por la red entra al dominio sin pasar por acá. Un campo
 * que el banco cambie de forma se convierte en un error de validación
 * explícito, no en un `undefined` que viaja hasta la conciliación.
 *
 * Fuente: manual derivado §§3–5, contrastable contra el PDF oficial
 * "Api Market v1.3.0" (`privado-no-gh/`), que es el que gobierna.
 */

import { z } from 'zod';

/** Todas las respuestas del banco traen este par. `0` es éxito. */
const respuestaBase = {
  responseCode: z.number().int(),
  message: z.string(),
};

/**
 * Solo el sobre. Se valida **antes** que la forma completa porque una
 * respuesta de error del banco no trae los campos del camino feliz (`qrId`
 * llega vacío, `payment` ausente). Si se validara la forma completa primero,
 * todo error del banco se reportaría como "respuesta inválida" y se perdería
 * el `responseCode` — que es justo lo que hay que registrar para construir el
 * catálogo empírico de errores (pregunta E1).
 */
export const sobreRespuesta = z.object(respuestaBase);

export const respuestaAutenticacion = z.object({
  token: z.string().min(1),
  ...respuestaBase,
});

export const respuestaGenerarQr = z.object({
  qrId: z.string().min(1),
  /** PNG en Base64. Puede faltar si `responseCode != 0`. */
  qrImage: z.string().nullish(),
  ...respuestaBase,
});

export const respuestaAnularQr = z.object(respuestaBase);

/**
 * Importe del banco: decimal con punto y hasta dos decimales.
 *
 * Se valida como texto porque un `number` de JSON ya perdió la información de
 * cuántos decimales traía. La conversión a centavos la hace `aCentavos()`.
 */
const importe = z.union([z.number(), z.string()]).refine(
  (v) => /^\d+(\.\d{1,2})?$/.test(typeof v === 'number' ? String(v) : v.trim()),
  { message: 'importe con más de dos decimales, coma o formato inesperado' },
);

/**
 * Un pago informado por el banco (`PaymentQR`).
 *
 * `senderName` se valida pero **no se propaga al dominio**: es el nombre de un
 * tercero y la regla #4 lo deja fuera de Firestore. Se acepta en el schema
 * porque el banco lo manda, no porque lo queramos guardar.
 */
export const pagoQr = z.object({
  qrId: z.string().min(1),
  /** Número de transacción del banco. Con `qrId` forma la clave de dedup (regla #7). */
  transactionId: z.string().min(1),
  /** `2021-06-14T00:00:00` — sin zona horaria (ver pregunta D7). */
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/),
  /** `17:06:29` */
  paymentTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  currency: z.enum(['BOB', 'USD']),
  amount: importe,
  senderBankCode: z.string().nullish(),
  senderName: z.string().nullish(),
  senderDocumentId: z.string().nullish(),
  /** Ya llega ofuscado por el banco (`******5691`). */
  senderAccount: z.string().nullish(),
  description: z.string().nullish(),
  branchCode: z.string().nullish(),
});

/**
 * Estados del QR (manual §5.2): 0 activo, 1 pagado, 9 anulado.
 *
 * No hay estado "vencido" documentado — es la pregunta C4 al banco. Hasta que
 * responda, un QR vencido sin pagar se asume que sigue informando 0.
 */
export const ESTADO_QR = { ACTIVO: 0, PAGADO: 1, ANULADO: 9 } as const;

/**
 * Respuesta de `statusQR`.
 *
 * El nombre del campo aparece como `statusQrCode` en la documentación, pero se
 * acepta también `statusQRCode`: la espec. no es consistente en el uso de
 * mayúsculas y equivocarse acá significa no detectar un pago. Absorber la
 * variante cuesta una línea; perder un pago, no.
 */
export const respuestaEstadoQr = z
  .object({
    statusQrCode: z.number().int().nullish(),
    statusQRCode: z.number().int().nullish(),
    payment: z.array(pagoQr).nullish(),
    ...respuestaBase,
  })
  .transform((r, ctx) => {
    const estado = r.statusQrCode ?? r.statusQRCode;
    if (estado === null || estado === undefined) {
      ctx.addIssue({ code: 'custom', message: 'falta statusQrCode / statusQRCode' });
      return z.NEVER;
    }
    return { estado, pagos: r.payment ?? [], responseCode: r.responseCode, message: r.message };
  });

export const respuestaPagosDelDia = z.object({
  paymentList: z.array(pagoQr).nullish(),
  ...respuestaBase,
});

export type RespuestaAutenticacion = z.infer<typeof respuestaAutenticacion>;
export type RespuestaGenerarQr = z.infer<typeof respuestaGenerarQr>;
export type RespuestaEstadoQr = z.infer<typeof respuestaEstadoQr>;
export type RespuestaPagosDelDia = z.infer<typeof respuestaPagosDelDia>;
export type PagoQr = z.infer<typeof pagoQr>;

/** Cuerpo de `generateQR` (manual §4.1). */
export type SolicitudGenerarQr = {
  readonly transactionId: string;
  /** Cuenta de abono **cifrada** en AES-256-CBC/Base64. Nunca en claro. */
  readonly accountCredit: string;
  readonly currency: 'BOB' | 'USD';
  /** Decimal con dos posiciones, punto separador. */
  readonly amount: string;
  readonly description: string;
  /** `yyyy-MM-dd`. */
  readonly dueDate: string;
  readonly singleUse: boolean;
  readonly modifyAmount: boolean;
  readonly branchCode?: string;
};

/** Límites de longitud del API Gateway (manual §4.1). */
export const LIMITES = {
  transactionId: 30,
  accountCredit: 10,
  description: 100,
  branchCode: 5,
} as const;
