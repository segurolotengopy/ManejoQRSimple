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
 * 3. Un cobro **no abandona un QR que el cliente todavía puede pagar** sin la
 *    constancia de haberlo anulado en el proveedor (`QrAnulado`). El banco
 *    vence los QR por día, no por hora (respuesta C4 de Baneco): sin esta
 *    guarda, un cobro vencido o anulado en nuestro reloj seguiría cobrable
 *    en el banco, y el pago entraría sin que nadie lo mire.
 */

import { exito, fallo, type Resultado } from '../comun/resultado.js';
import type { ConciliacionAprobada, MotivoRechazo } from '../conciliacion/conciliar.js';
import type { DeteccionDePago } from '../conciliacion/deteccion.js';
import type { QrAnulado } from './anulacion.js';
import type { Cobro, QrEmitido } from './cobro.js';
import { esTerminal, type EstadoCobro, type OrigenTransicion } from './estados.js';

export type { QrAnulado };

/**
 * Estados en los que el QR vigente todavía se puede pagar en el proveedor.
 *
 * `VENCIDO` no está porque llegar ahí ya exigió anularlo; `PAGO_DETECTADO` no
 * está porque el QR es de un solo uso y ya se pagó.
 */
const ESTADOS_CON_QR_PAGABLE: readonly EstadoCobro[] = ['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO'];

/** ¿El cobro tiene un QR que el cliente todavía puede pagar? */
export function tieneQrPagable(cobro: Cobro): boolean {
  return cobro.qrVigente !== null && ESTADOS_CON_QR_PAGABLE.includes(cobro.estado);
}

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
  | { readonly tipo: 'QR_VENCIDO'; readonly anulacion: QrAnulado; readonly origen: OrigenTransicion }
  | { readonly tipo: 'QR_RENOVADO'; readonly qr: QrEmitido; readonly origen: OrigenTransicion }
  | {
      readonly tipo: 'VENTANA_AGOTADA';
      readonly anulacion: QrAnulado;
      readonly origen: OrigenTransicion;
    }
  | {
      /**
       * El banco reportó un pago sobre el QR de un cobro ya vencido. No se
       * concilia solo: lo mira una persona, que decide si lo acepta.
       */
      readonly tipo: 'ABONO_TARDIO';
      readonly deteccion: DeteccionDePago;
      readonly origen: OrigenTransicion;
    }
  | {
      /**
       * El banco reportó un pago para un cobro que ya está en revisión (el
       * cierre diario lo encontró, o el dueño lo buscó). Queda en la evidencia
       * para que quien revise lo vea; el cobro sigue en revisión.
       */
      readonly tipo: 'DETECCION_EN_REVISION';
      readonly deteccion: DeteccionDePago;
      readonly origen: OrigenTransicion;
    }
  | {
      readonly tipo: 'RESUELTO_MANUALMENTE';
      readonly decision: 'CONFIRMADO';
      /**
       * El abono del banco que la persona acepta. Confirmar a mano exige
       * nombrarlo: sin una detección del banco no hay confirmación (regla #1),
       * tampoco manual. Un comprobante no alcanza.
       */
      readonly idDeduplicacion: string;
      readonly motivo: string;
      /** Solo una persona resuelve una revisión, y queda marcado como tal. */
      readonly origen: 'accion-manual';
    }
  | {
      readonly tipo: 'RESUELTO_MANUALMENTE';
      readonly decision: 'RECHAZADO';
      readonly motivo: string;
      readonly origen: 'accion-manual';
    }
  | {
      readonly tipo: 'ANULADO';
      readonly motivo: string;
      /** Obligatoria si el cobro tiene un QR pagable; `null` si no lo tiene. */
      readonly anulacion: QrAnulado | null;
      readonly origen: OrigenTransicion;
    };

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
    }
  | { readonly tipo: 'QR_SIN_ANULAR_EN_PROVEEDOR'; readonly referenciaProveedor: string }
  | { readonly tipo: 'CONFIRMACION_SIN_DETECCION' };

/** Estados desde los que cada evento puede disparar. Es la tabla de CLAUDE.md. */
const ORIGENES_PERMITIDOS: Readonly<Record<TipoEvento, readonly EstadoCobro[]>> = {
  QR_EMITIDO: ['BORRADOR'],
  QR_ENVIADO: ['QR_ACTIVO'],
  COMPROBANTE_RECIBIDO: ['ENVIADO'],
  // QR_ACTIVO también: si WhatsApp entregó el QR pero reportó una falla, el
  // cliente puede pagarlo sin que el cobro haya pasado a ENVIADO. Manda el
  // banco, no nuestro registro del envío (regla #1).
  PAGO_DETECTADO: ['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO'],
  PAGO_CONCILIADO: ['PAGO_DETECTADO'],
  CONCILIACION_FALLIDA: ['PAGO_DETECTADO'],
  QR_VENCIDO: ['QR_ACTIVO', 'ENVIADO'],
  QR_RENOVADO: ['VENCIDO'],
  VENTANA_AGOTADA: ['COMPROBANTE_RECIBIDO'],
  ABONO_TARDIO: ['VENCIDO'],
  DETECCION_EN_REVISION: ['EN_REVISION'],
  RESUELTO_MANUALMENTE: ['EN_REVISION'],
  ANULADO: ['BORRADOR', 'QR_ACTIVO', 'ENVIADO', 'VENCIDO'],
};

