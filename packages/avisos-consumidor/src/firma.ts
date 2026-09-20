/**
 * La firma del aviso de confirmación (docs/10 §4.6).
 *
 * Un aviso llega a un servidor que no controlamos y le dice "te pagaron". Si
 * no fuera verificable, cualquiera que conozca la URL del consumidor podría
 * mandarle uno inventado y hacerle entregar lo que vendió. El mismo
 * razonamiento por el que el webhook del banco no confirma nada acá (T9),
 * aplicado a la dirección opuesta.
 *
 * El esquema es el mismo que este proyecto ya exige para el webhook entrante
 * de comprobantes (docs/06, T5): **HMAC-SHA256 sobre el cuerpo crudo**, con
 * comparación en tiempo constante del lado de quien recibe.
 *
 * La marca de tiempo va **dentro de lo firmado**, no solo en la cabecera: sin
 * eso, quien intercepte un aviso válido puede reenviarlo cuando quiera y la
 * firma sigue siendo buena. Con ella, el consumidor descarta lo viejo.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Nombre de la cabecera que lleva la firma. */
export const CABECERA_FIRMA = 'X-MQS-Firma';

/** Versión del esquema, en la firma misma: cambiarlo no rompe en silencio. */
const VERSION = 'v1';

/**
 * Arma el valor de la cabecera: `t=<segundos>,v1=<hexa>`.
 *
 * Lo firmado es `<t>.<cuerpo crudo>`. El punto separa dos campos que no lo
 * contienen —`t` son dígitos—, así que no hay dos entradas distintas que
 * produzcan la misma cadena firmada.
 */
export function firmar(cuerpoCrudo: string, secreto: string, ahora: Date): string {
  const t = Math.floor(ahora.getTime() / 1000);
  const firma = createHmac('sha256', secreto).update(`${String(t)}.${cuerpoCrudo}`, 'utf8').digest('hex');
  return `t=${String(t)},${VERSION}=${firma}`;
}

/**
 * Verifica una cabecera de firma. Es la contraparte de `firmar()`, y está acá
 * para que el consumidor tenga una implementación de referencia y para poder
 * probar las dos mitades juntas.
 *
 * `toleranciaSegundos` acota el reenvío de un aviso viejo interceptado.
 */
export function verificarFirma(
  cuerpoCrudo: string,
  cabecera: string,
  secreto: string,
  ahora: Date,
  toleranciaSegundos = 300,
): boolean {
  const partes = new Map(
    cabecera.split(',').map((p) => {
      const corte = p.indexOf('=');
      return corte === -1 ? ['', ''] : [p.slice(0, corte).trim(), p.slice(corte + 1).trim()];
    }),
  );
  const t = partes.get('t');
  const recibida = partes.get(VERSION);
  if (t === undefined || recibida === undefined || !/^\d+$/.test(t)) {
    return false;
  }

  const edad = Math.abs(Math.floor(ahora.getTime() / 1000) - Number(t));
  if (edad > toleranciaSegundos) {
    return false;
  }

  const esperada = createHmac('sha256', secreto).update(`${t}.${cuerpoCrudo}`, 'utf8').digest('hex');
  const a = Buffer.from(recibida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  // `===` cortaría en la primera diferencia y filtraría la firma correcta
  // carácter por carácter (regla #10).
  return a.length === b.length && timingSafeEqual(a, b);
}
