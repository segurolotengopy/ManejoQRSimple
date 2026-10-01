/**
 * Tests de integración contra el **emulador** de Firestore.
 *
 * Corren con `npm run test:emulador`, fuera de la suite por defecto y del CI
 * (necesitan Java y firebase-tools). Prueban lo que un mock no puede: que
 * `create()` realmente rechaza la sobrescritura, que los `Timestamp` van y
 * vuelven sin perder precisión y que las consultas devuelven lo que se espera.
 */

import {
  CASOS_ABONOS_SIN_CONCILIAR,
  CASOS_COBRO_REPOSITORY,
  CASOS_EVIDENCE_STORE,
  centavos,
  esExito,
  type Centavos,
  type Cobro,
  type RegistroEvidencia,
} from '@mqs/qr-core';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AbonosSinConciliarFirestore, COLECCION_ABONOS_SIN_CONCILIAR } from './abonos-sin-conciliar.js';
import { atribuirCuentaALoAnterior, contarSinCuentaDeCobro } from './atribucion-de-cuenta.js';
import { COLECCION_CONFIGURACION, explicarMarca, fijarCuentaDePrueba } from './cuenta-de-prueba.js';
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
    cuentaCobro: 'cuenta-a',
    estado: 'BORRADOR',
    montoCentavos: bs(12_345),
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: T0,
    telefonoCliente: '+59171234567',
    concepto: 'Cobro de integración',
    consumidor: null,
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

/** Un cobro como lo guardaba la versión anterior: sin `cuentaCobro`. */
function documentoDeCobroViejo(): Record<string, unknown> {
  const { id: _id, cuentaCobro: _cuenta, ...resto } = unCobro();
  return { ...resto, creadoEn: Timestamp.fromDate(T0) };
}

/** Un abono como lo guardaba la versión anterior: sin `cuentaCobro`. */
function documentoDeAbonoViejo(): Record<string, unknown> {
  return {
    idDeduplicacion: 'baneco:qr-viejo:tx-1',
    motivo: 'HUERFANO',
    cobroId: null,
    montoCentavos: 100,
    ocurridoEn: Timestamp.fromDate(T0),
    origen: 'watcher-baneco',
    registradoEn: Timestamp.fromDate(T0),
    abierto: true,
    resolucion: null,
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
  await db.recursiveDelete(db.collection(COLECCION_ABONOS_SIN_CONCILIAR));
  await db.recursiveDelete(db.collection(COLECCION_CONFIGURACION));
});

describe('fijarCuentaDePrueba()', () => {
  it('marca el emulador vacío y deja pasar al mismo alias', async () => {
    await expect(fijarCuentaDePrueba(db, 'prod', T0)).resolves.toEqual({ tipo: 'MARCADA', cuenta: 'prod' });
    await expect(fijarCuentaDePrueba(db, 'prod', T0)).resolves.toEqual({ tipo: 'COINCIDE', cuenta: 'prod' });
  });

  it('otra cuenta sobre los mismos datos no arranca', async () => {
    await fijarCuentaDePrueba(db, 'prod', T0);
    const marca = await fijarCuentaDePrueba(db, 'sucursal-2', T0);
    expect(marca).toEqual({ tipo: 'CONFLICTO', cuenta: 'sucursal-2', guardada: 'prod' });
    // El conflicto no pisa la marca: los datos siguen siendo de la primera.
    await expect(fijarCuentaDePrueba(db, 'prod', T0)).resolves.toEqual({ tipo: 'COINCIDE', cuenta: 'prod' });
    expect(explicarMarca(marca)).toContain('sucursal-2');
  });

  it('una marca ilegible tampoco deja arrancar', async () => {
    await db.collection(COLECCION_CONFIGURACION).doc('cuentaDePrueba').set({ cuenta: 7 });
    const marca = await fijarCuentaDePrueba(db, 'prod', T0);
    expect(marca.tipo).toBe('ERROR');
    expect(explicarMarca(marca)).not.toBeNull();
  });
});

