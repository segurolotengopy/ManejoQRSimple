/**
 * La API HTTP, en tipos propios y no en los de un framework.
 *
 * Los handlers reciben una `Peticion` y devuelven una `Respuesta`: objetos
 * planos, sin `req`/`res`, sin streams y sin `next()`. Eso los hace probables
 * llamándolos como funciones —sin levantar un servidor ni simular Express— y
 * deja el framework como un detalle del borde.
 *
 * Hoy el borde es un servidor `node:http` local (`servidor.ts`), que es lo que
 * hace falta para desarrollar y demostrar. El día que esto se despliegue como
 * Cloud Functions, se escribe otro borde de veinte líneas y los handlers no se
 * tocan — es el mismo razonamiento de ADR-002 aplicado al transporte.
 */

export type Metodo = 'GET' | 'POST';

export type Peticion = {
  readonly metodo: Metodo;
  /** Ruta sin query string, p. ej. `/api/cobros/abc`. */
  readonly ruta: string;
  /** Cuerpo ya parseado. `null` si no vino o no era JSON. */
  readonly cuerpo: unknown;
  /** Token del header `Authorization: Bearer …`, sin el prefijo. */
  readonly token: string | null;
};

export type Respuesta = {
  readonly status: number;
  readonly cuerpo: unknown;
};

export const ok = (cuerpo: unknown): Respuesta => ({ status: 200, cuerpo });
export const creado = (cuerpo: unknown): Respuesta => ({ status: 201, cuerpo });

/**
 * Error de la API.
 *
 * `codigo` es un identificador estable para que la consola pueda reaccionar sin
 * parsear texto; `mensaje` es para una persona. Nunca lleva datos del cobro ni
 * del cliente (reglas #4 y #9).
 */
export const error = (status: number, codigo: string, mensaje: string): Respuesta => ({
  status,
  cuerpo: { error: { codigo, mensaje } },
});

export const noAutorizado = (): Respuesta =>
  error(401, 'NO_AUTORIZADO', 'Falta un token válido en el header Authorization.');

export const noEncontrado = (): Respuesta =>
  error(404, 'NO_ENCONTRADO', 'No existe ese recurso.');
