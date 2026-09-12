/**
 * Observación de las llamadas al banco, para depurar.
 *
 * Envuelve un `Transporte` y avisa, por cada llamada, qué se pidió y cómo
 * respondió el banco: método, **ruta sin query ni host**, estado HTTP,
 * `responseCode` y demora. Nada más. El cuerpo nunca sale de acá: lleva la
 * contraseña y la cuenta cifradas, y la ruta de cifrado del banco llevaría la
 * llave en la query string. Lo que no se observa no se puede filtrar.
 */

import { esExito } from '@mqs/qr-core';

import type { Transporte } from './http.js';

export type LlamadaAlBanco = {
  readonly metodo: string;
  /** Solo el camino: `/ApiGateway/api/qrsimple/generateQR`. */
  readonly ruta: string;
  readonly ms: number;
  /** `null` si no hubo respuesta (red, timeout). */
  readonly status: number | null;
  /** El `responseCode` del sobre del banco, si vino. */
  readonly responseCode: number | null;
  /** Tipo de falla del transporte (`INDISPONIBLE`, …) si no hubo respuesta. */
  readonly falla: string | null;
};

export function transporteObservado(
  base: Transporte,
  observar: (llamada: LlamadaAlBanco) => void,
  reloj: () => number = () => Date.now(),
): Transporte {
  return async (peticion) => {
    const inicio = reloj();
    const respuesta = await base(peticion);
    observar({
      metodo: peticion.metodo,
      ruta: rutaDe(peticion.url),
      ms: reloj() - inicio,
      status: esExito(respuesta) ? respuesta.valor.status : null,
      responseCode: esExito(respuesta) ? responseCodeDe(respuesta.valor.cuerpo) : null,
      falla: esExito(respuesta) ? null : respuesta.error.tipo,
    });
    return respuesta;
  };
}

function rutaDe(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '(url inválida)';
  }
}

function responseCodeDe(cuerpo: unknown): number | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('responseCode' in cuerpo)) {
    return null;
  }
  const { responseCode } = cuerpo;
  return typeof responseCode === 'number' ? responseCode : null;
}
