/**
 * `prepararDatosDeLaCuenta` contra el **emulador** de Firestore.
 *
 * Corre con `npm run test:emulador`, igual que los del adaptador: lo que se
 * prueba es lo que decide si la API o el satélite arrancan sobre datos que
 * no vigilarían.
 */

import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fijarCuentaDePrueba } from '@mqs/firestore-store';
import { esExito } from '@mqs/qr-core';

import { leerAtribucionExplicita, prepararDatosDeLaCuenta } from './cuenta.js';

let app: App;
let db: Firestore;

const T0 = new Date('2026-08-27T12:00:00.000Z');

/** Un cobro como lo guardaba la versión anterior: sin `cuentaCobro`. */
function cobroViejo(): Record<string, unknown> {
  return {
    proveedor: 'baneco',
    estado: 'ENVIADO',
    montoCentavos: 12_345,
    moneda: 'BOB',
    qrVersion: 1,
    qrVigente: null,
    creadoEn: Timestamp.fromDate(T0),
    telefonoCliente: '+59171234567',
    concepto: 'Cobro anterior',
    consumidor: null,
  };
}

const abonoViejo = (): Record<string, unknown> => ({
  idDeduplicacion: 'baneco:qr-viejo:tx-1',
  motivo: 'HUERFANO',
  cobroId: null,
  montoCentavos: 100,
  ocurridoEn: Timestamp.fromDate(T0),
  origen: 'watcher-baneco',
  registradoEn: Timestamp.fromDate(T0),
  abierto: true,
  resolucion: null,
});

async function foto(): Promise<unknown> {
  const leer = async (coleccion: string) =>
    (await db.collection(coleccion).get()).docs.map((d) => [d.ref.path, d.data()]);
  return { cobros: await leer('cobros'), abonos: await leer('abonosSinConciliar') };
}

