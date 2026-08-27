/**
 * Transporte HTTP del adaptador.
 *
 * Es una interfaz inyectable, no un `fetch` cableado, por dos razones: los
 * tests corren contra fixtures sin tocar la red (misma regla que el scraper —
 * jamás la API viva en CI), y el día que haga falta un timeout, un reintento o
 * un proxy, se cambia acá y no en las cuatro operaciones.
 */

import { exito, fallo, type ErrorPuerto, type Resultado } from '@mqs/qr-core';

export type PeticionHttp = {
  readonly metodo: 'GET' | 'POST' | 'DELETE';
  readonly url: string;
  readonly cuerpo?: unknown;
  /** JWT del banco. Nunca se registra. */
  readonly token?: string;
};

export type RespuestaHttp = {
  readonly status: number;
  readonly cuerpo: unknown;
};

export type Transporte = (peticion: PeticionHttp) => Promise<Resultado<RespuestaHttp, ErrorPuerto>>;

/** Transporte real sobre el `fetch` nativo de Node 22. */
export function transporteFetch(timeoutMs = 15_000): Transporte {
  return async (peticion) => {
    const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
    if (peticion.token !== undefined) {
      cabeceras['Authorization'] = `Bearer ${peticion.token}`;
    }

    const control = new AbortController();
    const temporizador = setTimeout(() => {
      control.abort();
    }, timeoutMs);

    try {
      const respuesta = await fetch(peticion.url, {
        method: peticion.metodo,
        headers: cabeceras,
        signal: control.signal,
        ...(peticion.cuerpo === undefined ? {} : { body: JSON.stringify(peticion.cuerpo) }),
      });

      const texto = await respuesta.text();
      let cuerpo: unknown = null;
      if (texto !== '') {
        try {
          cuerpo = JSON.parse(texto);
        } catch {
          return fallo(
            errorPuerto('RESPUESTA_INVALIDA', 'el banco respondió algo que no es JSON', false),
          );
        }
      }

      return exito({ status: respuesta.status, cuerpo });
    } catch (causa) {
      // Red caída, DNS, timeout: reintentable. El mensaje no lleva la URL
      // completa para no arrastrar identificadores a los logs.
      const motivo = causa instanceof Error ? causa.name : 'desconocido';
      return fallo(errorPuerto('INDISPONIBLE', `no se pudo contactar al banco (${motivo})`, true));
    } finally {
      clearTimeout(temporizador);
    }
  };
}

export function errorPuerto(
  tipo: ErrorPuerto['tipo'],
  mensaje: string,
  reintentable: boolean,
  codigoProveedor: string | null = null,
): ErrorPuerto {
  return { tipo, mensaje, reintentable, codigoProveedor };
}

/**
 * Traduce el estado HTTP a un error del puerto.
 *
 * `401` es su propia categoría porque el cliente lo usa para renovar el token
 * una vez antes de rendirse (supuesto B1 mientras el banco no documente la
 * vigencia del JWT).
 */
export function errorDeEstado(status: number): ErrorPuerto {
  if (status === 401 || status === 403) {
    return errorPuerto('NO_AUTORIZADO', `el banco rechazó la autenticación (HTTP ${String(status)})`, false);
  }
  if (status >= 500) {
    return errorPuerto('INDISPONIBLE', `el banco respondió HTTP ${String(status)}`, true);
  }
  return errorPuerto('RECHAZADO_POR_PROVEEDOR', `el banco respondió HTTP ${String(status)}`, false);
}
