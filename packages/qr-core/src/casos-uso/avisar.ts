/**
 * Entrega de los avisos de confirmación a los consumidores (docs/10 §4.6).
 *
 * Dos mitades, separadas a propósito:
 *
 * - **Encolar** pasa dentro de la transición, en `aplicar()`: en cuanto un
 *   cobro de un consumidor queda guardado como `CONFIRMADO`. Nunca antes —un
 *   aviso de un pago que no llegó a registrarse sería peor que ningún aviso,
 *   porque el consumidor podría entregar lo que vendió.
 * - **Entregar** pasa después, en una pasada del satélite. Un consumidor caído
 *   no puede demorar la confirmación de un cobro ni hacerla fracasar.
 *
 * Que la entrega falle para siempre es un desenlace **aceptable**: el
 * consumidor llega al mismo resultado preguntando por `estadoCobro`, y eso es
 * exactamente lo que el contrato le promete. Lo que no es aceptable es que
 * falle en silencio, y por eso ningún aviso se abandona: se reintenta con
 * espera creciente hasta una vez por día, y los que llevan mucho pendientes
 * salen en el log de cada pasada.
 */

import { esExito, exito, fallo, type Resultado } from '../comun/resultado.js';
import {
  proximoIntento,
  type AvisoDeConfirmacion,
  type AvisoPendiente,
} from '../avisos/aviso.js';
import type { AvisosStore, NotificadorConsumidor } from '../ports/puertos.js';
import { pagoDeCobro } from './consumidores.js';
import type { Dependencias, ErrorCasoUso } from './cobrar.js';

/** Lo que necesita entregar los avisos pendientes. */
export type DepsAviso = Pick<Dependencias, 'cobros' | 'evidencia'> & {
  readonly avisos: AvisosStore;
  readonly notificador: NotificadorConsumidor;
};

/** Cuántos avisos se intentan por pasada. Acota el tiempo de una vuelta. */
export const LIMITE_AVISOS_POR_PASADA = 50;

export type ResumenAvisos = {
  readonly intentados: number;
  readonly entregados: readonly string[];
  /** Consumidores sin destino configurado: no hay a quién avisarle, y está bien. */
  readonly sinDestino: readonly string[];
  /** El cobro ya no está confirmado o no es de ese consumidor: no se inventa un aviso. */
  readonly inconsistentes: readonly string[];
  /** Fallaron y se reintentan. */
  readonly reintentar: readonly string[];
  /** Pendientes totales después de esta pasada. */
  readonly pendientes: number;
};

/**
 * Intenta entregar los avisos que ya vencieron su espera.
 *
 * Cada aviso se arma **leyendo el cobro y su evidencia ahora**, no de una
 * copia guardada al encolar: si algo cambió, se avisa lo que es verdad hoy o
 * no se avisa nada.
 */
export async function entregarAvisos(
  deps: DepsAviso,
  ahora: Date,
  limite: number = LIMITE_AVISOS_POR_PASADA,
): Promise<Resultado<ResumenAvisos, ErrorCasoUso>> {
  const pendientes = await deps.avisos.listarParaEnviar(ahora, limite);
  if (!esExito(pendientes)) {
    return fallo({ tipo: 'PUERTO', error: pendientes.error });
  }

  const entregados: string[] = [];
  const sinDestino: string[] = [];
  const inconsistentes: string[] = [];
  const reintentar: string[] = [];

  for (const aviso of pendientes.valor) {
    const desenlace = await entregarUno(deps, aviso, ahora);
    switch (desenlace) {
      case 'ENTREGADO':
        entregados.push(aviso.cobroId);
        break;
      case 'SIN_DESTINO':
        sinDestino.push(aviso.cobroId);
        break;
      case 'COBRO_INCONSISTENTE':
        inconsistentes.push(aviso.cobroId);
        break;
      case 'REINTENTAR':
        reintentar.push(aviso.cobroId);
        break;
    }
  }

  const restantes = await deps.avisos.contarPendientes();
  return exito({
    intentados: pendientes.valor.length,
    entregados,
    sinDestino,
    inconsistentes,
    reintentar,
    pendientes: esExito(restantes) ? restantes.valor : -1,
  });
}

type DesenlaceIntento = 'ENTREGADO' | 'SIN_DESTINO' | 'COBRO_INCONSISTENTE' | 'REINTENTAR';

async function entregarUno(
  deps: DepsAviso,
  aviso: AvisoPendiente,
  ahora: Date,
): Promise<DesenlaceIntento> {
  const contenido = await armarAviso(deps, aviso);
  if (contenido === null) {
    // El cobro no existe, no está confirmado o cambió de dueño. No se entrega
    // un aviso que no se puede sostener contra el estado actual; se cierra
    // para no reintentarlo eternamente, y queda con su desenlace anotado.
    await deps.avisos.cerrar(aviso.cobroId, 'COBRO_INCONSISTENTE', ahora);
    return 'COBRO_INCONSISTENTE';
  }

  const entregado = await deps.notificador.entregar(contenido);
  if (!esExito(entregado)) {
    await deps.avisos.registrarFallo(
      aviso.cobroId,
      // El tipo de falla, no el mensaje del servidor del consumidor: ese
      // podría traer cualquier cosa hasta nuestra bitácora.
      entregado.error.tipo,
      proximoIntento(aviso.intentos + 1, ahora),
    );
    return 'REINTENTAR';
  }

  await deps.avisos.cerrar(aviso.cobroId, entregado.valor, ahora);
  return entregado.valor;
}

/** El contenido del aviso, leído del cobro y su evidencia. `null` si no se sostiene. */
async function armarAviso(
  deps: DepsAviso,
  aviso: AvisoPendiente,
): Promise<AvisoDeConfirmacion | null> {
  const encontrado = await deps.cobros.obtener(aviso.cobroId);
  if (!esExito(encontrado) || encontrado.valor === null) {
    return null;
  }
  const cobro = encontrado.valor;
  if (cobro.estado !== 'CONFIRMADO' || cobro.consumidor?.consumidorId !== aviso.consumidorId) {
    return null;
  }

  const registros = await deps.evidencia.listarDeCobro(cobro.id);
  if (!esExito(registros)) {
    return null;
  }
  const pago = pagoDeCobro(registros.valor);
  if (pago === null) {
    // Confirmado sin rastro del pago en la evidencia: contradictorio. No se
    // inventa una fecha de confirmación para poder mandar algo.
    return null;
  }

  return {
    evento: 'cobro.confirmado',
    idEvento: cobro.id,
    consumidorId: aviso.consumidorId,
    cobroId: cobro.id,
    referenciaExterna: cobro.consumidor.referenciaExterna,
    montoCentavos: cobro.montoCentavos,
    confirmadoEn: pago.confirmadoEn,
    ocurridoEn: pago.ocurridoEn,
    riel: pago.riel,
  };
}

/** Línea de log de una pasada de avisos. Sin datos de nadie (reglas #4 y #9). */
export function describirAvisos(resumen: ResumenAvisos): string {
  return [
    `intentados=${String(resumen.intentados)}`,
    `entregados=${String(resumen.entregados.length)}`,
    `sinDestino=${String(resumen.sinDestino.length)}`,
    `reintentar=${String(resumen.reintentar.length)}`,
    `inconsistentes=${String(resumen.inconsistentes.length)}`,
    `pendientes=${String(resumen.pendientes)}`,
  ].join(' ');
}
