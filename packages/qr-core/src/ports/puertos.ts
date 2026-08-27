/**
 * Puertos del dominio (docs/01 §2, ADR-002).
 *
 * El dominio define qué necesita del mundo; los adaptadores deciden cómo. La
 * consecuencia buscada: **el dominio no sabe si detrás de `PaymentWatcher` hay
 * un scraper o una API oficial**, y por eso migrar de uno a otro no toca
 * ninguna regla de negocio. Baneco es la primera prueba real de que funciona.
 *
 * Todos los métodos devuelven `Resultado`: un adaptador que habla con la red
 * falla seguido, y el dominio tiene que decidir qué hacer con esa falla en vez
 * de recibir una excepción que alguien se olvidó de atrapar.
 */

import type { Centavos } from '../comun/dinero.js';
import type { Resultado } from '../comun/resultado.js';
import type { Cobro, OrigenQr, QrEmitido } from '../cobro/cobro.js';
import type { RegistroEvidencia } from '../cobro/maquina-estados.js';
import type { DeteccionDePago } from '../conciliacion/deteccion.js';

/**
 * Falla de un adaptador. Deliberadamente opaca: el dominio no interpreta
 * códigos del proveedor, solo distingue si puede reintentar.
 *
 * `codigoProveedor` se guarda como evidencia para construir el catálogo
 * empírico de errores del banco (pregunta E1), no para ramificar lógica.
 */
export type ErrorPuerto = {
  readonly tipo: 'INDISPONIBLE' | 'RECHAZADO_POR_PROVEEDOR' | 'RESPUESTA_INVALIDA' | 'NO_AUTORIZADO';
  readonly mensaje: string;
  readonly reintentable: boolean;
  readonly codigoProveedor: string | null;
};

/** Datos para pedir un QR nuevo. La vigencia siempre es explícita (regla #6). */
export type SolicitudQr = {
  readonly cobroId: string;
  readonly montoCentavos: Centavos;
  readonly venceEn: Date;
  readonly concepto: string;
  /** Versión que tendrá el QR resultante. Renovar incrementa (regla #6). */
  readonly qrVersion: number;
  readonly origenEsperado: OrigenQr;
};

/**
 * Obtención y anulación del QR de cobro.
 *
 * Demo Baneco: `generateQR` / `cancelQR`. Demo Yape: carga asistida del QR que
 * genera el dueño (docs/03 §5).
 */
export interface QrProvider {
  emitir(solicitud: SolicitudQr): Promise<Resultado<QrEmitido, ErrorPuerto>>;
  /** Anula el QR en el proveedor. Debe ser idempotente ante doble llamada. */
  anular(referenciaProveedor: string): Promise<Resultado<void, ErrorPuerto>>;
}

/**
 * Detección de abonos. **Nunca confirma**: reporta candidatos que el dominio
 * concilia (reglas #1 y BANECO-1).
 *
 * Las dos formas de consulta corresponden a las dos capas de verificación:
 * la puntual por cobro (`statusQR`) y la conciliación del día (`paidQR`).
 */
export interface PaymentWatcher {
  /** Estado de un cobro puntual. `null` si todavía no hay abono. */
  consultarCobro(
    referenciaProveedor: string,
  ): Promise<Resultado<DeteccionDePago | null, ErrorPuerto>>;

  /** Abonos acreditados en una fecha, para el cierre diario. */
  listarAbonosDelDia(fecha: Date): Promise<Resultado<readonly DeteccionDePago[], ErrorPuerto>>;
}

/** Referencia del mensaje en el proveedor, para trazar la evidencia. */
export type ReferenciaMensaje = string;

/** Envío del QR al cliente y recepción de su comprobante. */
export interface MessagingProvider {
  enviarQr(cobro: Cobro, qr: QrEmitido): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>>;
  enviarConfirmacion(cobro: Cobro): Promise<Resultado<ReferenciaMensaje, ErrorPuerto>>;
}

/** Persistencia del cobro. Nada llama al SDK de Firestore fuera del adaptador. */
export interface CobroRepository {
  obtener(id: string): Promise<Resultado<Cobro | null, ErrorPuerto>>;
  guardar(cobro: Cobro): Promise<Resultado<void, ErrorPuerto>>;
  /** Cobros que el watcher debe seguir mirando. */
  listarPendientes(): Promise<Resultado<readonly Cobro[], ErrorPuerto>>;
  /**
   * Claves de deduplicación ya aplicadas a un cobro (regla #7).
   *
   * Se **deriva de la evidencia**, no se lleva en una lista aparte: cada
   * transición que involucró un abono ya registró su `idDeduplicacion`. Un
   * segundo lugar donde anotarlo sería un segundo lugar donde desincronizarse.
   */
  deteccionesAplicadas(cobroId: string): Promise<Resultado<readonly string[], ErrorPuerto>>;
}

/**
 * Evidencia append-only (regla #8).
 *
 * La interfaz **no tiene** `actualizar` ni `borrar`, y eso es a propósito: un
 * adaptador no puede ofrecer lo que el puerto no declara, así que la regla no
 * depende de que nadie escriba el método por descuido.
 */
export interface EvidenceStore {
  agregar(registro: RegistroEvidencia): Promise<Resultado<void, ErrorPuerto>>;
  listarDeCobro(cobroId: string): Promise<Resultado<readonly RegistroEvidencia[], ErrorPuerto>>;
}
