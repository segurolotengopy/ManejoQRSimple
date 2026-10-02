/**
 * `PaymentWatcher` que lee los abonos de la colección `abonos/*` de Firestore.
 *
 * No es un mock: es el **lado lector** del diseño que `docs/05 §2` documenta
 * desde el principio — un proceso detecta abonos y los deja ahí, y el dominio
 * los consume. Ese productor es el `yape-scraper` cuando exista, y mientras
 * tanto el simulador de `tools/demo-local`, que permite ejercitar el sistema
 * entero sin banco.
 *
 * La deduplicación es estructural y no depende de este código: el id del
 * documento **es** la clave de deduplicación (regla #7, docs/05 §2), así que
 * escribir dos veces el mismo abono es un no-op, no un duplicado.
 *
 * Lo que este watcher **no** hace, igual que todos: confirmar. Reporta
 * candidatos; conciliar es del dominio.
 */

import {
  centavos,
  claveDelRiel,
  esExito,
  exito,
  fallo,
  ORIGENES_DETECCION,
  registrarDeteccion,
  type DeteccionDePago,
  type ErrorPuerto,
  type PaymentWatcher,
  type Resultado,
} from '@mqs/qr-core';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const COLECCION_ABONOS = 'abonos';

/**
 * El riel de toda detección que sale de `abonos/*`: simulado.
 *
 * Lo fija el adaptador y no el documento (D3): cualquiera que pueda escribir
 * en la colección —el simulador de `tools/demo-local`, un script, la consola
 * de Firebase— podría declarar `watcher-baneco` y hacerse pasar por el banco.
 * Con un origen fijo, un abono de acá solo puede pagar un QR simulado (regla
 * #1, `QRS_DEL_RIEL`). Cuando exista el riel Yape, necesitará su propio lector
 * con su propio origen, no este.
 */
export const ORIGEN_ABONOS = 'watcher-simulado' as const;

/**
 * Forma del documento de abono. Validada con Zod aunque la escribamos nosotros
 * (regla #11): un documento sobrevive a los despliegues y puede haberlo escrito
 * una versión anterior — o el scraper, que es otro proceso.
 */
const abonoDoc = z.object({
  /** `qrId` del proveedor: es lo que ata el abono a un cobro. */
  referenciaProveedor: z.string().min(1),
  montoCentavos: z.number().int().nonnegative(),
  ocurridoEn: z.custom<Timestamp>((v) => v instanceof Timestamp, {
    message: 'se esperaba un Timestamp',
  }),
  /**
   * Se valida y **se ignora**: el origen de una detección lo pone este
   * adaptador (`ORIGEN_ABONOS`), no el documento. Quien escribe en `abonos/*`
   * podría poner cualquier riel y falsificar el del banco.
   */
  origen: z.enum(ORIGENES_DETECCION).optional(),
  referencia: z.string().nullable(),
});

export class PaymentWatcherAbonosFirestore implements PaymentWatcher {
  constructor(private readonly db: Firestore) {}

  async consultarCobro(
    referenciaProveedor: string,
  ): Promise<Resultado<DeteccionDePago | null, ErrorPuerto>> {
    try {
      const snapshot = await this.db
        .collection(COLECCION_ABONOS)
        .where('referenciaProveedor', '==', referenciaProveedor)
        .get();

      // Sin `limit(1)`: un documento descartado (`esDelRiel`) no puede tapar a
      // uno válido que comparta la referencia.
      const doc = snapshot.docs.find((d) => esDelRiel(d.id));
      if (doc === undefined) {
        // Todavía no hay abono. No es una falla: el contrato del puerto lo exige.
        return exito(null);
      }
      return aDeteccion(doc.id, doc.data());
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'consultarCobro'));
    }
  }

  async listarAbonosDelDia(
    fecha: Date,
  ): Promise<Resultado<readonly DeteccionDePago[], ErrorPuerto>> {
    const inicio = new Date(fecha);
    inicio.setUTCHours(0, 0, 0, 0);
    const fin = new Date(inicio.getTime() + 86_400_000);

    try {
      const snapshot = await this.db
        .collection(COLECCION_ABONOS)
        .where('ocurridoEn', '>=', Timestamp.fromDate(inicio))
        .where('ocurridoEn', '<', Timestamp.fromDate(fin))
        .get();

      const detecciones: DeteccionDePago[] = [];
      for (const doc of snapshot.docs.filter((d) => esDelRiel(d.id))) {
        const deteccion = aDeteccion(doc.id, doc.data());
        if (!esExito(deteccion)) {
          return deteccion;
        }
        if (deteccion.valor !== null) {
          detecciones.push(deteccion.valor);
        }
      }
      return exito(detecciones);
    } catch (causa) {
      return fallo(errorDeFirestore(causa, 'listarAbonosDelDia'));
    }
  }
}

/**
 * ¿Este documento puede ser una detección **simulada**? No si su id es de la
 * forma de las claves del banco (`baneco:…`): el id del documento es la clave
 * de deduplicación, y un simulado que reclamara una clave real haría que el
 * abono del cierre del día —el del banco, con esa misma clave— contara como
 * «ya registrado» y no se atara a su cobro. Se descarta, no se devuelve.
 */
function esDelRiel(id: string): boolean {
  return claveDelRiel(ORIGEN_ABONOS, id);
}

function aDeteccion(id: string, datos: unknown): Resultado<DeteccionDePago | null, ErrorPuerto> {
  const validado = abonoDoc.safeParse(datos);
  if (!validado.success) {
    // Un abono con forma inesperada no se saltea: perder un abono en silencio
    // es peor que fallar ruidosamente.
    return fallo({
      tipo: 'RESPUESTA_INVALIDA',
      mensaje: `El abono ${id} no tiene la forma esperada`,
      reintentable: false,
      codigoProveedor: null,
    });
  }

  const monto = centavos(validado.data.montoCentavos);
  if (!esExito(monto)) {
    return fallo({
      tipo: 'RESPUESTA_INVALIDA',
      mensaje: `El abono ${id} tiene un monto inválido`,
      reintentable: false,
      codigoProveedor: null,
    });
  }

  return exito(
    registrarDeteccion({
      // El id del documento ES la clave de deduplicación (regla #7).
      idDeduplicacion: id,
      montoCentavos: monto.valor,
      ocurridoEn: validado.data.ocurridoEn.toDate(),
      origen: ORIGEN_ABONOS,
      referencia: validado.data.referencia,
    }),
  );
}

function errorDeFirestore(causa: unknown, operacion: string): ErrorPuerto {
  const codigo =
    typeof causa === 'object' && causa !== null && 'code' in causa && typeof causa.code === 'number'
      ? causa.code
      : null;
  const esIndisponible = codigo === 14 || codigo === 4;
  return {
    tipo: esIndisponible ? 'INDISPONIBLE' : 'RESPUESTA_INVALIDA',
    mensaje: `Firestore falló en ${operacion}`,
    reintentable: esIndisponible,
    codigoProveedor: codigo === null ? null : String(codigo),
  };
}
