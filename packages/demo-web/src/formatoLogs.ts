/**
 * Presentación de los logs: filtro, orden y formato de cada línea. Sin DOM,
 * para probarlo sin navegador.
 */

import type { ErrorApi, LineaLog } from './api.js';

export type FiltroLogs = 'todo' | 'banco' | 'api' | 'consola' | 'problemas';

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

/** `12:34:56  AVISO  [banco]  POST /… → HTTP 200 · responseCode 57 · 120 ms` */
export function textoDeLinea(l: LineaLog): string {
  const fecha = new Date(l.en);
  const hora = Number.isNaN(fecha.getTime()) ? l.en : fecha.toLocaleTimeString('es-BO', { hour12: false });
  return `${hora}  ${l.nivel.toUpperCase().padEnd(5)}  [${l.origen}]  ${l.texto}`;
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
