/**
 * La prueba de que una persona aceptó un abono **que el banco reportó para este
 * cobro**.
 *
 * Es el equivalente manual de `ConciliacionAprobada`: la máquina de estados
 * exige una para llevar un caso en revisión a `CONFIRMADO`, y es un tipo marcado
 * que solo fabrica `aceptarAbono()`. Así la regla #1 —solo el banco confirma—
 * vale también para la persona, y no depende de que ningún script use el
 * camino directo: sin una detección del banco en la evidencia del cobro, no hay
 * `AbonoAceptado`, y sin él no hay confirmación manual.
 *
 * No importa la máquina de estados (ella importa este módulo, y la regla de
 * dependencias prohíbe los ciclos): recibe los registros por su forma.
 */

import { exito, fallo, type Resultado } from '../comun/resultado.js';
import type { Cobro } from './cobro.js';

declare const marcaAceptacion: unique symbol;

export type AbonoAceptado = {
  readonly [marcaAceptacion]: 'abono-aceptado';
  readonly cobroId: string;
  readonly idDeduplicacion: string;
};

/** Eventos cuya evidencia lleva una detección del banco. */
export const EVENTOS_CON_DETECCION = [
  'PAGO_DETECTADO',
  'ABONO_TARDIO',
  'DETECCION_EN_REVISION',
] as const;

/** Lo que hace falta de un registro de evidencia. */
export type RegistroConDetecciones = {
  readonly cobroId: string;
  readonly evento: string;
  readonly datos: Readonly<Record<string, string | number | null>>;
};

export type ErrorAceptacion =
  /** El banco no reportó ningún abono para este cobro: no hay nada que aceptar. */
  | { readonly tipo: 'SIN_DETECCION_DEL_BANCO' }
  /**
   * El abono que se quiere aceptar no es el último que reportó el banco: la
   * persona decidió mirando algo que ya cambió.
   */
  | { readonly tipo: 'ABONO_DESACTUALIZADO'; readonly ultimo: string };

/**
 * Acepta el abono `idDeduplicacion` para el cobro, solo si es **el último que
 * el banco reportó para ese mismo cobro**. Los registros de otros cobros se
 * ignoran: un abono no se acepta para un cobro que no es el suyo.
 */
export function aceptarAbono(
  cobro: Pick<Cobro, 'id'>,
  registros: readonly RegistroConDetecciones[],
  idDeduplicacion: string,
): Resultado<AbonoAceptado, ErrorAceptacion> {
  const detecciones = registros
    .filter(
      (r) =>
        r.cobroId === cobro.id &&
        (EVENTOS_CON_DETECCION as readonly string[]).includes(r.evento),
    )
    .map((r) => r.datos['idDeduplicacion'])
    .filter((id): id is string => typeof id === 'string' && id !== '');

  const ultimo = detecciones.at(-1);
  if (ultimo === undefined) {
    return fallo({ tipo: 'SIN_DETECCION_DEL_BANCO' });
  }
  if (ultimo !== idDeduplicacion) {
    return fallo({ tipo: 'ABONO_DESACTUALIZADO', ultimo });
  }
  return exito({ cobroId: cobro.id, idDeduplicacion } as AbonoAceptado);
}
