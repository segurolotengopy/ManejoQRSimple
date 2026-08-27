/**
 * `CobroRepository` y `EvidenceStore` sobre Firestore.
 *
 * Es el único paquete que conoce el SDK de Firebase (validado en CI). El
 * dominio ve interfaces; acá viven las colecciones, los `Timestamp` y los
 * códigos de error de Google.
 *
 * Dos garantías que se apoyan en el propio Firestore y no en nuestra
 * disciplina:
 *
 * - **`create()` en vez de `set()`** para la evidencia y el historial de QRs.
 *   `create()` falla si el documento ya existe, así que sobrescribir un
 *   registro de evidencia no es algo que haya que acordarse de no hacer: es
 *   algo que la base rechaza (reglas #6 y #8).
 * - **El id del documento es la clave natural.** Escribir dos veces el mismo
 *   abono es un no-op detectable, no un duplicado (regla #7, docs/05 §2).
 */

import { randomUUID } from 'node:crypto';

import {
  esExito,
  exito,
  fallo,
  type Cobro,
  type CobroRepository,
  type ErrorPuerto,
  type EvidenceStore,
  type RegistroEvidencia,
  type Resultado,
} from '@mqs/qr-core';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';

import {
  cobroADocumento,
  documentoACobro,
  documentoAEvidencia,
  evidenciaADocumento,
  idDeEvidencia,
  qrADocumento,
} from './mapeo.js';

export const COLECCION_COBROS = 'cobros';
export const SUBCOLECCION_QRS = 'qrs';
export const SUBCOLECCION_EVIDENCIA = 'evidencia';

/** Estados en los que el watcher todavía tiene que mirar el cobro. */
const ESTADOS_PENDIENTES = ['ENVIADO', 'COMPROBANTE_RECIBIDO'] as const;

/** Código gRPC de Firestore para "el documento ya existe". */
const YA_EXISTE = 6;

/**
 * Código gRPC del error, si lo trae. `unknown` de verdad: lo que sale de un
 * `catch` puede ser cualquier cosa, y `code` podría no ser ni número ni texto.
 */
function codigoDeError(causa: unknown): number | null {
  if (typeof causa !== 'object' || causa === null || !('code' in causa)) {
    return null;
  }
  const { code } = causa;
  return typeof code === 'number' ? code : null;
}

function comoErrorPuerto(causa: unknown, operacion: string): ErrorPuerto {
  const codigo = codigoDeError(causa);
  // UNAVAILABLE y DEADLINE_EXCEEDED: la próxima pasada del satélite reintenta.
  const esIndisponible = codigo === 14 || codigo === 4;
  return {
    tipo: esIndisponible ? 'INDISPONIBLE' : 'RESPUESTA_INVALIDA',
    mensaje: `Firestore falló en ${operacion}`,
    reintentable: esIndisponible,
    codigoProveedor: codigo === null ? null : String(codigo),
  };
}

function esYaExiste(causa: unknown): boolean {
  return codigoDeError(causa) === YA_EXISTE;
}

export class CobroRepositoryFirestore implements CobroRepository {
  constructor(private readonly db: Firestore) {}

  private get cobros(): CollectionReference {
    return this.db.collection(COLECCION_COBROS);
  }

