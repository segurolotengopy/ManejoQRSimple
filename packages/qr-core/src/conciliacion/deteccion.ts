/**
 * Detección de un abono candidato, reportada por un `PaymentWatcher`.
 *
 * Es **candidata**, no confirmada: el adaptador dice "vi este abono", el
 * dominio decide si concilia. Por eso `DeteccionDePago` no confirma nada por
 * sí sola — hay que pasarla por `conciliar()`.
 *
 * Los datos son los mínimos de la regla #4: monto, momento, referencia y una
 * clave de deduplicación. Nunca saldos, nunca el nombre del pagador.
 */

import { createHash } from 'node:crypto';

import type { OrigenQr } from '../cobro/cobro.js';
import type { Centavos } from '../comun/dinero.js';

declare const marcaDeteccion: unique symbol;

/**
 * Los rieles por los que puede llegar una detección.
 *
 * Es un array y no solo una unión de tipos para que quien necesite
 * **estrechar** un texto a `OrigenDeteccion` —leer un origen de la evidencia,
 * por ejemplo— lo haga contra esta lista y no contra una copia a mano. Un riel
 * nuevo acá alcanza a todos los que la usan.
 */
export const ORIGENES_DETECCION = ['watcher-baneco', 'scraper-yape', 'watcher-simulado'] as const;

export type OrigenDeteccion = (typeof ORIGENES_DETECCION)[number];

/** ¿Este texto es uno de los rieles conocidos? */
export function esOrigenDeteccion(valor: unknown): valor is OrigenDeteccion {
  return typeof valor === 'string' && (ORIGENES_DETECCION as readonly string[]).includes(valor);
}

/**
 * Qué QRs puede pagar cada riel de detección. Es una tabla **total**: un riel
 * nuevo obliga a decidir su fila, y no hay un camino por defecto que lo deje
 * pasar.
 *
 * Existe porque un detector simulado (el del demo) no puede confirmar un QR
 * que emitió el banco, ni uno real puede confirmar un QR simulado: la fuente
 * de verdad de un pago es el riel que corresponde a su QR (regla #1).
 */
export const QRS_DEL_RIEL: Readonly<Record<OrigenDeteccion, readonly OrigenQr[]>> = {
  'watcher-baneco': ['api-baneco'],
  'scraper-yape': ['carga-manual', 'consola-asistida'],
  'watcher-simulado': ['simulado'],
};

/** ¿Una detección de este riel puede pagar un QR de este origen? */
export function rielCorresponde(origenDeteccion: OrigenDeteccion, origenQr: OrigenQr): boolean {
  return QRS_DEL_RIEL[origenDeteccion].includes(origenQr);
}

/** El espacio de claves que solo el banco usa (`claveBaneco`). */
export const PREFIJO_CLAVE_BANECO = 'baneco:';

/**
 * ¿La clave de deduplicación pertenece al espacio del riel? Solo el riel del
 * banco usa claves `baneco:…` (`claveBaneco`), y **ningún otro** puede usarlas:
 * un documento que dice ser del banco pero trae una clave de otro formato (la
 * evidencia heredada del incidente 4B2 tiene `watcher-baneco` con una clave
 * `simulado:…`), o un detector simulado que reclama una clave real, no cuentan.
 */
export function claveDelRiel(origenDeteccion: OrigenDeteccion, idDeduplicacion: string): boolean {
  const esDeBaneco = idDeduplicacion.startsWith(PREFIJO_CLAVE_BANECO);
  return origenDeteccion === 'watcher-baneco' ? esDeBaneco : !esDeBaneco;
}

/**
 * ¿Este registro de evidencia lleva una detección **del riel que corresponde**
 * al QR vigente del cobro? Es la única regla con la que `aceptarAbono` y
 * `ultimaDeteccion` deciden qué detecciones son «del banco»; no se copia.
 *
 * Cerrada por defecto: con QR vigente, el registro cuenta solo si declara un
 * riel conocido, ese riel paga el QR (`rielCorresponde`) y su clave es de ese
 * riel (`claveDelRiel`). Sin riel declarado, con un riel desconocido o sin
 * clave, no cuenta. Sin QR vigente (`null`) no hay con qué comparar y cuenta,
 * como antes.
 */
export function deteccionDelRiel(
  datos: Readonly<Record<string, unknown>>,
  origenQr: OrigenQr | null,
): boolean {
  if (origenQr === null) {
    return true;
  }
  const origenDeteccion = datos['origenDeteccion'];
  const idDeduplicacion = datos['idDeduplicacion'];
  return (
    esOrigenDeteccion(origenDeteccion) &&
    typeof idDeduplicacion === 'string' &&
    rielCorresponde(origenDeteccion, origenQr) &&
    claveDelRiel(origenDeteccion, idDeduplicacion)
  );
}

export type DeteccionDePago = {
  readonly [marcaDeteccion]: 'deteccion-de-pago';
  /** Clave natural estable: dos lecturas del mismo abono producen la misma. */
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
  readonly origen: OrigenDeteccion;
  /** Glosa o referencia del movimiento. Puede faltar. */
  readonly referencia: string | null;
};

/**
 * Registra una detección. Lo llaman los adaptadores de `PaymentWatcher`, que
 * son los únicos que ven el mundo exterior.
 *
 * Que este constructor sea público no debilita la regla #1: tener una
 * detección no alcanza para confirmar un cobro. `CONFIRMADO` exige una
 * `ConciliacionAprobada`, y esa solo la fabrica `conciliar()`.
 */
export function registrarDeteccion(datos: {
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
  readonly origen: OrigenDeteccion;
  readonly referencia: string | null;
}): DeteccionDePago {
  return datos as DeteccionDePago;
}

/**
 * Clave de deduplicación de Baneco (regla #7).
 *
 * El banco entrega identificadores propios, así que no hace falta hashear
 * nada: `qrId` + número de transacción ya son una clave natural estable.
 */
export function claveBaneco(qrId: string, transactionId: string): string {
  return `baneco:${qrId}:${transactionId}`;
}

/**
 * Clave de deduplicación para fuentes sin identificador propio, como la
 * consola Yape: hash estable de fecha + monto + referencia (regla #7).
 *
 * El hash tiene que ser estable entre pasadas del watcher y entre reinicios;
 * por eso la fecha se normaliza a ISO en UTC y la referencia se recorta.
 */
export function claveHash(datos: {
  readonly proveedor: string;
  readonly ocurridoEn: Date;
  readonly montoCentavos: Centavos;
  readonly referencia: string | null;
}): string {
  const partes = [
    datos.proveedor,
    datos.ocurridoEn.toISOString(),
    String(datos.montoCentavos),
    (datos.referencia ?? '').trim(),
  ].join('|');
  const digest = createHash('sha256').update(partes, 'utf8').digest('hex');
  return `${datos.proveedor}:${digest}`;
}
