/**
 * Piezas compartidas por las herramientas del demo local.
 *
 * Todas exigen el **emulador**: si `FIRESTORE_EMULATOR_HOST` no está definida,
 * se niegan a arrancar. El demo siembra y borra datos alegremente, y hacer eso
 * contra el proyecto real sería destructivo. Es la misma barrera que usan los
 * tests de integración.
 */

import { centavos, esExito, type Centavos } from '@mqs/qr-core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export const PROYECTO = 'manejoqrsimple';

export function conectarAlEmulador(): Firestore {
  const emulador = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulador === undefined || emulador === '') {
    console.error(
      '✖ FIRESTORE_EMULATOR_HOST no está definida.\n' +
        '  Las herramientas del demo solo corren contra el emulador: siembran y borran\n' +
        '  datos, y hacerlo contra el proyecto real sería destructivo.\n' +
        '  Usá `npm run demo`, que levanta el emulador y define la variable.',
    );
    process.exit(1);
  }
  const app = initializeApp({ projectId: PROYECTO }, `demo-${String(Date.now())}`);
  return getFirestore(app);
}

export function bs(valorEnCentavos: number): Centavos {
  const r = centavos(valorEnCentavos);
  if (!esExito(r)) {
    throw new Error(`monto inválido: ${String(valorEnCentavos)}`);
  }
  return r.valor;
}

/** Enmascara el teléfono para la salida por consola (regla #9). */
export function telefonoParaMostrar(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  return digitos.length < 4 ? '***' : `+591 ${digitos.slice(3, 4)}** ***${digitos.slice(-2)}`;
}
