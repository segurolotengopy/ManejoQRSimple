/**
 * Tests de contrato de los puertos (ADR-002).
 *
 * Son los mismos casos para el mock, para `baneco-gateway` y para
 * `yape-scraper`: si un adaptador los pasa, el dominio no nota la diferencia.
 * Ese era el propósito declarado de ADR-002 y acá se hace ejecutable.
 *
 * Los casos son **datos**, no un `describe` de vitest: así `qr-core` sigue sin
 * importar nada (ni siquiera el runner de tests) y cada paquete los corre con
 * su propio runner. Las aserciones son `throw` a secas por el mismo motivo.
 */

import type { Cobro } from '../cobro/cobro.js';
import { centavos } from '../comun/dinero.js';
import { esExito, type Resultado } from '../comun/resultado.js';
import type { AbonoSinConciliar } from '../revision/abono-sin-conciliar.js';
import type {
  AbonosSinConciliarStore,
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  PaymentWatcher,
  QrProvider,
  SolicitudQr,
} from './puertos.js';

export type CasoDeContrato<T> = {
  readonly nombre: string;
  readonly ejecutar: (sujeto: T) => Promise<void>;
};

function afirmar(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    throw new Error(`contrato incumplido: ${mensaje}`);
  }
}

function exigirExito<T>(r: Resultado<T, ErrorPuerto>, contexto: string): T {
  if (!esExito(r)) {
    throw new Error(`contrato incumplido: ${contexto} falló con ${r.error.tipo}`);
  }
  return r.valor;
}

export const CASOS_QR_PROVIDER: ReadonlyArray<CasoDeContrato<QrProvider>> = [
  {
    nombre: 'emite un QR con la versión pedida y vencimiento posterior a la emisión',
    ejecutar: async (proveedor) => {
      const solicitud = solicitudDeEjemplo();
      const qr = exigirExito(await proveedor.emitir(solicitud), 'emitir');

      afirmar(qr.qrVersion === solicitud.qrVersion, 'la versión del QR debe ser la solicitada');
      afirmar(
        qr.venceEn.getTime() > qr.emitidoEn.getTime(),
        'todo QR vence después de emitirse (regla #6)',
      );
      afirmar(qr.referenciaProveedor.length > 0, 'el QR debe traer referencia del proveedor');
    },
  },
  {
    nombre: 'anular dos veces el mismo QR es idempotente',
    ejecutar: async (proveedor) => {
      const qr = exigirExito(await proveedor.emitir(solicitudDeEjemplo()), 'emitir');
      exigirExito(await proveedor.anular(qr.referenciaProveedor), 'primera anulación');
      // La segunda no puede romper: los reintentos son normales en la red.
      exigirExito(await proveedor.anular(qr.referenciaProveedor), 'segunda anulación');
    },
  },
];

export const CASOS_PAYMENT_WATCHER: ReadonlyArray<CasoDeContrato<PaymentWatcher>> = [
  {
    nombre: 'una referencia desconocida devuelve null, no un error',
    ejecutar: async (watcher) => {
      const r = await watcher.consultarCobro('referencia-que-no-existe');
      const deteccion = exigirExito(r, 'consultarCobro');
      afirmar(deteccion === null, '"todavía no hay abono" no es una falla del adaptador');
    },
  },
  {
    nombre: 'listar los abonos de un día devuelve una colección',
    ejecutar: async (watcher) => {
      const abonos = exigirExito(
        await watcher.listarAbonosDelDia(new Date('2026-08-27T00:00:00.000Z')),
        'listarAbonosDelDia',
      );
      afirmar(Array.isArray(abonos), 'debe devolver una colección, aunque esté vacía');
    },
  },
  {
    nombre: 'la clave de deduplicación de un abono es estable entre consultas',
    ejecutar: async (watcher) => {
      const fecha = new Date('2026-08-27T00:00:00.000Z');
      const primera = exigirExito(await watcher.listarAbonosDelDia(fecha), 'primera lectura');
      const segunda = exigirExito(await watcher.listarAbonosDelDia(fecha), 'segunda lectura');

      afirmar(primera.length === segunda.length, 'dos lecturas del mismo día deben coincidir');
      primera.forEach((abono, i) => {
        const otro = segunda[i];
        afirmar(otro !== undefined, 'las lecturas deben alinearse');
        afirmar(
          otro !== undefined && abono.idDeduplicacion === otro.idDeduplicacion,
          'la misma pasada dos veces no puede producir dos confirmaciones (regla #7)',
        );
        afirmar(abono.idDeduplicacion.length > 0, 'toda detección necesita clave de deduplicación');
      });
    },
  },
];

