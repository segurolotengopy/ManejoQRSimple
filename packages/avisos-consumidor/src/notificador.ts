/**
 * `NotificadorConsumidor` sobre HTTP: arma el cuerpo, lo firma y lo entrega.
 *
 * Es el único lugar que sabe que el aviso viaja por HTTP y con qué forma. El
 * dominio solo conoce `AvisoDeConfirmacion` y tres desenlaces.
 *
 * Lo que este adaptador **no** hace, a propósito:
 *
 * - **No reintenta.** El reintento con espera creciente es del caso de uso,
 *   que tiene dónde anotar el estado entre pasadas. Reintentar acá dentro
 *   dejaría al satélite bloqueado en un consumidor caído.
 * - **No lee la respuesta.** Lo que el consumidor conteste en el cuerpo no
 *   nos interesa y no queremos que llegue a nuestra bitácora: alcanza con el
 *   código HTTP. Solo se consume y descarta para poder cerrar la conexión.
 */

import {
  exito,
  fallo,
  type AvisoDeConfirmacion,
  type ErrorPuerto,
  type NotificadorConsumidor,
  type Resultado,
} from '@mqs/qr-core';

import { CABECERA_FIRMA, firmar } from './firma.js';
import type { Destino } from './destinos.js';

/** Cuánto se espera al consumidor antes de darlo por caído. */
export const TIEMPO_LIMITE_MS = 10_000;

/** La forma exacta del cuerpo que recibe el consumidor (docs/10 §4.6). */
export function cuerpoDelAviso(aviso: AvisoDeConfirmacion): string {
  return JSON.stringify({
    evento: aviso.evento,
    idEvento: aviso.idEvento,
    cobro: {
      id: aviso.cobroId,
      referenciaExterna: aviso.referenciaExterna,
      estado: 'CONFIRMADO',
      // Decimal con punto, como en toda la API: nunca un número (regla #5).
      monto: aDecimal(aviso.montoCentavos),
      moneda: 'BOB',
      confirmadoEn: aviso.confirmadoEn.toISOString(),
      ocurridoEn: aviso.ocurridoEn?.toISOString() ?? null,
      riel: aviso.riel === null ? null : RIEL_PUBLICO[aviso.riel],
    },
  });
}

/** Los mismos nombres públicos que usa la API, no los internos del dominio. */
const RIEL_PUBLICO: Readonly<Record<'watcher-baneco' | 'scraper-yape', string>> = {
  'watcher-baneco': 'api-baneco',
  'scraper-yape': 'scraping-yape',
};

/** Centavos enteros a decimal con dos posiciones, por aritmética entera. */
function aDecimal(centavos: number): string {
  const entero = Math.trunc(centavos / 100);
  const resto = Math.abs(centavos % 100);
  return `${String(entero)}.${String(resto).padStart(2, '0')}`;
}

/** Lo mínimo de `fetch` que hace falta. Se inyecta para poder probar sin red. */
export type Transporte = (
  url: string,
  opciones: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

export class NotificadorHttp implements NotificadorConsumidor {
  constructor(
    private readonly destinos: ReadonlyMap<string, Destino>,
    private readonly reloj: () => Date = () => new Date(),
    private readonly transporte: Transporte = fetchComoTransporte,
    private readonly tiempoLimiteMs: number = TIEMPO_LIMITE_MS,
  ) {}

  async entregar(
    aviso: AvisoDeConfirmacion,
  ): Promise<Resultado<'ENTREGADO' | 'SIN_DESTINO', ErrorPuerto>> {
    const destino = this.destinos.get(aviso.consumidorId);
    if (destino === undefined) {
      // No es una falla: la mayoría de los consumidores consulta y no escucha.
      return exito('SIN_DESTINO');
    }

    const cuerpo = cuerpoDelAviso(aviso);
    const control = new AbortController();
    const corte = setTimeout(() => {
      control.abort();
    }, this.tiempoLimiteMs);

    try {
      const respuesta = await this.transporte(destino.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          [CABECERA_FIRMA]: firmar(cuerpo, destino.secreto, this.reloj()),
        },
        body: cuerpo,
        signal: control.signal,
      });
      // Se consume y se descarta: no queremos el cuerpo del consumidor cerca
      // de nuestros logs, pero sí cerrar la conexión.
      await respuesta.text().catch(() => '');

      if (respuesta.status >= 200 && respuesta.status < 300) {
        return exito('ENTREGADO');
      }
      // 4xx y 5xx se reintentan igual: un 404 puede ser un despliegue a medio
      // camino, y abandonar un aviso por un código es perderlo para siempre.
      // La espera creciente hace que un 4xx permanente cueste un intento diario.
      return fallo({
        tipo: respuesta.status >= 500 ? 'INDISPONIBLE' : 'RECHAZADO_POR_PROVEEDOR',
        mensaje: `El consumidor respondió HTTP ${String(respuesta.status)}`,
        reintentable: true,
        codigoProveedor: String(respuesta.status),
      });
    } catch {
      // Red caída, DNS, TLS o el corte por tiempo. El motivo exacto no se
      // transporta: viene de una excepción que puede traer cualquier cosa.
      return fallo({
        tipo: 'INDISPONIBLE',
        mensaje: 'No se pudo alcanzar al consumidor',
        reintentable: true,
        codigoProveedor: null,
      });
    } finally {
      clearTimeout(corte);
    }
  }
}

const fetchComoTransporte: Transporte = async (url, opciones) => {
  const respuesta = await fetch(url, opciones);
  return { status: respuesta.status, text: () => respuesta.text() };
};
