/**
 * Una pasada del satélite: lo que hace cada `BANECO_POLL_INTERVAL_SECONDS`.
 *
 * Está separado del proceso (`main.ts`) a propósito: acá no hay temporizadores,
 * ni conexiones, ni `process.exit`. Es una función que recibe los puertos y
 * devuelve un resumen — así se puede probar entera con mocks, en CI, sin banco
 * ni Firestore.
 *
 * Lo que hace, por cobro pendiente:
 * 1. Si el QR venció, marcarlo `VENCIDO`. **Antes** de consultar el banco: un
 *    cobro vencido ya no es candidato a confirmarse solo.
 * 2. Si sigue vigente, preguntarle al banco y conciliar (`verificarPago`).
 *
 * El satélite **no renueva ni reenvía**: eso lo decide el dueño desde la
 * consola. Un proceso que renueva solo podría reemitir QRs indefinidamente
 * sobre un cobro que ya nadie va a pagar.
 */

import {
  esExito,
  vencerSiCorresponde,
  verificarPago,
  type Cobro,
  type DepsVerificacion,
  type ErrorCasoUso,
} from '@mqs/qr-core';

export type ResumenPasada = {
  readonly revisados: number;
  readonly confirmados: readonly string[];
  readonly enRevision: readonly string[];
  readonly vencidos: readonly string[];
  readonly sinAbono: readonly string[];
  /** Cobros que fallaron por un error de puerto; se reintentan en la próxima. */
  readonly conError: readonly { readonly cobroId: string; readonly error: ErrorCasoUso }[];
};

export async function unaPasada(
  deps: DepsVerificacion,
  ahora: Date,
): Promise<ResumenPasada | { readonly errorFatal: ErrorCasoUso }> {
  const pendientes = await deps.cobros.listarPendientes();
  if (!esExito(pendientes)) {
    // Sin la lista no hay pasada: no se puede saber qué quedó sin mirar.
    return { errorFatal: { tipo: 'PUERTO', error: pendientes.error } };
  }

  const confirmados: string[] = [];
  const enRevision: string[] = [];
  const vencidos: string[] = [];
  const sinAbono: string[] = [];
  const conError: { cobroId: string; error: ErrorCasoUso }[] = [];

  for (const pendiente of pendientes.valor) {
    const resultado = await revisarCobro(deps, pendiente, ahora);
    if (resultado.tipo === 'ERROR') {
      // Un cobro que falla no corta la pasada: los demás se siguen mirando y
      // este se reintenta en la próxima vuelta.
      conError.push({ cobroId: pendiente.id, error: resultado.error });
      continue;
    }
    switch (resultado.tipo) {
      case 'VENCIDO':
        vencidos.push(pendiente.id);
        break;
      case 'CONFIRMADO':
        confirmados.push(pendiente.id);
        break;
      case 'EN_REVISION':
        enRevision.push(pendiente.id);
        break;
      case 'SIN_ABONO':
        sinAbono.push(pendiente.id);
        break;
    }
  }

  return {
    revisados: pendientes.valor.length,
    confirmados,
    enRevision,
    vencidos,
    sinAbono,
    conError,
  };
}

type ResultadoCobro =
  | { readonly tipo: 'VENCIDO' | 'CONFIRMADO' | 'EN_REVISION' | 'SIN_ABONO' | 'NADA' }
  | { readonly tipo: 'ERROR'; readonly error: ErrorCasoUso };

async function revisarCobro(
  deps: DepsVerificacion,
  cobro: Cobro,
  ahora: Date,
): Promise<ResultadoCobro> {
  // Primero el vencimiento: un QR vencido no puede confirmarse solo, y dejarlo
  // en ENVIADO haría que el satélite lo consultara para siempre.
  const trasVencimiento = await vencerSiCorresponde(deps, cobro, ahora);
  if (!esExito(trasVencimiento)) {
    return { tipo: 'ERROR', error: trasVencimiento.error };
  }
  if (trasVencimiento.valor.estado === 'VENCIDO') {
    return { tipo: 'VENCIDO' };
  }

  const verificado = await verificarPago(deps, trasVencimiento.valor, ahora);
  if (!esExito(verificado)) {
    return { tipo: 'ERROR', error: verificado.error };
  }

  switch (verificado.valor.tipo) {
    case 'CONFIRMADO':
      return { tipo: 'CONFIRMADO' };
    case 'EN_REVISION':
      return { tipo: 'EN_REVISION' };
    case 'SIN_ABONO':
      return { tipo: 'SIN_ABONO' };
    case 'NO_CORRESPONDE':
      return { tipo: 'NADA' };
  }
}

/** Línea de log de una pasada. Sin datos personales (reglas #4 y #9). */
export function describirPasada(resumen: ResumenPasada): string {
  const partes = [
    `revisados=${String(resumen.revisados)}`,
    `confirmados=${String(resumen.confirmados.length)}`,
    `enRevision=${String(resumen.enRevision.length)}`,
    `vencidos=${String(resumen.vencidos.length)}`,
    `sinAbono=${String(resumen.sinAbono.length)}`,
  ];
  if (resumen.conError.length > 0) {
    partes.push(`conError=${String(resumen.conError.length)}`);
  }
  return partes.join(' ');
}
