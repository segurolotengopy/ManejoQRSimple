import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const paquete = (nombre: string): string =>
  fileURLToPath(new URL(`./packages/${nombre}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Los tests corren contra el CÓDIGO FUENTE de cada paquete, no contra dist:
    // así no hace falta compilar antes de testear y el watch es inmediato.
    alias: {
      '@mqs/qr-core': paquete('qr-core'),
      '@mqs/baneco-gateway': paquete('baneco-gateway'),
      '@mqs/firestore-store': paquete('firestore-store'),
      '@mqs/composicion': paquete('composicion'),
      '@mqs/baneco-satelite': paquete('baneco-satelite'),
      '@mqs/yape-scraper': paquete('yape-scraper'),
      '@mqs/wa-bridge': paquete('wa-bridge'),
      '@mqs/functions': paquete('functions'),
      '@mqs/demo-web': paquete('demo-web'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
    // Los tests `*.emulador.test.ts` necesitan el emulador de Firestore corriendo
    // (y con él Java y firebase-tools), así que quedan fuera de la suite por
    // defecto y del CI. Se corren aparte con `npm run test:emulador`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.emulador.test.ts'],
    // Objetivo declarado en CLAUDE.md: la suite completa por debajo de 10 s.
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
});
