/**
 * Tests de integración contra el **emulador** de Firestore.
 *
 * Corren con `npm run test:emulador`, fuera de la suite por defecto y del CI
 * (necesitan Java y firebase-tools). Prueban lo que un mock no puede: que
 * `create()` realmente rechaza la sobrescritura, que los `Timestamp` van y
 * vuelven sin perder precisión y que las consultas devuelven lo que se espera.
 */

import {
  CASOS_COBRO_REPOSITORY,
  CASOS_EVIDENCE_STORE,
  centavos,
  esExito,
  type Centavos,
  type Cobro,
  type RegistroEvidencia,
} from '@mqs/qr-core';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CobroRepositoryFirestore, EvidenceStoreFirestore } from './repositorio.js';

let app: App;
let db: Firestore;

const T0 = new Date('2026-08-27T12:00:00.000Z');

function bs(valor: number): Centavos {
  const r = centavos(valor);
  if (!esExito(r)) throw new Error('monto inválido');
  return r.valor;
}

function unCobro(sobrescribir: Partial<Cobro> = {}): Cobro {
  return {
    id: 'cobro-emulador-1',
    proveedor: 'baneco',
    estado: 'BORRADOR',
    montoCentavos: bs(12_345),
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: T0,
    telefonoCliente: '+59171234567',
    concepto: 'Cobro de integración',
    ...sobrescribir,
  };
}

function unQr(qrVersion = 1) {
  return {
    qrVersion,
    referenciaProveedor: `qr-${String(qrVersion)}`,
    emitidoEn: T0,
    venceEn: new Date(T0.getTime() + 72 * 3_600_000),
    origen: 'api-baneco' as const,
    imagenRef: null,
    hashImagen: null,
  };
}

function unaEvidencia(sobrescribir: Partial<RegistroEvidencia> = {}): RegistroEvidencia {
  return {
    cobroId: 'cobro-emulador-1',
    desde: 'BORRADOR',
    hacia: 'QR_ACTIVO',
    evento: 'QR_EMITIDO',
    origen: 'sistema',
    registradoEn: T0,
    datos: {},
    ...sobrescribir,
  };
}

