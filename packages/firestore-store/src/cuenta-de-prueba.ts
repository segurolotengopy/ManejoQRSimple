/**
 * La marca de cuenta del emulador de la prueba: `configuracion/cuentaDePrueba`.
 *
 * Cada cuenta de cobro corre la prueba con **sus** credenciales y **sus** datos
 * (`docs/Integraciones/baneco/03-prueba-en-produccion.md` §2). Si la API o el
 * satélite arrancan con las credenciales de una cuenta sobre los datos de otra,
 * el satélite le pregunta al banco equivocado por QRs que no son suyos: los
 * cobros quedan con error, el cierre diario no ata nada y todo eso parece un
 * hallazgo del banco cuando es una terminal mal arrancada.
 *
 * Que no pase no se deja a la disciplina: el primer proceso que toca un
 * emulador vacío lo **marca** con el alias de la cuenta, y desde ahí cualquier
 * proceso con otro alias se niega a arrancar. La marca es el alias —un rótulo,
 * `prod` o `sucursal-2`—, nunca el número de cuenta ni el usuario API: en
 * Firestore no entra dato bancario (regla #4).
 */

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const COLECCION_CONFIGURACION = 'configuracion';
export const DOC_CUENTA_DE_PRUEBA = 'cuentaDePrueba';

export type MarcaDeCuenta =
  /** El emulador estaba sin marcar: queda marcado con este alias. */
  | { readonly tipo: 'MARCADA'; readonly cuenta: string }
  /** Ya estaba marcado con este mismo alias: se sigue. */
  | { readonly tipo: 'COINCIDE'; readonly cuenta: string }
  /** Los datos son de otra cuenta. Nadie arranca. */
  | { readonly tipo: 'CONFLICTO'; readonly cuenta: string; readonly guardada: string }
  | { readonly tipo: 'ERROR'; readonly detalle: string };

const marcaDoc = z.object({
  cuenta: z.string().min(1),
  desde: z.custom<Timestamp>((v) => v instanceof Timestamp, { message: 'se esperaba un Timestamp' }),
});

/**
 * Deja la marca si no había, y la compara si ya estaba. En una transacción: dos
 * procesos que arrancan a la vez sobre un emulador recién creado no pueden
 * marcarlo con alias distintos.
 */
export async function fijarCuentaDePrueba(
  db: Firestore,
  cuenta: string,
  ahora: Date,
): Promise<MarcaDeCuenta> {
  const ref = db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA);
  try {
    return await db.runTransaction<MarcaDeCuenta>(async (tx) => {
      const actual = await tx.get(ref);
      if (!actual.exists) {
        tx.create(ref, { cuenta, desde: Timestamp.fromDate(ahora) });
        return { tipo: 'MARCADA', cuenta };
      }
      const validado = marcaDoc.safeParse(actual.data());
      if (!validado.success) {
        // Una marca ilegible no se pisa: puede ser de una versión futura, y
        // arrancar igual es justamente lo que esta barrera evita.
        return { tipo: 'ERROR', detalle: 'la marca de cuenta del emulador no tiene la forma esperada' };
      }
      return validado.data.cuenta === cuenta
        ? { tipo: 'COINCIDE', cuenta }
        : { tipo: 'CONFLICTO', cuenta, guardada: validado.data.cuenta };
    });
  } catch (causa) {
    return { tipo: 'ERROR', detalle: causa instanceof Error ? causa.message : 'falló la consulta a Firestore' };
  }
}

/** El texto que se le muestra al dueño cuando la marca no coincide. */
export function explicarMarca(marca: MarcaDeCuenta): string | null {
  switch (marca.tipo) {
    case 'MARCADA':
    case 'COINCIDE':
      return null;
    case 'CONFLICTO':
      return (
        `Los datos de este emulador son de la cuenta «${marca.guardada}» y este proceso arrancó ` +
        `con CUENTA=${marca.cuenta}.\n` +
        `  Cada cuenta de cobro tiene sus credenciales y sus datos: mezclarlas hace que se le\n` +
        `  pregunte al banco por QRs que no son de esa cuenta.\n` +
        `  Arrancá las cuatro terminales con el mismo CUENTA=${marca.guardada}, o levantá el\n` +
        `  emulador de la otra cuenta (docs/Integraciones/baneco/03-prueba-en-produccion.md §2).`
      );
    case 'ERROR':
      return `No se pudo verificar de qué cuenta son los datos del emulador: ${marca.detalle}`;
  }
}
