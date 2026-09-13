/**
 * Modo "pago asistido" del Hito B0 (respuesta A2 del banco).
 *
 * Certificación no simula pagos: para ver un pago de verdad hay que mandarle la
 * imagen del QR al oficial de cuenta y esperar a que el banco lo pague (hasta
 * 48 h, respuesta E2). Eso parte el sondeo en dos corridas separadas:
 *
 * 1. `--pago-asistido`: emite **un** QR de 1 BOB que **no se anula**, guarda su
 *    imagen para mandarla por correo y anota el `qrId` en un archivo local.
 * 2. `--capturar-pago`: si el banco ya lo pagó, guarda como fixtures el
 *    `statusQR` pagado y el `paidQR` del día del pago, y sondea qué responde el
 *    banco al anular un QR ya pagado.
 *
 * Y una salida de emergencia: `--anular-pendiente` anula el QR si nunca se
 * pagó, para no dejarlo vivo en el ambiente del banco.
 *
 * Este módulo es la parte **pura**: qué modo se pidió, cómo se lee el archivo
 * de estado, qué hacer según lo que informe el banco y qué hallazgos salen de
 * la captura. Todo lo que habla con el banco o con el disco está en `main.ts`.
 */

import { ESTADO_QR } from '@mqs/baneco-gateway';
import { exito, fallo, type Resultado } from '@mqs/qr-core';

import type { Hallazgo } from './hallazgos.js';

export type Modo = 'SONDEO' | 'EMITIR_PARA_PAGO' | 'CAPTURAR_PAGO' | 'ANULAR_PENDIENTE';

const BANDERAS: Readonly<Record<string, Modo>> = {
  '--pago-asistido': 'EMITIR_PARA_PAGO',
  '--capturar-pago': 'CAPTURAR_PAGO',
  '--anular-pendiente': 'ANULAR_PENDIENTE',
};

/**
 * El modo pedido por línea de comandos. Sin banderas, el sondeo de siempre.
 * Una bandera desconocida o dos modos a la vez son un error: esta herramienta
 * crea objetos reales en el banco, y adivinar qué quiso decir alguien no es
 * una opción.
 */
export function leerModo(args: readonly string[]): Resultado<Modo, string> {
  const pedidos: Modo[] = [];
  for (const arg of args) {
    const modo = BANDERAS[arg];
    if (modo === undefined) {
      return fallo(`Opción desconocida: ${arg}. Válidas: ${Object.keys(BANDERAS).join(', ')}.`);
    }
    pedidos.push(modo);
  }
  if (pedidos.length > 1) {
    return fallo('Se pidió más de un modo a la vez. Corré uno por vez.');
  }
  return exito(pedidos[0] ?? 'SONDEO');
}

/** Lo que la primera corrida deja anotado para la segunda. Sin secretos: solo ids. */
export type EstadoPagoAsistido = {
  readonly qrId: string;
  readonly transactionId: string;
  readonly emitidoEn: string;
};

/** El `qrId` sale del banco y termina en un nombre de archivo: se acota. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ¿Se puede usar este `qrId` como nombre de archivo y guardarlo en el estado?
 * Se valida **al emitir**, no solo al leer: un id raro guardado dejaría un QR
 * vivo que ninguna corrida siguiente podría anular.
 */
export function esIdSeguro(qrId: string): boolean {
  return ID_SEGURO.test(qrId);
}

/** El host del ambiente de certificación (respuesta A2 del banco). */
export const HOST_CERTIFICACION = 'apimktdesa.baneco.com.bo';

/**
 * Barrera por lista **blanca**: B0 solo habla con el host exacto de
 * certificación. La de `leerConfig` rechaza la URL de producción conocida,
 * pero no una IP ni otro alias; y el pago asistido deja un QR cobrable días.
 */
export function esHostDeCertificacion(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    // https además del host: por http el JWT viajaría en claro, y con él se
    // puede consultar o anular el QR del pago asistido.
    return url.protocol === 'https:' && url.hostname === HOST_CERTIFICACION;
  } catch {
    return false;
  }
}

/**
 * La reserva que se escribe **antes** de emitir, en forma atómica: dos corridas
 * simultáneas no pueden emitir dos QRs, y si el banco crea el QR pero la
 * respuesta se pierde, la reserva queda como pista. No es un estado completo
 * (no tiene `qrId`), así que ningún modo la toma como "no hay nada pendiente".
 */
export function serializarReserva(transactionId: string, emitidoEn: string): string {
  return `${JSON.stringify(
    {
      reserva: true,
      transactionId,
      emitidoEn,
      nota:
        'Se estaba emitiendo un QR de pago asistido. Si este archivo quedó así, el banco pudo haber ' +
        'creado el QR sin que la respuesta llegara: consultalo con el oficial por este transactionId ' +
        'antes de borrar el archivo.',
    },
    null,
    2,
  )}\n`;
}

export function serializarEstado(estado: EstadoPagoAsistido): string {
  return `${JSON.stringify(estado, null, 2)}\n`;
}

/** Lee el archivo de estado. `null` si no tiene la forma esperada. */
export function leerEstado(texto: string): EstadoPagoAsistido | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof crudo !== 'object' || crudo === null) {
    return null;
  }
  const { qrId, transactionId, emitidoEn } = crudo as Record<string, unknown>;
  if (
    typeof qrId !== 'string' ||
    !ID_SEGURO.test(qrId) ||
    typeof transactionId !== 'string' ||
    transactionId.length === 0 ||
    transactionId.length > 30 ||
    typeof emitidoEn !== 'string' ||
    Number.isNaN(Date.parse(emitidoEn))
  ) {
    return null;
  }
  return { qrId, transactionId, emitidoEn };
}

