/**
 * El cobro y sus QRs emitidos.
 *
 * Todo es `readonly`: las transiciones devuelven un cobro nuevo en vez de
 * mutar el existente, para que no exista la posibilidad de cambiar un estado
 * salteándose la función única de transición.
 */

import type { Centavos } from '../comun/dinero.js';
import type { EstadoCobro } from './estados.js';

/** Proveedor de cobro asociado al cobro (decisión D1: multi-proveedor). */
export const PROVEEDORES = ['baneco', 'yape'] as const;
export type Proveedor = (typeof PROVEEDORES)[number];

/** De dónde salió la imagen del QR (docs/02 §3, docs/03 §5). */
export const ORIGENES_QR = ['api-baneco', 'carga-manual', 'consola-asistida'] as const;
export type OrigenQr = (typeof ORIGENES_QR)[number];

/**
 * Un QR emitido para un cobro. El historial es append-only (regla #6): renovar
 * no reemplaza este registro, agrega otro con `qrVersion + 1`.
 */
export type QrEmitido = {
  readonly qrVersion: number;
  /** Identificador del QR en el proveedor (`qrId` en Baneco). */
  readonly referenciaProveedor: string;
  readonly emitidoEn: Date;
  /** Obligatoria: todo QR tiene vencimiento explícito (regla #6). */
  readonly venceEn: Date;
  readonly origen: OrigenQr;
  /** Referencia al archivo en Storage; nunca la imagen inline. */
  readonly imagenRef: string | null;
  /** SHA-256 del archivo, para integridad de la evidencia. */
  readonly hashImagen: string | null;
};

/**
 * Quién pidió el cobro, cuando lo pidió otro producto por el contrato de
 * consumidores (docs/10) y no el dueño desde la consola.
 *
 * `referenciaExterna` es **opaca**: es el identificador que el consumidor usa
 * en su propio sistema para reconocer este cobro. No lleva nombre, teléfono ni
 * NIT de su cliente — el sistema de cobros no necesita saber de quién es el
 * cobro, y lo que no se recibe no se puede filtrar (reglas #4 y #9).
 *
 * El par `(consumidorId, referenciaExterna)` es único: es lo que hace que dos
 * pedidos iguales devuelvan el mismo cobro en vez de dos QRs.
 */
export type DatosConsumidor = {
  readonly consumidorId: string;
  readonly referenciaExterna: string;
};

export type Cobro = {
  readonly id: string;
  readonly proveedor: Proveedor;
  readonly estado: EstadoCobro;
  readonly montoCentavos: Centavos;
  readonly moneda: 'BOB';
  /** Versión del QR vigente. Empieza en 0 mientras el cobro es BORRADOR. */
  readonly qrVersion: number;
  /** QR vigente, si hay uno emitido. */
  readonly qrVigente: QrEmitido | null;
  readonly creadoEn: Date;
  /**
   * Teléfono del cliente en formato E.164, o `null`.
   *
   * Se guarda completo cuando lo hay, porque hace falta para enviarle el QR;
   * en logs va siempre enmascarado (regla #9). Es `null` en los cobros que
   * pide un consumidor por el contrato de docs/10: ahí el envío al pagador es
   * del consumidor por su propio canal, así que este proyecto no pide —ni
   * guarda— el teléfono de un cliente que no es suyo. Un cobro sin teléfono
   * **no se puede enviar**, y `enviarQr()` lo rechaza en vez de inventar un
   * destinatario.
   */
  readonly telefonoCliente: string | null;
  readonly concepto: string;
  /** Presente solo si el cobro lo pidió un consumidor; `null` si lo creó el dueño. */
  readonly consumidor: DatosConsumidor | null;
};

/**
 * Enmascara un teléfono para logs y evidencia: `+59171234567` → `+591 7** ***67`.
 *
 * `null` entra y sale como `null`: un cobro de consumidor no tiene teléfono, y
 * fabricar un `'***'` para ese caso haría parecer que hay un dato oculto donde
 * no hay ninguno.
 */
export function enmascararTelefono(telefono: string | null): string | null {
  if (telefono === null) {
    return null;
  }
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 4) {
    return '***';
  }
  const ultimos = digitos.slice(-2);
  const primero = digitos.length > 8 ? digitos.slice(3, 4) : digitos.slice(0, 1);
  return `+591 ${primero}** ***${ultimos}`;
}

/** ¿El QR vigente ya venció a la hora dada? */
export function qrEstaVencido(cobro: Cobro, ahora: Date): boolean {
  if (cobro.qrVigente === null) {
    return false;
  }
  return ahora.getTime() >= cobro.qrVigente.venceEn.getTime();
}