  async obtener(id: string): Promise<Resultado<Cobro | null, ErrorPuerto>> {
    try {
      const doc = await this.cobros.doc(id).get();
      if (!doc.exists) {
        // Que no exista no es una falla: el contrato del puerto lo exige.
        return exito(null);
      }
      const cobro = documentoACobro(id, doc.data());
      if (!esExito(cobro)) {
        return fallo({
          tipo: 'RESPUESTA_INVALIDA',
          mensaje: `El documento del cobro ${id} no tiene la forma esperada: ${cobro.error.motivo}`,
          reintentable: false,
          codigoProveedor: null,
        });
      }
      return exito(cobro.valor);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'obtener'));
    }
  }

  /**
   * Guarda el estado del cobro y, si tiene QR vigente, lo agrega al historial.
   *
   * El historial usa `create()`: reguardar el mismo cobro no pisa la versión ya
   * escrita, y una versión que ya existía se ignora en silencio porque volver a
   * guardar es normal (el mismo cobro se guarda en cada transición).
   */
  async guardar(cobro: Cobro): Promise<Resultado<void, ErrorPuerto>> {
    try {
      const ref = this.cobros.doc(cobro.id);
      await ref.set(cobroADocumento(cobro));

      if (cobro.qrVigente !== null) {
        const qrRef = ref
          .collection(SUBCOLECCION_QRS)
          .doc(String(cobro.qrVigente.qrVersion).padStart(4, '0'));
        try {
          await qrRef.create(qrADocumento(cobro.qrVigente));
        } catch (causa) {
          if (!esYaExiste(causa)) {
            throw causa;
          }
        }
      }
      return exito(undefined);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'guardar'));
    }
  }

  async listarPendientes(): Promise<Resultado<readonly Cobro[], ErrorPuerto>> {
    try {
      const snapshot = await this.cobros.where('estado', 'in', [...ESTADOS_PENDIENTES]).get();
      const cobros: Cobro[] = [];
      for (const doc of snapshot.docs) {
        const cobro = documentoACobro(doc.id, doc.data());
        if (!esExito(cobro)) {
          // Un documento corrupto no se saltea en silencio: si el watcher
          // ignorara un cobro pendiente, nadie se enteraría de que dejó de
          // mirarlo.
          return fallo({
            tipo: 'RESPUESTA_INVALIDA',
            mensaje: `El cobro pendiente ${doc.id} no tiene la forma esperada: ${cobro.error.motivo}`,
            reintentable: false,
            codigoProveedor: null,
          });
        }
        cobros.push(cobro.valor);
      }
      return exito(cobros);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'listarPendientes'));
    }
  }

  /**
   * Detecciones ya conciliadas, derivadas de la evidencia (regla #7).
   *
   * No hay una lista paralela que mantener sincronizada: la evidencia ya
   * registró el `idDeduplicacion` de cada abono que llegó a conciliar.
   */
  async deteccionesAplicadas(cobroId: string): Promise<Resultado<readonly string[], ErrorPuerto>> {
    try {
      const snapshot = await this.cobros
        .doc(cobroId)
        .collection(SUBCOLECCION_EVIDENCIA)
        .where('evento', '==', 'PAGO_CONCILIADO')
        .get();

      const claves = snapshot.docs
        .map((d) => (d.data() as { datos?: Record<string, unknown> }).datos?.['idDeduplicacion'])
        .filter((v): v is string => typeof v === 'string');

      return exito(claves);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'deteccionesAplicadas'));
    }
  }
}

export class EvidenceStoreFirestore implements EvidenceStore {
  constructor(private readonly db: Firestore) {}

  /**
   * Agrega un registro. `create()` con un id único: append y nada más.
   *
   * La interfaz no declara `actualizar` ni `borrar`, y esta implementación
   * tampoco los podría ofrecer sin cambiar el puerto (regla #8).
   */
  async agregar(registro: RegistroEvidencia): Promise<Resultado<void, ErrorPuerto>> {
    try {
      const id = idDeEvidencia(registro, randomUUID());
      await this.db
        .collection(COLECCION_COBROS)
        .doc(registro.cobroId)
        .collection(SUBCOLECCION_EVIDENCIA)
        .doc(id)
        .create(evidenciaADocumento(registro));
      return exito(undefined);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'agregar evidencia'));
    }
  }

  async listarDeCobro(
    cobroId: string,
  ): Promise<Resultado<readonly RegistroEvidencia[], ErrorPuerto>> {
    try {
      // Los ids empiezan con el ISO del timestamp, así que ordenar por id
      // devuelve la cronología sin necesitar un índice compuesto.
      const snapshot = await this.db
        .collection(COLECCION_COBROS)
        .doc(cobroId)
        .collection(SUBCOLECCION_EVIDENCIA)
        .orderBy('__name__')
        .get();

      const registros: RegistroEvidencia[] = [];
      for (const doc of snapshot.docs) {
        const registro = documentoAEvidencia(doc.id, doc.data());
        if (!esExito(registro)) {
          return fallo({
            tipo: 'RESPUESTA_INVALIDA',
            mensaje: `El registro de evidencia ${doc.id} no tiene la forma esperada: ${registro.error.motivo}`,
            reintentable: false,
            codigoProveedor: null,
          });
        }
        registros.push(registro.valor);
      }
      return exito(registros);
    } catch (causa) {
      return fallo(comoErrorPuerto(causa, 'listar evidencia'));
    }
  }
}
