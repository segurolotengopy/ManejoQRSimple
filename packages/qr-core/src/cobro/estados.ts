/**
 * Estados del cobro (CLAUDE.md — "Máquina de estados del cobro").
 *
 * `PAGO_DETECTADO` y `CONFIRMADO` son dos estados a propósito: la detección la
 * reporta un adaptador (`PaymentWatcher`), la conciliación la decide el dominio.
 * Colapsarlos sería permitir que un adaptador confirme un cobro por su cuenta.
 */

export const ESTADOS = [
  'BORRADOR',
  'QR_ACTIVO',
  'ENVIADO',
  'COMPROBANTE_RECIBIDO',
  'PAGO_DETECTADO',
  'CONFIRMADO',
  'EN_REVISION',
  'RECHAZADO',
  'VENCIDO',
  'ANULADO',
] as const;

export type EstadoCobro = (typeof ESTADOS)[number];

/** Estados terminales: de acá no sale ninguna transición. */
export const ESTADOS_TERMINALES = ['CONFIRMADO', 'RECHAZADO', 'ANULADO'] as const;

export type EstadoTerminal = (typeof ESTADOS_TERMINALES)[number];

export function esTerminal(estado: EstadoCobro): estado is EstadoTerminal {
  return (ESTADOS_TERMINALES as readonly EstadoCobro[]).includes(estado);
}

/**
 * De dónde vino una transición (regla #8: toda transición registra su origen).
 *
 * `accion-manual` es el único origen que una persona puede producir, y queda
 * marcado como tal en la evidencia justamente para que sea auditable.
 *
 * `contrato-consumidor` existe por la misma razón: una anulación que pide otro
 * producto por el contrato de docs/10 **no** es una acción del dueño, y
 * firmarla como `accion-manual` le sacaría a la evidencia lo único que hace
 * auditable ese registro — quién la hizo. El id del consumidor va en los datos
 * del registro.
 */
export const ORIGENES = [
  'sistema',
  'watcher-baneco',
  'scraper-yape',
  'webhook-whatsapp',
  'accion-manual',
  'contrato-consumidor',
] as const;

export type OrigenTransicion = (typeof ORIGENES)[number];
