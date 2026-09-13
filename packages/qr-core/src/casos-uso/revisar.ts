/**
 * Casos de uso de la revisión manual.
 *
 * `EN_REVISION` es el único estado que resuelve una persona. Estos casos de uso
 * son lo que la consola le ofrece: ver la cola, buscar en el banco un pago que
 * falta, y decidir. Tres reglas que no dependen de la consola:
 *
 * - **Confirmar exige aceptar un abono del banco que figure en la evidencia.**
 *   Es la regla #1 también para la persona: un comprobante, una llamada del
 *   cliente o una captura no alcanzan. Y tiene que ser **el abono que la
 *   persona vio**: si el banco reportó otro mientras decidía, se rechaza y se
 *   vuelve a mirar. Lo sostiene el tipo `AbonoAceptado`, no este archivo.
 * - **Toda resolución lleva motivo y queda como `accion-manual`** (regla #8).
 * - **Buscar el pago no resuelve nada**: si el banco lo reporta, queda en la
 *   evidencia y el caso sigue en revisión, ahora confirmable.
 */

import { aceptarAbono } from '../cobro/aceptacion.js';
import type { Cobro } from '../cobro/cobro.js';
import { verificarAdmision } from '../cobro/maquina-estados.js';
import { esExito, exito, fallo, type Resultado } from '../comun/resultado.js';
import type { AbonosSinConciliarStore } from '../ports/puertos.js';
import {
  construirCasoAbono,
  MOTIVO_MINIMO,
  ordenarCasosAbono,
  type AbonoSinConciliar,
  type CasoAbono,
  type CobroDelAbono,
} from '../revision/abono-sin-conciliar.js';
import {
  construirCaso,
  ordenarCasos,
  POLITICA_REVISION_POR_DEFECTO,
  resumirRevision,
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

/**
 * La cola de revisión mira dos cosas: los cobros en `EN_REVISION` y los abonos
 * que el cierre diario no pudo atar a ningún cobro.
 */
export type DepsRevision = DepsPersistencia & {
  readonly abonosSinConciliar: AbonosSinConciliarStore;
};

/** Tope de casos que se arman de una vez. Más que esto es un problema operativo. */
export const LIMITE_REVISION = 200;

export type ColaRevision = {
  readonly casos: readonly CasoRevision[];
  /** Abonos sin cobro que los explique, abiertos, lo más urgente primero. */
  readonly abonos: readonly CasoAbono[];
  readonly resumen: ResumenRevision;
  /**
   * Hay más casos (o abonos) que el tope: la cola está incompleta y el resumen
   * se queda corto. Se informa en vez de callarlo — un caso crítico que no
   * entra nunca alertaría.
   */
  readonly truncado: boolean;
};

/** La cola de revisión, lo más urgente primero. */
export async function listarRevision(
  deps: DepsRevision,
  ahora: Date,
  politica: PoliticaRevision = POLITICA_REVISION_POR_DEFECTO,
  limite: number = LIMITE_REVISION,
): Promise<Resultado<ColaRevision, ErrorCasoUso>> {
  // Uno más que el tope: si vuelve, hay más de los que se muestran.
  const enRevision = await deps.cobros.listarPorEstado('EN_REVISION', limite + 1);
  if (!esExito(enRevision)) {
    return fallo({ tipo: 'PUERTO', error: enRevision.error });
  }
  const truncado = enRevision.valor.length > limite;

  const casos: CasoRevision[] = [];
  for (const cobro of enRevision.valor.slice(0, limite)) {
    const registros = await deps.evidencia.listarDeCobro(cobro.id);
    if (!esExito(registros)) {
      return fallo({ tipo: 'PUERTO', error: registros.error });
    }
    casos.push(construirCaso(cobro, registros.valor, ahora, politica));
  }

  const abiertos = await deps.abonosSinConciliar.listarAbiertos(limite + 1);
  if (!esExito(abiertos)) {
    return fallo({ tipo: 'PUERTO', error: abiertos.error });
  }
  const casosAbono: CasoAbono[] = [];
  for (const abono of abiertos.valor.slice(0, limite)) {
    const cobro = await cobroDelAbono(deps, abono);
    if (!esExito(cobro)) {
      return cobro;
    }
    casosAbono.push(construirCasoAbono(abono, ahora, politica, cobro.valor));
  }
  const abonos = ordenarCasosAbono(casosAbono);

  const ordenados = ordenarCasos(casos);
  return exito({
    casos: ordenados,
    abonos,
    resumen: resumirRevision(ordenados, abonos),
    truncado: truncado || abiertos.valor.length > limite,
  });
}

/**
 * El cobro del QR de un abono, como está ahora, y si su evidencia ya registra
 * ese pago. Mismo criterio que el cierre diario para "ya registrado": la clave
 * del banco figura en algún registro del cobro.
 */
async function cobroDelAbono(
  deps: DepsPersistencia,
  abono: AbonoSinConciliar,
): Promise<Resultado<CobroDelAbono | null, ErrorCasoUso>> {
  if (abono.cobroId === null) {
    return exito(null);
  }
  const cobro = await deps.cobros.obtener(abono.cobroId);
  if (!esExito(cobro)) {
    return fallo({ tipo: 'PUERTO', error: cobro.error });
  }
  if (cobro.valor === null) {
    return exito(null);
  }
  const registros = await deps.evidencia.listarDeCobro(abono.cobroId);
  if (!esExito(registros)) {
    return fallo({ tipo: 'PUERTO', error: registros.error });
  }
  return exito({
    id: abono.cobroId,
    estado: cobro.valor.estado,
    registraElPago: registros.valor.some((r) => r.datos['idDeduplicacion'] === abono.idDeduplicacion),
  });
}

/**
 * Cierra un abono sin conciliar con lo que se hizo con la plata.
 *
 * No toca ningún cobro: un abono huérfano no confirma nada, ni a mano. Si la
 * persona descubre de qué cobro era, ese cobro se resuelve por su propio camino
 * (buscar el pago en el banco, docs/09 §4), y este registro deja escrito por
 * qué se cerró.
 */
export async function cerrarAbonoSinConciliar(
  deps: Pick<DepsRevision, 'abonosSinConciliar'>,
  idDeduplicacion: string,
  motivo: string,
  ahora: Date,
): Promise<Resultado<AbonoSinConciliar, ErrorCasoUso>> {
  const texto = motivo.trim();
  if (texto.length < MOTIVO_MINIMO) {
    return fallo({ tipo: 'MOTIVO_INSUFICIENTE', minimo: MOTIVO_MINIMO });
  }
  const cerrado = await deps.abonosSinConciliar.cerrar(idDeduplicacion, { motivo: texto, resueltoEn: ahora });
  if (!esExito(cerrado)) {
    return fallo({ tipo: 'PUERTO', error: cerrado.error });
  }
  return cerrado.valor === null
    ? fallo({ tipo: 'ABONO_INEXISTENTE', idDeduplicacion })
    : exito(cerrado.valor);
}

/**
 * La decisión de la persona. Confirmar nombra el abono que vio en pantalla;
 * rechazar no necesita abono — pero si lo hay, rechazar significa que esa plata
 * se devuelve por fuera.
 */
export type Resolucion =
  | { readonly decision: 'CONFIRMADO'; readonly idDeduplicacion: string; readonly motivo: string }
  | { readonly decision: 'RECHAZADO'; readonly motivo: string };

/** La decisión del dueño sobre un caso en revisión. */
export async function resolverRevision(
  deps: DepsPersistencia,
  cobro: Cobro,
  resolucion: Resolucion,
  ahora: Date,
): Promise<Resultado<Cobro, ErrorCasoUso>> {
  const inadmisible = verificarAdmision(cobro, 'RESUELTO_MANUALMENTE');
  if (inadmisible !== null) {
    return fallo({ tipo: 'TRANSICION', error: inadmisible });
  }

  if (resolucion.decision === 'RECHAZADO') {
    const rechazado = await aplicar(
      deps,
      cobro,
      { tipo: 'RESUELTO_MANUALMENTE', decision: 'RECHAZADO', motivo: resolucion.motivo, origen: 'accion-manual' },
      ahora,
    );
    return esExito(rechazado) ? exito(rechazado.valor.cobro) : rechazado;
  }

  const registros = await deps.evidencia.listarDeCobro(cobro.id);
  if (!esExito(registros)) {
    return fallo({ tipo: 'PUERTO', error: registros.error });
  }
  const abono = aceptarAbono(cobro, registros.valor, resolucion.idDeduplicacion);
  if (!esExito(abono)) {
    return fallo(
      abono.error.tipo === 'SIN_DETECCION_DEL_BANCO'
        ? { tipo: 'SIN_DETECCION_DEL_BANCO', cobroId: cobro.id }
        : { tipo: 'ABONO_DESACTUALIZADO', cobroId: cobro.id },
    );
  }

  const confirmado = await aplicar(
    deps,
    cobro,
    {
      tipo: 'RESUELTO_MANUALMENTE',
      decision: 'CONFIRMADO',
      abono: abono.valor,
      motivo: resolucion.motivo,
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
 * comprobante, se pregunta al banco. Si aparece, queda en la evidencia y el
 * caso pasa a ser confirmable. Buscar de nuevo no lo vuelve a registrar (salvo
 * dos búsquedas simultáneas: ver `docs/09-revision-manual.md` §5).
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
