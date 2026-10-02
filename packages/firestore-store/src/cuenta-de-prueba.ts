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

import { esAliasDeCuenta } from '@mqs/qr-core';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { COLECCION_ABONOS_SIN_CONCILIAR } from './abonos-sin-conciliar.js';
import { COLECCION_COBROS } from './repositorio.js';
import { COLECCION_ABONOS } from './watcher-abonos.js';

export const COLECCION_CONFIGURACION = 'configuracion';
export const DOC_CUENTA_DE_PRUEBA = 'cuentaDePrueba';

export type MarcaDeCuenta =
  /** El emulador estaba sin marcar: queda marcado con este alias. */
  | { readonly tipo: 'MARCADA'; readonly cuenta: string }
  /** Ya estaba marcado con este mismo alias: se sigue. */
  | { readonly tipo: 'COINCIDE'; readonly cuenta: string }
  /** Los datos son de otra cuenta. Nadie arranca. */
  | { readonly tipo: 'CONFLICTO'; readonly cuenta: string; readonly guardada: string }
  /**
   * El emulador no tiene marca **y ya trae** cobros o abonos sin una cuenta de
   * cobro válida, y nadie autorizó explícitamente a marcarlo. No se creó
   * ninguna marca ni se escribió nada: una marca puesta ahora diría con qué
   * cuenta arrancó este proceso, no de quién son esos datos, y el siguiente
   * arranque —o el otro proceso que sube a la vez— los atribuiría en silencio.
   * Solo conteos: nunca ids ni contenido.
   */
  | {
      readonly tipo: 'SIN_MARCA_CON_DATOS';
      readonly cuenta: string;
      readonly cobros: number;
      readonly abonos: number;
    }
  | { readonly tipo: 'ERROR'; readonly detalle: string };

export const marcaDoc = z.object({
  cuenta: z.string().min(1),
  desde: z.custom<Timestamp>((v) => v instanceof Timestamp, { message: 'se esperaba un Timestamp' }),
});

/** ¿Este valor de `cuentaCobro` es un alias de cuenta válido? Todo lo demás es «sin cuenta». */
export const esCuentaValida = (valor: unknown): valor is string =>
  typeof valor === 'string' && esAliasDeCuenta(valor);

/**
 * Deja la marca si no había, y la compara si ya estaba. En una transacción: dos
 * procesos que arrancan a la vez sobre un emulador recién creado no pueden
 * marcarlo con alias distintos.
 *
 * **La marca no se crea sobre datos sin cuenta** salvo que quien llama lo
 * autorice (`permitirMarcarConDatos`, que sale de una acción explícita del
 * dueño). Es lo que impide que la marca autorice, por sí sola, atribuir datos
 * viejos: quien arranca primero la pondría con *su* cuenta y el siguiente
 * arranque, o el otro proceso que sube casi a la vez, los atribuiría en
 * silencio. La comprobación y la escritura van en la misma transacción —los
 * cobros y abonos se leen con `tx.get`—, así que dos procesos simultáneos no
 * pueden colarse entre una y otra.
 */
export async function fijarCuentaDePrueba(
  db: Firestore,
  cuenta: string,
  ahora: Date,
  permitirMarcarConDatos: boolean,
): Promise<MarcaDeCuenta> {
  const ref = db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA);
  try {
    return await db.runTransaction<MarcaDeCuenta>(async (tx) => {
      const actual = await tx.get(ref);
      if (!actual.exists) {
        if (!permitirMarcarConDatos) {
          // Todas las lecturas antes de cualquier escritura.
          const cobros = await tx.get(db.collection(COLECCION_COBROS));
          const abonos = await tx.get(db.collection(COLECCION_ABONOS_SIN_CONCILIAR));
          const sinCuentaCobros = cobros.docs.filter((d) => !esCuentaValida(d.get('cuentaCobro'))).length;
          const sinCuentaAbonos = abonos.docs.filter((d) => !esCuentaValida(d.get('cuentaCobro'))).length;
          if (sinCuentaCobros + sinCuentaAbonos > 0) {
            return { tipo: 'SIN_MARCA_CON_DATOS', cuenta, cobros: sinCuentaCobros, abonos: sinCuentaAbonos };
          }
        }
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

export type PresenciaDeMarca =
  | { readonly tipo: 'AUSENTE' }
  | { readonly tipo: 'PRESENTE' }
  | { readonly tipo: 'ERROR' };

/**
 * ¿Esta base tiene la marca de la prueba en producción?
 *
 * Es la lectura de los procesos que **no** son la prueba y no deben tocar una
 * base marcada: con adaptadores simulados confirmarían o anularían cobros que
 * el banco nunca vio. Por eso es deliberadamente más tosca que
 * `fijarCuentaDePrueba`: un solo `get()`, sin transacción y sin escribir nada,
 * y **todo documento que exista cuenta como presente**, tenga la forma que
 * tenga (una marca ilegible puede ser de una versión futura). Si la lectura
 * falla, el resultado es `ERROR` y quien llama no arranca (falla cerrada). El
 * error no lleva el mensaje de la causa: puede traer rutas o identificadores.
 */
export async function leerPresenciaDeMarca(db: Firestore): Promise<PresenciaDeMarca> {
  try {
    const marca = await db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA).get();
    return marca.exists ? { tipo: 'PRESENTE' } : { tipo: 'AUSENTE' };
  } catch {
    return { tipo: 'ERROR' };
  }
}

export type DatosSimulados =
  | { readonly tipo: 'OK'; readonly abonos: number; readonly cobros: number }
  | { readonly tipo: 'ERROR' };

/**
 * Cuántos datos de un proceso simulado hay en la base: los abonos de `abonos/*`
 * (los escribe el simulador) y los cobros cuyo QR vigente es `simulado`. Solo
 * conteos: nunca ids ni contenido. La prueba real no arranca sobre una base
 * donde esto no es cero (D2).
 */
export async function contarDatosSimulados(db: Firestore): Promise<DatosSimulados> {
  try {
    const [abonos, cobros] = await Promise.all([
      db.collection(COLECCION_ABONOS).count().get(),
      db.collection(COLECCION_COBROS).where('qrVigente.origen', '==', 'simulado').count().get(),
    ]);
    return { tipo: 'OK', abonos: abonos.data().count, cobros: cobros.data().count };
  } catch {
    return { tipo: 'ERROR' };
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
    case 'SIN_MARCA_CON_DATOS':
      return (
        `Hay ${String(marca.cobros)} cobro(s) y ${String(marca.abonos)} abono(s) anteriores sin cuenta de cobro ` +
        'en un emulador que no tiene marca de cuenta. No se creó ninguna marca ni se escribió nada: una marca ' +
        'puesta ahora diría con qué cuenta arrancó este proceso, no de quién son esos datos.\n' +
        '  Para decidir: respalde la carpeta del emulador y, solo si esos datos son de la cuenta ' +
        `«${marca.cuenta}», arranque una sola vez con ATRIBUIR_DATOS_ANTERIORES_A=${marca.cuenta}; ` +
        'o borre el emulador y empiece de cero.'
      );
    case 'ERROR':
      return `No se pudo verificar de qué cuenta son los datos del emulador: ${marca.detalle}`;
  }
}
