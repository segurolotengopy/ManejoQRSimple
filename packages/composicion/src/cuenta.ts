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

import { esAliasDeCuenta } from '@mqs/qr-core';

export { ALIAS_DE_CUENTA, esAliasDeCuenta } from '@mqs/qr-core';

/**
 * La cuenta de cobro de este proceso: la de sus credenciales, la que se graba
 * en cada cobro.
 *
 * El alias de la corrida, o `null` si el entorno trae algo que no sirve como
 * alias. Se prefiere fallar a inventar un valor: si `CUENTA` está mal escrita,
 * el archivo de credenciales que se cargó tampoco es el que se cree.
 *
 * Los scripts `prueba:*` fijan `PRUEBA_CUENTA` en el entorno del proceso, y en
 * Node el entorno **gana** sobre lo que traiga `--env-file`: una línea
 * `PRUEBA_CUENTA=` olvidada dentro de un archivo de credenciales no puede hacer
 * que las credenciales de una cuenta corran sobre los datos de otra.
 */
export function leerCuentaDeCobro(env: Readonly<Record<string, string | undefined>>): string | null {
  const crudo = env['PRUEBA_CUENTA']?.trim();
  if (crudo === undefined || crudo === '') {
    return CUENTA_POR_DEFECTO;
  }
  return esAliasDeCuenta(crudo) ? crudo : null;
}

/** El mismo valor, con el nombre que tenía cuando solo servía a la prueba controlada. */
export const leerCuentaDePrueba = leerCuentaDeCobro;

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
