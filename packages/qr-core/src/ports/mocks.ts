/**
 * Adaptadores en memoria (`INTEGRATION_MODE=mock`).
 *
 * Sirven para correr el demo sin tocar el banco ni WhatsApp, y para que los
 * tests de contrato tengan un sujeto de referencia: si un caso falla contra el
 * mock, el caso está mal escrito; si falla solo contra el adaptador real, el
 * adaptador está mal.
 *
 * Deliberadamente no simulan pagos por su cuenta: los abonos se cargan a mano
 * con `cargarAbono()`. Un watcher que inventa pagos es exactamente lo que este
 * dominio no puede tener.
 */

import { exito, type Resultado } from '../comun/resultado.js';
import type { Cobro, QrEmitido } from '../cobro/cobro.js';
import type { RegistroEvidencia } from '../cobro/maquina-estados.js';
import type { DeteccionDePago } from '../conciliacion/deteccion.js';
import type {
  CobroRepository,
  ErrorPuerto,
  EvidenceStore,
  MessagingProvider,
  PaymentWatcher,
  QrProvider,
  ReferenciaMensaje,
  SolicitudQr,
} from './puertos.js';

type Ok<T> = Promise<Resultado<T, ErrorPuerto>>;

export class QrProviderEnMemoria implements QrProvider {
  private secuencia = 0;
  private readonly anulados = new Set<string>();

  emitir(solicitud: SolicitudQr): Ok<QrEmitido> {
    this.secuencia += 1;
    const referencia = `mock-qr-${String(this.secuencia).padStart(6, '0')}`;
    return Promise.resolve(
      exito({
        qrVersion: solicitud.qrVersion,
        referenciaProveedor: referencia,
        emitidoEn: new Date(solicitud.venceEn.getTime() - 3_600_000),
        venceEn: solicitud.venceEn,
        origen: solicitud.origenEsperado,
        imagenRef: null,
        hashImagen: null,
      }),
    );
  }

  anular(referenciaProveedor: string): Ok<void> {
    // Idempotente a propósito: reintentar una anulación es normal.
    this.anulados.add(referenciaProveedor);
    return Promise.resolve(exito(undefined));
  }

  estaAnulado(referencia: string): boolean {
    return this.anulados.has(referencia);
  }
}

export class PaymentWatcherEnMemoria implements PaymentWatcher {
  private readonly porReferencia = new Map<string, DeteccionDePago>();
  private readonly porDia = new Map<string, DeteccionDePago[]>();

  /** Carga un abono a mano. El mock nunca inventa pagos. */
  cargarAbono(referenciaProveedor: string, deteccion: DeteccionDePago): void {
    this.porReferencia.set(referenciaProveedor, deteccion);
    const clave = claveDia(deteccion.ocurridoEn);
    const delDia = this.porDia.get(clave) ?? [];
    delDia.push(deteccion);
    this.porDia.set(clave, delDia);
  }

  consultarCobro(referenciaProveedor: string): Ok<DeteccionDePago | null> {
    return Promise.resolve(exito(this.porReferencia.get(referenciaProveedor) ?? null));
  }

  listarAbonosDelDia(fecha: Date): Ok<readonly DeteccionDePago[]> {
    return Promise.resolve(exito([...(this.porDia.get(claveDia(fecha)) ?? [])]));
  }
}

export type MensajeEnviado = {
  readonly cobroId: string;
  readonly tipo: 'qr' | 'confirmacion';
  readonly referencia: ReferenciaMensaje;
};

export class MessagingProviderEnMemoria implements MessagingProvider {
  private secuencia = 0;
  readonly enviados: MensajeEnviado[] = [];

  enviarQr(cobro: Cobro, _qr: QrEmitido): Ok<ReferenciaMensaje> {
    return Promise.resolve(exito(this.registrar(cobro.id, 'qr')));
  }

  enviarConfirmacion(cobro: Cobro): Ok<ReferenciaMensaje> {
    return Promise.resolve(exito(this.registrar(cobro.id, 'confirmacion')));
  }

  private registrar(cobroId: string, tipo: MensajeEnviado['tipo']): ReferenciaMensaje {
    this.secuencia += 1;
    const referencia = `mock-msg-${String(this.secuencia)}`;
    this.enviados.push({ cobroId, tipo, referencia });
    return referencia;
  }
}

export class CobroRepositoryEnMemoria implements CobroRepository {
  private readonly cobros = new Map<string, Cobro>();
  private readonly detecciones = new Map<string, string[]>();

  obtener(id: string): Ok<Cobro | null> {
    return Promise.resolve(exito(this.cobros.get(id) ?? null));
  }

  guardar(cobro: Cobro): Ok<void> {
    this.cobros.set(cobro.id, cobro);
    return Promise.resolve(exito(undefined));
  }

  listarPendientes(): Ok<readonly Cobro[]> {
    const pendientes = [...this.cobros.values()].filter(
      (c) => c.estado === 'ENVIADO' || c.estado === 'COMPROBANTE_RECIBIDO',
    );
    return Promise.resolve(exito(pendientes));
  }

  deteccionesAplicadas(cobroId: string): Ok<readonly string[]> {
    return Promise.resolve(exito([...(this.detecciones.get(cobroId) ?? [])]));
  }

  registrarDeteccionAplicada(cobroId: string, idDeduplicacion: string): void {
    const previas = this.detecciones.get(cobroId) ?? [];
    previas.push(idDeduplicacion);
    this.detecciones.set(cobroId, previas);
  }
}

export class EvidenceStoreEnMemoria implements EvidenceStore {
  private readonly registros: RegistroEvidencia[] = [];

  agregar(registro: RegistroEvidencia): Ok<void> {
    // Append y nada más: no hay forma de pisar ni de borrar (regla #8).
    this.registros.push(registro);
    return Promise.resolve(exito(undefined));
  }

  listarDeCobro(cobroId: string): Ok<readonly RegistroEvidencia[]> {
    return Promise.resolve(exito(this.registros.filter((r) => r.cobroId === cobroId)));
  }
}

function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
