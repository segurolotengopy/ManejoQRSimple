/**
 * `AbonosSinConciliarStore` sobre Firestore: `abonosSinConciliar/{id}`.
 *
 * Mismas garantías estructurales que el resto del paquete:
 *
 * - **El id del documento es la clave de deduplicación del banco**, y se
 *   escribe con `create()`: registrar dos veces el mismo abono es un no-op, y
 *   un abono ya cerrado no se reabre porque el cierre del día se repita.
 * - **Cerrar es una transacción** que solo escribe si el abono sigue abierto:
 *   dos pestañas cerrando el mismo abono no se pisan la resolución.
 *
 * El id se codifica con `encodeURIComponent` para usarlo como id de documento:
 * viene del banco, y un `/` en él abriría una subcolección.
 */

import {
  centavos,
  esExito,
  exito,
  fallo,
  MOTIVOS_ABONO_SIN_CONCILIAR,
  type AbonoSinConciliar,
  type AbonosSinConciliarStore,
  type ErrorPuerto,
  type ResolucionAbono,
  type Resultado,
} from '@mqs/qr-core';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const COLECCION_ABONOS_SIN_CONCILIAR = 'abonosSinConciliar';

/** Código gRPC de Firestore para "el documento ya existe". */
const YA_EXISTE = 6;

const marcaDeTiempo = z.custom<Timestamp>((v) => v instanceof Timestamp, {
  message: 'se esperaba un Timestamp',
});

/** Validado con Zod aunque lo escribamos nosotros (regla #11): sobrevive a versiones. */
const abonoDoc = z.object({
  idDeduplicacion: z.string().min(1),
  motivo: z.enum(MOTIVOS_ABONO_SIN_CONCILIAR),
  cobroId: z.string().min(1).nullable(),
  montoCentavos: z.number().int().nonnegative(),
  ocurridoEn: marcaDeTiempo,
  origen: z.enum(['watcher-baneco', 'scraper-yape']),
  registradoEn: marcaDeTiempo,
  /** Campo aparte para poder consultar los abiertos con un índice simple. */
  abierto: z.boolean(),
  resolucion: z.object({ motivo: z.string().min(1), resueltoEn: marcaDeTiempo }).nullable(),
});

export class AbonosSinConciliarFirestore implements AbonosSinConciliarStore {
  constructor(private readonly db: Firestore) {}

  private ref(idDeduplicacion: string) {
    return this.db.collection(COLECCION_ABONOS_SIN_CONCILIAR).doc(encodeURIComponent(idDeduplicacion));
  }

  async registrar(abono: AbonoSinConciliar): Promise<Resultado<void, ErrorPuerto>> {
    try {
      await this.ref(abono.idDeduplicacion).create({
        idDeduplicacion: abono.idDeduplicacion,
        motivo: abono.motivo,
        cobroId: abono.cobroId,
        montoCentavos: abono.montoCentavos,
        ocurridoEn: Timestamp.fromDate(abono.ocurridoEn),
        origen: abono.origen,
        registradoEn: Timestamp.fromDate(abono.registradoEn),
        abierto: abono.resolucion === null,
        resolucion:
          abono.resolucion === null
            ? null
            : { motivo: abono.resolucion.motivo, resueltoEn: Timestamp.fromDate(abono.resolucion.resueltoEn) },
      });
      return exito(undefined);
    } catch (causa) {
      // Ya estaba: es el caso normal de un cierre repetido, no una falla.
      return codigoDe(causa) === YA_EXISTE ? exito(undefined) : fallo(errorDeFirestore(causa, 'registrar'));
    }
  }

  async listarAbiertos(limite: number): Promise<Resultado<readonly AbonoSinConciliar[], ErrorPuerto>> {
    try {
      const snapshot = await this.db
        .collection(COLECCION_ABONOS_SIN_CONCILIAR)
        .where('abierto', '==', true)
        .limit(limite)
        .get();
      const abonos: AbonoSinConciliar[] = [];
      for (const doc of snapshot.docs) {
        const abono = aAbono(doc.id, doc.data());
        if (!esExito(abono)) {
          // Uno corrupto no se saltea: sería plata que desaparece de la cola.
          return abono;
        }
        abonos.push(abono.valor);
      }
      return exito(abonos);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'listarAbiertos'));
    }
  }

  async cerrar(
    idDeduplicacion: string,
    resolucion: ResolucionAbono,
  ): Promise<Resultado<AbonoSinConciliar | null, ErrorPuerto>> {
    const ref = this.ref(idDeduplicacion);
    try {
      const resultado = await this.db.runTransaction(async (tx) => {
        const actual = await tx.get(ref);
        if (!actual.exists) {
          return { tipo: 'NO_EXISTE' as const };
        }
        const abono = aAbono(actual.id, actual.data());
        if (!esExito(abono)) {
          return { tipo: 'INVALIDO' as const, error: abono.error };
        }
        if (abono.valor.resolucion !== null) {
          return { tipo: 'YA_CERRADO' as const };
        }
        tx.update(ref, {
          abierto: false,
          resolucion: { motivo: resolucion.motivo, resueltoEn: Timestamp.fromDate(resolucion.resueltoEn) },
        });
        return { tipo: 'CERRADO' as const, abono: { ...abono.valor, resolucion } };
      });

      switch (resultado.tipo) {
        case 'NO_EXISTE':
          return exito(null);
        case 'INVALIDO':
          return fallo(resultado.error);
        case 'YA_CERRADO':
          return fallo({
            tipo: 'CONFLICTO',
            mensaje: `El abono ${idDeduplicacion} ya estaba cerrado`,
            reintentable: false,
            codigoProveedor: null,
          });
        case 'CERRADO':
          return exito(resultado.abono);
      }
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'cerrar'));
    }
  }
}

function aAbono(id: string, datos: unknown): Resultado<AbonoSinConciliar, ErrorPuerto> {
  const validado = abonoDoc.safeParse(datos);
  const monto = validado.success ? centavos(validado.data.montoCentavos) : null;
  if (!validado.success || monto === null || !esExito(monto)) {
    return fallo({
      tipo: 'RESPUESTA_INVALIDA',
      mensaje: `El abono sin conciliar ${id} no tiene la forma esperada`,
      reintentable: false,
      codigoProveedor: null,
    });
  }
  const d = validado.data;
  return exito({
    idDeduplicacion: d.idDeduplicacion,
    motivo: d.motivo,
    cobroId: d.cobroId,
    montoCentavos: monto.valor,
    ocurridoEn: d.ocurridoEn.toDate(),
    origen: d.origen,
    registradoEn: d.registradoEn.toDate(),
    resolucion:
      d.resolucion === null ? null : { motivo: d.resolucion.motivo, resueltoEn: d.resolucion.resueltoEn.toDate() },
  });
}

function codigoDe(causa: unknown): number | null {
  return typeof causa === 'object' && causa !== null && 'code' in causa && typeof causa.code === 'number'
    ? causa.code
    : null;
}

function errorDeFirestore(causa: unknown, operacion: string): ErrorPuerto {
  const codigo = codigoDe(causa);
  // UNAVAILABLE y DEADLINE_EXCEEDED: el próximo cierre reintenta.
  const esIndisponible = codigo === 14 || codigo === 4;
  return {
    tipo: esIndisponible ? 'INDISPONIBLE' : 'RESPUESTA_INVALIDA',
    mensaje: `Firestore falló en ${operacion} (abonos sin conciliar)`,
    reintentable: esIndisponible,
    codigoProveedor: codigo === null ? null : String(codigo),
  };
}
