/**
 * Presentación de la cola de revisión: textos, recomendaciones y alertas.
 *
 * Como `formato.ts`, es traducción y nada más: **qué** es urgente lo decide el
 * dominio (el nivel de cada caso viene de la API) y **qué** se puede confirmar
 * también (`confirmable`). Acá solo se decide cómo decírselo a una persona y
 * cuándo avisarle.
 */

import type { MotivoRevision, NivelAlerta, ResumenRevision } from './api.js';

const MOTIVO: Readonly<Record<MotivoRevision, string>> = {
  MONTO_NO_COINCIDE: 'El monto pagado no coincide con el del cobro',
  FUERA_DE_VIGENCIA: 'El pago llegó después del vencimiento',
  DUPLICADO: 'El banco reporta un pago que ya se había usado',
  ABONO_TARDIO: 'Llegó un pago a un QR ya vencido',
  VENTANA_AGOTADA: 'Hay comprobante, pero el banco no registró el pago',
  OTRO: 'Caso atípico',
};

/**
 * Qué hacer con cada caso. Es la guía de `docs/09-revision-manual.md` en una
 * línea; si cambia una, cambia la otra.
 */
const RECOMENDACION: Readonly<Record<MotivoRevision, string>> = {
  MONTO_NO_COINCIDE:
    'Si pagó de menos: rechazá y emití un cobro nuevo por la diferencia, o aceptá solo si decidís ' +
    'absorberla. Si pagó de más: aceptá y devolvé el excedente por transferencia. Nunca cambies el ' +
    'monto del cobro para que coincida.',
  FUERA_DE_VIGENCIA:
    'El cliente pagó tarde, pero pagó. Si la venta o el servicio siguen en pie, aceptá el pago; si ' +
    'ya no (precio o cupo vencidos), rechazá y devolvé el dinero.',
  DUPLICADO:
    'Es una doble lectura del mismo pago, no un segundo pago: no lo aceptes. Rechazalo y mirá el ' +
    'extracto en la app del banco; si de verdad hay dos créditos, el segundo se devuelve por fuera.',
  ABONO_TARDIO:
    'El QR ya estaba vencido y anulado, pero el cliente pagó de verdad: casi siempre corresponde ' +
    'aceptarlo. No renueves ni reenvíes el cobro: le estarías pidiendo que pague dos veces.',
  VENTANA_AGOTADA:
    'No confirmes por el comprobante: el comprobante falso es el fraude más común. Buscá el pago en ' +
    'el banco. Si no aparece, pedile al cliente el número de operación y el banco desde el que pagó; ' +
    'si igual no aparece, rechazá.',
  OTRO:
    'Revisá el rastro de evidencia completo antes de decidir. Si no entendés cómo llegó acá, no lo ' +
    'resuelvas: consultalo.',
};

const TONO_NIVEL: Readonly<Record<NivelAlerta, string>> = {
  AL_DIA: 'espera',
  ATRASADO: 'atencion',
  CRITICO: 'mal',
};

const TEXTO_NIVEL: Readonly<Record<NivelAlerta, string>> = {
  AL_DIA: 'Al día',
  ATRASADO: 'Atrasado',
  CRITICO: 'Crítico',
};

export const describirMotivo = (motivo: MotivoRevision): string => MOTIVO[motivo];
export const recomendacion = (motivo: MotivoRevision): string => RECOMENDACION[motivo];
export const tonoDeNivel = (nivel: NivelAlerta): string => TONO_NIVEL[nivel];
export const textoNivel = (nivel: NivelAlerta): string => TEXTO_NIVEL[nivel];

/** Hace cuánto está en revisión, en texto. */
export function antiguedad(horas: number): string {
  if (horas < 1) {
    return 'hace menos de una hora';
  }
  if (horas < 48) {
    return `hace ${String(Math.floor(horas))} h`;
  }
  return `hace ${String(Math.floor(horas / 24))} días`;
}

/** Color de la insignia de la pestaña: el del caso más urgente. */
export function tonoInsignia(resumen: ResumenRevision): string {
  if (resumen.criticos > 0) return 'mal';
  if (resumen.atrasados > 0) return 'atencion';
  return 'espera';
}

/** Título de la pestaña del navegador, con la cantidad de casos pendientes. */
export function tituloDePagina(base: string, resumen: ResumenRevision | null): string {
  if (resumen === null || resumen.total === 0) {
    return base;
  }
  return `(${String(resumen.total)}) ${base}`;
}

/**
 * Cuántos casos críticos nuevos hay desde el último vistazo. Solo se avisa por
 * los nuevos: repetir el mismo aviso cada minuto enseña a ignorarlo.
 */
export function nuevosCriticos(anterior: ResumenRevision | null, actual: ResumenRevision): number {
  if (anterior === null) {
    return actual.criticos;
  }
  return Math.max(0, actual.criticos - anterior.criticos);
}

/** Cada cuánto hay que pasar por la cola aunque nada esté atrasado. */
export const HORAS_ENTRE_REVISIONES = 24;

/** ¿Toca hacer la revisión periódica? Solo si hay algo para revisar. */
export function revisionPendiente(ultimaIso: string | null, ahora: Date, hayCasos: boolean): boolean {
  if (!hayCasos) {
    return false;
  }
  if (ultimaIso === null) {
    return true;
  }
  const ultima = new Date(ultimaIso);
  if (Number.isNaN(ultima.getTime())) {
    return true;
  }
  return ahora.getTime() - ultima.getTime() >= HORAS_ENTRE_REVISIONES * 3_600_000;
}

export function textoUltimaRevision(ultimaIso: string | null, ahora: Date): string {
  if (ultimaIso === null) {
    return 'Todavía no marcaste ninguna revisión.';
  }
  const ultima = new Date(ultimaIso);
  if (Number.isNaN(ultima.getTime())) {
    return 'Todavía no marcaste ninguna revisión.';
  }
  const horas = (ahora.getTime() - ultima.getTime()) / 3_600_000;
  return `Última revisión: ${antiguedad(horas)}.`;
}

/** `"150.50"` → `15050`. Enteros y nada de floats (regla #5). `null` si no es un monto. */
function aCentavos(texto: string): number | null {
  const partes = /^(\d+)\.(\d{2})$/.exec(texto);
  if (partes === null) {
    return null;
  }
  return Number(partes[1]) * 100 + Number(partes[2]);
}

/**
 * Cuánto difiere lo que pagó el banco de lo que se cobró, en texto. `null` si
 * coinciden o si alguno de los dos no es un monto legible.
 */
export function diferencia(esperado: string, pagado: string): string | null {
  const e = aCentavos(esperado);
  const p = aCentavos(pagado);
  if (e === null || p === null || e === p) {
    return null;
  }
  const d = Math.abs(p - e);
  const texto = `Bs ${String(Math.floor(d / 100))}.${String(d % 100).padStart(2, '0')}`;
  return p < e ? `${texto} de menos` : `${texto} de más`;
}
