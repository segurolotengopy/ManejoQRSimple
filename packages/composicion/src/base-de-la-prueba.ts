/**
 * La base de la prueba en producción es solo de la prueba real.
 *
 * El emulador de la prueba (`configuracion/cuentaDePrueba`) guarda cobros con
 * QRs **reales**, pagables con plata real. Un proceso con un detector simulado
 * que apunte a esa base —la API del demo, `satelite:demo`— vigilaría esos QRs
 * con un watcher que confirma lo que cualquiera escriba en `abonos/*`, y su QR
 * simulado «anularía» QRs reales sin que el banco se entere: se daría por
 * pagado un cobro que el banco nunca vio, o se dejaría pagable uno que ya está
 * cerrado (reglas #1 y BANECO-1).
 *
 * Por eso la regla no se limita a «adaptadores simulados»: una base marcada la
 * toca **solo** la prueba real. Un proceso baneco/baneco de certificación
 * sobre esa base también la contaminaría. Los mensajes nombran el hecho, nunca
 * valores del entorno (el alias de la cuenta, la dirección del emulador).
 */

import type { PresenciaDeMarca } from '@mqs/firestore-store';

type Entorno = Readonly<Record<string, string | undefined>>;

/**
 * ¿Este proceso es la prueba real? Las cuatro condiciones a la vez: el modo
 * prueba, el ambiente de producción y los dos adaptadores del banco. Con
 * cualquiera menos, no lo es. Es más estricto que `verificarProduccion` a
 * propósito: quien llame esto para **permitir** algo necesita la respuesta
 * más estrecha.
 */
export function esProcesoDeLaPrueba(env: Entorno): boolean {
  return (
    env['MODO_PRUEBA_PRODUCCION'] === '1' &&
    env['BANECO_ENV'] === 'prod' &&
    env['QR_PROVIDER'] === 'baneco' &&
    env['PAYMENT_WATCHER'] === 'baneco'
  );
}

const MENSAJE_BASE_DE_LA_PRUEBA =
  'La base de Firestore de este proceso es la de la prueba en producción (tiene la marca ' +
  'configuracion/cuentaDePrueba). Solo prueba:api y prueba:satelite pueden usarla: con ' +
  'adaptadores simulados se confirmarían o anularían cobros que el banco nunca vio. ' +
  'Detenga el emulador de la prueba (exporta sus datos al salir) o use otro puerto para el demo ' +
  '(`npm run demo` y `prueba:emulador` comparten el puerto 8080 y no conviven).';

const MENSAJE_SIN_COMPROBAR =
  'No se pudo comprobar si esta base es la de la prueba en producción; ' +
  'sin esa comprobación no se arranca.';

const MENSAJE_PASADA_SALTADA =
  'No se pudo comprobar si esta base es la de la prueba en producción: se salta esta pasada y se ' +
  'reintenta en la siguiente.';

/** Qué hace un proceso con la base a la que está conectado. */
export type AccionSobreLaBase =
  | { readonly accion: 'SEGUIR' }
  | { readonly accion: 'SALTAR_PASADA' | 'SALIR'; readonly mensaje: string };

/**
 * La decisión, sin entrada ni salida: dado lo que se leyó de la marca, qué hace
 * el proceso. La toma `verificarBaseDelProceso` al arrancar y el satélite en
 * cada pasada.
 *
 * - La prueba real sigue siempre: la marca es suya.
 * - Sin marca, sigue. Con marca, sale: es la base de otro.
 * - Una lectura fallida **al arrancar** impide arrancar (falla cerrada). **En
 *   plena marcha** es un fallo pasajero de Firestore: salir tiraría el
 *   satélite por un parpadeo, y seguir sin comprobar dejaría pasar justo lo
 *   que esto evita. Se salta esa pasada —no se toca nada— y se reintenta.
 */
export function decidirSobreLaBase(
  env: Entorno,
  marca: PresenciaDeMarca,
  momento: 'ARRANQUE' | 'PASADA',
): AccionSobreLaBase {
  if (esProcesoDeLaPrueba(env)) {
    return { accion: 'SEGUIR' };
  }
  switch (marca.tipo) {
    case 'AUSENTE':
      return { accion: 'SEGUIR' };
    case 'PRESENTE':
      return { accion: 'SALIR', mensaje: MENSAJE_BASE_DE_LA_PRUEBA };
    case 'ERROR':
      return momento === 'ARRANQUE'
        ? { accion: 'SALIR', mensaje: MENSAJE_SIN_COMPROBAR }
        : { accion: 'SALTAR_PASADA', mensaje: MENSAJE_PASADA_SALTADA };
  }
}

/**
 * ¿Este proceso puede usar la base a la que está conectado **al arrancar**?
 * `null` si sí; si no, el motivo para mostrar.
 *
 * La prueba real no lee nada: la marca es suya (`fijarCuentaDePrueba` la crea o
 * la compara). Cualquier otro proceso lee la presencia de la marca: ausente,
 * sigue; presente o imposible de comprobar, no arranca (falla cerrada).
 */
export async function verificarBaseDelProceso(
  env: Entorno,
  leerMarca: () => Promise<PresenciaDeMarca>,
): Promise<string | null> {
  if (esProcesoDeLaPrueba(env)) {
    return null;
  }
  const decision = decidirSobreLaBase(env, await leerMarca(), 'ARRANQUE');
  return decision.accion === 'SEGUIR' ? null : decision.mensaje;
}
