/**
 * Conciliación: la única puerta hacia `CONFIRMADO`.
 *
 * `conciliar()` es el **único** productor de `ConciliacionAprobada`, y la
 * máquina de estados exige una para llegar a `CONFIRMADO`. Como el símbolo que
 * marca ese tipo no se exporta, ningún otro módulo puede fabricar el valor —
 * ni siquiera con un cast. Es la regla de negocio #1 sostenida por el
 * compilador y no por la disciplina de quien escribe el código:
 *
 *     un comprobante de WhatsApp no produce una ConciliacionAprobada,
 *     un webhook del banco tampoco, y sin ella no hay CONFIRMADO.
 *
 * Las tres condiciones son las de CLAUDE.md: monto exacto, dentro de la
 * vigencia (con la tolerancia configurada) y sin duplicado previo.
 */

import type { Centavos } from '../comun/dinero.js';
import { sonIguales } from '../comun/dinero.js';
import { exito, fallo, type Resultado } from '../comun/resultado.js';
import type { Cobro } from '../cobro/cobro.js';
import type { EstadoCobro } from '../cobro/estados.js';
import type { DeteccionDePago } from './deteccion.js';

declare const marcaConciliacion: unique symbol;

/**
 * Prueba de que un abono concilió contra un cobro. Solo `conciliar()` la emite.
 */
export type ConciliacionAprobada = {
  readonly [marcaConciliacion]: 'conciliacion-aprobada';
  readonly cobroId: string;
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly conciliadoEn: Date;
};

export type MotivoRechazo =
  | { readonly tipo: 'MONTO_NO_COINCIDE'; readonly esperado: Centavos; readonly recibido: Centavos }
  | {
      readonly tipo: 'FUERA_DE_VIGENCIA';
      readonly venceEn: Date;
      readonly ocurridoEn: Date;
      readonly toleranciaMinutos: number;
    }
  | { readonly tipo: 'DUPLICADO'; readonly idDeduplicacion: string }
  | { readonly tipo: 'ESTADO_NO_CONCILIABLE'; readonly estado: EstadoCobro }
  | { readonly tipo: 'SIN_QR_EMITIDO' };

export type PoliticaConciliacion = {
  /**
   * Margen después del vencimiento en el que un abono todavía concilia.
   *
   * Existe porque el reloj del banco y el nuestro no son el mismo, y porque
   * entre que el pagador confirma y el abono se acredita pasa un tiempo.
   * No es tolerancia de monto: el monto es exacto, siempre.
   */
  readonly toleranciaVencimientoMinutos: number;
};

export const POLITICA_POR_DEFECTO: PoliticaConciliacion = {
  toleranciaVencimientoMinutos: 10,
};

/**
 * Solo un cobro con un pago ya detectado se concilia. La detección es del
 * adaptador; la conciliación es del dominio, y ocurre después.
 */
const ESTADO_CONCILIABLE: EstadoCobro = 'PAGO_DETECTADO';

export function conciliar(args: {
  readonly cobro: Cobro;
  readonly deteccion: DeteccionDePago;
  /** Claves de deduplicación ya confirmadas para este cobro (regla #7). */
  readonly deteccionesPrevias: readonly string[];
  readonly politica: PoliticaConciliacion;
  readonly ahora: Date;
}): Resultado<ConciliacionAprobada, MotivoRechazo> {
  const { cobro, deteccion, deteccionesPrevias, politica, ahora } = args;

  if (cobro.estado !== ESTADO_CONCILIABLE) {
    return fallo({ tipo: 'ESTADO_NO_CONCILIABLE', estado: cobro.estado });
  }

  // Idempotencia (regla #7): el mismo abono visto dos veces concilia una sola.
  if (deteccionesPrevias.includes(deteccion.idDeduplicacion)) {
    return fallo({ tipo: 'DUPLICADO', idDeduplicacion: deteccion.idDeduplicacion });
  }

  if (cobro.qrVigente === null) {
    return fallo({ tipo: 'SIN_QR_EMITIDO' });
  }

  // Monto exacto: sin tolerancia, sin redondeo (reglas #5 y #1).
  if (!sonIguales(cobro.montoCentavos, deteccion.montoCentavos)) {
    return fallo({
      tipo: 'MONTO_NO_COINCIDE',
      esperado: cobro.montoCentavos,
      recibido: deteccion.montoCentavos,
    });
  }

  const limite =
    cobro.qrVigente.venceEn.getTime() + politica.toleranciaVencimientoMinutos * 60_000;
  if (deteccion.ocurridoEn.getTime() > limite) {
    return fallo({
      tipo: 'FUERA_DE_VIGENCIA',
      venceEn: cobro.qrVigente.venceEn,
      ocurridoEn: deteccion.ocurridoEn,
      toleranciaMinutos: politica.toleranciaVencimientoMinutos,
    });
  }

  return exito({
    cobroId: cobro.id,
    idDeduplicacion: deteccion.idDeduplicacion,
    montoCentavos: deteccion.montoCentavos,
    conciliadoEn: ahora,
  } as ConciliacionAprobada);
}
