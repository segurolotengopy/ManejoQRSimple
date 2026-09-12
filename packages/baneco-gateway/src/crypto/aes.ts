/**
 * Cifrado AES-256-CBC con IV antepuesto, como lo exige Baneco.
 *
 * Esquema: AES-256-CBC, padding PKCS7, IV aleatorio de 16 bytes **antepuesto**
 * al ciphertext, todo codificado en Base64. **Confirmado** (2026-09-12) con el
 * vector oficial de la especificación v1.3.0 §5.1: este módulo descifra el
 * ejemplo del banco al texto esperado. El vector no se versiona porque lleva la
 * llave de certificación (ver `01-preguntas-al-banco.md`, nota B2).
 *
 * El banco sugirió usar su endpoint utilitario de cifrado (B2). No se usa en
 * operación: recibe el texto plano y la llave en la query string, que es lo que
 * terminan registrando proxies y logs de acceso.
 *
 * Se implementa con `node:crypto` y sin librerías nuevas. El IV sale de
 * `crypto.randomBytes()`, nunca de `Math.random()` (regla #10): un IV
 * predecible en CBC filtra información sobre el texto plano.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { exito, fallo, type Resultado } from '@mqs/qr-core';

const ALGORITMO = 'aes-256-cbc';
const BYTES_IV = 16;
const BYTES_LLAVE = 32;

export type ErrorCifrado =
  | { readonly tipo: 'LLAVE_INVALIDA'; readonly bytes: number }
  | { readonly tipo: 'PAYLOAD_INVALIDO'; readonly motivo: string };

/**
 * Llave AES validada. Marcada nominalmente para que no se pueda pasar un
 * string cualquiera donde va la llave del banco.
 */
declare const marcaLlave: unique symbol;
export type LlaveAes = Buffer & { readonly [marcaLlave]: 'llave-aes' };

/**
 * Valida y envuelve la llave del banco (32 caracteres ASCII = 32 bytes).
 *
 * Nunca registres el valor devuelto: es la llave en claro. El tipo existe
 * justamente para que se note cuando algo la está manipulando.
 */
export function llaveAes(llaveAscii: string): Resultado<LlaveAes, ErrorCifrado> {
  const buffer = Buffer.from(llaveAscii, 'utf8');
  if (buffer.length !== BYTES_LLAVE) {
    return fallo({ tipo: 'LLAVE_INVALIDA', bytes: buffer.length });
  }
  return exito(buffer as LlaveAes);
}

/** Cifra texto plano. Cada llamada usa un IV nuevo, así que la salida varía. */
export function cifrar(textoPlano: string, llave: LlaveAes): string {
  const iv = randomBytes(BYTES_IV);
  const cipher = createCipheriv(ALGORITMO, llave, iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cifrado]).toString('base64');
}

/** Descifra un payload `Base64(IV || ciphertext)`. */
export function descifrar(payloadBase64: string, llave: LlaveAes): Resultado<string, ErrorCifrado> {
  let combinado: Buffer;
  try {
    combinado = Buffer.from(payloadBase64, 'base64');
  } catch {
    return fallo({ tipo: 'PAYLOAD_INVALIDO', motivo: 'no es Base64' });
  }

  if (combinado.length <= BYTES_IV) {
    return fallo({ tipo: 'PAYLOAD_INVALIDO', motivo: 'más corto que el IV' });
  }
  if ((combinado.length - BYTES_IV) % BYTES_IV !== 0) {
    return fallo({ tipo: 'PAYLOAD_INVALIDO', motivo: 'longitud no múltiplo del bloque' });
  }

  const iv = combinado.subarray(0, BYTES_IV);
  const cifrado = combinado.subarray(BYTES_IV);

  try {
    const decipher = createDecipheriv(ALGORITMO, llave, iv);
    const plano = Buffer.concat([decipher.update(cifrado), decipher.final()]);
    return exito(plano.toString('utf8'));
  } catch {
    // Llave equivocada o payload corrupto: el padding no valida. No se
    // distingue una causa de la otra a propósito.
    return fallo({ tipo: 'PAYLOAD_INVALIDO', motivo: 'no descifra con esta llave' });
  }
}

/**
 * Compara dos secretos en tiempo constante (regla #10).
 *
 * `===` sobre un token filtra por cuánto tardó en fallar; esto no.
 */
export function sonIgualesEnTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
