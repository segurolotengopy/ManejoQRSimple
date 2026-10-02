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
 * - **Los dos adaptadores del banco, y solo ellos.** `QR_PROVIDER` y
 *   `PAYMENT_WATCHER` tienen que ser los dos `baneco`. Mezclar uno real con
 *   uno simulado o mock es peligroso en los dos sentidos: un QR real vigilado
 *   por un watcher que confirma con un documento escrito a mano daría por
 *   pagado un cobro que el banco nunca vio (reglas de negocio #1 y BANECO-1),
 *   y un watcher real sobre un QR que no es del banco no vigila nada. Hoy solo
 *   los scripts de `npm` fijaban los dos, es decir, la disciplina de quien los
 *   corre, no el código.
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
  // Primero y antes que cualquier otra condición: es la que impide confirmar un
  // pago que el banco no vio. Un valor ausente cuenta como distinto de `baneco`
  // (el valor por defecto de los adaptadores es `mock`). El mensaje nombra
  // variables, nunca los valores que tenían.
  if (env['QR_PROVIDER'] !== 'baneco' || env['PAYMENT_WATCHER'] !== 'baneco') {
    return (
      'Contra la API de producción del banco, QR_PROVIDER y PAYMENT_WATCHER tienen que ser los dos ' +
      'baneco: un QR real vigilado por otro tipo de watcher confirmaría pagos que el banco nunca vio, ' +
      'o dejaría QRs pagables sin vigilancia.'
    );
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
  if (env['SATELITE_SIN_FIRESTORE'] === '1') {
    // Sin persistencia no hay cobros contra los cuales conciliar, ni queda
    // marcada la cuenta de la corrida: el satélite le hablaría a la API de
    // producción y perdería al salir todo lo que viera, abonos incluidos.
    return (
      'SATELITE_SIN_FIRESTORE=1 no se admite contra producción: sin persistencia no hay ' +
      'nada contra qué conciliar y los abonos del día se pierden al salir.'
    );
  }
  return null;
}
