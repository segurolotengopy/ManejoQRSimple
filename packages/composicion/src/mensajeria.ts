/**
 * `MessagingProvider` provisorio — **falla a propósito**.
 *
 * `wa-bridge` no se puede implementar todavía, y no por falta de ganas: la API
 * real de WhatsAppModular no expone hoy un endpoint de mensajería genérica —
 * solo `/v1/otp/request` y `/v1/otp/verify`— y su webhook entrante no entiende
 * imágenes, así que el comprobante del cliente llegaría como `unsupported`.
 * Verificado el 2026-08-27; el detalle y las dos opciones para destrabarlo están
 * en `docs/04-integracion-whatsapp-modular.md` §2.
 *
 * La tentación es usar el mock en memoria de `qr-core` y seguir. Sería peor: el
 * mock devuelve éxito, así que el sistema creería haber avisado al cliente y
 * nadie se enteraría de que el mensaje nunca salió. Este proveedor falla con un
 * error que dice exactamente por qué, y lleva la cuenta de lo que quedó sin
 * enviar.
 *
 * No rompe nada: `verificarPago` trata el aviso al cliente como cortesía, no
 * como parte de la confirmación. El cobro se confirma igual.
 */

import {
  fallo,
  type Cobro,
  type ErrorPuerto,
  type MessagingProvider,
  type QrEmitido,
  type ReferenciaMensaje,
  type Resultado,
} from '@mqs/qr-core';

const NO_CONFIGURADO: ErrorPuerto = {
  tipo: 'INDISPONIBLE',
  mensaje:
    'wa-bridge no está implementado: WhatsAppModular todavía no expone mensajería ' +
    'genérica por HTTP. Ver docs/04 §2.',
  // Reintentable: el día que exista el endpoint, el mismo aviso sale sin tocar
  // nada de este lado.
  reintentable: true,
  codigoProveedor: null,
};

export class MensajeriaNoConfigurada implements MessagingProvider {
  /** Avisos que no se pudieron enviar, para que quien orquesta los reporte. */
  readonly pendientes: string[] = [];

  enviarQr(cobro: Cobro, _qr: QrEmitido): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>> {
    this.pendientes.push(`QR del cobro ${cobro.id}`);
    return Promise.resolve(fallo(NO_CONFIGURADO));
  }

  enviarConfirmacion(cobro: Cobro): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>> {
    this.pendientes.push(`confirmación del cobro ${cobro.id}`);
    return Promise.resolve(fallo(NO_CONFIGURADO));
  }

  /** Vacía y devuelve lo acumulado, para reportar una vez por pasada. */
  drenar(): readonly string[] {
    return this.pendientes.splice(0, this.pendientes.length);
  }
}
