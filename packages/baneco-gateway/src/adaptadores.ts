/**
 * Los dos puertos del dominio, implementados sobre la API de Baneco.
 *
 * Acá termina el conocimiento de Baneco: hacia arriba solo salen `QrEmitido` y
 * `DeteccionDePago`, que son tipos del dominio. Ese es el punto de ADR-002 —
 * `qr-core` no sabe si detrás hay una API oficial o un scraper.
 */

import { createHash } from 'node:crypto';

import {
  aDecimalBob,
  esExito,
  exito,
  fallo,
  type DeteccionDePago,
  type ErrorPuerto,
  type PaymentWatcher,
  type QrEmitido,
  type QrProvider,
  type Resultado,
  type SolicitudQr,
} from '@mqs/qr-core';

import type { ClienteBaneco } from './client/qr.js';
import { errorPuerto } from './client/http.js';
import type { ConfigBaneco } from './config.js';
import { cifrar } from './crypto/aes.js';
import { aDeteccion, aFechaBaneco } from './mapeo.js';
import { ESTADO_QR, LIMITES, type PagoQr } from './schemas.js';

/**
 * Dónde guardar la imagen PNG que devuelve `generateQR`. Devuelve la referencia
 * con la que después se la encuentra (`imagenRef`), o `null` si no se pudo.
 *
 * Se inyecta porque dónde viven los archivos es cosa del proceso, no del
 * adaptador: la API del demo los deja en un directorio local fuera del repo; en
 * producción irían a Storage (docs/02 §3).
 */
export type AlmacenImagenQr = (qrId: string, pngBase64: string) => Promise<string | null>;

export class QrProviderBaneco implements QrProvider {
  constructor(
    private readonly config: ConfigBaneco,
    private readonly cliente: ClienteBaneco,
    private readonly reloj: () => Date = () => new Date(),
    private readonly almacen: AlmacenImagenQr | null = null,
  ) {}

  async emitir(solicitud: SolicitudQr): Promise<Resultado<QrEmitido, ErrorPuerto>> {
    const transactionId = solicitud.cobroId.slice(0, LIMITES.transactionId);
    const emitidoEn = this.reloj();

    const respuesta = await this.cliente.generarQr({
      transactionId,
      // La cuenta de abono viaja cifrada, siempre (manual §4.1, regla #4).
      accountCredit: cifrar(this.config.cuentaAbono.revelar(), this.config.llave),
      currency: 'BOB',
      // Centavos → decimal por aritmética entera, solo acá en el borde (regla #5).
      amount: aDecimalBob(solicitud.montoCentavos),
      description: solicitud.concepto.slice(0, LIMITES.description),
      dueDate: aFechaBaneco(solicitud.venceEn),
      // Cobro puntual por monto exacto: un solo pago, sin que el cliente pueda
      // cambiar el importe. Es lo que hace conciliable al cobro.
      singleUse: true,
      modifyAmount: false,
      ...(this.config.branchCode === null
        ? {}
        : { branchCode: this.config.branchCode.slice(0, LIMITES.branchCode) }),
    });

    if (!esExito(respuesta)) {
      return respuesta;
    }

    // La imagen nunca viaja inline por el dominio (docs/02 §3): se guarda por
    // fuera y el cobro lleva su referencia y su hash, para la integridad de la
    // evidencia. Si no se puede guardar, el QR igual existe en el banco: se
    // informa con `imagenRef: null` y quien lo muestra lo dice.
    const png = respuesta.valor.qrImageBase64;
    const imagenRef =
      png === null || this.almacen === null ? null : await this.almacen(respuesta.valor.qrId, png);
    const hashImagen =
      imagenRef === null || png === null
        ? null
        : createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');

    return exito({
      qrVersion: solicitud.qrVersion,
      referenciaProveedor: respuesta.valor.qrId,
      emitidoEn,
      venceEn: solicitud.venceEn,
      origen: 'api-baneco',
      imagenRef,
      hashImagen,
    });
  }

