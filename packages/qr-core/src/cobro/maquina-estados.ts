/**
 * Función única de transición del cobro (CLAUDE.md).
 *
 * **Ningún handler, trigger ni script cambia un estado por fuera de acá.** Las
 * demás piezas del sistema no tienen forma de hacerlo: `Cobro` es totalmente
 * `readonly`, así que la única manera de obtener un cobro en otro estado es que
 * esta función devuelva uno nuevo.
 *
 * Dos garantías estructurales, no de disciplina:
 *
 * 1. `CONFIRMADO` exige una `ConciliacionAprobada`, que solo `conciliar()`
 *    fabrica. Un comprobante de WhatsApp o un webhook del banco no pueden
 *    producirla (reglas #1 y BANECO-1).
 * 2. Cada transición devuelve su `RegistroEvidencia` — con timestamp, origen y
 *    datos mínimos — para que el repositorio lo agregue. La evidencia es
 *    append-only (regla #8): esta función nunca reescribe nada, solo emite.
 */

import { exito, fallo, type Resultado } from '../comun/resultado.js';
import type { ConciliacionAprobada, MotivoRechazo } from '../conciliacion/conciliar.js';
import type { DeteccionDePago } from '../conciliacion/deteccion.js';
import type { Cobro, QrEmitido } from './cobro.js';
import { esTerminal, type EstadoCobro, type OrigenTransicion } from './estados.js';

export type EventoCobro =
  | { readonly tipo: 'QR_EMITIDO'; readonly qr: QrEmitido; readonly origen: OrigenTransicion }
  | { readonly tipo: 'QR_ENVIADO'; readonly origen: OrigenTransicion }
  | {
      readonly tipo: 'COMPROBANTE_RECIBIDO';
      readonly referenciaComprobante: string;
      readonly origen: OrigenTransicion;
    }
  | {
      readonly tipo: 'PAGO_DETECTADO';
      readonly deteccion: DeteccionDePago;
      readonly origen: OrigenTransicion;
    }
  | {
      readonly tipo: 'PAGO_CONCILIADO';
      readonly conciliacion: ConciliacionAprobada;
      readonly origen: OrigenTransicion;
    }
  | {
      readonly tipo: 'CONCILIACION_FALLIDA';
      readonly motivo: MotivoRechazo;
      readonly origen: OrigenTransicion;
    }
  | { readonly tipo: 'QR_VENCIDO'; readonly origen: OrigenTransicion }
  | { readonly tipo: 'QR_RENOVADO'; readonly qr: QrEmitido; readonly origen: OrigenTransicion }
  | { readonly tipo: 'VENTANA_AGOTADA'; readonly origen: OrigenTransicion }
  | {
      readonly tipo: 'RESUELTO_MANUALMENTE';
      readonly decision: 'CONFIRMADO' | 'RECHAZADO';
      readonly motivo: string;
      /** Solo una persona resuelve una revisión, y queda marcado como tal. */
      readonly origen: 'accion-manual';
    }
  | { readonly tipo: 'ANULADO'; readonly motivo: string; readonly origen: OrigenTransicion };

export type TipoEvento = EventoCobro['tipo'];

/** Dato mínimo admitido en la evidencia (regla #4: nada más que esto). */
export type ValorEvidencia = string | number | null;

export type RegistroEvidencia = {
  readonly cobroId: string;
  readonly desde: EstadoCobro;
  readonly hacia: EstadoCobro;
  readonly evento: TipoEvento;
  readonly origen: OrigenTransicion;
  readonly registradoEn: Date;
  readonly datos: Readonly<Record<string, ValorEvidencia>>;
};

export type TransicionAplicada = {
  readonly cobro: Cobro;
  readonly evidencia: RegistroEvidencia;
};

export type ErrorTransicion =
  | { readonly tipo: 'TRANSICION_NO_PERMITIDA'; readonly desde: EstadoCobro; readonly evento: TipoEvento }
  | { readonly tipo: 'COBRO_TERMINAL'; readonly estado: EstadoCobro }
  | {
      readonly tipo: 'CONCILIACION_DE_OTRO_COBRO';
      readonly cobroId: string;
      readonly conciliacionDe: string;
    }
  | { readonly tipo: 'QR_SIN_VENCIMIENTO_VALIDO'; readonly qrVersion: number }
  | {
      readonly tipo: 'VERSION_QR_INVALIDA';
      readonly esperada: number;
      readonly recibida: number;
    };

/** Estados desde los que cada evento puede disparar. Es la tabla de CLAUDE.md. */
const ORIGENES_PERMITIDOS: Readonly<Record<TipoEvento, readonly EstadoCobro[]>> = {
  QR_EMITIDO: ['BORRADOR'],
  QR_ENVIADO: ['QR_ACTIVO'],
  COMPROBANTE_RECIBIDO: ['ENVIADO'],
  PAGO_DETECTADO: ['ENVIADO', 'COMPROBANTE_RECIBIDO'],
  PAGO_CONCILIADO: ['PAGO_DETECTADO'],
  CONCILIACION_FALLIDA: ['PAGO_DETECTADO'],
  QR_VENCIDO: ['QR_ACTIVO', 'ENVIADO'],
  QR_RENOVADO: ['VENCIDO'],
  VENTANA_AGOTADA: ['COMPROBANTE_RECIBIDO'],
  RESUELTO_MANUALMENTE: ['EN_REVISION'],
  ANULADO: ['BORRADOR', 'QR_ACTIVO', 'ENVIADO', 'VENCIDO'],
};

