/**
 * `AvisosStore` sobre Firestore: `avisosConsumidor/{cobroId}`.
 *
 * Mismas garantías estructurales que el resto del paquete:
 *
 * - **El id del documento es el `cobroId`**, y se escribe con `create()`: un
 *   cobro confirmado encola un aviso y no más, y reintentar la confirmación no
 *   produce un segundo aviso ni reabre uno ya cerrado.
 * - **`pendiente` es un campo aparte** para poder consultar lo que falta
 *   entregar con un índice simple, igual que `abierto` en los abonos sin
 *   conciliar.
 *
 * El `cobroId` lo generamos nosotros (un UUID o `cons-<hexa>`), así que no
 * hace falta codificarlo para usarlo como id de documento.
 */

import {
  DESENLACES_AVISO,
  esExito,
  exito,
  fallo,
  type AvisoPendiente,
  type AvisosStore,
  type DesenlaceAviso,
  type ErrorPuerto,
  type Resultado,
} from '@mqs/qr-core';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const COLECCION_AVISOS = 'avisosConsumidor';

/** Código gRPC de Firestore para "el documento ya existe". */
const YA_EXISTE = 6;

const marcaDeTiempo = z.custom<Timestamp>((v) => v instanceof Timestamp, {
  message: 'se esperaba un Timestamp',
});

const avisoDoc = z.object({
  cobroId: z.string().min(1),
  consumidorId: z.string().min(1),
  encoladoEn: marcaDeTiempo,
  intentos: z.number().int().nonnegative(),
  proximoIntentoEn: marcaDeTiempo,
  ultimoError: z.string().nullable(),
  pendiente: z.boolean(),
  cerradoEn: marcaDeTiempo.nullable(),
  desenlace: z.enum(DESENLACES_AVISO).nullable(),
});

export class AvisosFirestore implements AvisosStore {
  constructor(private readonly db: Firestore) {}

  private ref(cobroId: string) {
    return this.db.collection(COLECCION_AVISOS).doc(cobroId);
  }

  async encolar(aviso: AvisoPendiente): Promise<Resultado<boolean, ErrorPuerto>> {
    try {
      await this.ref(aviso.cobroId).create({
        cobroId: aviso.cobroId,
        consumidorId: aviso.consumidorId,
        encoladoEn: Timestamp.fromDate(aviso.encoladoEn),
        intentos: aviso.intentos,
        proximoIntentoEn: Timestamp.fromDate(aviso.proximoIntentoEn),
        ultimoError: aviso.ultimoError,
        pendiente: aviso.cerradoEn === null,
        cerradoEn: aviso.cerradoEn === null ? null : Timestamp.fromDate(aviso.cerradoEn),
        desenlace: aviso.desenlace,
      });
      return exito(true);
    } catch (causa) {
      // Ya estaba: es el caso normal de una confirmación reintentada.
      return codigoDe(causa) === YA_EXISTE ? exito(false) : fallo(errorDeFirestore(causa, 'encolar'));
    }
  }

  async listarParaEnviar(
    ahora: Date,
    limite: number,
  ): Promise<Resultado<readonly AvisoPendiente[], ErrorPuerto>> {
    try {
      const snapshot = await this.db
        .collection(COLECCION_AVISOS)
        .where('pendiente', '==', true)
        .where('proximoIntentoEn', '<=', Timestamp.fromDate(ahora))
        .orderBy('proximoIntentoEn', 'asc')
        .limit(limite)
        .get();

      const avisos: AvisoPendiente[] = [];
      for (const doc of snapshot.docs) {
        const aviso = aAviso(doc.id, doc.data());
        if (!esExito(aviso)) {
          // Uno corrupto no se saltea: sería un aviso que nadie vuelve a mirar.
          return aviso;
        }
        avisos.push(aviso.valor);
      }
      return exito(avisos);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'listarParaEnviar'));
    }
  }

  /**
   * Cierra el aviso, **solo si sigue pendiente**. Dos procesos entregando el
   * mismo aviso a la vez no se pisan el desenlace: gana el primero, y el
   * segundo no reescribe la historia.
   */
  async cerrar(
    cobroId: string,
    desenlace: DesenlaceAviso,
    cerradoEn: Date,
  ): Promise<Resultado<void, ErrorPuerto>> {
    try {
      await this.db.runTransaction(async (tx) => {
        const ref = this.ref(cobroId);
        const actual = await tx.get(ref);
        const datos = actual.data() as { pendiente?: unknown } | undefined;
        if (!actual.exists || datos?.pendiente !== true) {
          return;
        }
        tx.update(ref, {
          pendiente: false,
          cerradoEn: Timestamp.fromDate(cerradoEn),
          desenlace,
        });
      });
      return exito(undefined);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'cerrar'));
    }
  }

  async registrarFallo(
    cobroId: string,
    error: string,
    proximoIntentoEn: Date,
  ): Promise<Resultado<void, ErrorPuerto>> {
    try {
      await this.db.runTransaction(async (tx) => {
        const ref = this.ref(cobroId);
        const actual = await tx.get(ref);
        const datos = actual.data() as { pendiente?: unknown; intentos?: unknown } | undefined;
        if (!actual.exists || datos?.pendiente !== true) {
          return;
        }
        const intentos = typeof datos.intentos === 'number' ? datos.intentos : 0;
        tx.update(ref, {
          intentos: intentos + 1,
          ultimoError: error,
          proximoIntentoEn: Timestamp.fromDate(proximoIntentoEn),
        });
      });
      return exito(undefined);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'registrarFallo'));
    }
  }

  async contarPendientes(): Promise<Resultado<number, ErrorPuerto>> {
    try {
      const snapshot = await this.db
        .collection(COLECCION_AVISOS)
        .where('pendiente', '==', true)
        .count()
        .get();
      return exito(snapshot.data().count);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'contarPendientes'));
    }
  }
}

function aAviso(id: string, datos: unknown): Resultado<AvisoPendiente, ErrorPuerto> {
  const validado = avisoDoc.safeParse(datos);
  if (!validado.success) {
    return fallo({
      tipo: 'RESPUESTA_INVALIDA',
      mensaje: `El aviso ${id} no tiene la forma esperada`,
      reintentable: false,
      codigoProveedor: null,
    });
  }
  const d = validado.data;
  return exito({
    cobroId: d.cobroId,
    consumidorId: d.consumidorId,
    encoladoEn: d.encoladoEn.toDate(),
    intentos: d.intentos,
    proximoIntentoEn: d.proximoIntentoEn.toDate(),
    ultimoError: d.ultimoError,
    cerradoEn: d.cerradoEn === null ? null : d.cerradoEn.toDate(),
    desenlace: d.desenlace,
  });
}

function codigoDe(causa: unknown): number | null {
  return typeof causa === 'object' && causa !== null && 'code' in causa && typeof causa.code === 'number'
    ? causa.code
    : null;
}

function errorDeFirestore(causa: unknown, operacion: string): ErrorPuerto {
  const codigo = codigoDe(causa);
  // UNAVAILABLE y DEADLINE_EXCEEDED: la próxima pasada del satélite reintenta.
  const esIndisponible = codigo === 14 || codigo === 4;
  return {
    tipo: esIndisponible ? 'INDISPONIBLE' : 'RESPUESTA_INVALIDA',
    mensaje: `Firestore falló en ${operacion} (avisos a consumidores)`,
    reintentable: esIndisponible,
    codigoProveedor: codigo === null ? null : String(codigo),
  };
}
