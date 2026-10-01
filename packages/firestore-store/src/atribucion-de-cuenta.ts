/**
 * Atribuye a una cuenta de cobro los datos anteriores a que el cobro llevara
 * `cuentaCobro`.
 *
 * Hasta este cambio la atribución era puramente física: un emulador por cuenta,
 * protegido por la marca de `cuenta-de-prueba.ts`. Esa marca es lo único que
 * dice de qué cuenta son los datos, y por eso es lo único que autoriza esta
 * migración: si el emulador no tiene marca, o la marca es de otra cuenta, **no
 * se escribe nada**. Atribuir por suposición sería inventar un dato.
 *
 * Solo agrega el campo que falta. No toca `estado`, ni la evidencia, ni el
 * historial de QRs (reglas #6 y #8), y no pisa un `cuentaCobro` que ya esté.
 * Es idempotente: una segunda corrida no encuentra nada que atribuir.
 */

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { COLECCION_ABONOS_SIN_CONCILIAR } from './abonos-sin-conciliar.js';
import { COLECCION_CONFIGURACION, DOC_CUENTA_DE_PRUEBA, marcaDoc } from './cuenta-de-prueba.js';
import { COLECCION_COBROS } from './repositorio.js';

export type AtribucionDeCuenta =
  /** Hecha: cuántos cobros y abonos recibieron la cuenta en esta corrida. */
  | { readonly tipo: 'HECHA'; readonly cobros: number; readonly abonos: number }
  /** El emulador no tiene marca de cuenta: no hay con qué atribuir. */
  | { readonly tipo: 'SIN_MARCA' }
  /** Los datos son de otra cuenta: no se les agrega esta. */
  | { readonly tipo: 'MARCA_DE_OTRA_CUENTA'; readonly guardada: string }
  | { readonly tipo: 'ERROR'; readonly detalle: string };

export async function atribuirCuentaALoAnterior(db: Firestore, cuenta: string): Promise<AtribucionDeCuenta> {
  try {
    const marca = await db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA).get();
    if (!marca.exists) {
      return { tipo: 'SIN_MARCA' };
    }
    const validada = marcaDoc.safeParse(marca.data());
    if (!validada.success) {
      return { tipo: 'ERROR', detalle: 'la marca de cuenta del emulador no tiene la forma esperada' };
    }
    if (validada.data.cuenta !== cuenta) {
      return { tipo: 'MARCA_DE_OTRA_CUENTA', guardada: validada.data.cuenta };
    }

    const cobros = await atribuirColeccion(db, COLECCION_COBROS, cuenta);
    const abonos = await atribuirColeccion(db, COLECCION_ABONOS_SIN_CONCILIAR, cuenta);
    return { tipo: 'HECHA', cobros, abonos };
  } catch (causa) {
    return { tipo: 'ERROR', detalle: causa instanceof Error ? causa.message : 'falló la consulta a Firestore' };
  }
}

/** Cuántos documentos de la colección recibieron la cuenta. */
async function atribuirColeccion(db: Firestore, coleccion: string, cuenta: string): Promise<number> {
  const snapshot = await db.collection(coleccion).get();
  let atribuidos = 0;
  for (const doc of snapshot.docs) {
    if (doc.get('cuentaCobro') !== undefined) {
      continue;
    }
    if (await atribuirDocumento(db, doc.ref, cuenta)) {
      atribuidos += 1;
    }
  }
  return atribuidos;
}

/**
 * Vuelve a leer dentro de la transacción: si entre la lectura y la escritura
 * otro proceso le puso cuenta, no se la pisa.
 */
async function atribuirDocumento(db: Firestore, ref: DocumentReference, cuenta: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists || actual.get('cuentaCobro') !== undefined) {
      return false;
    }
    tx.update(ref, { cuentaCobro: cuenta });
    return true;
  });
}

/**
 * Cuántos cobros y abonos sin conciliar **no tienen el campo** `cuentaCobro`.
 *
 * Solo lectura: no escribe nada. Existe para que quien arranca un proceso
 * pueda negarse si queda alguno. Un cobro pendiente sin cuenta queda fuera de
 * `listarPendientes(cuenta)`: sería un QR pagable que el satélite dejó de
 * vigilar sin ningún error (T10). Un documento con el campo presente, aunque
 * sea inválido, no cuenta: ese lo reporta el mapeo al leerlo.
 */
export async function contarSinCuentaDeCobro(
  db: Firestore,
): Promise<{ readonly cobros: number; readonly abonos: number }> {
  return {
    cobros: await contarSinCuenta(db, COLECCION_COBROS),
    abonos: await contarSinCuenta(db, COLECCION_ABONOS_SIN_CONCILIAR),
  };
}

async function contarSinCuenta(db: Firestore, coleccion: string): Promise<number> {
  const snapshot = await db.collection(coleccion).get();
  return snapshot.docs.filter((doc) => doc.get('cuentaCobro') === undefined).length;
}
