import { describe, expect, it } from 'vitest';

import { hablaConProduccion, verificarProduccion } from './produccion.js';

const PROD = { BANECO_ENV: 'prod', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' };

describe('barrera de producción', () => {
  it('certificación y los mocks pasan sin condiciones', () => {
    expect(verificarProduccion({ BANECO_ENV: 'cert', QR_PROVIDER: 'baneco' })).toBeNull();
    expect(verificarProduccion({ BANECO_ENV: 'prod', QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado' })).toBeNull();
    expect(hablaConProduccion({ BANECO_ENV: 'prod', QR_PROVIDER: 'mock' })).toBe(false);
  });

  it('producción sin modo prueba no arranca', () => {
    expect(verificarProduccion({ ...PROD, FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toMatch(
      /MODO_PRUEBA_PRODUCCION=1/,
    );
  });

  it('producción en modo prueba exige el emulador: los datos no salen de la máquina', () => {
    expect(verificarProduccion({ ...PROD, MODO_PRUEBA_PRODUCCION: '1' })).toMatch(/FIRESTORE_EMULATOR_HOST/);
  });

  it('con modo prueba y emulador, arranca', () => {
    expect(
      verificarProduccion({ ...PROD, MODO_PRUEBA_PRODUCCION: '1', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }),
    ).toBeNull();
  });

  it('basta con que uno de los dos puertos hable con el banco', () => {
    expect(hablaConProduccion({ BANECO_ENV: 'prod', PAYMENT_WATCHER: 'baneco' })).toBe(true);
  });
});
