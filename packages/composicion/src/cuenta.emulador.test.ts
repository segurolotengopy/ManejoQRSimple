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

import { prepararDatosDeLaCuenta } from './cuenta.js';

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

describe('prepararDatosDeLaCuenta()', () => {
  it('sin datos anteriores sigue, con o sin modo prueba', async () => {
    const fuera = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: false });
    expect(esExito(fuera) && fuera.valor).toEqual({ cobros: 0, abonos: 0 });

    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    const enPrueba = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: true });
    expect(esExito(enPrueba) && enPrueba.valor).toEqual({ cobros: 0, abonos: 0 });
  });

  it('en modo prueba, con un cobro viejo, lo atribuye y sigue', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('viejo').set(abonoViejo());

    const r = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: true });

    expect(esExito(r) && r.valor).toEqual({ cobros: 1, abonos: 1 });
    const cobro = await db.collection('cobros').doc('viejo').get();
    expect([cobro.get('cuentaCobro'), cobro.get('estado')]).toEqual(['cuenta-a', 'ENVIADO']);
  });

  it('fuera de modo prueba, con un cobro viejo aborta con el conteo y no escribe', async () => {
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    await db.collection('abonosSinConciliar').doc('viejo').set(abonoViejo());
    const antes = await foto();

    const r = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: false });

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'DATOS_SIN_CUENTA', cobros: 1, abonos: 1 });
    expect(r.error.mensaje).toContain('1 cobro(s) y 1 abono(s)');
    // Ni ids ni datos de los documentos.
    expect(r.error.mensaje).not.toContain('viejo');
    expect(await foto()).toEqual(antes);
  });

  it('con la marca de otra cuenta aborta, nombra la variante y no escribe', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-b', T0);
    await db.collection('cobros').doc('viejo').set(cobroViejo());
    const antes = await foto();

    const r = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: true });

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'ATRIBUCION_NO_HECHA', variante: 'MARCA_DE_OTRA_CUENTA' });
    expect(r.error.mensaje).toContain('MARCA_DE_OTRA_CUENTA');
    expect(await foto()).toEqual(antes);
  });

  it('en modo prueba, sin marca, aborta con SIN_MARCA', async () => {
    await db.collection('cobros').doc('viejo').set(cobroViejo());

    const r = await prepararDatosDeLaCuenta({ db, cuenta: 'cuenta-a', modoPrueba: true });

    expect(esExito(r)).toBe(false);
    if (esExito(r)) return;
    expect(r.error).toMatchObject({ tipo: 'ATRIBUCION_NO_HECHA', variante: 'SIN_MARCA' });
  });
});
