/**
 * `MessagingProvider` del satélite — **provisorio y explícito**.
 *
 * `wa-bridge` todavía no está implementado: `docs/ESTADO.md` (decisión 7) deja
 * asentado que hay que verificar la API pública real de WhatsAppModular antes
 * de escribirlo, y no se inventa un contrato.
 *
 * La tentación era pasar el mock en memoria de `qr-core` y seguir. Sería peor:
 * el mock devuelve éxito, así que el satélite creería haber avisado al cliente
 * y nadie se enteraría de que la confirmación nunca salió. Este proveedor
 * **falla a propósito**, con un error que dice exactamente por qué.
 *
 * No rompe nada: `verificarPago` trata el aviso al cliente como cortesía, no
 * como parte de la confirmación. El cobro se confirma igual y el fallo del
 * aviso queda registrado.
 */

import { fallo, type Cobro, type ErrorPuerto, type MessagingProvider, type QrEmitido, type ReferenciaMensaje, type Resultado } from '@mqs/qr-core';

const NO_CONFIGURADO: ErrorPuerto = {
  tipo: 'INDISPONIBLE',
  mensaje:
    'wa-bridge todavía no está implementado: el cliente no recibe aviso automático. ' +
    'Ver docs/ESTADO.md, decisión 7.',
  // Reintentable: cuando wa-bridge exista, el mismo aviso va a salir sin que
  // haya que tocar nada acá.
  reintentable: true,
  codigoProveedor: null,
};

export class MensajeriaNoConfigurada implements MessagingProvider {
  /** Avisos que no se pudieron enviar, para que el satélite los reporte. */
  readonly pendientes: string[] = [];

  enviarQr(cobro: Cobro, _qr: QrEmitido): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>> {
    this.pendientes.push(`QR del cobro ${cobro.id}`);
    return Promise.resolve(fallo(NO_CONFIGURADO));
  }

  enviarConfirmacion(cobro: Cobro): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>> {
    this.pendientes.push(`confirmación del cobro ${cobro.id}`);
    return Promise.resolve(fallo(NO_CONFIGURADO));
  }
}
