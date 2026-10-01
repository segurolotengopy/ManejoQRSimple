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

import {
  atribuirCuentaALoAnterior,
  contarSinCuentaDeCobro,
  explicarMarca,
  type MarcaDeCuenta,
} from '@mqs/firestore-store';
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
  /**
   * Defensa en profundidad. Hay datos viejos sin cuenta y la marca la puso este
   * mismo arranque sin autorización explícita: no dice de quién son. No se
   * atribuye nada; decide el dueño. Con `fijarCuentaDePrueba` cerrando la
   * puerta (no marca sobre datos sin cuenta), esta rama casi no se alcanza.
   */
  | {
      readonly tipo: 'MARCA_RECIEN_PUESTA';
      readonly cobros: number;
      readonly abonos: number;
      readonly mensaje: string;
    }
  /** El emulador no tiene marca y ya trae datos sin cuenta: no se creó ninguna marca. */
  | {
      readonly tipo: 'SIN_MARCA_CON_DATOS';
      readonly cobros: number;
      readonly abonos: number;
      readonly mensaje: string;
    }
  /** Quedan documentos que el satélite de esta cuenta no vigilaría. */
  | {
      readonly tipo: 'DATOS_SIN_CUENTA';
      readonly cobros: number;
      readonly abonos: number;
      readonly pendientesDeOtraCuenta: number;
      readonly mensaje: string;
    }
  /** Firestore falló al comprobarlo: no se sabe qué hay, así que no se arranca. */
  | { readonly tipo: 'NO_SE_PUDO_COMPROBAR'; readonly mensaje: string };

/**
 * La comprobación que la API y el satélite hacen **siempre** al arrancar, antes
 * de atender nada, sobre los datos de su cuenta. Un solo código para los dos:
 * si cada `main.ts` la escribiera por su cuenta, tarde o temprano divergirían.
 *
 * En modo prueba recibe lo que devolvió `fijarCuentaDePrueba` (la marca), no la
 * vuelve a leer: de ella depende si se puede atribuir.
 *
 * 1. Solo en modo prueba: `atribuirCuentaALoAnterior`, que agrega la cuenta a
 *    los cobros y abonos anteriores, cuando la marca ya existía (`COINCIDE`)
 *    o cuando el dueño autorizó explícitamente marcar sobre esos datos
 *    (`atribucionExplicita`, de `ATRIBUIR_DATOS_ANTERIORES_A`). La protección
 *    real es anterior: `fijarCuentaDePrueba` **no crea la marca** sobre datos
 *    sin cuenta sin esa autorización (devuelve `SIN_MARCA_CON_DATOS`), así que
 *    una marca recién puesta nunca queda autorizando por sí sola a atribuir.
 *    Una marca `MARCADA` sin autorización explícita y con datos sin cuenta no
 *    debería darse; si se diera, se aborta sin escribir (defensa en
 *    profundidad). (Que la migración corra sola en el arranque queda sujeto a
 *    la decisión D-A.)
 * 2. **Siempre**, con o sin modo prueba, `contarSinCuentaDeCobro`: se aborta si
 *    queda algún documento con la cuenta ausente o inválida, o algún cobro
 *    pendiente de **otra** cuenta. Un cobro pendiente que el filtro por cuenta
 *    deja afuera es un QR pagable que el satélite dejó de vigilar, sin ningún
 *    error (T10). Lo de otra cuenta es anomalía mientras cada cuenta tenga su
 *    propia base; el bloque 4, con base compartida, tendrá que revisar esa regla.
 *
 * Los mensajes dicen cuántos son y qué hacer; nunca ids ni datos de los
 * documentos. En caso de éxito devuelve cuántos documentos se atribuyeron en
 * esta corrida (`0` y `0` si no se atribuyó nada). Nunca lanza: un fallo de
 * Firestore vuelve como `NO_SE_PUDO_COMPROBAR`.
 */
