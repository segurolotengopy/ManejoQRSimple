/**
 * El contrato para proyectos consumidores (docs/10).
 *
 * Un consumidor es otro producto —NovuChat es el primero— que necesita cobrar
 * y no quiere saber nada del banco: pide un cobro, pregunta si se pagó y lo
 * anula. Nada más. La asimetría es deliberada y es el corazón del contrato:
 *
 * - **No hay ninguna operación que confirme un pago.** No está en este archivo
 *   y no se puede escribir en otro: `CONFIRMADO` exige una
 *   `ConciliacionAprobada`, y esa solo la fabrica `conciliar()` a partir de la
 *   consulta saliente autenticada al banco (reglas #1 y BANECO-1). Lo que un
 *   consumidor diga sobre un pago es, como el comprobante del pagador, a lo
 *   sumo una señal.
 * - **El consumidor no manda datos personales.** Su referencia externa es
 *   opaca y el cobro no lleva teléfono: el envío del QR al pagador es de él,
 *   por su canal (docs/10, decisiones #4 y #5).
 *
 * La idempotencia por referencia externa es lo que impide que un reintento del
 * consumidor le cobre dos veces a su cliente, y no se apoya en una búsqueda
 * previa —eso sería una carrera— sino en que **el id del cobro se deriva de la
 * referencia** y la creación es atómica (`CobroRepository.crear`).
 */

import { createHash } from 'node:crypto';

import { centavos, type Centavos } from '../comun/dinero.js';
import { esExito, exito, fallo, type Resultado } from '../comun/resultado.js';
import type { Cobro, Proveedor } from '../cobro/cobro.js';
import type { OrigenTransicion } from '../cobro/estados.js';
import type { RegistroEvidencia } from '../cobro/maquina-estados.js';
import { esOrigenDeteccion, type OrigenDeteccion } from '../conciliacion/deteccion.js';
import { emitirQr, type Dependencias, type ErrorCasoUso } from './cobrar.js';

/** Lo que necesita el contrato: persistir, dejar evidencia y pedirle el QR al banco. */
export type DepsConsumidor = Pick<Dependencias, 'cobros' | 'evidencia' | 'avisos' | 'qr'>;

/**
 * Id del cobro de un consumidor, derivado de su clave natural.
 *
 * Que el id **sea** la clave es lo que hace atómica la idempotencia: no hay un
 * "buscar y si no existe crear" entre los que se pueda colar un segundo
 * pedido. Es el mismo criterio con el que la evidencia y los abonos usan su
 * clave natural como id de documento (docs/05 §2).
 *
 * El separador es un byte nulo porque no puede aparecer en ninguna de las dos
 * partes: sin él, `("ab","c")` y `("a","bc")` darían el mismo id.
 */
export function idDeCobroDeConsumidor(consumidorId: string, referenciaExterna: string): string {
  const digest = createHash('sha256')
    .update(`${consumidorId}\u0000${referenciaExterna}`, 'utf8')
    .digest('hex');
  return `cons-${digest}`;
}

export type SolicitudCobroConsumidor = {
  readonly consumidorId: string;
  /** Opaca y única por consumidor. Nunca datos de su cliente (regla #9). */
  readonly referenciaExterna: string;
  readonly montoCentavos: Centavos;
  readonly concepto: string;
  readonly venceEn: Date;
  readonly proveedor: Proveedor;
};

export type ResultadoCreacion = {
  readonly cobro: Cobro;
  /**
   * `false` cuando el pedido era un reintento y se devolvió el cobro que ya
   * existía. El consumidor lo necesita para distinguir "creé uno" de "ya lo
   * tenía", y la API lo traduce a 201 o 200.
   */
  readonly creado: boolean;
};

/**
 * Crea —o devuelve— el cobro de un consumidor, con su QR ya emitido.
 *
 * Idempotente por `(consumidorId, referenciaExterna)`: dos pedidos iguales
 * devuelven el mismo cobro y **un solo** QR. Un pedido con la misma referencia
 * y otro importe no es un reintento sino un error del consumidor, y se rechaza
 * en vez de elegir uno de los dos importes.
 *
 * Si el primer intento murió después de reservar el cobro pero antes de
 * emitirle el QR, el cobro quedó en `BORRADOR` y el reintento **lo retoma**:
 * un cobro sin QR no le sirve a nadie, y crear otro duplicaría la referencia.
 */
