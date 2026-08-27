/**
 * Detección de un abono candidato, reportada por un `PaymentWatcher`.
 *
 * Es **candidata**, no confirmada: el adaptador dice "vi este abono", el
 * dominio decide si concilia. Por eso `DeteccionDePago` no confirma nada por
 * sí sola — hay que pasarla por `conciliar()`.
 *
 * Los datos son los mínimos de la regla #4: monto, momento, referencia y una
 * clave de deduplicación. Nunca saldos, nunca el nombre del pagador.
 */

import { createHash } from 'node:crypto';

import type { Centavos } from '../comun/dinero.js';

declare const marcaDeteccion: unique symbol;

export type OrigenDeteccion = 'watcher-baneco' | 'scraper-yape';

export type DeteccionDePago = {
  readonly [marcaDeteccion]: 'deteccion-de-pago';
  /** Clave natural estable: dos lecturas del mismo abono producen la misma. */
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
  readonly origen: OrigenDeteccion;
  /** Glosa o referencia del movimiento. Puede faltar. */
  readonly referencia: string | null;
};

/**
 * Registra una detección. Lo llaman los adaptadores de `PaymentWatcher`, que
 * son los únicos que ven el mundo exterior.
 *
 * Que este constructor sea público no debilita la regla #1: tener una
 * detección no alcanza para confirmar un cobro. `CONFIRMADO` exige una
 * `ConciliacionAprobada`, y esa solo la fabrica `conciliar()`.
 */
export function registrarDeteccion(datos: {
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
  readonly origen: OrigenDeteccion;
  readonly referencia: string | null;
}): DeteccionDePago {
  return datos as DeteccionDePago;
}

/**
 * Clave de deduplicación de Baneco (regla #7).
 *
 * El banco entrega identificadores propios, así que no hace falta hashear
 * nada: `qrId` + número de transacción ya son una clave natural estable.
 */
export function claveBaneco(qrId: string, transactionId: string): string {
  return `baneco:${qrId}:${transactionId}`;
}

/**
 * Clave de deduplicación para fuentes sin identificador propio, como la
 * consola Yape: hash estable de fecha + monto + referencia (regla #7).
 *
 * El hash tiene que ser estable entre pasadas del watcher y entre reinicios;
 * por eso la fecha se normaliza a ISO en UTC y la referencia se recorta.
 */
export function claveHash(datos: {
  readonly proveedor: string;
  readonly ocurridoEn: Date;
  readonly montoCentavos: Centavos;
  readonly referencia: string | null;
}): string {
  const partes = [
    datos.proveedor,
    datos.ocurridoEn.toISOString(),
    String(datos.montoCentavos),
    (datos.referencia ?? '').trim(),
  ].join('|');
  const digest = createHash('sha256').update(partes, 'utf8').digest('hex');
  return `${datos.proveedor}:${digest}`;
}
