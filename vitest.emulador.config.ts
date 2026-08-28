import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const paquete = (nombre: string): string =>
  fileURLToPath(new URL(`./packages/${nombre}/src/index.ts`, import.meta.url));

/**
 * Configuración para los tests de integración contra el **emulador** de Firestore.
 *
 * Separada de `vitest.config.ts` a propósito: estos tests necesitan Java y
 * firebase-tools, así que no corren en CI ni en `npm test`. Se lanzan con
 * `npm run test:emulador`, que levanta el emulador y lo baja al terminar.
 *
 * Ninguna prueba automatizada toca el proyecto real (docs/05 §1). Eso lo
 * garantiza `FIRESTORE_EMULATOR_HOST`, que el propio `emulators:exec` define y
 * que los tests verifican antes de conectarse.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mqs/qr-core': paquete('qr-core'),
      '@mqs/firestore-store': paquete('firestore-store'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.emulador.test.ts'],
    // El emulador arranca en frío; la primera conexión puede tardar.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Los tests comparten una única base emulada: correrlos en paralelo haría
    // que se pisen los datos entre sí.
    fileParallelism: false,
  },
});
