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

import { esExito, type Resultado } from '../comun/resultado.js';
import type { CobroRepository, ErrorPuerto, EvidenceStore, PaymentWatcher, QrProvider, SolicitudQr } from './puertos.js';

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
];

function solicitudDeEjemplo(): SolicitudQr {
  const emitidoEn = new Date('2026-08-27T12:00:00.000Z');
  return {
    cobroId: 'cobro-contrato',
    montoCentavos: 12_345 as SolicitudQr['montoCentavos'],
    venceEn: new Date(emitidoEn.getTime() + 72 * 3_600_000),
    concepto: 'Caso de contrato',
    qrVersion: 1,
    origenEsperado: 'api-baneco',
  };
}
