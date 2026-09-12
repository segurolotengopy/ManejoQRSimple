/**
 * La constancia de que el proveedor anuló un QR.
 *
 * Es un tipo marcado, como `ConciliacionAprobada`, y por la misma razón: la
 * máquina de estados exige una para soltar un QR que todavía se puede pagar,
 * así que no tiene que poder conseguirse sin haber anulado el QR de verdad.
 * La única forma de obtenerla es `anularEnProveedor()`, que hace la llamada
 * ella misma. Fabricarla exige pasarle un anulador falso: un acto deliberado,
 * no un descuido — que es todo lo que un tipo puede garantizar sobre un
 * efecto que ocurre fuera del programa.
 */

import { esExito, exito, type Resultado } from '../comun/resultado.js';
import type { QrEmitido } from './cobro.js';

declare const marcaAnulacion: unique symbol;

/** Prueba de que el proveedor anuló este QR: ya no se puede pagar. */
export type QrAnulado = {
  readonly [marcaAnulacion]: 'qr-anulado';
  readonly referenciaProveedor: string;
  readonly anuladoEn: Date;
};

/**
 * Lo único que hace falta del `QrProvider`. Se declara por su forma y no se
 * importa de los puertos porque los puertos ya dependen de este módulo, y la
 * regla de dependencias prohíbe los ciclos.
 */
export type Anulador<E> = {
  anular(referenciaProveedor: string): Promise<Resultado<void, E>>;
};

/** Anula el QR en el proveedor y, solo si lo logró, entrega la constancia. */
export async function anularEnProveedor<E>(
  anulador: Anulador<E>,
  qr: Pick<QrEmitido, 'referenciaProveedor'>,
  ahora: Date,
): Promise<Resultado<QrAnulado, E>> {
  const anulado = await anulador.anular(qr.referenciaProveedor);
  if (!esExito(anulado)) {
    return anulado;
  }
  return exito({ referenciaProveedor: qr.referenciaProveedor, anuladoEn: ahora } as QrAnulado);
}
