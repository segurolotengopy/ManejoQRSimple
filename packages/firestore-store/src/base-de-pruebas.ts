/**
 * La base compartida de las pruebas del emulador, con la guarda que impide
 * borrar sobre la base de la prueba en producción.
 *
 * Las pruebas `*.emulador.test.ts` limpian colecciones enteras entre un caso y
 * otro. Si el emulador al que apuntan es el de la prueba real (cobros con QRs
 * reales), esa limpieza borraría plata. La guarda mira la marca
 * `configuracion/cuentaDePrueba` **una sola vez, antes de borrar nada**, y la
 * limpieza queda atada a que esa verificación haya pasado: aunque la guarda
 * falle (y `beforeAll` lance), el `afterAll` de Vitest igual corre, y no puede
 * borrar nada —ni la marca— si no hubo verificación. Es un solo código para los
 * tres archivos de pruebas: tres copias terminarían divergiendo.
 *
 * No es una pieza de producción: ningún proceso la usa.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { COLECCION_ABONOS_SIN_CONCILIAR } from './abonos-sin-conciliar.js';
import { COLECCION_CONFIGURACION, DOC_CUENTA_DE_PRUEBA, leerPresenciaDeMarca } from './cuenta-de-prueba.js';
import { COLECCION_COBROS } from './repositorio.js';
import { COLECCION_ABONOS } from './watcher-abonos.js';

/** Las colecciones que las pruebas del emulador crean y limpian. */
const COLECCIONES_DE_DATOS = [COLECCION_COBROS, COLECCION_ABONOS, COLECCION_ABONOS_SIN_CONCILIAR] as const;

export class BaseDeEmuladorDePruebas {
  /** Solo se pone en `true` al final de `verificar()`, después de la guarda. */
  private verificada = false;

  constructor(private readonly db: Firestore) {}

  /**
   * La guarda: lanza si la base trae la marca de la prueba en producción o si
   * no se pudo comprobar. Sin valores en el mensaje.
   */
  async verificar(): Promise<void> {
    const presencia = await leerPresenciaDeMarca(this.db);
    if (presencia.tipo !== 'AUSENTE') {
      throw new Error(
        'La base de este emulador tiene la marca de la prueba en producción, o no se pudo comprobar: ' +
          'estas pruebas borran datos y no corren sobre ella.',
      );
    }
    this.verificada = true;
  }

  /**
   * Borra los datos de las pruebas y la marca que las propias pruebas pudieron
   * crear. No hace nada —y lo dice— si la guarda no pasó. Devuelve si limpió.
   */
  async limpiar(): Promise<boolean> {
    if (!this.verificada) {
      return false;
    }
    for (const coleccion of COLECCIONES_DE_DATOS) {
      await this.db.recursiveDelete(this.db.collection(coleccion));
    }
    await this.borrarMarca();
    return true;
  }

  /**
   * El cierre (`afterAll`): deja sin la marca que las pruebas hayan creado, para
   * que el archivo siguiente pase su propia guarda. Solo el documento de la
   * marca, no la colección entera, y solo si la guarda pasó.
   */
  async cerrar(): Promise<boolean> {
    if (!this.verificada) {
      return false;
    }
    await this.borrarMarca();
    return true;
  }

  private async borrarMarca(): Promise<void> {
    await this.db.collection(COLECCION_CONFIGURACION).doc(DOC_CUENTA_DE_PRUEBA).delete();
  }
}