export function transicionar(
  cobro: Cobro,
  evento: EventoCobro,
  ahora: Date,
): Resultado<TransicionAplicada, ErrorTransicion> {
  if (esTerminal(cobro.estado)) {
    return fallo({ tipo: 'COBRO_TERMINAL', estado: cobro.estado });
  }

  if (!ORIGENES_PERMITIDOS[evento.tipo].includes(cobro.estado)) {
    return fallo({
      tipo: 'TRANSICION_NO_PERMITIDA',
      desde: cobro.estado,
      evento: evento.tipo,
    });
  }

  const aplicar = (
    hacia: EstadoCobro,
    cambios: Partial<Cobro>,
    datos: Readonly<Record<string, ValorEvidencia>>,
  ): Resultado<TransicionAplicada, ErrorTransicion> =>
    exito({
      cobro: { ...cobro, ...cambios, estado: hacia },
      evidencia: {
        cobroId: cobro.id,
        desde: cobro.estado,
        hacia,
        evento: evento.tipo,
        origen: evento.origen,
        registradoEn: ahora,
        datos,
      },
    });

  switch (evento.tipo) {
    case 'QR_EMITIDO': {
      const invalido = validarQr(evento.qr);
      if (invalido !== null) {
        return fallo(invalido);
      }
      return aplicar(
        'QR_ACTIVO',
        { qrVigente: evento.qr, qrVersion: evento.qr.qrVersion },
        {
          qrVersion: evento.qr.qrVersion,
          venceEn: evento.qr.venceEn.toISOString(),
          origenQr: evento.qr.origen,
        },
      );
    }

    case 'QR_ENVIADO':
      return aplicar('ENVIADO', {}, { qrVersion: cobro.qrVersion });

    case 'COMPROBANTE_RECIBIDO':
      // Evidencia auxiliar, nunca confirmación (regla #1 / ADR-005).
      return aplicar(
        'COMPROBANTE_RECIBIDO',
        {},
        { referenciaComprobante: evento.referenciaComprobante },
      );

    case 'PAGO_DETECTADO':
      // Candidato reportado por un adaptador. Todavía no confirma nada.
      return aplicar(
        'PAGO_DETECTADO',
        {},
        {
          idDeduplicacion: evento.deteccion.idDeduplicacion,
          montoCentavos: evento.deteccion.montoCentavos,
          ocurridoEn: evento.deteccion.ocurridoEn.toISOString(),
          origenDeteccion: evento.deteccion.origen,
        },
      );

    case 'PAGO_CONCILIADO': {
      // Sin esta comprobación, la conciliación de un cobro podría confirmar otro.
      if (evento.conciliacion.cobroId !== cobro.id) {
        return fallo({
          tipo: 'CONCILIACION_DE_OTRO_COBRO',
          cobroId: cobro.id,
          conciliacionDe: evento.conciliacion.cobroId,
        });
      }
      return aplicar(
        'CONFIRMADO',
        {},
        {
          idDeduplicacion: evento.conciliacion.idDeduplicacion,
          montoCentavos: evento.conciliacion.montoCentavos,
          conciliadoEn: evento.conciliacion.conciliadoEn.toISOString(),
        },
      );
    }

    case 'CONCILIACION_FALLIDA':
      // Un abono detectado que no concilia no se descarta: lo mira una persona.
      return aplicar('EN_REVISION', {}, { motivo: evento.motivo.tipo });

    case 'QR_VENCIDO':
      return aplicar('VENCIDO', {}, { qrVersion: cobro.qrVersion });

    case 'QR_RENOVADO': {
      const invalido = validarQr(evento.qr);
      if (invalido !== null) {
        return fallo(invalido);
      }
      // Renovar no crea un cobro nuevo: incrementa la versión (regla #6).
      const esperada = cobro.qrVersion + 1;
      if (evento.qr.qrVersion !== esperada) {
        return fallo({
          tipo: 'VERSION_QR_INVALIDA',
          esperada,
          recibida: evento.qr.qrVersion,
        });
      }
      return aplicar(
        'QR_ACTIVO',
        { qrVigente: evento.qr, qrVersion: esperada },
        { qrVersion: esperada, venceEn: evento.qr.venceEn.toISOString() },
      );
    }

    case 'VENTANA_AGOTADA':
      // Llegó comprobante pero el watcher nunca vio el abono. Lo mira una persona.
      return aplicar('EN_REVISION', {}, { qrVersion: cobro.qrVersion });

    case 'RESUELTO_MANUALMENTE':
      return aplicar(evento.decision, {}, { motivo: evento.motivo });

    case 'ANULADO':
      return aplicar('ANULADO', {}, { motivo: evento.motivo });
  }
}

/** Todo QR tiene vencimiento explícito y posterior a su emisión (regla #6). */
function validarQr(qr: QrEmitido): ErrorTransicion | null {
  if (qr.venceEn.getTime() <= qr.emitidoEn.getTime()) {
    return { tipo: 'QR_SIN_VENCIMIENTO_VALIDO', qrVersion: qr.qrVersion };
  }
  return null;
}