  /**
   * Anula el QR en el banco. **Idempotente**, como exige el puerto.
   *
   * El banco no lo es: en la prueba en producción (2026-09-13/14,
   * `02-hallazgos-produccion.md`) `cancelQR` respondió `responseCode 403` tanto
   * sobre un QR ya anulado como sobre uno pagado. El código solo no distingue
   * los dos casos, y confundirlos sería grave: dar por anulado un QR pagado
   * soltaría un cobro con plata recibida.
   *
   * Por eso, ante un rechazo del banco se le **pregunta el estado**: si
   * `statusQR` informa anulado, la anulación ya estaba hecha y es éxito; en
   * cualquier otro caso (pagado, activo, o la consulta falla) se devuelve el
   * rechazo original. Un error sin `responseCode` (HTTP, red) no se toca: ahí
   * el banco no dijo nada sobre el QR.
   */
  async anular(referenciaProveedor: string): Promise<Resultado<void, ErrorPuerto>> {
    const anulado = await this.cliente.anularQr(referenciaProveedor);
    if (esExito(anulado)) {
      return anulado;
    }
    if (anulado.error.tipo !== 'RECHAZADO_POR_PROVEEDOR' || anulado.error.codigoProveedor === null) {
      return anulado;
    }
    const estado = await this.cliente.estadoQr(referenciaProveedor);
    return esExito(estado) && estado.valor.estado === ESTADO_QR.ANULADO ? exito(undefined) : anulado;
  }
}

export class PaymentWatcherBaneco implements PaymentWatcher {
  constructor(private readonly cliente: ClienteBaneco) {}

  /**
   * Consulta autenticada del estado de un QR: la fuente de verdad del pago
   * (regla BANECO-1).
   *
   * Devuelve `null` cuando todavía no hay pago — eso no es una falla del
   * adaptador, y el contrato del puerto lo exige explícitamente.
   */
  async consultarCobro(
    referenciaProveedor: string,
  ): Promise<Resultado<DeteccionDePago | null, ErrorPuerto>> {
    const estado = await this.cliente.estadoQr(referenciaProveedor);
    if (!esExito(estado)) {
      return estado;
    }

    if (estado.valor.estado !== ESTADO_QR.PAGADO) {
      // Activo o anulado: no hay abono que conciliar.
      return exito(null);
    }

    const primero = estado.valor.pagos[0];
    if (primero === undefined) {
      // "Pagado" sin detalle del pago: contradictorio. No se inventa un abono.
      return fallo(
        errorPuerto('RESPUESTA_INVALIDA', 'statusQR informó pagado pero sin detalle del pago', false),
      );
    }

    return primeraDeteccion([primero]);
  }

  async listarAbonosDelDia(
    fecha: Date,
  ): Promise<Resultado<readonly DeteccionDePago[], ErrorPuerto>> {
    const pagos = await this.cliente.pagosDelDia(fecha);
    if (!esExito(pagos)) {
      return pagos;
    }

    const detecciones: DeteccionDePago[] = [];
    for (const pago of pagos.valor) {
      const deteccion = aDeteccion(pago);
      if (!esExito(deteccion)) {
        // Un pago que no mapea no se descarta en silencio: corta la
        // conciliación del día para que una persona lo mire (análisis §6.2).
        return fallo(
          errorPuerto(
            'RESPUESTA_INVALIDA',
            `un pago del día no se pudo interpretar (${deteccion.error.tipo})`,
            false,
          ),
        );
      }
      detecciones.push(deteccion.valor);
    }
    return exito(detecciones);
  }
}

function primeraDeteccion(pagos: readonly PagoQr[]): Resultado<DeteccionDePago | null, ErrorPuerto> {
  const primero = pagos[0];
  if (primero === undefined) {
    return exito(null);
  }
  const deteccion = aDeteccion(primero);
  if (!esExito(deteccion)) {
    return fallo(
      errorPuerto(
        'RESPUESTA_INVALIDA',
        `el pago informado no se pudo interpretar (${deteccion.error.tipo})`,
        false,
      ),
    );
  }
  return exito(deteccion.valor);
}