describe('contrato de los puertos contra Firestore real', () => {
  it.each(CASOS_COBRO_REPOSITORY)('CobroRepository — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new CobroRepositoryFirestore(db))).resolves.toBeUndefined();
  });

  it.each(CASOS_EVIDENCE_STORE)('EvidenceStore — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new EvidenceStoreFirestore(db))).resolves.toBeUndefined();
  });

  it.each(CASOS_ABONOS_SIN_CONCILIAR)('AbonosSinConciliarStore — $nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new AbonosSinConciliarFirestore(db))).resolves.toBeUndefined();
  });
});

describe('AbonosSinConciliarFirestore', () => {
  it('un id del banco con "/" no abre una subcolección', async () => {
    const store = new AbonosSinConciliarFirestore(db);
    const monto = bs(100);
    const r = await store.registrar({
      idDeduplicacion: 'baneco:qr/raro:tx-1',
      motivo: 'HUERFANO',
      cobroId: null,
      montoCentavos: monto,
      ocurridoEn: T0,
      origen: 'watcher-baneco',
      cuentaCobro: 'cuenta-a',
      registradoEn: T0,
      resolucion: null,
    });
    expect(esExito(r)).toBe(true);
    const abiertos = await store.listarAbiertos(10);
    expect(esExito(abiertos) && abiertos.valor.map((a) => a.idDeduplicacion)).toEqual(['baneco:qr/raro:tx-1']);
  });

  it('el abono conserva la cuenta en que cayó el pago', async () => {
    const store = new AbonosSinConciliarFirestore(db);
    await store.registrar({
      idDeduplicacion: 'baneco:qr-cuenta:tx-1',
      motivo: 'HUERFANO',
      cobroId: null,
      montoCentavos: bs(100),
      ocurridoEn: T0,
      origen: 'watcher-baneco',
      cuentaCobro: 'cuenta-b',
      registradoEn: T0,
      resolucion: null,
    });
    const abiertos = await store.listarAbiertos(10);
    expect(esExito(abiertos) && abiertos.valor.map((a) => a.cuentaCobro)).toEqual(['cuenta-b']);
  });

  it('un abono sin cuenta falla fuerte al leerse, no se lee como «sin cuenta»', async () => {
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());
    const abiertos = await new AbonosSinConciliarFirestore(db).listarAbiertos(10);
    expect(esExito(abiertos)).toBe(false);
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
    await repo.guardar(unCobro({ id: 'c5', estado: 'QR_ACTIVO', qrVersion: 1, qrVigente: unQr() }));

    const pendientes = await repo.listarPendientes('cuenta-a');
    expect(esExito(pendientes)).toBe(true);
    if (esExito(pendientes)) {
      // QR_ACTIVO también: su QR es pagable y al vencer hay que anularlo.
      expect(pendientes.valor.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c5']);
    }
  });

  it('encuentra el cobro por la referencia de su QR vigente, en cualquier estado', async () => {
    // La conciliación diaria busca así: un pago de un cobro ya confirmado es
    // el caso normal, no un huérfano.
    const repo = new CobroRepositoryFirestore(db);
    await repo.guardar(unCobro({ id: 'c1', estado: 'CONFIRMADO', qrVersion: 1, qrVigente: unQr(1) }));
    await repo.guardar(unCobro({ id: 'c2', estado: 'ENVIADO', qrVersion: 2, qrVigente: unQr(2) }));

    const encontrado = await repo.buscarPorReferenciaQr('qr-1');
    expect(esExito(encontrado) && encontrado.valor?.id).toBe('c1');
    expect(await repo.buscarPorReferenciaQr('qr-9')).toEqual({ ok: true, valor: null });
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
    await db.collection('cobros').doc('roto').set({ cuentaCobro: 'cuenta-a', estado: 'ENVIADO', basura: true });

    const pendientes = await new CobroRepositoryFirestore(db).listarPendientes('cuenta-a');
    expect(esExito(pendientes)).toBe(false);
  });

  it('la cuenta de cobro hace el viaje de ida y vuelta', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await repo.guardar(unCobro({ cuentaCobro: 'sucursal-2' }));

    const leido = await repo.obtener('cobro-emulador-1');
    expect(esExito(leido) && leido.valor?.cuentaCobro).toBe('sucursal-2');
    const crudo = await db.collection('cobros').doc('cobro-emulador-1').get();
    expect(crudo.get('cuentaCobro')).toBe('sucursal-2');
  });

  it('un documento sin cuentaCobro es DOCUMENTO_INVALIDO, no un cobro «sin cuenta»', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());

    const leido = await repo.obtener('viejo');
    expect(esExito(leido)).toBe(false);
  });

  it('un alias que parece un número de cuenta no se acepta al leer', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await db.collection('cobros').doc('numerico').set({ ...documentoDeCobroViejo(), cuentaCobro: '1234567890' });

    expect(esExito(await repo.obtener('numerico'))).toBe(false);
  });

  it('listarPendientes solo devuelve los de la cuenta pedida', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await repo.guardar(unCobro({ id: 'a1', cuentaCobro: 'cuenta-a', estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() }));
    await repo.guardar(unCobro({ id: 'b1', cuentaCobro: 'cuenta-b', estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr(2) }));

    const deB = await repo.listarPendientes('cuenta-b');
    expect(esExito(deB) && deB.valor.map((c) => c.id)).toEqual(['b1']);
  });

  it('listarDeConsumidor filtra por consumidor y por cuenta', async () => {
    const repo = new CobroRepositoryFirestore(db);
    const consumidor = (ref: string) => ({ consumidorId: 'novuchat', referenciaExterna: ref });
    await repo.guardar(unCobro({ id: 'a1', cuentaCobro: 'cuenta-a', telefonoCliente: null, consumidor: consumidor('r1') }));
    await repo.guardar(unCobro({ id: 'b1', cuentaCobro: 'cuenta-b', telefonoCliente: null, consumidor: consumidor('r2') }));

    const desde = new Date(T0.getTime() - 3_600_000);
    const hasta = new Date(T0.getTime() + 3_600_000);
    const deA = await repo.listarDeConsumidor({ consumidorId: 'novuchat', cuentaCobro: 'cuenta-a' }, desde, hasta, 10);
    expect(esExito(deA) && deA.valor.map((c) => c.id)).toEqual(['a1']);
  });
});

