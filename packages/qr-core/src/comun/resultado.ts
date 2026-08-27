/**
 * Resultado explícito, sin excepciones.
 *
 * El dominio no lanza para las violaciones de regla previsibles: las devuelve.
 * Una excepción se puede olvidar de atrapar; un `Resultado` no se puede leer sin
 * mirar antes si falló, porque TypeScript no deja acceder a `valor` hasta que se
 * estrechó el `ok`. Las reglas de este proyecto tienen que ser imposibles de
 * violar, no solo fáciles de respetar.
 */

export type Exito<T> = { readonly ok: true; readonly valor: T };
export type Fallo<E> = { readonly ok: false; readonly error: E };
export type Resultado<T, E> = Exito<T> | Fallo<E>;

export const exito = <T>(valor: T): Exito<T> => ({ ok: true, valor });
export const fallo = <E>(error: E): Fallo<E> => ({ ok: false, error });

/** Estrecha a éxito. Útil en tests y en el borde de los adaptadores. */
export const esExito = <T, E>(r: Resultado<T, E>): r is Exito<T> => r.ok;

/** Estrecha a fallo. */
export const esFallo = <T, E>(r: Resultado<T, E>): r is Fallo<E> => !r.ok;
