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
import { BaseDeEmuladorDePruebas } from './base-de-pruebas.js';
import { atribuirCuentaALoAnterior, contarSinCuentaDeCobro } from './atribucion-de-cuenta.js';
import {
  COLECCION_CONFIGURACION,
  contarDatosSimulados,
  explicarMarca,
  fijarCuentaDePrueba,
  leerPresenciaDeMarca,
} from './cuenta-de-prueba.js';
import { CobroRepositoryFirestore, EvidenceStoreFirestore } from './repositorio.js';
import { COLECCION_ABONOS, ORIGEN_ABONOS, PaymentWatcherAbonosFirestore } from './watcher-abonos.js';

let app: App;
let db: Firestore;
let base: BaseDeEmuladorDePruebas;

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

beforeAll(async () => {
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

describe('fijarCuentaDePrueba()', () => {
  it('marca el emulador vacío y deja pasar al mismo alias', async () => {
    await expect(fijarCuentaDePrueba(db, 'prod', T0, false)).resolves.toEqual({ tipo: 'MARCADA', cuenta: 'prod' });
    await expect(fijarCuentaDePrueba(db, 'prod', T0, false)).resolves.toEqual({ tipo: 'COINCIDE', cuenta: 'prod' });
  });

  it('otra cuenta sobre los mismos datos no arranca', async () => {
    await fijarCuentaDePrueba(db, 'prod', T0, false);
    const marca = await fijarCuentaDePrueba(db, 'sucursal-2', T0, false);
    expect(marca).toEqual({ tipo: 'CONFLICTO', cuenta: 'sucursal-2', guardada: 'prod' });
    // El conflicto no pisa la marca: los datos siguen siendo de la primera.
    await expect(fijarCuentaDePrueba(db, 'prod', T0, false)).resolves.toEqual({ tipo: 'COINCIDE', cuenta: 'prod' });
    expect(explicarMarca(marca)).toContain('sucursal-2');
  });

  describe('sobre un emulador que ya trae datos sin cuenta', () => {
    const marcaDe = async () => (await db.collection(COLECCION_CONFIGURACION).doc('cuentaDePrueba').get()).exists;
    async function foto(): Promise<unknown> {
      const leer = async (coleccion: string) =>
        (await db.collection(coleccion).get()).docs.map((d) => [d.ref.path, d.data()]);
      return { cobros: await leer('cobros'), abonos: await leer(COLECCION_ABONOS_SIN_CONCILIAR) };
    }
    async function sembrar(): Promise<void> {
      await db.collection('cobros').doc('doc-x7q').set(documentoDeCobroViejo());
      await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('doc-x7q').set(documentoDeAbonoViejo());
    }
    const sinMarcaConDatos = { tipo: 'SIN_MARCA_CON_DATOS', cuenta: 'cuenta-a', cobros: 1, abonos: 1 };

    it('no crea la marca: devuelve SIN_MARCA_CON_DATOS y no escribe nada', async () => {
      await sembrar();
      const antes = await foto();

      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual(sinMarcaConDatos);

      expect(await marcaDe()).toBe(false);
      expect(await foto()).toEqual(antes);
    });

    it('el reintento con la misma cuenta también aborta: la marca no quedó puesta', async () => {
      await sembrar();
      const antes = await foto();

      await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual(sinMarcaConDatos);

      expect(await marcaDe()).toBe(false);
      expect(await foto()).toEqual(antes);
    });

    it('dos arranques simultáneos abortan los dos, sin marca y sin escribir', async () => {
      await sembrar();
      const antes = await foto();

      const resultados = await Promise.all([
        fijarCuentaDePrueba(db, 'cuenta-a', T0, false),
        fijarCuentaDePrueba(db, 'cuenta-a', T0, false),
      ]);

      expect(resultados).toEqual([sinMarcaConDatos, sinMarcaConDatos]);
      expect(await marcaDe()).toBe(false);
      expect(await foto()).toEqual(antes);
    });

    it('con la autorización explícita crea la marca, y la siguiente vez coincide', async () => {
      await sembrar();

      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, true)).resolves.toEqual({
        tipo: 'MARCADA',
        cuenta: 'cuenta-a',
      });
      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual({
        tipo: 'COINCIDE',
        cuenta: 'cuenta-a',
      });
    });

    it('un cobro con la cuenta inválida también cuenta como dato sin cuenta', async () => {
      await db.collection('cobros').doc('doc-x7q').set({ ...documentoDeCobroViejo(), cuentaCobro: 'PROD' });

      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual({
        tipo: 'SIN_MARCA_CON_DATOS',
        cuenta: 'cuenta-a',
        cobros: 1,
        abonos: 0,
      });
    });

    it('los datos que ya tienen cuenta válida no impiden marcar', async () => {
      await db.collection('cobros').doc('con-cuenta').set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a' });

      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual({
        tipo: 'MARCADA',
        cuenta: 'cuenta-a',
      });
    });

    it('con una marca de otra cuenta sigue siendo CONFLICTO, haya datos o no', async () => {
      await fijarCuentaDePrueba(db, 'cuenta-b', T0, false);
      await sembrar();

      await expect(fijarCuentaDePrueba(db, 'cuenta-a', T0, false)).resolves.toEqual({
        tipo: 'CONFLICTO',
        cuenta: 'cuenta-a',
        guardada: 'cuenta-b',
      });
    });

    it('explicarMarca dice qué pasó y cómo decidir, sin ids ni datos', () => {
      const texto = explicarMarca({ tipo: 'SIN_MARCA_CON_DATOS', cuenta: 'cuenta-a', cobros: 2, abonos: 1 });
      expect(texto).toContain('2 cobro(s) y 1 abono(s)');
      expect(texto).toContain('No se creó ninguna marca ni se escribió nada');
      expect(texto).toContain('ATRIBUIR_DATOS_ANTERIORES_A=cuenta-a');
      expect(texto).toContain('respalde');
      expect(texto).not.toContain('doc-x7q');
    });
  });

  it('una marca ilegible tampoco deja arrancar', async () => {
    await db.collection(COLECCION_CONFIGURACION).doc('cuentaDePrueba').set({ cuenta: 7 });
    const marca = await fijarCuentaDePrueba(db, 'prod', T0, false);
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
    await fijarCuentaDePrueba(db, 'cuenta-b', T0, false);
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
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
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
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
    await sembrarAnterior();
    await atribuirCuentaALoAnterior(db, 'cuenta-a');

    await expect(atribuirCuentaALoAnterior(db, 'cuenta-a')).resolves.toEqual({
      tipo: 'HECHA',
      cobros: 0,
      abonos: 0,
    });
  });

  it('no toca la evidencia ni el historial de QRs', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
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
  const contado = (cobros: number, abonos: number, pendientesDeOtraCuenta = 0) => ({
    tipo: 'CONTADO',
    cobros,
    abonos,
    pendientesDeOtraCuenta,
  });

  it('una base vacía da 0, 0 y 0', async () => {
    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0));
  });

  it('cuenta los cobros y los abonos que no tienen el campo', async () => {
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(1, 1));
  });

  it.each([
    ['null', null],
    ['vacía', ''],
    ['un número', 5],
    ['mayúsculas', 'PROD'],
    ['un número de cuenta', '1234567890'],
    ['con espacios', 'otra cuenta'],
  ])('un cobro y un abono con la cuenta inválida (%s) cuentan: el mapeo no los ve', async (_caso, valor) => {
    // El filtro por cuenta los deja fuera de `listarPendientes` antes de que se
    // lea el documento: el mapeo nunca llega a reportarlos.
    await db.collection('cobros').doc('invalido').set({ ...documentoDeCobroViejo(), cuentaCobro: valor });
    await db
      .collection(COLECCION_ABONOS_SIN_CONCILIAR)
      .doc('invalido')
      .set({ ...documentoDeAbonoViejo(), cuentaCobro: valor });

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(1, 1));
  });

  it('con una cuenta válida en todos da 0 y 0', async () => {
    await db.collection('cobros').doc('nuevo').set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a' });
    await db
      .collection(COLECCION_ABONOS_SIN_CONCILIAR)
      .doc('nuevo')
      .set({ ...documentoDeAbonoViejo(), cuentaCobro: 'cuenta-a' });

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0));
  });

  it.each(['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO'])(
    'un cobro %s de otra cuenta cuenta aparte',
    async (estado) => {
      await db
        .collection('cobros')
        .doc('ajeno')
        .set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-b', estado });

      await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0, 1));
    },
  );

  it('un cobro de otra cuenta que no está pendiente no cuenta', async () => {
    for (const estado of ['CONFIRMADO', 'ANULADO', 'VENCIDO', 'EN_REVISION', 'BORRADOR']) {
      await db
        .collection('cobros')
        .doc(`ajeno-${estado}`)
        .set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-b', estado });
    }

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0, 0));
  });

  it('un cobro pendiente de esta misma cuenta no cuenta', async () => {
    await db
      .collection('cobros')
      .doc('propio')
      .set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a', estado: 'ENVIADO' });

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0, 0));
  });

  it('después de atribuir vuelve a dar 0', async () => {
    await fijarCuentaDePrueba(db, 'cuenta-a', T0, false);
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());

    await atribuirCuentaALoAnterior(db, 'cuenta-a');

    await expect(contarSinCuentaDeCobro(db, 'cuenta-a')).resolves.toEqual(contado(0, 0));
  });

  it('es de solo lectura: no cambia ningún documento', async () => {
    await db.collection('cobros').doc('viejo').set(documentoDeCobroViejo());
    await db.collection('cobros').doc('nuevo').set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-a' });
    await db
      .collection('cobros')
      .doc('ajeno')
      .set({ ...documentoDeCobroViejo(), cuentaCobro: 'cuenta-b', estado: 'ENVIADO' });
    await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc('viejo').set(documentoDeAbonoViejo());
    const antes = await fotoDeLaBase();

    await contarSinCuentaDeCobro(db, 'cuenta-a');

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

describe('PaymentWatcherAbonosFirestore: el origen lo pone el adaptador, no el documento', () => {
  const abonoEscrito = (sobrescribir: Record<string, unknown> = {}): Record<string, unknown> => ({
    referenciaProveedor: 'qr-1',
    montoCentavos: 12_345,
    ocurridoEn: Timestamp.fromDate(T0),
    referencia: null,
    ...sobrescribir,
  });

  it('un documento que dice ser del banco se lee como detección simulada', async () => {
    // Adverso: quien escribe en `abonos/*` se hace pasar por `watcher-baneco`.
    await db.collection(COLECCION_ABONOS).doc('falso-1').set(abonoEscrito({ origen: 'watcher-baneco' }));
    const r = await new PaymentWatcherAbonosFirestore(db).consultarCobro('qr-1');
    expect(esExito(r) && r.valor?.origen).toBe(ORIGEN_ABONOS);
    expect(ORIGEN_ABONOS).toBe('watcher-simulado');
  });

  it('un documento sin origen también se lee, como simulado', async () => {
    await db.collection(COLECCION_ABONOS).doc('sin-origen-1').set(abonoEscrito());
    const r = await new PaymentWatcherAbonosFirestore(db).listarAbonosDelDia(T0);
    expect(esExito(r) && r.valor.map((d) => d.origen)).toEqual(['watcher-simulado']);
  });

  it('un documento cuyo id imita una clave del banco se descarta: no se devuelve como detección', async () => {
    // Si pasara, el abono real del cierre con esa misma clave contaría como
    // «ya registrado» y nunca se ataría a su cobro.
    await db.collection(COLECCION_ABONOS).doc('baneco:qr-1:tx-1').set(abonoEscrito({ origen: 'watcher-baneco' }));
    const watcher = new PaymentWatcherAbonosFirestore(db);
    const puntual = await watcher.consultarCobro('qr-1');
    expect(esExito(puntual) && puntual.valor).toBeNull();
    const dia = await watcher.listarAbonosDelDia(T0);
    expect(esExito(dia) && dia.valor).toEqual([]);

    // Un documento válido con la misma referencia sí se devuelve.
    await db.collection(COLECCION_ABONOS).doc('simulado:qr-1:12345').set(abonoEscrito());
    const conValido = await watcher.consultarCobro('qr-1');
    expect(esExito(conValido) && conValido.valor?.idDeduplicacion).toBe('simulado:qr-1:12345');
    const diaValido = await watcher.listarAbonosDelDia(T0);
    expect(esExito(diaValido) && diaValido.valor.map((d) => d.idDeduplicacion)).toEqual(['simulado:qr-1:12345']);
  });

  it('un origen que no es de ningún riel conocido sigue siendo un documento inválido', async () => {
    await db.collection(COLECCION_ABONOS).doc('raro-1').set(abonoEscrito({ origen: 'inventado' }));
    const r = await new PaymentWatcherAbonosFirestore(db).consultarCobro('qr-1');
    expect(!esExito(r) && r.error.tipo).toBe('RESPUESTA_INVALIDA');
  });
});

describe('el QR simulado ida y vuelta', () => {
  it('se guarda y se lee con origen simulado', async () => {
    const repo = new CobroRepositoryFirestore(db);
    const cobro = unCobro({ estado: 'ENVIADO', qrVersion: 1, qrVigente: { ...unQr(), origen: 'simulado' } });
    expect(esExito(await repo.crear(cobro))).toBe(true);
    const leido = await repo.obtener(cobro.id);
    expect(esExito(leido) && leido.valor?.qrVigente?.origen).toBe('simulado');
  });
});

describe('leerPresenciaDeMarca()', () => {
  it('sin documento, AUSENTE', async () => {
    await expect(leerPresenciaDeMarca(db)).resolves.toEqual({ tipo: 'AUSENTE' });
  });

  it('con la marca válida, PRESENTE', async () => {
    await fijarCuentaDePrueba(db, 'prod', T0, false);
    await expect(leerPresenciaDeMarca(db)).resolves.toEqual({ tipo: 'PRESENTE' });
  });

  it('una marca ilegible cuenta como PRESENTE: no se pasa por encima', async () => {
    await db.collection(COLECCION_CONFIGURACION).doc('cuentaDePrueba').set({ cuenta: 7 });
    await expect(leerPresenciaDeMarca(db)).resolves.toEqual({ tipo: 'PRESENTE' });
  });

  it('si la lectura falla, ERROR sin el texto de la causa', async () => {
    const roto = {
      collection: () => ({
        doc: () => ({ get: () => Promise.reject(new Error('detalle-que-no-debe-salir')) }),
      }),
    } as unknown as Firestore;
    const r = await leerPresenciaDeMarca(roto);
    expect(r).toEqual({ tipo: 'ERROR' });
    expect(JSON.stringify(r)).not.toContain('detalle-que-no-debe-salir');
  });
});

describe('contarDatosSimulados()', () => {
  it('base vacía: ceros', async () => {
    await expect(contarDatosSimulados(db)).resolves.toEqual({ tipo: 'OK', abonos: 0, cobros: 0 });
  });

  it('cuenta los abonos de abonos/* y los cobros con QR simulado, y no los del banco', async () => {
    const repo = new CobroRepositoryFirestore(db);
    await repo.crear(unCobro({ id: 'real-1', estado: 'ENVIADO', qrVersion: 1, qrVigente: unQr() }));
    await repo.crear(
      unCobro({ id: 'sim-1', estado: 'ENVIADO', qrVersion: 1, qrVigente: { ...unQr(), origen: 'simulado' } }),
    );
    await repo.crear(unCobro({ id: 'sim-2', estado: 'ENVIADO', qrVersion: 1, qrVigente: { ...unQr(), origen: 'simulado' } }));
    await db.collection(COLECCION_ABONOS).doc('a-1').set({ referenciaProveedor: 'x', montoCentavos: 1 });
    await expect(contarDatosSimulados(db)).resolves.toEqual({ tipo: 'OK', abonos: 1, cobros: 2 });
  });

  it('si la consulta falla, ERROR sin el texto de la causa', async () => {
    const roto = {
      collection: () => {
        throw new Error('detalle-que-no-debe-salir');
      },
    } as unknown as Firestore;
    const r = await contarDatosSimulados(roto);
    expect(r).toEqual({ tipo: 'ERROR' });
    expect(JSON.stringify(r)).not.toContain('detalle-que-no-debe-salir');
  });
});