describe('atribuirCuentaALoAnterior()', () => {
  async function sembrarAnterior(): Promise<void> {
    await db.collection('cobros').doc('viejo-1').set({ ...documentoDeCobroViejo(), estado: 'ENVIADO' });
    await db.collection('cobros').doc('viejo-2').set({ ...documentoDeCobroViejo(), estado: 'CONFIRMADO' });
    await db.collection('cobros').doc('con-cuenta').set({ ...documentoDeCobroViejo(), cuentaCobro: 'otra' });
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());
  }

  async function sinCuenta(): Promise<string[]> {
    const todos = await db.collection('cobros').get();
    return todos.docs.filter((d) => d.get('cuentaCobro') === undefined).map((d) => d.id).sort();
  }

  it('sin marca de cuenta no hay con qué atribuir: no escribe nada', async () => {
    await sembrarAnterior();

    await expect(atribuirCuentaALoAnterior(db, 'cuenta-a')).resolves.toEqual({ tipo: 'SIN_MARCA' });
    expect(await sinCuenta()).toEqual(['viejo-1', 'viejo-2']);
  });

  it('con la marca de otra cuenta se niega y no escribe nada', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-b', T0);
    await sembrarAnterior();

    await expect(atribuirCuentaALoAnterior(db, 'cuenta-a')).resolves.toEqual({
      tipo: 'MARCA_DE_OTRA_CUENTA',
      guardada: 'cuenta-b',
    });
    expect(await sinCuenta()).toEqual(['viejo-1', 'viejo-2']);
    const abono = await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').get();
    expect(abono.get('cuentaCobro')).toBeUndefined();
  });

  it('con la marca correcta atribuye solo lo que falta y no toca el estado', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    await sembrarAnterior();

    await expect(atribuirCuentaALoAnterior(db, 'cuenta-a')).resolves.toEqual({
      tipo: 'HECHA',
      cobros: 2,
      abonos: 1,
    });

    const viejo1 = await db.collection('cobros').doc('viejo-1').get();
    const viejo2 = await db.collection('cobros').doc('viejo-2').get();
    expect([viejo1.get('cuentaCobro'), viejo1.get('estado')]).toEqual(['cuenta-a', 'ENVIADO']);
    expect([viejo2.get('cuentaCobro'), viejo2.get('estado')]).toEqual(['cuenta-a', 'CONFIRMADO']);
    // No pisa una cuenta que ya estaba, aunque sea distinta.
    const conCuenta = await db.collection('cobros').doc('con-cuenta').get();
    expect(conCuenta.get('cuentaCobro')).toBe('otra');
    const abono = await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').get();
    expect(abono.get('cuentaCobro')).toBe('cuenta-a');
    // Y ahora los documentos se leen.
    expect(esExito(await new CobroRepositoryFirestore(db).obtener('viejo-1'))).toBe(true);
  });

  it('la segunda corrida no encuentra nada que atribuir', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    await sembrarAnterior();
    await atribuirCuentaALoAnterior(db, 'cuenta-a');

    await expect(atribuirCuentaALoAnterior(db, 'cuenta-a')).resolves.toEqual({
      tipo: 'HECHA',
      cobros: 0,
      abonos: 0,
    });
  });

  it('no toca la evidencia ni el historial de QRs', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    const repo = new CobroRepositoryFirestore(db);
    await repo.guardar(unCobro({ estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() }));
    await new EvidenceStoreFirestore(db).agregar(unaEvidencia());
    await db.collection('cobros').doc('cobro-emulador-1').update({ cuentaCobro: FieldValue.delete() });
    const contenidoDeSubcolecciones = async () => {
      const leer = async (sub: string) =>
        (await db.collection('cobros').doc('cobro-emulador-1').collection(sub).get()).docs.map((d) => [
          d.id,
          d.data(),
        ]);
      return { evidencia: await leer('evidencia'), qrs: await leer('qrs') };
    };
    const antes = await contenidoDeSubcolecciones();
    expect(antes.evidencia).toHaveLength(1);
    expect(antes.qrs).toHaveLength(1);

    await atribuirCuentaALoAnterior(db, 'cuenta-a');

    expect(await contenidoDeSubcolecciones()).toEqual(antes);
    const cobro = await db.collection('cobros').doc('cobro-emulador-1').get();
    expect(cobro.get('cuentaCobro')).toBe('cuenta-a');
  });
});

