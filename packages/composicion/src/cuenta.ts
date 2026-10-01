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

import { atribuirCuentaALoAnterior, contarSinCuentaDeCobro } from '@mqs/firestore-store';
import { esAliasDeCuenta, exito, fallo, type Resultado } from '@mqs/qr-core';
import type { Firestore } from 'firebase-admin/firestore';

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

export type ErrorPreparacionDeCuenta =
  /** La atribución de los datos anteriores no se pudo hacer (solo en modo prueba). */
  | {
      readonly tipo: 'ATRIBUCION_NO_HECHA';
      readonly variante: 'SIN_MARCA' | 'MARCA_DE_OTRA_CUENTA' | 'ERROR';
      readonly mensaje: string;
    }
  /** Quedan cobros o abonos sin cuenta: el satélite no los vigilaría. */
  | {
      readonly tipo: 'DATOS_SIN_CUENTA';
      readonly cobros: number;
      readonly abonos: number;
      readonly mensaje: string;
    };

/**
 * La comprobación que la API y el satélite hacen **siempre** al arrancar, antes
 * de atender nada, sobre los datos de su cuenta. Un solo código para los dos:
 * si cada `main.ts` la escribiera por su cuenta, tarde o temprano divergirían.
 *
 * En este orden:
 *
 * 1. Solo en modo prueba, `atribuirCuentaALoAnterior`: los cobros y abonos
 *    anteriores a que el cobro llevara `cuentaCobro` reciben la de este
 *    proceso. Solo es posible con la marca del emulador, que es lo único que
 *    dice de qué cuenta son esos datos; si falta o es de otra cuenta, no hay
 *    atribución y se aborta. (Que esta migración corra sola en el arranque de
 *    la prueba queda sujeto a la decisión D-A del dueño.)
 * 2. **Siempre**, con o sin modo prueba, `contarSinCuentaDeCobro`: si queda
 *    algún cobro o abono sin cuenta se aborta. Un cobro pendiente sin cuenta
 *    queda fuera de `listarPendientes(cuenta)`: sería un QR pagable que el
 *    satélite dejó de vigilar, sin ningún error (T10).
 *
 * Los mensajes dicen cuántos son y qué hacer; nunca ids ni datos de los
 * documentos. En caso de éxito devuelve cuántos documentos se atribuyeron en
 * esta corrida (`0` y `0` fuera de modo prueba).
 */
export async function prepararDatosDeLaCuenta(opciones: {
  readonly db: Firestore;
  readonly cuenta: string;
  readonly modoPrueba: boolean;
}): Promise<Resultado<{ readonly cobros: number; readonly abonos: number }, ErrorPreparacionDeCuenta>> {
  const { db, cuenta, modoPrueba } = opciones;
  let atribuidos = { cobros: 0, abonos: 0 };

  if (modoPrueba) {
    const atribucion = await atribuirCuentaALoAnterior(db, cuenta);
    switch (atribucion.tipo) {
      case 'HECHA':
        atribuidos = { cobros: atribucion.cobros, abonos: atribucion.abonos };
        break;
      case 'SIN_MARCA':
        return fallo({
          tipo: 'ATRIBUCION_NO_HECHA',
          variante: 'SIN_MARCA',
          mensaje:
            'SIN_MARCA: el emulador no tiene marca de cuenta, así que no se puede saber de qué cuenta ' +
            'son sus datos anteriores. No se les atribuye ninguna.',
        });
      case 'MARCA_DE_OTRA_CUENTA':
        return fallo({
          tipo: 'ATRIBUCION_NO_HECHA',
          variante: 'MARCA_DE_OTRA_CUENTA',
          mensaje:
            `MARCA_DE_OTRA_CUENTA: los datos de este emulador son de la cuenta «${atribucion.guardada}», ` +
            `no de «${cuenta}». No se les atribuye ninguna.`,
        });
      case 'ERROR':
        return fallo({
          tipo: 'ATRIBUCION_NO_HECHA',
          variante: 'ERROR',
          mensaje: `ERROR: no se pudo atribuir la cuenta a los datos anteriores (${atribucion.detalle}).`,
        });
    }
  }

  const sinCuenta = await contarSinCuentaDeCobro(db);
  if (sinCuenta.cobros + sinCuenta.abonos > 0) {
    return fallo({
      tipo: 'DATOS_SIN_CUENTA',
      cobros: sinCuenta.cobros,
      abonos: sinCuenta.abonos,
      mensaje:
        `Hay ${String(sinCuenta.cobros)} cobro(s) y ${String(sinCuenta.abonos)} abono(s) sin cuenta de cobro. ` +
        'Un cobro pendiente sin cuenta queda fuera de la vigilancia: su QR seguiría pagable sin que nadie lo mire. ' +
        'Atribúyanse a su cuenta con la marca del emulador (modo prueba) antes de arrancar.',
    });
  }
  return exito(atribuidos);
}
