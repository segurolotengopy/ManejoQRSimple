import type { PresenciaDeMarca } from '@mqs/firestore-store';
import { describe, expect, it, vi } from 'vitest';

import { decidirSobreLaBase, esProcesoDeLaPrueba, verificarBaseDelProceso } from './base-de-la-prueba.js';

const PRUEBA_REAL = {
  MODO_PRUEBA_PRODUCCION: '1',
  BANECO_ENV: 'prod',
  QR_PROVIDER: 'baneco',
  PAYMENT_WATCHER: 'baneco',
  PRUEBA_CUENTA: 'cuenta-secreta-uno',
  FIRESTORE_EMULATOR_HOST: 'host-reservado:9999',
};

const DEMO = { QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado', FIRESTORE_EMULATOR_HOST: 'host-reservado:9999' };
const SIN_VARIABLES = {};
const CERTIFICACION = { BANECO_ENV: 'cert', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' };

const lector = (tipo: PresenciaDeMarca['tipo']) => vi.fn(() => Promise.resolve({ tipo } as PresenciaDeMarca));

describe('esProcesoDeLaPrueba()', () => {
  it('solo con las cuatro condiciones a la vez', () => {
    expect(esProcesoDeLaPrueba(PRUEBA_REAL)).toBe(true);
    for (const falta of ['MODO_PRUEBA_PRODUCCION', 'BANECO_ENV', 'QR_PROVIDER', 'PAYMENT_WATCHER'] as const) {
      expect(esProcesoDeLaPrueba({ ...PRUEBA_REAL, [falta]: undefined })).toBe(false);
    }
    expect(esProcesoDeLaPrueba({ ...PRUEBA_REAL, BANECO_ENV: 'cert' })).toBe(false);
    expect(esProcesoDeLaPrueba({ ...PRUEBA_REAL, PAYMENT_WATCHER: 'simulado' })).toBe(false);
  });
});

describe('verificarBaseDelProceso()', () => {
  it('la prueba real no lee la marca: es suya', async () => {
    const leer = lector('PRESENTE');
    await expect(verificarBaseDelProceso(PRUEBA_REAL, leer)).resolves.toBeNull();
    expect(leer).not.toHaveBeenCalled();
  });

  describe.each([
    ['el demo (mock/simulado)', DEMO],
    ['un entorno vacío', SIN_VARIABLES],
    ['certificación baneco/baneco', CERTIFICACION],
  ])('%s', (_nombre, env) => {
    it('sobre una base sin marca, arranca', async () => {
      await expect(verificarBaseDelProceso(env, lector('AUSENTE'))).resolves.toBeNull();
    });

    it('sobre la base marcada, no arranca', async () => {
      const motivo = await verificarBaseDelProceso(env, lector('PRESENTE'));
      expect(motivo).toMatch(/es la de la prueba en producción/);
      expect(motivo).toMatch(/Detenga el emulador de la prueba/);
      expect(motivo).toMatch(/otro puerto/);
      expect(motivo).toMatch(/puerto 8080/);
    });

    it('si no se puede comprobar, no arranca (falla cerrada)', async () => {
      const motivo = await verificarBaseDelProceso(env, lector('ERROR'));
      expect(motivo).toMatch(/sin esa comprobación no se arranca/);
    });
  });

  it('los mensajes no contienen el alias de la cuenta ni la dirección del emulador', async () => {
    const env = { ...DEMO, PRUEBA_CUENTA: 'cuenta-secreta-uno' };
    for (const tipo of ['PRESENTE', 'ERROR'] as const) {
      const motivo = await verificarBaseDelProceso(env, lector(tipo));
      expect(motivo).not.toBeNull();
      expect(motivo).not.toContain('cuenta-secreta-uno');
      expect(motivo).not.toContain('host-reservado');
    }
  });
});

describe('decidirSobreLaBase()', () => {
  const marcas: readonly PresenciaDeMarca[] = [{ tipo: 'AUSENTE' }, { tipo: 'PRESENTE' }, { tipo: 'ERROR' }];

  it('la prueba real siempre sigue, en el arranque y en cada pasada, con cualquier marca', () => {
    for (const momento of ['ARRANQUE', 'PASADA'] as const) {
      for (const marca of marcas) {
        expect(decidirSobreLaBase(PRUEBA_REAL, marca, momento)).toEqual({ accion: 'SEGUIR' });
      }
    }
  });

  it.each(['ARRANQUE', 'PASADA'] as const)('sin marca, sigue (%s)', (momento) => {
    expect(decidirSobreLaBase(DEMO, { tipo: 'AUSENTE' }, momento)).toEqual({ accion: 'SEGUIR' });
  });

  it.each(['ARRANQUE', 'PASADA'] as const)('con la marca, sale (%s)', (momento) => {
    expect(decidirSobreLaBase(DEMO, { tipo: 'PRESENTE' }, momento)).toMatchObject({ accion: 'SALIR' });
  });

  it('una lectura fallida impide ARRANCAR, pero en plena marcha solo salta la pasada', () => {
    expect(decidirSobreLaBase(DEMO, { tipo: 'ERROR' }, 'ARRANQUE')).toMatchObject({ accion: 'SALIR' });
    const enMarcha = decidirSobreLaBase(DEMO, { tipo: 'ERROR' }, 'PASADA');
    expect(enMarcha).toMatchObject({ accion: 'SALTAR_PASADA' });
    expect('mensaje' in enMarcha && enMarcha.mensaje).toMatch(/reintenta en la siguiente/);
  });
});
