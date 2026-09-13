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
import type { EstadoCobro } from '../cobro/estados.js';
import type { RegistroEvidencia } from '../cobro/maquina-estados.js';
import type { DeteccionDePago } from '../conciliacion/deteccion.js';
import type { AbonoSinConciliar, ResolucionAbono } from '../revision/abono-sin-conciliar.js';

/**
 * Falla de un adaptador. Deliberadamente opaca: el dominio no interpreta
 * códigos del proveedor, solo distingue si puede reintentar.
 *
 * `codigoProveedor` se guarda como evidencia para construir el catálogo
 * empírico de errores del banco (pregunta E1), no para ramificar lógica.
 */
export type ErrorPuerto = {
  /**
   * `CONFLICTO`: el dato cambió entre que se leyó y se quiso escribir (otro
   * proceso lo modificó). No se reintenta a ciegas: hay que releer.
   */
  readonly tipo:
    | 'INDISPONIBLE'
    | 'RECHAZADO_POR_PROVEEDOR'
    | 'RESPUESTA_INVALIDA'
    | 'NO_AUTORIZADO'
    | 'CONFLICTO';
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
  /**
   * Guarda el cobro.
   *
   * Con `estadoEsperado`, solo escribe si el cobro guardado sigue en ese
   * estado —uno que todavía no existe cuenta como `BORRADOR`—; si no, falla
   * con `CONFLICTO` sin escribir. Es lo que usa toda transición: sin eso, el
   * dueño anulando un cobro que el satélite acaba de confirmar pisaría el
   * `CONFIRMADO` con su copia vieja. Sin `estadoEsperado` escribe siempre
   * (sembrar datos en tests y demos).
   */
  guardar(cobro: Cobro, estadoEsperado?: EstadoCobro): Promise<Resultado<void, ErrorPuerto>>;
  /**
   * Cobros que el watcher debe seguir mirando: los que esperan un pago
   * (`QR_ACTIVO`, `ENVIADO`, `COMPROBANTE_RECIBIDO`). `QR_ACTIVO` está porque
   * WhatsApp puede entregar el QR aunque reporte una falla, y porque su QR
   * también hay que anularlo al vencer. Es la pregunta del satélite, no la de
   * la consola.
   */
  listarPendientes(): Promise<Resultado<readonly Cobro[], ErrorPuerto>>;

  /**
   * Los cobros más recientes, en cualquier estado.
   *
   * Es la pregunta de la **consola**, y es distinta a propósito: un cobro recién
   * creado está en `QR_ACTIVO` y el watcher no lo mira todavía, pero quien lo
   * acaba de crear necesita verlo. Mezclar las dos preguntas en un solo método
   * dejaría a una de las dos mal servida.
   */
  listarRecientes(limite: number): Promise<Resultado<readonly Cobro[], ErrorPuerto>>;

  /**
   * Cobros en un estado dado, hasta `limite`. Es la pregunta de la cola de
   * revisión (`EN_REVISION`), que no puede depender de que el caso esté entre
   * los más recientes: un caso viejo es justamente el más urgente.
   */
  listarPorEstado(estado: EstadoCobro, limite: number): Promise<Resultado<readonly Cobro[], ErrorPuerto>>;

  /**
   * El cobro cuyo QR **vigente** tiene esta referencia del proveedor, en
   * cualquier estado. `null` si no hay ninguno.
   *
   * Es la pregunta de la conciliación diaria: el banco informa pagos por QR, y
   * un pago de un cobro ya confirmado no es un huérfano — es el caso normal.
   */
  buscarPorReferenciaQr(referenciaProveedor: string): Promise<Resultado<Cobro | null, ErrorPuerto>>;
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

/**
 * Abonos que el cierre diario no pudo atar a un cobro, hasta que una persona
 * los cierre.
 *
 * Sin `borrar`, por la misma razón que `EvidenceStore`: un abono cerrado sigue
 * guardado con su resolución, y un abono sin cerrar no desaparece por error.
 */
export interface AbonosSinConciliarStore {
  /**
   * Guarda un abono abierto. **Idempotente** por `idDeduplicacion`: si ya
   * existe, abierto o cerrado, no hace nada. Repetir el cierre de un día no
   * duplica el caso ni reabre uno que la persona ya cerró.
   */
  registrar(abono: AbonoSinConciliar): Promise<Resultado<void, ErrorPuerto>>;
  /** Los que siguen abiertos, hasta `limite`. */
  listarAbiertos(limite: number): Promise<Resultado<readonly AbonoSinConciliar[], ErrorPuerto>>;
  /**
   * Cierra un abono abierto con la resolución de la persona y lo devuelve.
   * `null` si no existe; `CONFLICTO` si ya estaba cerrado: una resolución no
   * se pisa con otra.
   */
  cerrar(
    idDeduplicacion: string,
    resolucion: ResolucionAbono,
  ): Promise<Resultado<AbonoSinConciliar | null, ErrorPuerto>>;
}
