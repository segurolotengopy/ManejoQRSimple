/**
 * Qué cuenta de cobro está en juego en la prueba controlada.
 *
 * La prueba en producción se repite entera —P1 a P9— cada vez que se abre una
 * cuenta de cobro nueva en el banco o se registra otro banco
 * (`docs/Integraciones/baneco/03-prueba-en-produccion.md` §1). Cada cuenta
 * tiene su **propio archivo de credenciales** y sus **propios datos en el
 * emulador**; el alias es el hilo que ata las dos cosas, el que se muestra en
 * la consola y el que impide mezclarlas.
 *
 * El alias es un rótulo elegido por el dueño (`prod`, `sucursal-2`), nunca el
 * número de cuenta ni el usuario API: se muestra en pantalla y se guarda en el
 * emulador, y ahí no va ningún dato bancario (regla #4).
 */

export const CUENTA_POR_DEFECTO = 'prod';

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

/**
 * El alias de la corrida, o `null` si el entorno trae algo que no sirve como
 * alias. Se prefiere fallar a inventar un valor: si `CUENTA` está mal escrita,
 * el archivo de credenciales que se cargó tampoco es el que se cree.
 *
 * Los scripts `prueba:*` fijan `PRUEBA_CUENTA` en el entorno del proceso, y en
 * Node el entorno **gana** sobre lo que traiga `--env-file`: una línea
 * `PRUEBA_CUENTA=` olvidada dentro de un archivo de credenciales no puede hacer
 * que las credenciales de una cuenta corran sobre los datos de otra.
 */
export function leerCuentaDePrueba(env: Readonly<Record<string, string | undefined>>): string | null {
  const crudo = env['PRUEBA_CUENTA']?.trim();
  if (crudo === undefined || crudo === '') {
    return CUENTA_POR_DEFECTO;
  }
  return esAliasDeCuenta(crudo) ? crudo : null;
}

/**
 * Nombre del archivo de credenciales de una cuenta, dentro de `~/.manejoqr/`.
 *
 * La misma convención está escrita en los scripts `prueba:*` de
 * `package.json`, que arman la ruta para `node --env-file` antes de que corra
 * una línea de este código. Si cambia acá, cambia allá.
 */
export function archivoDeCredenciales(alias: string): string {
  return `baneco-${alias}.env`;
}
