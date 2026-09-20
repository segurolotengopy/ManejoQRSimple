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

/**
 * Quién hizo el pedido, una vez verificado su token.
 *
 * Son dos mundos separados y no dos permisos del mismo: el dueño opera su
 * consola, un consumidor opera el contrato de docs/10. Que sea una unión y no
 * un `esConsumidor: boolean` es lo que hace que el enrutador tenga que decidir
 * explícitamente en cada ruta, y que agregar una ruta nueva sin decidirlo no
 * compile.
 */
export type Identidad =
  | { readonly tipo: 'dueño'; readonly id: string }
  | { readonly tipo: 'consumidor'; readonly consumidorId: string };

export type Peticion = {
  readonly metodo: Metodo;
  /** Ruta sin query string, p. ej. `/api/cobros/abc`. */
  readonly ruta: string;
  /** Parámetros del query string, ya decodificados. Vacío si no hubo. */
  readonly consulta: Readonly<Record<string, string>>;
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
export const error = (
  status: number,
  codigo: string,
  mensaje: string,
  /** Detalle técnico para diagnosticar (tipo de falla, código del banco). Nunca datos personales. */
  detalle?: Readonly<Record<string, unknown>>,
): Respuesta => ({
  status,
  cuerpo: { error: { codigo, mensaje, ...(detalle === undefined ? {} : { detalle }) } },
});

export const noAutorizado = (): Respuesta =>
  error(401, 'NO_AUTORIZADO', 'Falta un token válido en el header Authorization.');

export const noEncontrado = (): Respuesta =>
  error(404, 'NO_ENCONTRADO', 'No existe ese recurso.');
