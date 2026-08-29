/**
 * Traducción entre el dominio y los documentos de Firestore.
 *
 * La lectura pasa por Zod (regla #11). Puede parecer exagerado validar datos
 * que escribimos nosotros, pero un documento en Firestore sobrevive a los
 * despliegues: puede haberlo escrito una versión anterior con otra forma, o
 * haberlo tocado alguien desde la consola de Firebase. Un `undefined` que se
 * cuela hasta la conciliación es peor que un error de validación acá.
 *
 * Sobre los montos: en Firestore viven como enteros y vuelven al dominio por
 * `centavos()`, que valida. Nunca hay un float en el medio (regla #5).
 */

import {
  centavos,
  esExito,
  exito,
  fallo,
  type Cobro,
  type EstadoCobro,
  type OrigenQr,
  type Proveedor,
  type QrEmitido,
  type RegistroEvidencia,
  type Resultado,
} from '@mqs/qr-core';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

export type ErrorMapeoFirestore = {
  readonly tipo: 'DOCUMENTO_INVALIDO';
  readonly id: string;
  readonly motivo: string;
};

/** Firestore devuelve `Timestamp`; el dominio trabaja con `Date`. */
const marcaDeTiempo = z.custom<Timestamp>((v) => v instanceof Timestamp, {
  message: 'se esperaba un Timestamp de Firestore',
});

const qrEmitidoDoc = z.object({
  qrVersion: z.number().int().nonnegative(),
  referenciaProveedor: z.string().min(1),
  emitidoEn: marcaDeTiempo,
  venceEn: marcaDeTiempo,
  origen: z.enum(['api-baneco', 'carga-manual', 'consola-asistida']),
  imagenRef: z.string().nullable(),
  hashImagen: z.string().nullable(),
});

const cobroDoc = z.object({
  proveedor: z.enum(['baneco', 'yape']),
  estado: z.enum([
    'BORRADOR',
    'QR_ACTIVO',
    'ENVIADO',
    'COMPROBANTE_RECIBIDO',
    'PAGO_DETECTADO',
    'CONFIRMADO',
    'EN_REVISION',
    'RECHAZADO',
    'VENCIDO',
    'ANULADO',
  ]),
  montoCentavos: z.number().int().nonnegative(),
  moneda: z.literal('BOB'),
  qrVersion: z.number().int().nonnegative(),
  qrVigente: qrEmitidoDoc.nullable(),
  creadoEn: marcaDeTiempo,
  telefonoCliente: z.string().min(1),
  concepto: z.string(),
});

export function cobroADocumento(cobro: Cobro): Record<string, unknown> {
  return {
    proveedor: cobro.proveedor,
    estado: cobro.estado,
    montoCentavos: cobro.montoCentavos,
    moneda: cobro.moneda,
    qrVersion: cobro.qrVersion,
    qrVigente: cobro.qrVigente === null ? null : qrADocumento(cobro.qrVigente),
    creadoEn: Timestamp.fromDate(cobro.creadoEn),
    telefonoCliente: cobro.telefonoCliente,
    concepto: cobro.concepto,
  };
}

export function qrADocumento(qr: QrEmitido): Record<string, unknown> {
  return {
    qrVersion: qr.qrVersion,
    referenciaProveedor: qr.referenciaProveedor,
    emitidoEn: Timestamp.fromDate(qr.emitidoEn),
    venceEn: Timestamp.fromDate(qr.venceEn),
    origen: qr.origen,
    imagenRef: qr.imagenRef,
    hashImagen: qr.hashImagen,
  };
}