export const CASOS_EVIDENCE_STORE: ReadonlyArray<CasoDeContrato<EvidenceStore>> = [
  {
    nombre: 'la evidencia es append-only: agregar no pisa lo anterior',
    ejecutar: async (store) => {
      const base = {
        cobroId: 'cobro-contrato',
        desde: 'BORRADOR',
        hacia: 'QR_ACTIVO',
        evento: 'QR_EMITIDO',
        origen: 'sistema',
        datos: {},
      } as const;

      exigirExito(
        await store.agregar({ ...base, registradoEn: new Date('2026-08-27T12:00:00.000Z') }),
        'primer registro',
      );
      exigirExito(
        await store.agregar({ ...base, registradoEn: new Date('2026-08-27T12:01:00.000Z') }),
        'segundo registro',
      );

      const registros = exigirExito(await store.listarDeCobro('cobro-contrato'), 'listar');
      afirmar(registros.length === 2, 'los dos registros deben coexistir, no reemplazarse');
    },
  },
];

export const CASOS_COBRO_REPOSITORY: ReadonlyArray<CasoDeContrato<CobroRepository>> = [
  {
    nombre: 'un id desconocido devuelve null, no un error',
    ejecutar: async (repo) => {
      const cobro = exigirExito(await repo.obtener('no-existe'), 'obtener');
      afirmar(cobro === null, 'un cobro inexistente no es una falla');
    },
  },
  {
    nombre: 'una referencia de QR desconocida devuelve null, no un error',
    ejecutar: async (repo) => {
      const cobro = exigirExito(await repo.buscarPorReferenciaQr('qr-inexistente'), 'buscar');
      afirmar(cobro === null, 'un QR que no es de nadie no es una falla: es un huérfano');
    },
  },
  {
    nombre: 'una escritura sobre un estado viejo falla con CONFLICTO y no pisa el actual',
    ejecutar: async (repo) => {
      const cobro = cobroDeContrato();
      exigirExito(await repo.guardar(cobro), 'guardado inicial');

      // Alguien leyó el cobro cuando estaba en QR_ACTIVO; hoy está en ENVIADO.
      const viejo = await repo.guardar({ ...cobro, estado: 'ANULADO' }, 'QR_ACTIVO');
      afirmar(!esExito(viejo) && viejo.error.tipo === 'CONFLICTO', 'debe rechazar con CONFLICTO');
      const actual = exigirExito(await repo.obtener(cobro.id), 'releer');
      afirmar(actual?.estado === 'ENVIADO', 'el estado guardado no debe cambiar');

      exigirExito(await repo.guardar({ ...cobro, estado: 'ANULADO' }, 'ENVIADO'), 'con el estado correcto');
    },
  },
  {
    nombre: 'listar por estado devuelve solo los cobros de ese estado',
    ejecutar: async (repo) => {
      const base = cobroDeContrato();
      exigirExito(await repo.guardar({ ...base, id: 'contrato-revision', estado: 'EN_REVISION' }), 'guardar');
      exigirExito(await repo.guardar({ ...base, id: 'contrato-enviado', estado: 'ENVIADO' }), 'guardar');

      const enRevision = exigirExito(await repo.listarPorEstado('EN_REVISION', 10), 'listar');
      afirmar(
        enRevision.length === 1 && enRevision[0]?.id === 'contrato-revision',
        'la cola de revisión no puede mezclar otros estados',
      );
    },
  },
];

function cobroDeContrato(): Cobro {
  return {
    id: 'cobro-contrato-conflicto',
    proveedor: 'baneco',
    estado: 'ENVIADO',
    montoCentavos: 12_345 as Cobro['montoCentavos'],
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: INSTANTE_DE_CONTRATO,
    telefonoCliente: '+59171234567',
    concepto: 'Caso de contrato',
  };
}

/**
 * El "ahora" de los casos de contrato. Quien corre los casos contra un
 * proveedor con reloj inyectable le pasa este instante: con el reloj real, la
 * solicitud de ejemplo —que vence en una fecha fija— terminaría emitida
 * después de su vencimiento en cuanto pase esa fecha.
 */
