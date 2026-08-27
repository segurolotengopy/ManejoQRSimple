/**
 * Traducción entre los DTOs del banco y el dominio.
 *
 * Es el único lugar donde conviven las dos representaciones. Dos cuidados que
 * el resto del sistema hereda sin enterarse:
 *
 * - **Montos** (regla #5): el decimal del banco entra por `desdeDecimalBob`, que
 *   rechaza el tercer decimal en vez de redondearlo. Un importe raro se
 *   convierte en un error de mapeo, y el cobro termina en `EN_REVISION`.
 * - **Datos personales** (reglas #4 y #9): `senderName` y `senderDocumentId`
 *   llegan del banco y **se descartan acá**. No viajan al dominio, así que no
 *   pueden terminar en Firestore ni en un log por descuido más adelante.
 */

import {
  claveBaneco,
  desdeDecimalBob,
  esExito,
  exito,
  fallo,
  registrarDeteccion,
  type Centavos,
  type DeteccionDePago,
  type Resultado,
} from '@mqs/qr-core';

import type { PagoQr } from './schemas.js';

export type ErrorMapeo =
  | { readonly tipo: 'IMPORTE_NO_REPRESENTABLE'; readonly amount: string }
  | { readonly tipo: 'MONEDA_NO_SOPORTADA'; readonly currency: string }
  | { readonly tipo: 'FECHA_INVALIDA'; readonly paymentDate: string; readonly paymentTime: string };

/**
 * Offset de Bolivia respecto de UTC. No hay horario de verano.
 *
 * El banco informa `paymentDate`/`paymentTime` sin zona horaria, así que se
 * interpretan en hora boliviana. **Es un supuesto** hasta que el banco responda
 * la pregunta D7; está acá, en una sola constante, para que confirmarlo o
 * corregirlo sea cambiar una línea.
 */
const OFFSET_BOLIVIA_HORAS = -4;

/** Combina fecha y hora del banco en un instante UTC. */
export function instanteDelPago(pago: PagoQr): Resultado<Date, ErrorMapeo> {
  const soloFecha = pago.paymentDate.slice(0, 10);
  const iso = `${soloFecha}T${pago.paymentTime}.000Z`;
  const comoUtc = Date.parse(iso);

  if (Number.isNaN(comoUtc)) {
    return fallo({
      tipo: 'FECHA_INVALIDA',
      paymentDate: pago.paymentDate,
      paymentTime: pago.paymentTime,
    });
  }

  // El texto se leyó como si fuera UTC; se corrige al offset boliviano.
  return exito(new Date(comoUtc - OFFSET_BOLIVIA_HORAS * 3_600_000));
}

/** Convierte el importe del banco a centavos enteros. */
export function aCentavos(pago: PagoQr): Resultado<Centavos, ErrorMapeo> {
  const texto = typeof pago.amount === 'number' ? String(pago.amount) : pago.amount.trim();
  const monto = desdeDecimalBob(texto);
  if (!esExito(monto)) {
    return fallo({ tipo: 'IMPORTE_NO_REPRESENTABLE', amount: texto });
  }
  return exito(monto.valor);
}

/**
 * Convierte un pago del banco en una detección del dominio.
 *
 * Lo que sale de acá es todo lo que el sistema va a saber del pago: monto,
 * momento, referencia y clave de deduplicación. El nombre del pagador queda
 * afuera a propósito.
 */
export function aDeteccion(pago: PagoQr): Resultado<DeteccionDePago, ErrorMapeo> {
  if (pago.currency !== 'BOB') {
    // El demo opera en bolivianos. Un pago en USD no se concilia solo: lo mira
    // una persona, en vez de convertirlo con un tipo de cambio inventado.
    return fallo({ tipo: 'MONEDA_NO_SOPORTADA', currency: pago.currency });
  }

  const monto = aCentavos(pago);
  if (!esExito(monto)) {
    return monto;
  }

  const ocurridoEn = instanteDelPago(pago);
  if (!esExito(ocurridoEn)) {
    return ocurridoEn;
  }

  return exito(
    registrarDeteccion({
      idDeduplicacion: claveBaneco(pago.qrId, pago.transactionId),
      montoCentavos: monto.valor,
      ocurridoEn: ocurridoEn.valor,
      origen: 'watcher-baneco',
      referencia: pago.description ?? null,
    }),
  );
}

/** `yyyy-MM-dd` en hora boliviana, como espera `dueDate`. */
export function aFechaBaneco(fecha: Date): string {
  const local = new Date(fecha.getTime() + OFFSET_BOLIVIA_HORAS * 3_600_000);
  return local.toISOString().slice(0, 10);
}

/** `yyyyMMdd`, como espera el path de `paidQR`. */
export function aFechaCompacta(fecha: Date): string {
  return aFechaBaneco(fecha).replace(/-/g, '');
}