export async function prepararDatosDeLaCuenta(
  opciones: { readonly db: Firestore; readonly cuenta: string } & (
    | { readonly modoPrueba: false }
    | {
        readonly modoPrueba: true;
        readonly marca: MarcaDeCuenta;
        /** El dueño pidió expresamente atribuir los datos anteriores a esta cuenta. */
        readonly atribucionExplicita: boolean;
      }
  ),
): Promise<Resultado<{ readonly cobros: number; readonly abonos: number }, ErrorPreparacionDeCuenta>> {
  const { db, cuenta } = opciones;
  let atribuidos = { cobros: 0, abonos: 0 };
  let marcaRecienPuesta = false;

  if (opciones.modoPrueba) {
    const { marca } = opciones;
    switch (marca.tipo) {
      case 'MARCADA':
      case 'COINCIDE': {
        if (marca.tipo === 'MARCADA' && !opciones.atribucionExplicita) {
          // La marca la puso este arranque sin autorización para atribuir.
          marcaRecienPuesta = true;
          break;
        }
        // La marca ya existía, o el dueño autorizó expresamente atribuir.
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
                'SIN_MARCA: la marca de cuenta del emulador desapareció durante el arranque. ' +
                'No se atribuye ninguna cuenta a los datos anteriores.',
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
        break;
      }
      case 'SIN_MARCA_CON_DATOS':
        return fallo({
          tipo: 'SIN_MARCA_CON_DATOS',
          cobros: marca.cobros,
          abonos: marca.abonos,
          mensaje: explicarMarca(marca) ?? 'El emulador no tiene marca y trae datos sin cuenta.',
        });
      case 'CONFLICTO':
        return fallo({
          tipo: 'ATRIBUCION_NO_HECHA',
          variante: 'MARCA_DE_OTRA_CUENTA',
          mensaje:
            `MARCA_DE_OTRA_CUENTA: los datos de este emulador son de la cuenta «${marca.guardada}», ` +
            `no de «${cuenta}». No se les atribuye ninguna.`,
        });
      case 'ERROR':
        return fallo({
          tipo: 'ATRIBUCION_NO_HECHA',
          variante: 'ERROR',
          mensaje: `ERROR: no se pudo verificar la marca de cuenta del emulador (${marca.detalle}).`,
        });
    }
  }

  const conteo = await contarSinCuentaDeCobro(db, cuenta);
  if (conteo.tipo === 'ERROR') {
    return fallo({
      tipo: 'NO_SE_PUDO_COMPROBAR',
      mensaje:
        `No se pudo comprobar si hay cobros sin cuenta de cobro (${conteo.detalle}). ` +
        '¿Está corriendo el emulador? Sin esa comprobación no se arranca.',
    });
  }

  if (marcaRecienPuesta && conteo.cobros + conteo.abonos > 0) {
    return fallo({
      tipo: 'MARCA_RECIEN_PUESTA',
      cobros: conteo.cobros,
      abonos: conteo.abonos,
      mensaje:
        `Hay ${String(conteo.cobros)} cobro(s) y ${String(conteo.abonos)} abono(s) sin cuenta de cobro, y la marca ` +
        'de cuenta del emulador la puso este mismo arranque. Una marca recién puesta no dice de quién son ' +
        'los datos viejos, así que no se les atribuye ninguna cuenta ni se escribe nada. ' +
        'El dueño debe decidir a qué cuenta pertenecen antes de arrancar ' +
        '(ATRIBUIR_DATOS_ANTERIORES_A=<la cuenta>, solo si son de esta cuenta).',
    });
  }

  if (conteo.cobros + conteo.abonos + conteo.pendientesDeOtraCuenta > 0) {
    return fallo({
      tipo: 'DATOS_SIN_CUENTA',
      cobros: conteo.cobros,
      abonos: conteo.abonos,
      pendientesDeOtraCuenta: conteo.pendientesDeOtraCuenta,
      mensaje:
        `Hay ${String(conteo.cobros)} cobro(s) y ${String(conteo.abonos)} abono(s) sin una cuenta de cobro ` +
        `válida, y ${String(conteo.pendientesDeOtraCuenta)} cobro(s) pendiente(s) de otra cuenta. ` +
        'Esos cobros quedarían fuera de la vigilancia de esta cuenta: su QR seguiría pagable sin que nadie ' +
        'lo mire. Hay que resolverlos antes de arrancar.',
    });
  }
  return exito(atribuidos);
}

/** La variable con la que el dueño autoriza, una vez, atribuir los datos anteriores a esta cuenta. */
export const VARIABLE_ATRIBUCION = 'ATRIBUIR_DATOS_ANTERIORES_A';

export type AtribucionExplicita = {
  /** `true` solo si la variable vale **exactamente** la cuenta de este proceso. */
  readonly permitida: boolean;
  /**
   * Un texto para sumar al error cuando la variable existe pero no coincide: se
   * ignora, y esto lo dice. Solo nombra el valor si es un alias válido: podría
   * ser un número de cuenta pegado por error.
   */
  readonly aviso: string | null;
};

/**
 * ¿El dueño autorizó explícitamente atribuir los datos anteriores a la cuenta de
 * este proceso? Es la única puerta para marcar un emulador que ya trae datos
 * sin cuenta: tiene que ser una acción deliberada, con el alias exacto.
 */
export function leerAtribucionExplicita(
  env: Readonly<Record<string, string | undefined>>,
  cuenta: string,
): AtribucionExplicita {
  const crudo = env[VARIABLE_ATRIBUCION]?.trim();
  if (crudo === undefined || crudo === '') {
    return { permitida: false, aviso: null };
  }
  if (crudo === cuenta) {
    return { permitida: true, aviso: null };
  }
  const valor = esAliasDeCuenta(crudo) ? ` («${crudo}»)` : '';
  return {
    permitida: false,
    aviso:
      `${VARIABLE_ATRIBUCION} está definida pero su valor${valor} no coincide con la cuenta de este proceso ` +
      `(«${cuenta}»): se ignora, como si no estuviera.`,
  };
}
