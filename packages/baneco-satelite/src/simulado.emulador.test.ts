/**
 * El caso 4B2, contra el emulador de Firestore: un detector simulado no
 * confirma un QR del banco.
 *
 * Reproduce lo que pasaba: una base con un cobro de QR real (`api-baneco`), un
 * documento en `abonos/*` con la forma que escribe `demo:pagar` y el origen
 * `watcher-baneco`, y un satélite armado con los adaptadores del demo. Antes,
 * esa pasada confirmaba el cobro; ahora tiene que dejarlo en revisión.
 *
 * Corre con `npm run test:emulador`.
 */

import { MensajeriaNoConfigurada, construirPuertos } from '@mqs/composicion';
import { BaseDeEmuladorDePruebas, CobroRepositoryFirestore, COLECCION_ABONOS } from '@mqs/firestore-store';
import { centavos, esExito, type Cobro, type OrigenQr } from '@mqs/qr-core';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { unaPasada } from './pasada.js';

let app: App;
let db: Firestore;
let base: BaseDeEmuladorDePruebas;

const T0 = new Date('2026-08-27T12:00:00.000Z');
const CUENTA = 'cuenta-a';
const REFERENCIA = 'qr-4b2';
const MONTO = 12_345;

beforeAll(async () => {
  const emulador = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulador === undefined || emulador === '') {
    throw new Error('FIRESTORE_EMULATOR_HOST no está definida. Estos tests solo corren contra el emulador.');
  }
  app = initializeApp({ projectId: 'manejoqrsimple' }, `satelite-${String(Date.now())}`);
  db = getFirestore(app);

  // Estas pruebas borran colecciones enteras: nunca sobre la base de la prueba
  // en producción (cobros reales) ni sobre una que no se pueda comprobar. La
  // guarda se mira una sola vez, antes de borrar nada, y toda limpieza queda
  // atada a que haya pasado (`BaseDeEmuladorDePruebas`).
  base = new BaseDeEmuladorDePruebas(db);
  await base.verificar();
});

afterAll(async () => {
  // Aunque la guarda haya fallado, este gancho corre: sin verificación no borra
  // nada —ni la marca de la prueba real— y solo cierra la app.
  await base.cerrar();
  await deleteApp(app);
});

beforeEach(async () => {
  await base.limpiar();
});

function unCobroEnviado(origenQr: OrigenQr): Cobro {
  const monto = centavos(MONTO);
  if (!esExito(monto)) throw new Error('monto inválido');
  return {
    id: 'cobro-4b2',
    proveedor: 'baneco',
    cuentaCobro: CUENTA,
    estado: 'ENVIADO',
    montoCentavos: monto.valor,
    moneda: 'BOB',
    qrVersion: 1,
    qrVigente: {
      qrVersion: 1,
      referenciaProveedor: REFERENCIA,
      emitidoEn: T0,
      venceEn: new Date(T0.getTime() + 72 * 3_600_000),
      origen: origenQr,
      imagenRef: null,
      hashImagen: null,
    },
    creadoEn: T0,
    telefonoCliente: '+59171234567',
    concepto: 'Cobro de integración',
    consumidor: null,
  };
}

/** El documento tal como lo escribe `tools/demo-local/src/pagar.ts`, con el origen falsificado. */
async function escribirAbonoComoPagar(origen: string): Promise<void> {
  await db
    .collection(COLECCION_ABONOS)
    .doc(`simulado:${REFERENCIA}:${String(MONTO)}`)
    .set({
      referenciaProveedor: REFERENCIA,
      montoCentavos: MONTO,
      ocurridoEn: Timestamp.fromDate(new Date(T0.getTime() + 30 * 60_000)),
      origen,
      referencia: 'Cobro de integración',
    });
}

function armarSatelite() {
  const puertos = construirPuertos({
    env: { QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado', MESSAGING_PROVIDER: 'mock' },
    db,
    mensajeria: new MensajeriaNoConfigurada(),
  });
  if (!esExito(puertos)) throw new Error('los puertos del demo deberían armarse');
  return puertos.valor;
}

const estadoGuardado = async (): Promise<string | undefined> =>
  (await db.collection('cobros').doc('cobro-4b2').get()).get('estado') as string | undefined;

describe('4B2: el detector simulado sobre un QR del banco', () => {
  it('un abono con origen watcher-baneco escrito a mano deja el cobro en EN_REVISION, nunca CONFIRMADO', async () => {
    await new CobroRepositoryFirestore(db).crear(unCobroEnviado('api-baneco'));
    await escribirAbonoComoPagar('watcher-baneco');

    const resultado = await unaPasada(armarSatelite().deps, CUENTA, new Date(T0.getTime() + 3_600_000));

    expect('errorFatal' in resultado).toBe(false);
    if ('errorFatal' in resultado) return;
    expect(resultado.confirmados).toEqual([]);
    expect(resultado.enRevision).toEqual(['cobro-4b2']);
    expect(await estadoGuardado()).toBe('EN_REVISION');
  });

  it('el mismo abono sobre un QR simulado sí confirma: el demo sigue funcionando', async () => {
    await new CobroRepositoryFirestore(db).crear(unCobroEnviado('simulado'));
    await escribirAbonoComoPagar('watcher-simulado');

    const resultado = await unaPasada(armarSatelite().deps, CUENTA, new Date(T0.getTime() + 3_600_000));

    expect('errorFatal' in resultado).toBe(false);
    if ('errorFatal' in resultado) return;
    expect(resultado.confirmados).toEqual(['cobro-4b2']);
    expect(await estadoGuardado()).toBe('CONFIRMADO');
  });
});
