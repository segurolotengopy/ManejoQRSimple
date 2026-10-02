/**
 * La guarda de las pruebas del emulador, probada contra el emulador.
 *
 * Es la prueba de que la limpieza **no puede** borrar sobre la base de la
 * prueba real: con la marca puesta, ni la verificación pasa ni la limpieza ni
 * el cierre tocan nada —ni la propia marca—, aunque el gancho `afterAll` corra
 * después de que `beforeAll` haya lanzado. Corre con `npm run test:emulador`.
 */

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BaseDeEmuladorDePruebas } from './base-de-pruebas.js';
import { COLECCION_CONFIGURACION, DOC_CUENTA_DE_PRUEBA } from './cuenta-de-prueba.js';
import { COLECCION_COBROS } from './repositorio.js';

let app: App;
let db: Firestore;
/** La que prepara y deshace los datos de este archivo, ella sí verificada. */
let propia: BaseDeEmuladorDePruebas;

const refMarca = () => db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA);
const refCobro = () => db.collection(COLECCION_COBROS).doc('cobro-real');

beforeAll(async () => {
  const emulador = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulador === undefined || emulador === '') {
    throw new Error('FIRESTORE_EMULATOR_HOST no está definida. Estos tests solo corren contra el emulador.');
  }
  app = initializeApp({ projectId: 'manejoqrsimple' }, `guarda-${String(Date.now())}`);
  db = getFirestore(app);
  propia = new BaseDeEmuladorDePruebas(db);
  await propia.verificar();
});

afterAll(async () => {
  await propia.cerrar();
  await deleteApp(app);
});

afterEach(async () => {
  await propia.limpiar();
});

describe('BaseDeEmuladorDePruebas: con la marca de la prueba real', () => {
  it('la guarda lanza y no borra nada: cobros y marca siguen ahí', async () => {
    await refMarca().set({ cuenta: 'alias-reservado' });
    await refCobro().set({ concepto: 'cobro real pendiente' });

    const bajoPrueba = new BaseDeEmuladorDePruebas(db);
    const error = await bajoPrueba.verificar().then(
      () => null,
      (causa: unknown) => causa,
    );
    expect(error).toBeInstanceOf(Error);
    // Sin valores en el mensaje.
    expect((error as Error).message).not.toContain('alias-reservado');

    // Lo que Vitest hace después de un beforeAll que lanzó: correr los ganchos.
    expect(await bajoPrueba.limpiar()).toBe(false);
    expect(await bajoPrueba.cerrar()).toBe(false);

    expect((await refCobro().get()).exists).toBe(true);
    expect((await refMarca().get()).exists).toBe(true);
  });

  it('una marca ilegible tampoco deja verificar, ni borra', async () => {
    await refMarca().set({ cuenta: 7 });
    await refCobro().set({ concepto: 'cobro real pendiente' });

    const bajoPrueba = new BaseDeEmuladorDePruebas(db);
    await expect(bajoPrueba.verificar()).rejects.toThrow(/marca de la prueba en producción/);
    expect(await bajoPrueba.limpiar()).toBe(false);
    expect(await bajoPrueba.cerrar()).toBe(false);

    expect((await refCobro().get()).exists).toBe(true);
    expect((await refMarca().get()).exists).toBe(true);
  });

  it('la guarda no se anula sola: tras el aborto, el siguiente archivo sigue viendo la marca', async () => {
    await refMarca().set({ cuenta: 'prod' });
    const bajoPrueba = new BaseDeEmuladorDePruebas(db);
    await bajoPrueba.verificar().catch(() => undefined);
    await bajoPrueba.cerrar();

    await expect(new BaseDeEmuladorDePruebas(db).verificar()).rejects.toThrow();
  });
});

describe('BaseDeEmuladorDePruebas: sin la marca', () => {
  it('verifica y limpia los datos de las pruebas', async () => {
    await refCobro().set({ concepto: 'dato de prueba' });
    await db.collection('abonos').doc('a-1').set({ montoCentavos: 1 });

    const base = new BaseDeEmuladorDePruebas(db);
    await base.verificar();
    expect(await base.limpiar()).toBe(true);

    expect((await refCobro().get()).exists).toBe(false);
    expect((await db.collection('abonos').doc('a-1').get()).exists).toBe(false);
  });

  it('no limpia antes de verificar', async () => {
    await refCobro().set({ concepto: 'dato de prueba' });
    const base = new BaseDeEmuladorDePruebas(db);
    expect(await base.limpiar()).toBe(false);
    expect((await refCobro().get()).exists).toBe(true);
  });

  it('cerrar() borra solo la marca que las pruebas crearon, no la colección entera', async () => {
    const base = new BaseDeEmuladorDePruebas(db);
    await base.verificar();
    await refMarca().set({ cuenta: 'creada-por-la-prueba' });
    await db.collection(COLECCION_CONFIGURACION).doc('otro-documento').set({ dato: 1 });

    expect(await base.cerrar()).toBe(true);

    expect((await refMarca().get()).exists).toBe(false);
    expect((await db.collection(COLECCION_CONFIGURACION).doc('otro-documento').get()).exists).toBe(true);
    await db.collection(COLECCION_CONFIGURACION).doc('otro-documento').delete();
  });
});