beforeAll(() => {
  // Barrera: si esta variable no está, `emulators:exec` no nos lanzó y estos
  // tests podrían terminar hablándole al proyecto real. No se corren.
  const emulador = process.env['FIRESTORE_EMULATOR_HOST'];
  if (emulador === undefined || emulador === '') {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST no está definida. Estos tests solo corren contra el ' +
        'emulador: usá `npm run test:emulador`.',
    );
  }

  app = initializeApp({ projectId: 'manejoqrsimple' }, `test-${String(Date.now())}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('cobros'));
});

describe('contrato de los puertos contra Firestore real', () => {
  it.each(CASOS_COBRO_REPOSITORY)('CobroRepository — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new CobroRepositoryFirestore(db))).resolves.toBeUndefined();
  });

  it.each(CASOS_EVIDENCE_STORE)('EvidenceStore — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new EvidenceStoreFirestore(db))).resolves.toBeUndefined();
  });
});

describe('CobroRepositoryFirestore', () => {
  it('guarda y recupera un cobro sin perder nada por el camino', async () => {
    const repo = new CobroRepositoryFirestore(db);
    const cobro = unCobro({ estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() });

    expect(esExito(await repo.guardar(cobro))).toBe(true);
    const leido = await repo.obtener(cobro.id);

    expect(esExito(leido)).toBe(true);
    if (esExito(leido)) {
      // Igualdad estructural completa: incluye las fechas, que pasaron por
      // Timestamp de ida y de vuelta.
      expect(leido.valor).toEqual(cobro);
    }
  });

  it('devuelve null para un id que no existe, no un error', async () => {
    const repo = new CobroRepositoryFirestore(db);
    expect(await repo.obtener('no-existe')).toEqual({ ok: true, valor: null });
  });

  it('lista solo los cobros que el watcher tiene que mirar', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await repo.guardar(unCobro({ id: 'c1', estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() }));
    await repo.guardar(unCobro({ id: 'c2', estado: 'COMPROBANTE_RECIBIDO', qrVersion: 1, qrVigente: unQr() }));
    await repo.guardar(unCobro({ id: 'c3', estado: 'CONFIRMADO' }));
    await repo.guardar(unCobro({ id: 'c4', estado: 'BORRADOR' }));

    const pendientes = await repo.listarPendientes();
    expect(esExito(pendientes)).toBe(true);
    if (esExito(pendientes)) {
      expect(pendientes.valor.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    }
  });

  it('el historial de QRs es append-only: renovar agrega, no reemplaza', async () => {
    const repo = new CobroRepositoryFirestore(db);
    const cobro = unCobro({ estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr(1) });
    await repo.guardar(cobro);
    await repo.guardar({ ...cobro, qrVersion: 2, qrVigente: unQr(2) });

    const qrs = await db.collection('cobros').doc(cobro.id).collection('qrs').get();
    expect(qrs.docs.map((d) => d.id).sort()).toEqual(['0001', '0002']);
  });

  it('reguardar el mismo cobro no rompe por el QR ya escrito', async () => {
    // Pasa todo el tiempo: el cobro se guarda en cada transición.
    const repo = new CobroRepositoryFirestore(db);
    const cobro = unCobro({ estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() });
    await repo.guardar(cobro);
    expect(esExito(await repo.guardar({ ...cobro, estado: 'PAGO_DETECTADO' }))).toBe(true);
  });

  it('deriva las detecciones conciliadas de la evidencia (regla #7)', async () => {
    const repo = new CobroRepositoryFirestore(db);
    const evidencia = new EvidenceStoreFirestore(db);
    await repo.guardar(unCobro());

    await evidencia.agregar(unaEvidencia({ evento: 'PAGO_DETECTADO', datos: { idDeduplicacion: 'baneco:q:1' } }));
    await evidencia.agregar(
      unaEvidencia({
        evento: 'PAGO_CONCILIADO',
        hacia: 'CONFIRMADO',
        datos: { idDeduplicacion: 'baneco:q:1' },
      }),
    );

    const claves = await repo.deteccionesAplicadas('cobro-emulador-1');
    expect(esExito(claves)).toBe(true);
    if (esExito(claves)) {
      // Solo la que llegó a conciliar: la mera detección no bloquea reintentos.
      expect(claves.valor).toEqual(['baneco:q:1']);
    }
  });

  it('un documento corrupto se reporta, no se saltea en silencio', async () => {
    // Saltear un cobro pendiente sería dejar de mirarlo sin que nadie se entere.
    await db.collection('cobros').doc('roto').set({ estado: 'ENVIADO', basura: true });

    const pendientes = await new CobroRepositoryFirestore(db).listarPendientes();
    expect(esExito(pendientes)).toBe(false);
  });
});

describe('EvidenceStoreFirestore', () => {
  it('agrega registros y los devuelve en orden cronológico', async () => {
    const store = new EvidenceStoreFirestore(db);
    await store.agregar(unaEvidencia({ registradoEn: new Date('2026-08-27T12:00:00.000Z') }));
    await store.agregar(
      unaEvidencia({
        evento: 'QR_ENVIADO',
        desde: 'QR_ACTIVO',
        hacia: 'ENVIADO',
        registradoEn: new Date('2026-08-27T12:05:00.000Z'),
      }),
    );

    const registros = await store.listarDeCobro('cobro-emulador-1');
    expect(esExito(registros)).toBe(true);
    if (esExito(registros)) {
      expect(registros.valor.map((r) => r.hacia)).toEqual(['QR_ACTIVO', 'ENVIADO']);
    }
  });

  it('dos transiciones en el mismo instante no se pisan', async () => {
    const store = new EvidenceStoreFirestore(db);
    await store.agregar(unaEvidencia());
    await store.agregar(unaEvidencia());

    const registros = await store.listarDeCobro('cobro-emulador-1');
    expect(esExito(registros) && registros.valor).toHaveLength(2);
  });

  it('la evidencia guardada conserva el instante exacto', async () => {
    const store = new EvidenceStoreFirestore(db);
    const cuando = new Date('2026-08-27T12:34:56.789Z');
    await store.agregar(unaEvidencia({ registradoEn: cuando }));

    const registros = await store.listarDeCobro('cobro-emulador-1');
    expect(esExito(registros) && registros.valor[0]?.registradoEn).toEqual(cuando);
  });

  it('un cobro sin evidencia devuelve lista vacía, no error', async () => {
    const registros = await new EvidenceStoreFirestore(db).listarDeCobro('sin-evidencia');
    expect(registros).toEqual({ ok: true, valor: [] });
  });
});