export function documentoACobro(
  id: string,
  datos: unknown,
): Resultado<Cobro, ErrorMapeoFirestore> {
  const validado = cobroDoc.safeParse(datos);
  if (!validado.success) {
    return fallo({ tipo: 'DOCUMENTO_INVALIDO', id, motivo: validado.error.issues[0]?.message ?? 'forma inesperada' });
  }

  const monto = centavos(validado.data.montoCentavos);
  if (!esExito(monto)) {
    return fallo({ tipo: 'DOCUMENTO_INVALIDO', id, motivo: `montoCentavos inválido (${monto.error.tipo})` });
  }

  const d = validado.data;
  return exito({
    id,
    proveedor: d.proveedor satisfies Proveedor,
    estado: d.estado satisfies EstadoCobro,
    montoCentavos: monto.valor,
    moneda: 'BOB',
    qrVersion: d.qrVersion,
    qrVigente:
      d.qrVigente === null
        ? null
        : {
            qrVersion: d.qrVigente.qrVersion,
            referenciaProveedor: d.qrVigente.referenciaProveedor,
            emitidoEn: d.qrVigente.emitidoEn.toDate(),
            venceEn: d.qrVigente.venceEn.toDate(),
            origen: d.qrVigente.origen satisfies OrigenQr,
            imagenRef: d.qrVigente.imagenRef,
            hashImagen: d.qrVigente.hashImagen,
          },
    creadoEn: d.creadoEn.toDate(),
    telefonoCliente: d.telefonoCliente,
    concepto: d.concepto,
  });
}

export function evidenciaADocumento(registro: RegistroEvidencia): Record<string, unknown> {
  return {
    cobroId: registro.cobroId,
    desde: registro.desde,
    hacia: registro.hacia,
    evento: registro.evento,
    origen: registro.origen,
    registradoEn: Timestamp.fromDate(registro.registradoEn),
    datos: registro.datos,
  };
}

const evidenciaDoc = z.object({
  cobroId: z.string().min(1),
  desde: z.string().min(1),
  hacia: z.string().min(1),
  evento: z.string().min(1),
  origen: z.string().min(1),
  registradoEn: marcaDeTiempo,
  datos: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

export function documentoAEvidencia(
  id: string,
  datos: unknown,
): Resultado<RegistroEvidencia, ErrorMapeoFirestore> {
  const validado = evidenciaDoc.safeParse(datos);
  if (!validado.success) {
    return fallo({ tipo: 'DOCUMENTO_INVALIDO', id, motivo: validado.error.issues[0]?.message ?? 'forma inesperada' });
  }
  const d = validado.data;
  return exito({
    cobroId: d.cobroId,
    desde: d.desde as RegistroEvidencia['desde'],
    hacia: d.hacia as RegistroEvidencia['hacia'],
    evento: d.evento as RegistroEvidencia['evento'],
    origen: d.origen as RegistroEvidencia['origen'],
    registradoEn: d.registradoEn.toDate(),
    datos: d.datos,
  });
}

/**
 * Id del documento de evidencia. Ordenable lexicográficamente por tiempo.
 *
 * El prefijo ISO da el orden cronológico sin necesitar un índice. Pero dos
 * transiciones del mismo cobro caen seguido en el **mismo milisegundo** —
 * `verificarPago` aplica PAGO_DETECTADO y PAGO_CONCILIADO con el mismo `ahora`—
 * y ahí el ISO empata. Sin un desempate por orden de inserción, el rastro sale
 * ordenado por lo que venga después en el id: con el nombre del evento ahí,
 * `PAGO_CONCILIADO` precedía a `PAGO_DETECTADO` y la auditoría mostraba la
 * confirmación **antes** de la detección que la causó.
 *
 * El desempate es un contador monótono del proceso, de ancho fijo para que
 * ordene bien como texto. Dentro de un proceso es estrictamente creciente, que
 * es donde ocurren las ráfagas en el mismo milisegundo; entre procesos, dos
 * transiciones del mismo cobro en el mismo milisegundo son inverosímiles.
 */
let contadorMonotono = 0n;

export function idDeEvidencia(registro: RegistroEvidencia, sufijo: string): string {
  contadorMonotono += 1n;
  const orden = contadorMonotono.toString().padStart(12, '0');
  return `${registro.registradoEn.toISOString()}_${orden}_${sufijo}`;
}
