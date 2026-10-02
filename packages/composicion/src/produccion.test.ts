import { leerConfig } from '@mqs/baneco-gateway';
import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { MensajeriaNoConfigurada } from './mensajeria.js';
import { hablaConProduccion, verificarProduccion } from './produccion.js';
import { construirPuertos } from './puertos.js';

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

  it('el satélite sin Firestore no habla con producción', () => {
    // Con la persistencia en memoria no hay cobros contra los cuales conciliar
    // ni queda marcada la cuenta: los abonos reales del día se perderían al salir.
    expect(
      verificarProduccion({
        ...PROD,
        MODO_PRUEBA_PRODUCCION: '1',
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
        SATELITE_SIN_FIRESTORE: '1',
      }),
    ).toMatch(/SATELITE_SIN_FIRESTORE/);
  });

  it('basta con que uno de los dos puertos hable con el banco', () => {
    expect(hablaConProduccion({ BANECO_ENV: 'prod', PAYMENT_WATCHER: 'baneco' })).toBe(true);
  });
});

describe('barrera de producción: los dos adaptadores son del banco', () => {
  const LISTO = { BANECO_ENV: 'prod', MODO_PRUEBA_PRODUCCION: '1', FIRESTORE_EMULATOR_HOST: 'localhost:8080' };

  // Cada mezcla: un puerto real y el otro no. Antes de la barrera, las seis
  // pasaban con el modo prueba y el emulador puestos.
  it.each([
    ['baneco', 'simulado'],
    ['baneco', 'mock'],
    ['baneco', 'yape'],
    ['simulado', 'baneco'],
    ['mock', 'baneco'],
    ['yape', 'baneco'],
  ])('QR_PROVIDER=%s con PAYMENT_WATCHER=%s no arranca', (qr, watcher) => {
    const motivo = verificarProduccion({ ...LISTO, QR_PROVIDER: qr, PAYMENT_WATCHER: watcher });
    expect(motivo).toMatch(/QR_PROVIDER y PAYMENT_WATCHER/);
    // Nombra variables, nunca los valores que tenían.
    expect(motivo).not.toMatch(/simulado|mock|yape/);
  });

  it('un puerto ausente cuenta como distinto de baneco: su valor por defecto es mock', () => {
    expect(verificarProduccion({ ...LISTO, QR_PROVIDER: 'baneco' })).toMatch(/QR_PROVIDER y PAYMENT_WATCHER/);
    expect(verificarProduccion({ ...LISTO, PAYMENT_WATCHER: 'baneco' })).toMatch(/QR_PROVIDER y PAYMENT_WATCHER/);
  });

  it('los valores vacíos o con otra forma de escribir baneco tampoco pasan, en los dos puertos', () => {
    for (const valor of ['', 'Baneco', 'BANECO', ' baneco', 'baneco ']) {
      expect(verificarProduccion({ ...LISTO, QR_PROVIDER: valor, PAYMENT_WATCHER: 'baneco' })).toMatch(
        /QR_PROVIDER y PAYMENT_WATCHER/,
      );
      expect(verificarProduccion({ ...LISTO, QR_PROVIDER: 'baneco', PAYMENT_WATCHER: valor })).toMatch(
        /QR_PROVIDER y PAYMENT_WATCHER/,
      );
    }
  });

  it('es la primera condición: una mezcla se rechaza por esto aunque falte también el modo prueba', () => {
    expect(
      verificarProduccion({ BANECO_ENV: 'prod', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'simulado' }),
    ).toMatch(/QR_PROVIDER y PAYMENT_WATCHER/);
  });

  it('con los dos en baneco, modo prueba y emulador, arranca', () => {
    expect(verificarProduccion({ ...LISTO, QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' })).toBeNull();
  });

  it('fuera de producción las mezclas siguen permitidas: es lo que usa el demo y la certificación', () => {
    expect(verificarProduccion({ BANECO_ENV: 'cert', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'simulado' })).toBeNull();
    expect(verificarProduccion({ QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado' })).toBeNull();
  });
});

// La barrera lee las variables con su propio criterio, y el sistema las lee con el suyo
// (`leerModo` en puertos.ts y `leerConfig` en baneco-gateway). Si algún día uno de los
// dos aprende a tolerar una variante —un `.trim()`, un `.toLowerCase()`— sin que el
// otro se entere, el hueco se reabre sin que nada falle. Esta prueba los ata: para
// cada entorno con el que el sistema SÍ arma un adaptador del banco contra
// producción, la barrera tiene que darlo por hablando con producción.
// Llave sintética de prueba, igual a la de puertos.test.ts. En una constante y no en el
// literal del objeto: el escaneo de secretos del repositorio marca `AES_KEY: '…'`.
const LLAVE = '0123456789abcdef0123456789abcdef';

describe('la barrera y los lectores reales dicen lo mismo', () => {
  const CREDENCIALES_DE_PRUEBA = {
    BANECO_PROD_USERNAME: 'usuario',
    BANECO_PROD_PASSWORD: 'password',
    BANECO_PROD_AES_KEY: LLAVE,
    BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
  } as const;
  const AMBIENTES = [undefined, 'prod', 'cert', 'PROD', 'Prod', 'production', 'prod ', ' prod', ''];
  const MODOS = [undefined, 'baneco', 'Baneco', 'BANECO', ' baneco', 'baneco ', 'mock', 'simulado', 'yape', ''];

  it('todo lo que el sistema arma contra producción con un adaptador del banco, la barrera lo ve', () => {
    let contraProduccion = 0;
    for (const ambiente of AMBIENTES) {
      for (const qr of MODOS) {
        for (const watcher of MODOS) {
          const env: Record<string, string | undefined> = {
            ...CREDENCIALES_DE_PRUEBA,
            BANECO_ENV: ambiente,
            QR_PROVIDER: qr,
            PAYMENT_WATCHER: watcher,
          };
          const puertos = construirPuertos({ env, db: null, mensajeria: new MensajeriaNoConfigurada() });
          const config = leerConfig(env);
          const usaBanco = esExito(puertos) && /(?:qr|watcher)=baneco/.test(puertos.valor.resumen);
          if (usaBanco && esExito(config) && config.valor.ambiente === 'prod') {
            contraProduccion += 1;
            expect(hablaConProduccion(env), `BANECO_ENV=${String(ambiente)} QR=${String(qr)} W=${String(watcher)}`).toBe(true);
          }
        }
      }
    }
    // Que el recorrido no sea vacío: con (prod, baneco, baneco), (prod, baneco, mock) y los
    // otros tres que tocan al banco, hay al menos cinco combinaciones reales.
    expect(contraProduccion).toBeGreaterThanOrEqual(5);
  });
});

describe('MODO_PRUEBA_PRODUCCION=1 es solo de la prueba real: producción y los dos adaptadores del banco', () => {
  const EMULADOR = { FIRESTORE_EMULATOR_HOST: 'localhost:8080' };
  const MODO = { MODO_PRUEBA_PRODUCCION: '1' };

  it.each([
    ['mock', 'mock'],
    ['mock', 'simulado'],
    ['simulado', 'simulado'],
    ['baneco', 'mock'],
    ['mock', 'baneco'],
  ])('con ambiente prod, QR_PROVIDER=%s y PAYMENT_WATCHER=%s no arranca', (qr, watcher) => {
    const motivo = verificarProduccion({ ...MODO, ...EMULADOR, BANECO_ENV: 'prod', QR_PROVIDER: qr, PAYMENT_WATCHER: watcher });
    expect(motivo).toMatch(/MODO_PRUEBA_PRODUCCION=1/);
    expect(motivo).toMatch(/QR_PROVIDER y PAYMENT_WATCHER/);
    // Nombra variables, nunca los valores que tenían.
    expect(motivo).not.toMatch(/simulado|mock|yape/);
  });

  it('los adaptadores simulados con el modo prueba y sin BANECO_ENV no arrancan: antes pasaban', () => {
    expect(verificarProduccion({ ...MODO, ...EMULADOR, QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado' })).toMatch(
      /MODO_PRUEBA_PRODUCCION=1/,
    );
    expect(verificarProduccion({ ...MODO, ...EMULADOR })).toMatch(/MODO_PRUEBA_PRODUCCION=1/);
  });

  it('baneco/baneco sin BANECO_ENV=prod tampoco arranca', () => {
    expect(verificarProduccion({ ...MODO, ...EMULADOR, QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' })).toMatch(
      /BANECO_ENV=prod/,
    );
  });

  it('baneco/baneco contra certificación con el modo prueba no arranca', () => {
    expect(
      verificarProduccion({ ...MODO, ...EMULADOR, BANECO_ENV: 'cert', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' }),
    ).toMatch(/BANECO_ENV=prod/);
  });

  it('la prueba real —prod, baneco/baneco, emulador— arranca', () => {
    expect(
      verificarProduccion({ ...MODO, ...EMULADOR, BANECO_ENV: 'prod', QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' }),
    ).toBeNull();
  });

  it('sin el modo prueba, el demo con mocks sigue arrancando', () => {
    expect(verificarProduccion({ QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado', ...EMULADOR })).toBeNull();
  });
});
