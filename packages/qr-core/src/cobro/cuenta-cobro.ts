/**
 * La cuenta de cobro, vista desde el dominio: un alias.
 *
 * El alias es un rótulo elegido por el dueño (`prod`, `sucursal-2`), nunca el
 * número de cuenta ni el usuario API: se muestra en pantalla y se guarda en
 * cada cobro, y ahí no va ningún dato bancario (regla #4).
 */

/**
 * Alias admitido. Sirve como parte de un nombre de archivo y como texto en
 * pantalla: sin rutas, sin espacios y sin mayúsculas que se pierdan al tipear.
 *
 * **Empieza con letra a propósito**, para que un alias no pueda ser un número
 * de cuenta. El alias viaja al emulador, a la bitácora, a la pantalla y al
 * título del informe —que se archiva en `02-hallazgos-produccion.md`, en el
 * repo—, y ahí no entra ningún dato bancario (regla #4). Que la documentación
 * lo pida no alcanza: el nombre más tentador para distinguir dos cuentas es
 * justamente su número.
 */
export const ALIAS_DE_CUENTA = /^[a-z][a-z0-9-]{0,23}$/;

export function esAliasDeCuenta(alias: string): boolean {
  return ALIAS_DE_CUENTA.test(alias);
}
