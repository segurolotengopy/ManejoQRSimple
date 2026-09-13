/**
 * El cierre diario: conciliar los pagos de los días anteriores contra los cobros.
 *
 * Es la red de seguridad del polling (análisis Baneco §4.3). Si una consulta
 * puntual se perdió un pago —el satélite estaba caído, el banco no respondía,
 * o un QR se pagó en la carrera entre la última consulta y su anulación—, acá
 * aparece.
 *
 * Cuándo corre lo decide la respuesta D7 del banco: `paidQR` informa en hora de
 * Bolivia y el día anterior está completo desde las 00:00:01. No se cierra solo
 * "ayer": se revisan los últimos `DIAS_DE_CIERRE` días que no se hayan cerrado
 * bien, así un satélite apagado un fin de semana no deja días sin red. Repetir
 * un día no duplica nada — `conciliarDia` es idempotente.
 *
 * Como `pasada.ts`, son funciones sin temporizadores ni I/O propio: el proceso
 * guarda qué días cerró y se lo pasa.
 */

import {
  conciliarDia,
  esExito,
  type DepsCierre,
  type ErrorCasoUso,
  type ResumenConciliacionDiaria,
} from '@mqs/qr-core';

/** Bolivia no tiene horario de verano: UTC-4 todo el año (respuesta D7). */
const OFFSET_BOLIVIA_MS = -4 * 3_600_000;
const DIA_MS = 86_400_000;

/**
 * Cuántos días hacia atrás se miran. Cubre un fin de semana largo con el
 * satélite apagado; más atrás, el día se concilia a mano (y se avisa).
 */
export const DIAS_DE_CIERRE = 3;

/** `yyyy-MM-dd` del instante, en hora de Bolivia. */
export function diaBoliviano(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_BOLIVIA_MS).toISOString().slice(0, 10);
}

export type DiaACerrar = { readonly clave: string; readonly fecha: Date };

/**
 * Los días de la ventana que todavía no se cerraron, del más viejo al más
 * nuevo. `fecha` es un instante dentro de ese día, que es lo que espera el
 * `PaymentWatcher`. El día en curso nunca entra: su reporte no está completo.
 */
export function diasACerrar(ahora: Date, cerrados: ReadonlySet<string>): readonly DiaACerrar[] {
  const dias: DiaACerrar[] = [];
  for (let atras = DIAS_DE_CIERRE; atras >= 1; atras -= 1) {
    const fecha = new Date(ahora.getTime() - atras * DIA_MS);
    const clave = diaBoliviano(fecha);
    if (!cerrados.has(clave)) {
      dias.push({ clave, fecha });
    }
  }
  return dias;
}

/** Días de la lista que ya quedaron fuera de la ventana de cierre. */
export function fueraDeVentana(ahora: Date, claves: Iterable<string>): readonly string[] {
  const masViejo = diaBoliviano(new Date(ahora.getTime() - DIAS_DE_CIERRE * DIA_MS));
  // Las claves `yyyy-MM-dd` se ordenan igual como texto que como fecha.
  return [...claves].filter((clave) => clave < masViejo);
}

export type ResultadoCierre =
  | { readonly tipo: 'CERRADO'; readonly clave: string; readonly resumen: ResumenConciliacionDiaria }
  | { readonly tipo: 'ERROR'; readonly clave: string; readonly error: ErrorCasoUso };

/**
 * ¿Quedó cerrado del todo? Un día con abonos que no se pudieron procesar no
 * cuenta como cerrado: se vuelve a intentar en la próxima pasada.
 */
export function cerroCompleto(resultado: ResultadoCierre): boolean {
  return resultado.tipo === 'CERRADO' && resultado.resumen.conError.length === 0;
}

/** Cierra, en orden, los días de la ventana que falten. */
export async function cerrarDiasPendientes(
  deps: DepsCierre,
  ahora: Date,
  cerrados: ReadonlySet<string>,
): Promise<readonly ResultadoCierre[]> {
  const resultados: ResultadoCierre[] = [];
  for (const { clave, fecha } of diasACerrar(ahora, cerrados)) {
    const resultado = await conciliarDia(deps, fecha, ahora);
    resultados.push(
      esExito(resultado)
        ? { tipo: 'CERRADO', clave, resumen: resultado.valor }
        : { tipo: 'ERROR', clave, error: resultado.error },
    );
  }
  return resultados;
}

/**
 * Línea de log del cierre. Solo conteos: los ids de los abonos para revisar se
 * listan aparte, y son claves del banco (`baneco:{qrId}:{transactionId}`), sin
 * datos del pagador (reglas #4 y #9). Esos abonos ya quedaron guardados para
 * la pestaña Revisión: el log es un eco, no el único registro.
 */
export function describirCierre(clave: string, resumen: ResumenConciliacionDiaria): string {
  const partes = [
    `cierre ${clave}:`,
    `abonos=${String(resumen.abonosLeidos)}`,
    `confirmados=${String(resumen.confirmados.length)}`,
    `enRevision=${String(resumen.enRevision.length)}`,
    `yaRegistrados=${String(resumen.yaRegistrados)}`,
    `sinCorroborar=${String(resumen.sinCorroborar.length)}`,
    `huerfanos=${String(resumen.huerfanos.length)}`,
  ];
  if (resumen.huerfanos.length + resumen.sinCorroborar.length > 0) {
    // Un cierre repetido vuelve a contarlos; "nuevos" dice cuántos son novedad.
    partes.push(`nuevosParaRevisar=${String(resumen.nuevosParaRevisar.length)}`);
  }
  if (resumen.conError.length > 0) {
    partes.push(`conError=${String(resumen.conError.length)}`);
  }
  return partes.join(' ');
}