beforeAll(() => {
  const emulador = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulador === undefined || emulador === '') {
    throw new Error('FIRESTORE_EMULATOR_HOST no está definida. Estos tests solo corren contra el emulador.');
  }
  app = initializeApp({ projectId: 'manejoqrsimple' }, `composicion-${String(Date.now())}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('cobros'));
  await db.recursiveDelete(db.collection('abonosSinConciliar'));
  await db.recursiveDelete(db.collection('configuracion'));
});

/**
 * El arranque de la API y del satélite, tal como lo escriben sus `main.ts`: en
 * modo prueba se fija la marca **primero** (si no hay, la crea) y con lo que
 * devolvió se prepara. Probar `prepararDatosDeLaCuenta` sin ese paso previo
 * probaría un orden que ningún proceso ejecuta.
 */
async function arrancar(cuenta: string, modoPrueba: boolean, env: Record<string, string> = {}) {
  if (!modoPrueba) {
    return prepararDatosDeLaCuenta({ db, cuenta, modoPrueba: false });
  }
  const explicita = leerAtribucionExplicita(env, cuenta);
  const marca = await fijarCuentaDePrueba(db, cuenta, T0, explicita.permitida);
  return prepararDatosDeLaCuenta({
    db,
    cuenta,
    modoPrueba: true,
    marca,
    atribucionExplicita: explicita.permitida,
  });
}

const hayMarca = async (): Promise<boolean> =>
  (await db.collection('configuracion').doc('cuentaDePrueba').get()).exists;

describe('prepararDatosDeLaCuenta() con la secuencia de los main.ts', () => {
  it('sin datos anteriores sigue, con o sin modo prueba', async () => {
    const fuera = await arrancar('cuenta-a', false);
    expect(esExito(fuera) && fuera.valor).toEqual({ cobros: 0, abonos: 0 });

    const enPrueba = await arrancar('cuenta-a', true);
    expect(esExito(enPrueba) && enPrueba.valor).toEqual({ cobros: 0, abonos: 0 });
  });

  it('sobre datos viejos SIN marca aborta ANTES de crear la marca y no escribe nada', async () => {
    // El caso que importa: el emulador tiene datos de antes y ninguna marca. La
    // marca no se crea, así que ni este arranque, ni el siguiente, ni el otro
    // proceso que sube a la vez pueden atribuir esos datos por suposición.
    await db.collection('cobros').doc('doc-x7q').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('doc-x7q').set(abonoViejo());
    const antes = await foto();

    const r = await arrancar('cuenta-a', true);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'SIN_MARCA_CON_DATOS', cobros: 1, abonos: 1 });
    expect(r.error.mensaje).toContain('No se creó ninguna marca ni se escribió nada');
    expect(r.error.mensaje).toContain('ATRIBUIR_DATOS_ANTERIORES_A=cuenta-a');
    expect(r.error.mensaje).not.toContain('doc-x7q');
    expect(await hayMarca()).toBe(false);
    expect(await foto()).toEqual(antes);

    // El reintento, y el otro proceso que sube casi a la vez, corren la misma suerte.
    const [otra, tercera] = await Promise.all([arrancar('cuenta-a', true), arrancar('cuenta-a', true)]);
    expect([esExito(otra), esExito(tercera)]).toEqual([false, false]);
    expect(await hayMarca()).toBe(false);
    expect(await foto()).toEqual(antes);
  });

  it('defensa en profundidad: una marca MARCADA sin autorización, con datos sin cuenta, no atribuye', async () => {
    // No debería darse (fijarCuentaDePrueba no marca sobre esos datos), pero si
    // alguien arma la llamada a mano, la marca recién puesta no autoriza nada.
    await db.collection('cobros').doc('doc-x7q').set(cobroViejo());
    const antes = await foto();

    const r = await prepararDatosDeLaCuenta({
      db,
      cuenta: 'cuenta-a',
      modoPrueba: true,
      marca: { tipo: 'MARCADA', cuenta: 'cuenta-a' },
      atribucionExplicita: false,
    });

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error.tipo).toBe('MARCA_RECIEN_PUESTA');
    expect(await foto()).toEqual(antes);
  });

  it('con ATRIBUIR_DATOS_ANTERIORES_A igual a la cuenta, marca, atribuye y la segunda corrida coincide', async () => {
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('viejo').set(abonoViejo());
    const env = { ATRIBUIR_DATOS_ANTERIORES_A: 'cuenta-a' };

    const primera = await arrancar('cuenta-a', true, env);
    expect(esExito(primera) && primera.valor).toEqual({ cobros: 1, abonos: 1 });
    const cobro = await db.collection('cobros').doc('viejo').get();
    expect([cobro.get('cuentaCobro'), cobro.get('estado')]).toEqual(['cuenta-a', 'ENVIADO']);
    expect(await hayMarca()).toBe(true);

    const segunda = await arrancar('cuenta-a', true, env);
    expect(esExito(segunda) && segunda.valor).toEqual({ cobros: 0, abonos: 0 });
  });

  it('con la variable DISTINTA de la cuenta se comporta como sin variable', async () => {
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    const antes = await foto();

    const r = await arrancar('cuenta-a', true, { ATRIBUIR_DATOS_ANTERIORES_A: 'cuenta-b' });

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error.tipo).toBe('SIN_MARCA_CON_DATOS');
    expect(await hayMarca()).toBe(false);
    expect(await foto()).toEqual(antes);
  });

  it.each([{}, { ATRIBUIR_DATOS_ANTERIORES_A: 'cuenta-a' }, { ATRIBUIR_DATOS_ANTERIORES_A: 'cuenta-b' }])(
    'sin datos viejos, un emulador nuevo se marca como antes (%j)',
    async (env) => {
      const r = await arrancar('cuenta-a', true, env);

      expect(esExito(r) && r.valor).toEqual({ cobros: 0, abonos: 0 });
      expect(await hayMarca()).toBe(true);
    },
  );

  it('con la marca de una corrida anterior, un cobro viejo se atribuye y sigue', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false); // marca que ya existía
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('viejo').set(abonoViejo());

    const r = await arrancar('cuenta-a', true);

    expect(esExito(r) && r.valor).toEqual({ cobros: 1, abonos: 1 });
    const cobro = await db.collection('cobros').doc('viejo').get();
    expect([cobro.get('cuentaCobro'), cobro.get('estado')]).toEqual(['cuenta-a', 'ENVIADO']);
  });

  it('fuera de modo prueba, con un cobro viejo aborta con el conteo y no escribe', async () => {
    await db.collection('cobros').doc('doc-x7q').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('doc-x7q').set(abonoViejo());
    const antes = await foto();

    const r = await arrancar('cuenta-a', false);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'DATOS_SIN_CUENTA', cobros: 1, abonos: 1, pendientesDeOtraCuenta: 0 });
    expect(r.error.mensaje).toContain('1 cobro(s) y 1 abono(s)');
    // Ni ids ni datos de los documentos.
    expect(r.error.mensaje).not.toContain('doc-x7q');
    expect(await foto()).toEqual(antes);
  });

  it('con la marca de otra cuenta aborta, nombra la variante y no escribe', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-b', T0, false);
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    const antes = await foto();

    const r = await arrancar('cuenta-a', true);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'ATRIBUCION_NO_HECHA', variante: 'MARCA_DE_OTRA_CUENTA' });
    expect(r.error.mensaje).toContain('MARCA_DE_OTRA_CUENTA');
    expect(await foto()).toEqual(antes);
  });

  it('un cobro con la cuenta inválida sobrevive a la atribución y aborta el arranque', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
    await db
      .collection('cobros')
      .doc('invalido')
      .set({ ...cobroViejo(), cuentaCobro: 'PROD' });

    const r = await arrancar('cuenta-a', true);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'DATOS_SIN_CUENTA', cobros: 1 });
    expect(r.error.mensaje).not.toContain('PROD');
  });

  it('un cobro pendiente de otra cuenta aborta el arranque; uno que no está pendiente no', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
    await db
      .collection('cobros')
      .doc('terminado')
      .set({ ...cobroViejo(), cuentaCobro: 'cuenta-b', estado: 'CONFIRMADO' });
    const sinPendiente = await arrancar('cuenta-a', true);
    expect(esExito(sinPendiente)).toBe(true);

    await db
      .collection('cobros')
      .doc('pendiente')
      .set({ ...cobroViejo(), cuentaCobro: 'cuenta-b', estado: 'ENVIADO' });
    const r = await arrancar('cuenta-a', true);

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'DATOS_SIN_CUENTA', cobros: 0, abonos: 0, pendientesDeOtraCuenta: 1 });
  });
});
