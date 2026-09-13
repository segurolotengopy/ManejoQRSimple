/**
 * Abonos que el cierre diario no pudo atar a ningún cobro.
 *
 * El banco informa un pago y el sistema no lo explica: o ningún cobro espera
 * ese QR (**huérfano**: un QR anulado que igual se pagó, un `generateQR` que el
 * banco creó tras un timeout —C3—, un pago a un QR ya renovado), o el cobro
 * existe pero ni la consulta puntual ni la evidencia respaldan el pago (**sin
 * corroborar**). En los dos casos hay plata en la cuenta que ninguna regla
 * puede decidir sola.
 *
 * No son cobros y no pasan por la máquina de estados: no hay nada que
 * confirmar. Lo que hace falta es que **no se pierdan**. Por eso se guardan
 * aparte, con la clave de deduplicación del banco como identidad (registrar
 * dos veces el mismo abono no duplica ni reabre nada), y la persona que revisa
 * los cierra con un motivo que queda escrito.
 *
 * Datos mínimos (regla #4): monto, momento, origen y la clave del banco. La
 * glosa no se guarda: en Baneco trae el nombre del pagador (respuesta F1).
 */

import type { EstadoCobro } from '../cobro/estados.js';
import type { Centavos } from '../comun/dinero.js';
import type { OrigenDeteccion } from '../conciliacion/deteccion.js';
import { nivelDeAlerta, type NivelAlerta, type PoliticaRevision } from './revision.js';

export const MOTIVOS_ABONO_SIN_CONCILIAR = ['HUERFANO', 'SIN_CORROBORAR'] as const;
export type MotivoAbonoSinConciliar = (typeof MOTIVOS_ABONO_SIN_CONCILIAR)[number];

export type ResolucionAbono = {
  /** Qué se hizo con la plata. Obligatorio: es lo único que queda del caso. */
  readonly motivo: string;
  readonly resueltoEn: Date;
};

export type AbonoSinConciliar = {
  readonly idDeduplicacion: string;
  readonly motivo: MotivoAbonoSinConciliar;
  /** El cobro dueño del QR, si lo hay (anulado, o uno que no respalda el pago). */
  readonly cobroId: string | null;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
  readonly origen: OrigenDeteccion;
  /** Cuándo lo encontró el cierre: desde ahí corre la alerta. */
  readonly registradoEn: Date;
  readonly resolucion: ResolucionAbono | null;
};

/**
 * El cobro dueño del QR, **como está ahora**. Un abono "sin corroborar" puede
 * quedar explicado después del cierre: la vigilancia normal detecta el mismo
 * pago y confirma el cobro. Sin este dato, la cola lo seguiría mostrando como
 * plata sin dueño y alguien podría devolverla.
 */
export type CobroDelAbono = {
  readonly id: string;
  readonly estado: EstadoCobro;
  /** La evidencia del cobro ya registra este mismo pago (misma clave del banco). */
  readonly registraElPago: boolean;
};

/** Un abono sin conciliar tal como lo ve la cola de revisión. */
export type CasoAbono = {
  readonly abono: AbonoSinConciliar;
  readonly horasAbierto: number;
  readonly nivel: NivelAlerta;
  /** `null` si el QR no es de ningún cobro que exista. */
  readonly cobro: CobroDelAbono | null;
};

/** Largo mínimo del motivo al cerrar un abono: "ok" no explica nada. */
export const MOTIVO_MINIMO = 10;

const HORA_MS = 3_600_000;

/**
 * Arma el caso de un abono abierto. Siempre hay plata de por medio, así que
 * usa los umbrales **con abono**: se mide desde que el cierre lo encontró, no
 * desde el pago, para que un abono de ayer no nazca crítico por el solo hecho
 * de que el cierre corre de madrugada.
 *
 * Si el cobro ya registra ese pago, el abono deja de alertar: está explicado.
 * No se cierra solo —cerrarlo lleva motivo—, pero no compite por la atención
 * con la plata que de verdad no tiene dueño.
 */
export function construirCasoAbono(
  abono: AbonoSinConciliar,
  ahora: Date,
  politica: PoliticaRevision,
  cobro: CobroDelAbono | null = null,
): CasoAbono {
  const horasAbierto = Math.max(0, (ahora.getTime() - abono.registradoEn.getTime()) / HORA_MS);
  const nivel = cobro?.registraElPago === true ? 'AL_DIA' : nivelDeAlerta(horasAbierto, true, politica);
  return { abono, horasAbierto, nivel, cobro };
}

const PESO: Readonly<Record<NivelAlerta, number>> = { CRITICO: 2, ATRASADO: 1, AL_DIA: 0 };

/** Lo más urgente primero; a igual urgencia, lo más viejo. */
export function ordenarCasosAbono(casos: readonly CasoAbono[]): readonly CasoAbono[] {
  return [...casos].sort((a, b) => PESO[b.nivel] - PESO[a.nivel] || b.horasAbierto - a.horasAbierto);
}
