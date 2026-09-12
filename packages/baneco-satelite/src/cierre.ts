/**
 * El cierre diario: conciliar los pagos del día anterior contra los cobros.
 *
 * Es la red de seguridad del polling (análisis Baneco §4.3). Si una consulta
 * puntual se perdió un pago —el satélite estaba caído, el banco no respondía,
 * o un QR se pagó en la carrera entre la última consulta y su anulación—, acá
 * aparece.
 *
 * Cuándo corre lo decide la respuesta D7 del banco: `paidQR` informa en hora de
 * Bolivia y el día anterior está completo desde las 00:00:01. Así que se cierra
 * "ayer" apenas cambia el día boliviano, y también al arrancar el proceso, por
 * si estuvo apagado a medianoche.
 *
 * Como `pasada.ts`, es una función sin temporizadores ni I/O propio: el proceso
 * guarda qué día cerró por última vez y se lo pasa.
 */

import {
  conciliarDia,
  esExito,
  type DepsVerificacion,
  type ErrorCasoUso,
  type ResumenConciliacionDiaria,
} from '@mqs/qr-core';

/** Bolivia no tiene horario de verano: UTC-4 todo el año (respuesta D7). */
const OFFSET_BOLIVIA_MS = -4 * 3_600_000;
const DIA_MS = 86_400_000;

/** `yyyy-MM-dd` del instante, en hora de Bolivia. */
export function diaBoliviano(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_BOLIVIA_MS).toISOString().slice(0, 10);
}

/**
 * El día que corresponde cerrar en este instante: el anterior, en hora de
 * Bolivia. `fecha` es un instante dentro de ese día, que es lo que espera el
 * `PaymentWatcher`.
 */
export function diaACerrar(ahora: Date): { readonly clave: string; readonly fecha: Date } {
  const fecha = new Date(ahora.getTime() - DIA_MS);
  return { clave: diaBoliviano(fecha), fecha };
}

export type ResultadoCierre =
  | { readonly tipo: 'YA_CERRADO' }
  | { readonly tipo: 'CERRADO'; readonly clave: string; readonly resumen: ResumenConciliacionDiaria }
  | { readonly tipo: 'ERROR'; readonly clave: string; readonly error: ErrorCasoUso };

/**
 * Cierra el día anterior si todavía no se cerró.
 *
 * Un error no marca el día como cerrado: la próxima pasada lo reintenta. Un
 * cierre que falla en silencio es un día sin red de seguridad.
 */
export async function cerrarDiaSiCorresponde(
  deps: DepsVerificacion,
  ahora: Date,
  ultimoCerrado: string | null,
): Promise<ResultadoCierre> {
  const { clave, fecha } = diaACerrar(ahora);
  if (clave === ultimoCerrado) {
    return { tipo: 'YA_CERRADO' };
  }

  const resultado = await conciliarDia(deps, fecha, ahora);
  return esExito(resultado)
    ? { tipo: 'CERRADO', clave, resumen: resultado.valor }
    : { tipo: 'ERROR', clave, error: resultado.error };
}

/**
 * Línea de log del cierre. Solo conteos: los ids de los abonos huérfanos se
 * listan aparte, y son claves del banco (`baneco:{qrId}:{transactionId}`), sin
 * datos del pagador (reglas #4 y #9).
 */
export function describirCierre(clave: string, resumen: ResumenConciliacionDiaria): string {
  return [
    `cierre ${clave}:`,
    `abonos=${String(resumen.abonosLeidos)}`,
    `confirmados=${String(resumen.confirmados.length)}`,
    `enRevision=${String(resumen.enRevision.length)}`,
    `yaRegistrados=${String(resumen.yaRegistrados)}`,
    `sinCorroborar=${String(resumen.sinCorroborar.length)}`,
    `huerfanos=${String(resumen.huerfanos.length)}`,
  ].join(' ');
}
