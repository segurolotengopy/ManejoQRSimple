/**
 * Las cuatro operaciones de Cobros QR Simple (manual §§4–5).
 *
 * Cada respuesta pasa por Zod antes de salir de acá (regla #11), en dos pasos:
 * primero el **sobre** (`responseCode` / `message`), después la forma completa.
 * El orden importa — una respuesta de error del banco no trae los campos del
 * camino feliz, y validar la forma completa primero convertiría todo error del
 * banco en un genérico "respuesta inválida", perdiendo el `responseCode`.
 *
 * Todo `responseCode != 0` se trata como **error opaco**: se propaga el código
 * para la evidencia y el catálogo empírico (pregunta E1), pero no se ramifica
 * lógica de negocio sobre un catálogo que el banco todavía no documentó.
 */

import { esExito, exito, fallo, type ErrorPuerto, type Resultado } from '@mqs/qr-core';

import type { ProveedorDeToken } from '../auth/token.js';
import type { ConfigBaneco } from '../config.js';
import { aFechaCompacta } from '../mapeo.js';
import {
  respuestaEstadoQr,
  respuestaGenerarQr,
  respuestaPagosDelDia,
  sobreRespuesta,
  type PagoQr,
  type SolicitudGenerarQr,
} from '../schemas.js';
import { errorDeEstado, errorPuerto, type PeticionHttp, type Transporte } from './http.js';

export type ResultadoGenerarQr = {
  readonly qrId: string;
  readonly qrImageBase64: string | null;
};

export type EstadoDeQr = {
  readonly estado: number;
  readonly pagos: readonly PagoQr[];
};

export class ClienteBaneco {
  constructor(
    private readonly config: ConfigBaneco,
    private readonly transporte: Transporte,
    private readonly tokens: ProveedorDeToken,
  ) {}

  async generarQr(
    solicitud: SolicitudGenerarQr,
  ): Promise<Resultado<ResultadoGenerarQr, ErrorPuerto>> {
    const cuerpo = await this.autenticada('generateQR', {
      metodo: 'POST',
      url: `${this.config.baseUrl}/api/qrsimple/generateQR`,
      cuerpo: solicitud,
    });
    if (!esExito(cuerpo)) return cuerpo;

    const validada = respuestaGenerarQr.safeParse(cuerpo.valor);
    if (!validada.success) {
      return fallo(
        errorPuerto('RESPUESTA_INVALIDA', 'generateQR devolvió una forma inesperada', false),
      );
    }
    return exito({ qrId: validada.data.qrId, qrImageBase64: validada.data.qrImage ?? null });
  }

  async anularQr(qrId: string): Promise<Resultado<void, ErrorPuerto>> {
    const cuerpo = await this.autenticada('cancelQR', {
      metodo: 'DELETE',
      url: `${this.config.baseUrl}/api/qrsimple/cancelQR`,
      cuerpo: { qrId },
    });
    if (!esExito(cuerpo)) return cuerpo;
    return exito(undefined);
  }

  /**
   * Consulta autenticada del estado de un QR.
   *
   * **Esta es la fuente de verdad de un pago** (regla BANECO-1): el webhook del
   * banco, si algún día se habilita, solo dispara esta consulta.
   */
  async estadoQr(qrId: string): Promise<Resultado<EstadoDeQr, ErrorPuerto>> {
    const cuerpo = await this.autenticada('statusQR', {
      metodo: 'GET',
      url: `${this.config.baseUrl}/api/qrsimple/v2/statusQR/${encodeURIComponent(qrId)}`,
    });
    if (!esExito(cuerpo)) return cuerpo;

    const validada = respuestaEstadoQr.safeParse(cuerpo.valor);
    if (!validada.success) {
      return fallo(
        errorPuerto('RESPUESTA_INVALIDA', 'statusQR devolvió una forma inesperada', false),
      );
    }
    return exito({ estado: validada.data.estado, pagos: validada.data.pagos });
  }

  /** Pagos acreditados en una fecha, para el cierre diario. */
  async pagosDelDia(fecha: Date): Promise<Resultado<readonly PagoQr[], ErrorPuerto>> {
    const cuerpo = await this.autenticada('paidQR', {
      metodo: 'GET',
      url: `${this.config.baseUrl}/api/qrsimple/v2/paidQR/${aFechaCompacta(fecha)}`,
    });
    if (!esExito(cuerpo)) return cuerpo;

    const validada = respuestaPagosDelDia.safeParse(cuerpo.valor);
    if (!validada.success) {
      return fallo(errorPuerto('RESPUESTA_INVALIDA', 'paidQR devolvió una forma inesperada', false));
    }
    return exito(validada.data.paymentList ?? []);
  }

  /**
   * Ejecuta una petición autenticada y valida el sobre de la respuesta.
   *
   * Reintenta **una** vez ante 401, y una sola a propósito: si el banco sigue
   * rechazando con un token recién emitido, el problema son las credenciales, y
   * reintentar en bucle contra un usuario API que puede bloquearse por intentos
   * fallidos (pregunta B4) es peor que fallar rápido.
   */
  private async autenticada(
    operacion: string,
    peticion: Omit<PeticionHttp, 'token'>,
  ): Promise<Resultado<unknown, ErrorPuerto>> {
    const token = await this.tokens.obtener();
    if (!esExito(token)) return token;

    let respuesta = await this.transporte({ ...peticion, token: token.valor });
    if (!esExito(respuesta)) return respuesta;

    if (respuesta.valor.status === 401) {
      const nuevo = await this.tokens.renovar();
      if (!esExito(nuevo)) return nuevo;

      respuesta = await this.transporte({ ...peticion, token: nuevo.valor });
      if (!esExito(respuesta)) return respuesta;
    }

    if (respuesta.valor.status !== 200) {
      return fallo(errorDeEstado(respuesta.valor.status));
    }

    const sobre = sobreRespuesta.safeParse(respuesta.valor.cuerpo);
    if (!sobre.success) {
      return fallo(
        errorPuerto('RESPUESTA_INVALIDA', `${operacion}: falta el sobre responseCode/message`, false),
      );
    }
    if (sobre.data.responseCode !== 0) {
      return fallo(
        errorPuerto(
          'RECHAZADO_POR_PROVEEDOR',
          `${operacion} rechazado por el banco`,
          false,
          String(sobre.data.responseCode),
        ),
      );
    }

    return exito(respuesta.valor.cuerpo);
  }
}