export type Accion = 'CAPTURAR' | 'ESPERAR' | 'YA_ANULADO' | 'DESCONOCIDO';

/** Qué hacer con el QR según el estado que informa `statusQR`. */
export function accionSegunEstado(estado: number): Accion {
  switch (estado) {
    case ESTADO_QR.PAGADO:
      return 'CAPTURAR';
    case ESTADO_QR.ACTIVO:
      return 'ESPERAR';
    case ESTADO_QR.ANULADO:
      return 'YA_ANULADO';
    default:
      return 'DESCONOCIDO';
  }
}

/** Lo que devolvió el intento de anular el QR ya pagado. */
export type AnulacionDePagado =
  | { readonly ok: true }
  | { readonly ok: false; readonly tipo: string; readonly codigo: string | null };

export type Captura = {
  /** Pagos que trae `statusQR`, ya en centavos (los que no se pudieron leer, fuera). */
  readonly montosCentavos: readonly number[];
  readonly montoEsperadoCentavos: number;
  /** ¿El pago figura en el `paidQR` de su día? `null` si la consulta falló. */
  readonly enPaidQr: boolean | null;
  readonly anulacion: AnulacionDePagado;
  /** Estado que informa `statusQR` después de intentar anular. `null` si falló. */
  readonly estadoTrasAnular: number | null;
};

/**
 * Los hallazgos de la captura. Cada uno responde algo que solo un pago real
 * puede responder, y que la prueba en producción también mira (P5, P6, P9).
 */
export function hallazgosDelPago(c: Captura): readonly Hallazgo[] {
  const hallazgos: Hallazgo[] = [
    {
      pregunta: 'A2',
      titulo: 'Pago manual del banco sobre un QR de certificación',
      veredicto: 'CONFIRMADO',
      detalle:
        `\`statusQR\` informa el QR pagado con ${String(c.montosCentavos.length)} pago(s) en \`payment\`. ` +
        'El camino de pago end-to-end quedó capturado como fixture.',
    },
  ];

  const unico = c.montosCentavos.length === 1 ? c.montosCentavos[0] : undefined;
  hallazgos.push(
    unico === undefined
      ? {
          pregunta: 'V4',
          titulo: 'Forma de `payment` en un `statusQR` pagado',
          veredicto: 'NO_CONCLUYENTE',
          detalle:
            `Se esperaba exactamente un pago legible y hubo ${String(c.montosCentavos.length)}. ` +
            'Revisar la fixture `statusQR-pagado.json` antes de ajustar el adaptador.',
        }
      : {
          pregunta: 'V4',
          titulo: 'Monto del pago contra el del QR (`modifyAmount=false`)',
          veredicto: unico === c.montoEsperadoCentavos ? 'CONFIRMADO' : 'REFUTADO',
          detalle:
            unico === c.montoEsperadoCentavos
              ? 'El pago trae exactamente el monto del QR, en el formato que el adaptador ya lee.'
              : `El pago trae ${String(unico)} centavos y el QR era de ${String(c.montoEsperadoCentavos)}: ` +
                'o el banco no respetó el monto fijo o el adaptador lee mal el importe.',
        },
  );

  hallazgos.push({
    pregunta: 'D7',
    titulo: 'El pago figura en `paidQR` del día del pago',
    veredicto: c.enPaidQr === null ? 'NO_CONCLUYENTE' : c.enPaidQr ? 'CONFIRMADO' : 'REFUTADO',
    detalle:
      c.enPaidQr === null
        ? 'La consulta de `paidQR` falló: no se pudo comparar.'
        : c.enPaidQr
          ? 'El reporte diario trae el pago en el día que indica su fecha: el cierre diario lo va a encontrar.'
          : 'El reporte del día del pago **no** lo trae. El cierre diario no lo vería: hay que revisar ' +
            'cómo se calcula el día (hora de Bolivia, D7) antes de confiar en él.',
  });

  const anulado = c.estadoTrasAnular === ESTADO_QR.ANULADO;
  hallazgos.push({
    pregunta: 'C5',
    titulo: 'Anular un QR ya pagado',
    // Lo esperado es que el banco no lo anule. Si lo anula, un pago podría
    // dejar de verse en `statusQR`: eso sí rompe supuestos del adaptador.
    veredicto: anulado ? 'REFUTADO' : c.estadoTrasAnular === null ? 'NO_CONCLUYENTE' : 'CONFIRMADO',
    detalle:
      (c.anulacion.ok
        ? 'El banco **aceptó** la llamada a `cancelQR`. '
        : `El banco rechazó \`cancelQR\` (${c.anulacion.tipo}` +
          `${c.anulacion.codigo === null ? '' : `, responseCode ${c.anulacion.codigo}`}). `) +
      (c.estadoTrasAnular === null
        ? 'La re-consulta falló, así que no se sabe si el estado cambió.'
        : anulado
          ? 'Después `statusQR` informa **anulado**: un QR pagado se puede anular y el pago deja de verse ' +
            'por esa vía. El sistema no anula QRs pagados (consulta antes), pero hay que confirmarlo con el banco.'
          : `Después \`statusQR\` sigue informando ${String(c.estadoTrasAnular)}: el pago no se pierde.`),
  });

  return hallazgos;
}
