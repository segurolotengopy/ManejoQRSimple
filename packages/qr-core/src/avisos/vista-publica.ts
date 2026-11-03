/**
 * Lo que un consumidor ve de un pago, en un solo lugar.
 *
 * Es el bloque `pago` de `estadoCobro` **y** del aviso de confirmación
 * (docs/10 §4.6). Vive en un módulo sin dependencias para que los dos lo usen
 * sin que el dominio tenga ciclos.
 */

import { aDecimalBob, type Centavos } from '../comun/dinero.js';
import type { OrigenTransicion } from '../cobro/estados.js';
import type { OrigenDeteccion } from '../conciliacion/deteccion.js';

/**
 * Nombres del riel hacia afuera.
 *
 * Se traducen en vez de exponer los del dominio: `watcher-baneco` describe
 * nuestra implementación, y un contrato que la filtra no se puede refactorizar
 * sin romperle el código a quien lo consume.
 */
const RIEL_PUBLICO: Readonly<Record<OrigenDeteccion, string>> = {
  'watcher-baneco': 'api-baneco',
  'scraper-yape': 'scraping-yape',
  'watcher-simulado': 'simulado',
};

/** Lo que de un pago puede ver el consumidor. Sin la clave de deduplicación del abono. */
export type DatosPublicosDelPago = {
  /** Cuándo este sistema lo dio por confirmado. */
  readonly confirmadoEn: Date;
  /** Cuándo ocurrió el abono según el banco. `null` si no consta. */
  readonly ocurridoEn: Date | null;
  readonly montoCentavos: Centavos | null;
  readonly riel: OrigenDeteccion | null;
  /** `sistema` si concilió solo; `accion-manual` si lo resolvió una persona. */
  readonly confirmadoPor: OrigenTransicion;
};

/**
 * El bloque `pago` que ve un consumidor, **el mismo** en `estadoCobro` y en el
 * aviso de confirmación (docs/10 §4.6). Hay una sola función a propósito: dos
 * copias del mapeo ya divergieron una vez, y la divergencia era en el monto.
 *
 * `monto` es lo que **entró al banco**; el `monto` del cobro es lo que se pedía.
 * Coinciden salvo en un abono por menos que el dueño aceptó a mano.
 */
export function vistaPublicaDelPago(pago: DatosPublicosDelPago): Record<string, unknown> {
  return {
    confirmadoEn: pago.confirmadoEn.toISOString(),
    ocurridoEn: pago.ocurridoEn?.toISOString() ?? null,
    monto: pago.montoCentavos === null ? null : aDecimalBob(pago.montoCentavos),
    riel: pago.riel === null ? null : RIEL_PUBLICO[pago.riel],
    confirmadoPor: pago.confirmadoPor === 'accion-manual' ? 'revision-manual' : 'automatico',
  };
}