export const CASOS_ABONOS_SIN_CONCILIAR: ReadonlyArray<CasoDeContrato<AbonosSinConciliarStore>> = [
  {
    nombre: 'registrar dos veces el mismo abono deja un solo caso abierto',
    ejecutar: async (store) => {
      const abono = abonoSinConciliarDeEjemplo('baneco:qr-contrato-1:tx-1');
      const primero = exigirExito(await store.registrar(abono), 'primer registro');
      const segundo = exigirExito(await store.registrar(abono), 'segundo registro');
      afirmar(primero && !segundo, 'registrar informa si el abono es nuevo: true la primera vez, false después');
      const abiertos = exigirExito(await store.listarAbiertos(10), 'listar');
      afirmar(abiertos.length === 1, 'el mismo abono no se duplica (regla #7)');
    },
  },
  {
    nombre: 'los datos vuelven tal cual se guardaron',
    ejecutar: async (store) => {
      const abono = abonoSinConciliarDeEjemplo('baneco:qr-contrato-2:tx-1');
      exigirExito(await store.registrar(abono), 'registrar');
      const [leido] = exigirExito(await store.listarAbiertos(10), 'listar');
      afirmar(leido !== undefined, 'el abono registrado debe listarse');
      afirmar(leido?.montoCentavos === abono.montoCentavos, 'el monto no cambia');
      afirmar(leido?.ocurridoEn.getTime() === abono.ocurridoEn.getTime(), 'el instante del pago no cambia');
      afirmar(leido?.registradoEn.getTime() === abono.registradoEn.getTime(), 'el instante del registro no cambia');
      afirmar(leido?.motivo === 'HUERFANO' && leido.cobroId === null, 'motivo y cobro se conservan');
      afirmar(leido?.resolucion === null, 'un abono recién registrado está abierto');
    },
  },
  {
    nombre: 'cerrar lo saca de los abiertos, y registrarlo de nuevo no lo reabre',
    ejecutar: async (store) => {
      const abono = abonoSinConciliarDeEjemplo('baneco:qr-contrato-3:tx-1');
      exigirExito(await store.registrar(abono), 'registrar');
      const cerrado = exigirExito(
        await store.cerrar(abono.idDeduplicacion, { motivo: 'Devuelto al pagador', resueltoEn: INSTANTE_DE_CONTRATO }),
        'cerrar',
      );
      afirmar(cerrado?.resolucion?.motivo === 'Devuelto al pagador', 'cerrar devuelve el abono con su resolución');
      // El cierre del día se repite (el satélite reinició): no puede reabrirlo.
      const denuevo = exigirExito(await store.registrar(abono), 'registrar de nuevo');
      afirmar(!denuevo, 'un abono ya cerrado no cuenta como nuevo');
      const abiertos = exigirExito(await store.listarAbiertos(10), 'listar');
      afirmar(abiertos.length === 0, 'un abono cerrado no vuelve a la cola');
    },
  },
  {
    nombre: 'una resolución no se pisa con otra',
    ejecutar: async (store) => {
      const abono = abonoSinConciliarDeEjemplo('baneco:qr-contrato-4:tx-1');
      exigirExito(await store.registrar(abono), 'registrar');
      const resolucion = { motivo: 'Primera resolución', resueltoEn: INSTANTE_DE_CONTRATO };
      exigirExito(await store.cerrar(abono.idDeduplicacion, resolucion), 'primer cierre');
      const segundo = await store.cerrar(abono.idDeduplicacion, { ...resolucion, motivo: 'Segunda resolución' });
      afirmar(!esExito(segundo) && segundo.error.tipo === 'CONFLICTO', 'el segundo cierre debe fallar con CONFLICTO');
    },
  },
  {
    nombre: 'cerrar un abono que no existe devuelve null, no un error',
    ejecutar: async (store) => {
      const r = exigirExito(
        await store.cerrar('baneco:qr-inexistente:tx-0', { motivo: 'No existe', resueltoEn: INSTANTE_DE_CONTRATO }),
        'cerrar inexistente',
      );
      afirmar(r === null, 'lo desconocido es null');
    },
  },
];

function abonoSinConciliarDeEjemplo(idDeduplicacion: string): AbonoSinConciliar {
  const monto = centavos(1_500);
  if (!esExito(monto)) {
    throw new Error('monto de ejemplo inválido');
  }
  return {
    idDeduplicacion,
    motivo: 'HUERFANO',
    cobroId: null,
    montoCentavos: monto.valor,
    ocurridoEn: new Date(INSTANTE_DE_CONTRATO.getTime() - 3_600_000),
    origen: 'watcher-baneco',
    registradoEn: INSTANTE_DE_CONTRATO,
    resolucion: null,
  };
}

export const INSTANTE_DE_CONTRATO = new Date('2026-08-27T12:00:00.000Z');

function solicitudDeEjemplo(): SolicitudQr {
  return {
    cobroId: 'cobro-contrato',
    montoCentavos: 12_345 as SolicitudQr['montoCentavos'],
    venceEn: new Date(INSTANTE_DE_CONTRATO.getTime() + 72 * 3_600_000),
    concepto: 'Caso de contrato',
    qrVersion: 1,
    origenEsperado: 'api-baneco',
  };
}
