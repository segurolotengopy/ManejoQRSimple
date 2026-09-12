/**
 * Barrera de producción.
 *
 * Hablarle a la API de producción de Baneco significa QRs reales, pagables con
 * plata real, contra la cuenta de cobro del comercio. Hasta el pase a
 * producción, eso solo se admite en la **prueba controlada** (docs/Integraciones/
 * baneco/03-prueba-en-produccion.md), y con dos condiciones que no dependen de
 * que alguien se acuerde:
 *
 * - `MODO_PRUEBA_PRODUCCION=1`, que activa los topes de monto y de cantidad.
 * - Persistencia en el **emulador** de Firestore: los datos de la prueba no
 *   salen de la máquina del dueño.
 *
 * La usan la API y el satélite al arrancar. Como los errores de composición,
 * el mensaje nombra variables, nunca valores.
 */

type Entorno = Readonly<Record<string, string | undefined>>;

/** ¿Este entorno le habla a la API de producción del banco? */
export function hablaConProduccion(env: Entorno): boolean {
  return env['BANECO_ENV'] === 'prod' && (env['QR_PROVIDER'] === 'baneco' || env['PAYMENT_WATCHER'] === 'baneco');
}

/** ¿Se puede arrancar? `null` si sí; si no, el motivo para mostrar. */
export function verificarProduccion(env: Entorno): string | null {
  if (!hablaConProduccion(env)) {
    return null;
  }
  if (env['MODO_PRUEBA_PRODUCCION'] !== '1') {
    return (
      'BANECO_ENV=prod solo se admite en la prueba controlada: falta MODO_PRUEBA_PRODUCCION=1 ' +
      '(ver docs/Integraciones/baneco/03-prueba-en-produccion.md).'
    );
  }
  if ((env['FIRESTORE_EMULATOR_HOST'] ?? '') === '') {
    return (
      'La prueba en producción guarda sus datos en el emulador local de Firestore: ' +
      'falta FIRESTORE_EMULATOR_HOST (levantá `npm run prueba:emulador`).'
    );
  }
  return null;
}