describe('contarSinCuentaDeCobro()', () => {
  async function fotoDeLaBase(): Promise<unknown> {
    const leer = async (coleccion: string) =>
      (await db.collection(coleccion).get()).docs.map((d) => [d.ref.path, d.data()]);
    return { cobros: await leer('cobros'), abonos: await leer(COLECCION_ABONOS_SIN_CONCILIAR) };
  }

  it('una base vacía da 0 y 0', async () => {
    await expect(contarSinCuentaDeCobro(db)).resolves.toEqual({ cobros: 0, abonos: 0 });
  });

  it('cuenta los cobros y los abonos que no tienen el campo', async () => {
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());

    await expect(contarSinCuentaDeCobro(db)).resolves.toEqual({ cobros: 1, abonos: 1 });
  });

  it('con cuenta en todos da 0 y 0, aunque el valor sea inválido (eso lo reporta el mapeo)', async () => {
    await db.collection('cobros').doc('nuevo').set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a' });
    await db.collection('cobros').doc('numerico').set({ ...documentoDeCobroViejo(), cuentaCobro: '1234567890' });
    await db
      .collection(COLECCION_ABONOS_SIN_CONCILIAR)
      .doc('nuevo')
      .set({ ...documentoDeAbonoViejo(), cuentaCobro: 'cuenta-a' });

    await expect(contarSinCuentaDeCobro(db)).resolves.toEqual({ cobros: 0, abonos: 0 });
  });

  it('después de atribuir vuelve a dar 0 y 0', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0);
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());

    await atribuirCuentaALoAnterior(db, 'cuenta-a');

    await expect(contarSinCuentaDeCobro(db)).resolves.toEqual({ cobros: 0, abonos: 0 });
  });

  it('es de solo lectura: no cambia ningún documento', async () => {
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection('cobros').doc('nuevo').set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a' });
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());
    const antes = await fotoDeLaBase();

    await contarSinCuentaDeCobro(db);

    expect(await fotoDeLaBase()).toEqual(antes);
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
