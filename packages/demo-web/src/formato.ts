/**
 * Presentación: cómo se ve un cobro en pantalla.
 *
 * Separado de los componentes para poder probarlo sin DOM. Todo lo que hay acá
 * es traducción de datos a texto — **ninguna decisión de negocio**. Si algo de
 * este archivo empezara a decidir cuándo se puede anular un cobro, estaría en
 * el lugar equivocado.
 */

import type { Cobro, EstadoCobro } from './api.js';

/** Qué significa cada estado, en castellano y para una persona. */
const DESCRIPCION: Readonly<Record<EstadoCobro, string>> = {
  BORRADOR: 'Recién creado, sin QR todavía',
  QR_ACTIVO: 'Con QR emitido, sin enviar al cliente',
  ENVIADO: 'Enviado al cliente, esperando el pago',
  COMPROBANTE_RECIBIDO: 'El cliente mandó comprobante — todavía sin confirmar',
  PAGO_DETECTADO: 'El banco reportó un abono, falta conciliarlo',
  CONFIRMADO: 'Pago confirmado contra el banco',
  EN_REVISION: 'Necesita que lo mires: el abono no concilió',
  RECHAZADO: 'Rechazado tras revisión manual',
  VENCIDO: 'El QR venció sin pago',
  ANULADO: 'Anulado',
};

/** Color semántico del estado. Los nombres los resuelve la hoja de estilos. */
const TONO: Readonly<Record<EstadoCobro, string>> = {
  BORRADOR: 'neutro',
  QR_ACTIVO: 'espera',
  ENVIADO: 'espera',
  COMPROBANTE_RECIBIDO: 'espera',
  PAGO_DETECTADO: 'espera',
  CONFIRMADO: 'bien',
  EN_REVISION: 'atencion',
  RECHAZADO: 'mal',
  VENCIDO: 'neutro',
  ANULADO: 'neutro',
};

export const describirEstado = (estado: EstadoCobro): string => DESCRIPCION[estado];
export const tonoDeEstado = (estado: EstadoCobro): string => TONO[estado];

/** `"150.50"` → `"Bs 150.50"`. El monto ya viene como texto de la API. */
export const montoParaMostrar = (cobro: Pick<Cobro, 'monto'>): string => `Bs ${cobro.monto}`;

/** Fecha y hora locales, cortas. */
export function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return iso;
  }
  return fecha.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Cuánto le queda de vida al QR, en texto.
 *
 * Devuelve `null` si no hay QR. Un QR ya vencido lo dice explícitamente en vez
 * de mostrar un número negativo.
 */
export function vigenciaRestante(venceEn: string, ahora: Date): string | null {
  const vence = new Date(venceEn);
  if (Number.isNaN(vence.getTime())) {
    return null;
  }
  const minutos = Math.floor((vence.getTime() - ahora.getTime()) / 60_000);
  if (minutos < 0) {
    return 'vencido';
  }
  if (minutos < 60) {
    return `vence en ${String(minutos)} min`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 48) {
    return `vence en ${String(horas)} h`;
  }
  return `vence en ${String(Math.floor(horas / 24))} días`;
}

/**
 * Qué acciones tienen sentido para un cobro en este estado.
 *
 * **No es la regla de negocio**: la máquina de estados del dominio es la que
 * decide, y va a rechazar con 409 cualquier cosa que no corresponda. Esto solo
 * evita mostrar botones que sabemos que van a fallar. Si los dos quedaran
 * desalineados, manda el dominio — por eso la consola siempre muestra el error
 * que devuelve la API.
 */
export function accionesPosibles(estado: EstadoCobro): readonly string[] {
  switch (estado) {
    case 'QR_ACTIVO':
      return ['enviar', 'anular'];
    case 'ENVIADO':
      return ['verificar', 'comprobante', 'anular'];
    case 'COMPROBANTE_RECIBIDO':
      return ['verificar', 'anular'];
    case 'VENCIDO':
      return ['renovar', 'anular'];
    case 'BORRADOR':
      return ['anular'];
    default:
      // CONFIRMADO, RECHAZADO y ANULADO son terminales; PAGO_DETECTADO y
      // EN_REVISION los resuelve el satélite o una persona fuera de la consola.
      return [];
  }
}
