/**
 * Presentación de los logs: filtro, orden y formato de cada línea. Sin DOM,
 * para probarlo sin navegador.
 */

import type { ErrorApi, LineaLog } from './api.js';

export type FiltroLogs = 'todo' | 'banco' | 'api' | 'satelite' | 'consola' | 'problemas';

/** Las líneas que pasan el filtro, de la más vieja a la más nueva. */
export function filtrarLogs(lineas: readonly LineaLog[], filtro: FiltroLogs): readonly LineaLog[] {
  const pasan = lineas.filter((l) => {
    switch (filtro) {
      case 'todo':
        return true;
      case 'problemas':
        return l.nivel !== 'info';
      default:
        return l.origen === filtro;
    }
  });
  return [...pasan].sort((a, b) => a.en.localeCompare(b.en));
}

/**
 * `13/09 21:05:36  AVISO  [banco]  POST /… → HTTP 200 · responseCode 57 · 120 ms`.
 * Con día: los logs persisten entre reinicios y mezclan días distintos.
 */
export function textoDeLinea(l: LineaLog): string {
  const fecha = new Date(l.en);
  const cuando = Number.isNaN(fecha.getTime())
    ? l.en
    : fecha.toLocaleString('es-BO', {
        hour12: false,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
  return `${cuando}  ${l.nivel.toUpperCase().padEnd(5)}  [${l.origen}]  ${l.texto}`;
}

/** Un error que vio la consola, como línea de log. */
export function lineaDeError(error: ErrorApi, n: number, ahora: Date): LineaLog {
  const d = error.detalle;
  const detalle =
    d === undefined ? '' : ` · ${d.tipo}${d.codigoProveedor === null ? '' : ` responseCode ${d.codigoProveedor}`}`;
  return {
    n,
    en: ahora.toISOString(),
    nivel: 'error',
    origen: 'consola',
    texto: `${error.codigo} (HTTP ${String(error.status)}): ${error.mensaje}${detalle}`,
  };
}