/**
 * ¿El cobro admite este evento en su estado actual? `null` si lo admite.
 *
 * Existe para que un caso de uso pueda preguntarlo **antes** de tocar el
 * mundo: pedirle al banco que emita o anule un QR y recién después descubrir
 * que la transición no correspondía deja un efecto real sin su cambio de
 * estado.
 */
export function verificarAdmision(cobro: Cobro, tipo: TipoEvento): ErrorTransicion | null {
  if (esTerminal(cobro.estado)) {
    return { tipo: 'COBRO_TERMINAL', estado: cobro.estado };
  }
  if (!ORIGENES_PERMITIDOS[tipo].includes(cobro.estado)) {
    return { tipo: 'TRANSICION_NO_PERMITIDA', desde: cobro.estado, evento: tipo };
  }
  return null;
}

export function transicionar(
  cobro: Cobro,
  evento: EventoCobro,
  ahora: Date,
): Resultado<TransicionAplicada, ErrorTransicion> {
  const inadmisible = verificarAdmision(cobro, evento.tipo);
  if (inadmisible !== null) {
    return fallo(inadmisible);
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

    case 'QR_VENCIDO': {
      const sinAnular = exigirAnulacion(cobro, evento.anulacion);
      if (sinAnular !== null) {
        return fallo(sinAnular);
      }
      return aplicar('VENCIDO', {}, { qrVersion: cobro.qrVersion, ...datosDeAnulacion(evento.anulacion) });
    }

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

    case 'VENTANA_AGOTADA': {
      // Llegó comprobante pero el watcher nunca vio el abono. Lo mira una persona.
      const sinAnular = exigirAnulacion(cobro, evento.anulacion);
      if (sinAnular !== null) {
        return fallo(sinAnular);
      }
      return aplicar(
        'EN_REVISION',
        {},
        { qrVersion: cobro.qrVersion, ...datosDeAnulacion(evento.anulacion) },
      );
    }

    case 'ABONO_TARDIO':
      // Plata real sobre un QR vencido: ni se descarta ni se confirma sola.
      return aplicar(
        'EN_REVISION',
        {},
        {
          qrVersion: cobro.qrVersion,
          idDeduplicacion: evento.deteccion.idDeduplicacion,
          montoCentavos: evento.deteccion.montoCentavos,
          ocurridoEn: evento.deteccion.ocurridoEn.toISOString(),
          origenDeteccion: evento.deteccion.origen,
        },
      );

    case 'DETECCION_EN_REVISION':
      return aplicar(
        'EN_REVISION',
        {},
        {
          idDeduplicacion: evento.deteccion.idDeduplicacion,
          montoCentavos: evento.deteccion.montoCentavos,
          ocurridoEn: evento.deteccion.ocurridoEn.toISOString(),
          origenDeteccion: evento.deteccion.origen,
        },
      );

    case 'RESUELTO_MANUALMENTE':
      if (evento.decision === 'RECHAZADO') {
        return aplicar('RECHAZADO', {}, { motivo: evento.motivo });
      }
      if (evento.idDeduplicacion.trim() === '') {
        return fallo({ tipo: 'CONFIRMACION_SIN_DETECCION' });
      }
      return aplicar(
        'CONFIRMADO',
        {},
        { motivo: evento.motivo, idDeduplicacion: evento.idDeduplicacion },
      );

    case 'ANULADO': {
      const sinAnular = exigirAnulacion(cobro, evento.anulacion);
      if (sinAnular !== null) {
        return fallo(sinAnular);
      }
      return aplicar(
        'ANULADO',
        {},
        {
          motivo: evento.motivo,
          ...(evento.anulacion === null ? { qrAnulado: null } : datosDeAnulacion(evento.anulacion)),
        },
      );
    }
  }
}

/**
 * Exige la constancia de anulación cuando el cobro tiene un QR pagable, y que
 * sea **de ese** QR: anular una versión anterior no deja muerta la vigente.
 */
function exigirAnulacion(cobro: Cobro, anulacion: QrAnulado | null): ErrorTransicion | null {
  if (!tieneQrPagable(cobro) || cobro.qrVigente === null) {
    return null;
  }
  const vigente = cobro.qrVigente.referenciaProveedor;
  if (anulacion === null || anulacion.referenciaProveedor !== vigente) {
    return { tipo: 'QR_SIN_ANULAR_EN_PROVEEDOR', referenciaProveedor: vigente };
  }
  return null;
}

function datosDeAnulacion(anulacion: QrAnulado): Readonly<Record<string, ValorEvidencia>> {
  return { qrAnulado: anulacion.referenciaProveedor, anuladoEn: anulacion.anuladoEn.toISOString() };
}

/** Todo QR tiene vencimiento explícito y posterior a su emisión (regla #6). */
function validarQr(qr: QrEmitido): ErrorTransicion | null {
  if (qr.venceEn.getTime() <= qr.emitidoEn.getTime()) {
    return { tipo: 'QR_SIN_VENCIMIENTO_VALIDO', qrVersion: qr.qrVersion };
  }
  return null;
}
