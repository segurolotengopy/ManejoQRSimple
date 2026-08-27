/**
 * Transporte que graba lo que pasa por él.
 *
 * `ClienteBaneco` devuelve objetos ya validados, que es lo correcto para
 * producción pero inservible para armar fixtures: hace falta el cuerpo crudo
 * tal como lo mandó el banco. Envolver el transporte permite tener las dos
 * cosas sin ensuciar el cliente con un modo "dame el crudo".
 *
 * También es de acá de donde sale el `message` real del banco para el catálogo
 * empírico de errores (pregunta E1): el cliente lo descarta a propósito, porque
 * puede nombrar al usuario.
 */

import type { RespuestaHttp, Transporte } from '@mqs/baneco-gateway';
import { esExito } from '@mqs/qr-core';

export type Grabacion = {
  readonly url: string;
  readonly metodo: string;
  readonly status: number;
  readonly cuerpo: unknown;
};

export class Grabador {
  readonly grabaciones: Grabacion[] = [];

  constructor(private readonly base: Transporte) {}

  readonly enviar: Transporte = async (peticion) => {
    const respuesta = await this.base(peticion);
    if (esExito(respuesta)) {
      this.grabaciones.push({
        url: peticion.url,
        metodo: peticion.metodo,
        status: respuesta.valor.status,
        cuerpo: respuesta.valor.cuerpo,
      });
    }
    return respuesta;
  };

  /** Última respuesta cruda de una URL que contenga el fragmento dado. */
  ultima(fragmentoUrl: string): RespuestaHttp | null {
    for (let i = this.grabaciones.length - 1; i >= 0; i -= 1) {
      const g = this.grabaciones[i];
      if (g !== undefined && g.url.includes(fragmentoUrl)) {
        return { status: g.status, cuerpo: g.cuerpo };
      }
    }
    return null;
  }
}

/** Extrae `responseCode` y `message` de un cuerpo crudo, si los trae. */
export function sobreDe(cuerpo: unknown): { codigo: string; mensaje: string } | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return null;
  }
  const registro = cuerpo as Record<string, unknown>;
  const codigo = registro['responseCode'];
  if (typeof codigo !== 'number') {
    return null;
  }
  const mensaje = registro['message'];
  return { codigo: String(codigo), mensaje: typeof mensaje === 'string' ? mensaje : '' };
}