export async function crearCobroDeConsumidor(
  deps: DepsConsumidor,
  solicitud: SolicitudCobroConsumidor,
  ahora: Date,
): Promise<Resultado<ResultadoCreacion, ErrorCasoUso>> {
  const id = idDeCobroDeConsumidor(solicitud.consumidorId, solicitud.referenciaExterna);

  const existente = await deps.cobros.obtener(id);
  if (!esExito(existente)) {
    return fallo({ tipo: 'PUERTO', error: existente.error });
  }

  if (existente.valor !== null) {
    return reintentoSobre(deps, existente.valor, solicitud, ahora);
  }

  const nuevo: Cobro = {
    id,
    proveedor: solicitud.proveedor,
    estado: 'BORRADOR',
    montoCentavos: solicitud.montoCentavos,
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: ahora,
    // Sin teléfono a propósito: el envío al pagador es del consumidor.
    telefonoCliente: null,
    concepto: solicitud.concepto,
    consumidor: {
      consumidorId: solicitud.consumidorId,
      referenciaExterna: solicitud.referenciaExterna,
    },
  };

  const reserva = await deps.cobros.crear(nuevo);
  if (!esExito(reserva)) {
    if (reserva.error.tipo !== 'CONFLICTO') {
      return fallo({ tipo: 'PUERTO', error: reserva.error });
    }
    // Dos pedidos iguales al mismo tiempo: el otro ganó la reserva. No se
    // emite un segundo QR; se sigue con el cobro que quedó.
    const ganador = await deps.cobros.obtener(id);
    if (!esExito(ganador)) {
      return fallo({ tipo: 'PUERTO', error: ganador.error });
    }
    if (ganador.valor === null) {
      return fallo({ tipo: 'PUERTO', error: reserva.error });
    }
    return reintentoSobre(deps, ganador.valor, solicitud, ahora);
  }

  return emitirSobre(deps, nuevo, solicitud, ahora, true);
}

/** Qué hacer cuando la referencia externa ya tenía un cobro. */
async function reintentoSobre(
  deps: DepsConsumidor,
  existente: Cobro,
  solicitud: SolicitudCobroConsumidor,
  ahora: Date,
): Promise<Resultado<ResultadoCreacion, ErrorCasoUso>> {
  const dueño = existente.consumidor;
  if (
    dueño === null ||
    dueño.consumidorId !== solicitud.consumidorId ||
    dueño.referenciaExterna !== solicitud.referenciaExterna
  ) {
    // Colisión del hash: inverosímil, pero no se elige un cobro al azar para
    // devolvérselo a quien no es su dueño.
    return fallo({ tipo: 'REFERENCIA_EXTERNA_EN_USO', referenciaExterna: solicitud.referenciaExterna });
  }
  if (existente.montoCentavos !== solicitud.montoCentavos) {
    return fallo({
      tipo: 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA',
      referenciaExterna: solicitud.referenciaExterna,
      registrado: existente.montoCentavos,
    });
  }
  if (existente.estado !== 'BORRADOR') {
    return exito({ cobro: existente, creado: false });
  }
  // Quedó reservado sin QR: se le emite ahora en vez de dejarlo inservible.
  return emitirSobre(deps, existente, solicitud, ahora, false);
}

