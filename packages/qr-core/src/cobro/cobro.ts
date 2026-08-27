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
   * Teléfono del cliente en formato E.164. Se guarda completo porque hace
   * falta para enviarle el QR; en logs va siempre enmascarado (regla #9).
   */
  readonly telefonoCliente: string;
  readonly concepto: string;
};

/** Enmascara un teléfono para logs y evidencia: `+59171234567` → `+591 7** ***67`. */
export function enmascararTelefono(telefono: string): string {
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
