/**
 * El aviso de confirmación a un proyecto consumidor (docs/10 §4.6).
 *
 * Cuando un cobro de un consumidor llega a `CONFIRMADO`, se le avisa. El aviso
 * es un **acelerador, no la fuente de verdad**, y esa distinción gobierna todo
 * lo que hay acá:
 *
 * - Se puede **perder**, y el diseño lo tolera: si la entrega falla para
 *   siempre, el consumidor igual llega al mismo resultado preguntando por
 *   `estadoCobro`. Por eso encolar un aviso nunca hace fracasar la
 *   confirmación que lo originó.
 * - Se puede **repetir**: los reintentos entregan el mismo `idEvento`, para
 *   que el consumidor deduplique en vez de cobrar dos veces.
 * - Puede llegar **tarde o desordenado** respecto de otros avisos.
 *
 * Lo que **no** puede es ser falsificable ni mentir: va firmado, con marca de
 * tiempo, y su contenido se arma leyendo el cobro y su evidencia en el momento
 * de enviarlo, no una copia guardada al encolar. Una copia sería un segundo
 * lugar donde desincronizarse, y podría anunciar un pago que después resultó
 * otra cosa.
 */

import type { Cobro } from '../cobro/cobro.js';
import type { Centavos } from '../comun/dinero.js';
import type { OrigenDeteccion } from '../conciliacion/deteccion.js';

/** Cómo terminó un aviso. `null` mientras sigue pendiente. */
export const DESENLACES_AVISO = ['ENTREGADO', 'SIN_DESTINO', 'COBRO_INCONSISTENTE'] as const;
export type DesenlaceAviso = (typeof DESENLACES_AVISO)[number];

/**
 * Un aviso encolado, con su estado de reintento.
 *
 * Guarda **solo** el cobro y el consumidor: el contenido del aviso se
 * reconstruye al enviarlo. La clave natural es el `cobroId`, así que un cobro
 * produce un aviso y no más — encolar dos veces es un no-op detectable.
 */
export type AvisoPendiente = {
  readonly cobroId: string;
  readonly consumidorId: string;
  readonly encoladoEn: Date;
  /** Cuántas veces se intentó entregarlo. Empieza en 0. */
  readonly intentos: number;
  /** Desde cuándo corresponde volver a intentar. */
  readonly proximoIntentoEn: Date;
  /** Por qué falló el último intento. Sin datos del consumidor ni del pagador. */
  readonly ultimoError: string | null;
  readonly cerradoEn: Date | null;
  readonly desenlace: DesenlaceAviso | null;
};

/**
 * Lo que viaja hacia el consumidor. Solo lo suyo y lo mínimo (regla #4):
 * su referencia, el importe y cuándo. Ni el `qrId` del banco, ni la clave de
 * deduplicación del abono, ni nada del pagador.
 */
export type AvisoDeConfirmacion = {
  /** `cobro.confirmado`. Hay un solo tipo de aviso, y se nombra igual. */
  readonly evento: 'cobro.confirmado';
  /**
   * Estable entre reentregas: es el id del cobro. Dos entregas del mismo
   * evento traen el mismo `idEvento`, que es lo que el consumidor usa para
   * no procesarlo dos veces.
   */
  readonly idEvento: string;
  readonly consumidorId: string;
  readonly cobroId: string;
  readonly referenciaExterna: string;
  readonly montoCentavos: Centavos;
  /** Cuándo este sistema lo dio por confirmado. */
  readonly confirmadoEn: Date;
  /** Cuándo ocurrió el abono según el banco, si consta. */
  readonly ocurridoEn: Date | null;
  readonly riel: OrigenDeteccion | null;
};

/**
 * Espera antes del intento número `intentos + 1`, en milisegundos.
 *
 * Crece rápido y se aplana en un día. **No hay un tope de intentos**: un aviso
 * no se abandona en silencio. Si el consumidor estuvo caído una semana, lo
 * recibe cuando vuelve; y si nunca vuelve, el aviso queda pendiente y visible
 * en vez de desaparecer. El costo de reintentar una vez por día es nulo, y el
 * de perder un aviso sin que nadie se entere, no.
 */
export function esperaDelReintento(intentos: number): number {
  const escalera = [
    30_000, // 30 s
    60_000, // 1 min
    300_000, // 5 min
    900_000, // 15 min
    3_600_000, // 1 h
    21_600_000, // 6 h
  ];
  const DIA = 86_400_000;
  return escalera[intentos] ?? DIA;
}

/** Cuándo corresponde el próximo intento, después de fallar el número `intentos`. */
export function proximoIntento(intentos: number, ahora: Date): Date {
  return new Date(ahora.getTime() + esperaDelReintento(intentos));
}

/** Un aviso recién encolado, listo para el primer intento inmediato. */
export function encolarAviso(
  cobroId: string,
  consumidorId: string,
  ahora: Date,
): AvisoPendiente {
  return {
    cobroId,
    consumidorId,
    encoladoEn: ahora,
    intentos: 0,
    // Sin espera: el valor del aviso es llegar antes que la próxima consulta.
    proximoIntentoEn: ahora,
    ultimoError: null,
    cerradoEn: null,
    desenlace: null,
  };
}

/** ¿Hace cuántas horas que este aviso espera? Para avisar de los que se trabaron. */
export function horasEsperando(aviso: AvisoPendiente, ahora: Date): number {
  return (ahora.getTime() - aviso.encoladoEn.getTime()) / 3_600_000;
}

/**
 * ¿Esta transición merece un aviso? Solo la que deja `CONFIRMADO` un cobro de
 * un consumidor, y solo viniendo de otro estado.
 *
 * Vive acá y no en el caso de uso de entrega para que `aplicar()` —que es
 * quien encola— no tenga que importar el módulo que entrega: el dominio
 * quedaría con un ciclo entre "confirmar" y "avisar", y un ciclo es la forma
 * más fácil de que mañana alguien haga que avisar bloquee confirmar.
 */
export function correspondeAvisar(anterior: Cobro, resultante: Cobro): boolean {
  return (
    resultante.estado === 'CONFIRMADO' &&
    anterior.estado !== 'CONFIRMADO' &&
    resultante.consumidor !== null
  );
}
