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
 * Ojo con la marca: puesta sobre datos sin cuenta, solo diría con qué cuenta
 * arrancó el proceso que la puso, no de quién son esos datos. La protección
 * real es que **`fijarCuentaDePrueba` no crea la marca** sobre un emulador con
 * datos sin cuenta (devuelve `SIN_MARCA_CON_DATOS`) salvo acción explícita del
 * dueño (`ATRIBUIR_DATOS_ANTERIORES_A`, que lee `composicion`). Esta función no
 * puede distinguir por sí sola una marca legítima de otra: en el documento se
 * ven igual, por eso no se debe llamar sin pasar por esa puerta.
 *
 * Solo agrega el campo que falta. No toca `estado`, ni la evidencia, ni el
 * historial de QRs (reglas #6 y #8), y no pisa un `cuentaCobro` que ya esté.
 * Es idempotente: una segunda corrida no encuentra nada que atribuir.
 */

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { COLECCION_ABONOS_SIN_CONCILIAR } from './abonos-sin-conciliar.js';
import { COLECCION_CONFIGURACION, DOC_CUENTA_DE_PRUEBA, esCuentaValida, marcaDoc } from './cuenta-de-prueba.js';
import { COLECCION_COBROS, ESTADOS_PENDIENTES } from './repositorio.js';

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

/** Lo que encontró `contarSinCuentaDeCobro`. */
export type ConteoSinCuenta =
  | {
      readonly tipo: 'CONTADO';
      /** Cobros cuya `cuentaCobro` no es un alias válido (falta, es `null`, vacía, un número…). */
      readonly cobros: number;
      /** Abonos sin conciliar en la misma situación. */
      readonly abonos: number;
      /** Cobros **pendientes** con un alias válido pero distinto del de este proceso. */
      readonly pendientesDeOtraCuenta: number;
    }
  | { readonly tipo: 'ERROR'; readonly detalle: string };

/**
 * Cuántos documentos quedarían fuera de la vigilancia de la cuenta `cuenta`.
 *
 * Solo lectura: no escribe nada. Existe para que quien arranca un proceso
 * pueda negarse si encuentra alguno. Un cobro pendiente cuya `cuentaCobro` no
 * sirve queda fuera de `listarPendientes(cuenta)`: sería un QR pagable que el
 * satélite dejó de vigilar sin ningún error (T10). Y el mapeo **no** lo avisa:
 * el filtro por cuenta lo deja afuera de la consulta antes de que se lea.
 *
 * Cuenta, por eso, **todo** documento cuya `cuentaCobro` no sea un texto que
 * cumpla `ALIAS_DE_CUENTA`: falta, `null`, vacía, un número, mayúsculas… Y,
 * aparte, los cobros en estado pendiente con un alias válido pero de otra
 * cuenta: hoy cada cuenta tiene su propia base, así que uno de otra cuenta
 * acá es una anomalía. **El bloque 4, con una base compartida entre cuentas,
 * tendrá que revisar esta regla**: ahí uno de otra cuenta será lo normal.
 *
 * Si Firestore falla devuelve `ERROR`, como `atribuirCuentaALoAnterior`: quien
 * arranca no debe soltar un stack trace ni seguir sin saber qué hay.
 */
export async function contarSinCuentaDeCobro(db: Firestore, cuenta: string): Promise<ConteoSinCuenta> {
  try {
    const cobros = await db.collection(COLECCION_COBROS).get();
    const abonos = await db.collection(COLECCION_ABONOS_SIN_CONCILIAR).get();
    let cobrosSinCuenta = 0;
    let pendientesDeOtraCuenta = 0;
    for (const doc of cobros.docs) {
      const valor: unknown = doc.get('cuentaCobro');
      if (!esCuentaValida(valor)) {
        cobrosSinCuenta += 1;
      } else if (valor !== cuenta && esPendiente(doc.get('estado'))) {
        pendientesDeOtraCuenta += 1;
      }
    }
    return {
      tipo: 'CONTADO',
      cobros: cobrosSinCuenta,
      abonos: abonos.docs.filter((doc) => !esCuentaValida(doc.get('cuentaCobro'))).length,
      pendientesDeOtraCuenta,
    };
  } catch (causa) {
    return { tipo: 'ERROR', detalle: causa instanceof Error ? causa.message : 'falló la consulta a Firestore' };
  }
}

const esPendiente = (estado: unknown): boolean =>
  typeof estado === 'string' && (ESTADOS_PENDIENTES as readonly string[]).includes(estado);
