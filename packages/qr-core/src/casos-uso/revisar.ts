/**
 * Casos de uso de la revisión manual.
 *
 * `EN_REVISION` es el único estado que resuelve una persona. Estos casos de uso
 * son lo que la consola le ofrece: ver la cola, buscar en el banco un pago que
 * falta, y decidir. Tres reglas que no dependen de la consola:
 *
 * - **Confirmar exige un abono del banco en la evidencia.** Es la regla #1
 *   también para la persona: un comprobante, una llamada del cliente o una
 *   captura no alcanzan. Si el banco no reportó nada, se busca primero.
 * - **Toda resolución lleva motivo y queda como `accion-manual`** (regla #8).
 * - **Buscar el pago no resuelve nada**: si el banco lo reporta, queda en la
 *   evidencia y el caso sigue en revisión, ahora confirmable.
 */

import type { Cobro } from '../cobro/cobro.js';
import { verificarAdmision } from '../cobro/maquina-estados.js';
import { esExito, exito, fallo, type Resultado } from '../comun/resultado.js';
import {
  construirCaso,
  ordenarCasos,
  POLITICA_REVISION_POR_DEFECTO,
  resumirRevision,
  ultimaDeteccion,
  type CasoRevision,
  type PoliticaRevision,
  type ResumenRevision,
} from '../revision/revision.js';
import {
  aplicar,
  type Dependencias,
  type DepsPersistencia,
  type ErrorCasoUso,
} from './cobrar.js';

/** Buscar un pago en el banco: persistir, más consultar al watcher. */
export type DepsBusqueda = DepsPersistencia & Pick<Dependencias, 'watcher'>;

/** Tope de casos que se arman de una vez. Más que esto es un problema operativo. */
export const LIMITE_REVISION = 200;

export type ColaRevision = {
  readonly casos: readonly CasoRevision[];
  readonly resumen: ResumenRevision;
};

/** La cola de revisión, lo más urgente primero. */
export async function listarRevision(
  deps: DepsPersistencia,
  ahora: Date,
  politica: PoliticaRevision = POLITICA_REVISION_POR_DEFECTO,
): Promise<Resultado<ColaRevision, ErrorCasoUso>> {
  const enRevision = await deps.cobros.listarPorEstado('EN_REVISION', LIMITE_REVISION);
  if (!esExito(enRevision)) {
    return fallo({ tipo: 'PUERTO', error: enRevision.error });
  }

  const casos: CasoRevision[] = [];
  for (const cobro of enRevision.valor) {
    const registros = await deps.evidencia.listarDeCobro(cobro.id);
    if (!esExito(registros)) {
      return fallo({ tipo: 'PUERTO', error: registros.error });
    }
    casos.push(construirCaso(cobro, registros.valor, ahora, politica));
  }

  const ordenados = ordenarCasos(casos);
  return exito({ casos: ordenados, resumen: resumirRevision(ordenados) });
}

/**
 * La decisión del dueño sobre un caso en revisión.
 *
 * `CONFIRMADO` acepta el último abono que reportó el banco; si no hay ninguno,
 * falla con `SIN_DETECCION_DEL_BANCO`. `RECHAZADO` no necesita abono — pero
 * si lo hay, rechazar significa que esa plata se devuelve por fuera.
 */
export async function resolverRevision(
  deps: DepsPersistencia,
  cobro: Cobro,
  decision: 'CONFIRMADO' | 'RECHAZADO',
  motivo: string,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const inadmisible = verificarAdmision(cobro, 'RESUELTO_MANUALMENTE');
  if (inadmisible !== null) {
    return fallo({ tipo: 'TRANSICION', error: inadmisible });
  }

  if (decision === 'RECHAZADO') {
    const rechazado = await aplicar(
      deps,
      cobro,
      { tipo: 'RESUELTO_MANUALMENTE', decision, motivo, origen: 'accion-manual' },
      ahora,
    );
    return esExito(rechazado) ? exito(rechazado.valor.cobro) : rechazado;
  }

  const registros = await deps.evidencia.listarDeCobro(cobro.id);
  if (!esExito(registros)) {
    return fallo({ tipo: 'PUERTO', error: registros.error });
  }
  const abono = ultimaDeteccion(registros.valor);
  if (abono === null) {
    return fallo({ tipo: 'SIN_DETECCION_DEL_BANCO', cobroId: cobro.id });
  }

  const confirmado = await aplicar(
    deps,
    cobro,
    {
      tipo: 'RESUELTO_MANUALMENTE',
      decision,
      idDeduplicacion: abono.idDeduplicacion,
      motivo,
      origen: 'accion-manual',
    },
    ahora,
  );
  return esExito(confirmado) ? exito(confirmado.valor.cobro) : confirmado;
}

export type ResultadoBusqueda = {
  /** ¿El banco reporta un pago para el QR de este cobro? */
  readonly encontrado: boolean;
  readonly cobro: Cobro;
};

/**
 * Le pregunta al banco si hay un pago para el QR de un cobro en revisión.
 *
 * Es lo que el dueño hace cuando el cliente jura que pagó: en vez de creerle al
 * comprobante, se pregunta al banco. Si aparece, queda en la evidencia (una
 * sola vez, aunque se busque de nuevo) y el caso pasa a ser confirmable.
 */
export async function buscarAbonoEnRevision(
  deps: DepsBusqueda,
  cobro: Cobro,
  ahora: Date,
): Promise<Resultado<ResultadoBusqueda, ErrorCasoUso>> {
  const inadmisible = verificarAdmision(cobro, 'DETECCION_EN_REVISION');
  if (inadmisible !== null) {
    return fallo({ tipo: 'TRANSICION', error: inadmisible });
  }
  const qr = cobro.qrVigente;
  if (qr === null) {
    return fallo({ tipo: 'SIN_QR_VIGENTE', cobroId: cobro.id });
  }

  const consulta = await deps.watcher.consultarCobro(qr.referenciaProveedor);
  if (!esExito(consulta)) {
    return fallo({ tipo: 'PUERTO', error: consulta.error });
  }
  const deteccion = consulta.valor;
  if (deteccion === null) {
    return exito({ encontrado: false, cobro });
  }

  const registros = await deps.evidencia.listarDeCobro(cobro.id);
  if (!esExito(registros)) {
    return fallo({ tipo: 'PUERTO', error: registros.error });
  }
  if (registros.valor.some((r) => r.datos['idDeduplicacion'] === deteccion.idDeduplicacion)) {
    return exito({ encontrado: true, cobro });
  }

  const registrado = await aplicar(
    deps,
    cobro,
    { tipo: 'DETECCION_EN_REVISION', deteccion, origen: deteccion.origen },
    ahora,
  );
  return esExito(registrado) ? exito({ encontrado: true, cobro: registrado.valor.cobro }) : registrado;
}