/** Emite el QR del cobro reservado; si otro se adelantó, devuelve el de él. */
async function emitirSobre(
  deps: DepsConsumidor,
  cobro: Cobro,
  solicitud: SolicitudCobroConsumidor,
  ahora: Date,
  creado: boolean,
): Promise<Resultado<ResultadoCreacion, ErrorCasoUso>> {
  const emitido = await emitirQr(deps, cobro, solicitud.venceEn, ahora);
  if (esExito(emitido)) {
    return exito({ cobro: emitido.valor, creado });
  }
  // `emitirQr` ya anuló en el banco el QR que no llegó a adoptarse. Si perdió
  // la carrera contra otro pedido igual, el cobro bueno es el que quedó
  // guardado: devolverlo es exactamente lo que espera quien reintenta.
  if (emitido.error.tipo !== 'PUERTO' || emitido.error.error.tipo !== 'CONFLICTO') {
    return emitido;
  }
  const ganador = await deps.cobros.obtener(cobro.id);
  if (!esExito(ganador)) {
    return fallo({ tipo: 'PUERTO', error: ganador.error });
  }
  return ganador.valor === null || ganador.valor.qrVigente === null
    ? emitido
    : exito({ cobro: ganador.valor, creado: false });
}

/** ¿Este cobro es de ese consumidor? Nadie ve ni toca el cobro de otro. */
export function esDelConsumidor(cobro: Cobro, consumidorId: string): boolean {
  return cobro.consumidor?.consumidorId === consumidorId;
}

/**
 * El pago de un cobro confirmado, reconstruido desde su evidencia.
 *
 * Se deriva de la evidencia y no de un campo del cobro por la misma razón que
 * `deteccionesAplicadas` (regla #7): un segundo lugar donde anotarlo sería un
 * segundo lugar donde desincronizarse. Devuelve `null` si el cobro nunca llegó
 * a `CONFIRMADO`.
 */
export type PagoDeCobro = {
  readonly idDeduplicacion: string;
  /** Cuándo ocurrió el abono según el banco. `null` si la evidencia no lo trae. */
  readonly ocurridoEn: Date | null;
  /** Cuándo este sistema lo dio por confirmado. */
  readonly confirmadoEn: Date;
  readonly montoCentavos: Centavos | null;
  /** Qué riel lo detectó: la API del banco o el scraper. `null` si no consta. */
  readonly riel: OrigenDeteccion | null;
  /** `sistema` si concilió solo; `accion-manual` si lo resolvió una persona. */
  readonly confirmadoPor: OrigenTransicion;
};

export function pagoDeCobro(registros: readonly RegistroEvidencia[]): PagoDeCobro | null {
  // El último que llegó a CONFIRMADO. `CONFIRMADO` es terminal, así que hay
  // uno solo; se recorre al revés por si alguna vez deja de serlo.
  const confirmacion = [...registros].reverse().find((r) => r.hacia === 'CONFIRMADO');
  if (confirmacion === undefined) {
    return null;
  }
  const idDeduplicacion = confirmacion.datos['idDeduplicacion'];
  if (typeof idDeduplicacion !== 'string') {
    return null;
  }

  // El riel y el instante del abono vienen del registro que lo reportó
  // (`PAGO_DETECTADO`, `ABONO_TARDIO`, `DETECCION_EN_REVISION`), no de la
  // confirmación: la confirmación es nuestra, la detección es del riel.
  const deteccion = registros.find(
    (r) => r.datos['idDeduplicacion'] === idDeduplicacion && typeof r.datos['origenDeteccion'] === 'string',
  );
  const origenDeteccion = deteccion?.datos['origenDeteccion'];
  const ocurridoEn = deteccion?.datos['ocurridoEn'];
  const monto = deteccion?.datos['montoCentavos'] ?? confirmacion.datos['montoCentavos'];
  const montoValidado = typeof monto === 'number' ? centavos(monto) : null;

  return {
    idDeduplicacion,
    ocurridoEn: typeof ocurridoEn === 'string' ? new Date(ocurridoEn) : null,
    confirmadoEn: confirmacion.registradoEn,
    montoCentavos: montoValidado !== null && esExito(montoValidado) ? montoValidado.valor : null,
    // `esOrigenDeteccion` y no una lista copiada acá: un riel nuevo en
    // `deteccion.ts` tiene que aparecer, no volverse `null` en silencio.
    riel: esOrigenDeteccion(origenDeteccion) ? origenDeteccion : null,
    confirmadoPor: confirmacion.origen,
  };
}
