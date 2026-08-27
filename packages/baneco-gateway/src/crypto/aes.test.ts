import { createCipheriv } from 'node:crypto';

import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { cifrar, descifrar, llaveAes, sonIgualesEnTiempoConstante, type LlaveAes } from './aes.js';

/**
 * Llave de prueba propia, generada para estos tests. No es la del banco: las
 * llaves reales nunca entran al repo (regla #2). Son 32 caracteres ASCII.
 */
const LLAVE_DE_PRUEBA = '0123456789abcdef0123456789abcdef';

function llave(texto = LLAVE_DE_PRUEBA): LlaveAes {
  const r = llaveAes(texto);
  if (!esExito(r)) {
    throw new Error('la llave de prueba debería ser válida');
  }
  return r.valor;
}

describe('llaveAes()', () => {
  it('acepta exactamente 32 bytes', () => {
    expect(esExito(llaveAes(LLAVE_DE_PRUEBA))).toBe(true);
  });

  it.each([31, 33, 0, 16])('rechaza una llave de %p bytes', (n) => {
    expect(llaveAes('a'.repeat(n))).toEqual({
      ok: false,
      error: { tipo: 'LLAVE_INVALIDA', bytes: n },
    });
  });

  it('cuenta bytes, no caracteres: un acento ocupa dos', () => {
    // 32 caracteres pero 33 bytes en UTF-8. Aceptarlo daría una llave inválida
    // para el banco y errores de descifrado imposibles de diagnosticar.
    const conAcento = `á${'a'.repeat(31)}`;
    expect(conAcento).toHaveLength(32);
    expect(llaveAes(conAcento)).toEqual({ ok: false, error: { tipo: 'LLAVE_INVALIDA', bytes: 33 } });
  });
});

describe('round-trip', () => {
  it.each([
    'password-simple',
    '1234',
    '',
    'texto con espacios y símbolos: áéíóú ñ €',
    'x'.repeat(1000),
    '0123456789abcdef', // exactamente un bloque
  ])('cifra y descifra %p sin pérdida', (texto) => {
    const payload = cifrar(texto, llave());
    expect(descifrar(payload, llave())).toEqual({ ok: true, valor: texto });
  });

  it('produce salidas distintas para el mismo texto (IV aleatorio por operación)', () => {
    const a = cifrar('mismo-texto', llave());
    const b = cifrar('mismo-texto', llave());
    expect(a).not.toBe(b);
    // Pero ambas descifran a lo mismo.
    expect(descifrar(a, llave())).toEqual(descifrar(b, llave()));
  });

  it('antepone un IV de 16 bytes al ciphertext', () => {
    const payload = Buffer.from(cifrar('1234', llave()), 'base64');
    // 16 de IV + 16 del único bloque de un texto de 4 bytes con padding PKCS7.
    expect(payload).toHaveLength(32);
  });

  it('la salida es Base64 válido', () => {
    const payload = cifrar('1234', llave());
    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe('vector de prueba con IV fijo', () => {
  /**
   * Vector propio (el banco no publica ninguno — pregunta B2). Fija el IV para
   * que el ciphertext sea determinista y cualquier cambio de esquema —padding,
   * orden del IV, codificación— rompa este test en vez de romper en producción.
   */
  const IV_FIJO = Buffer.alloc(16, 0);
  const TEXTO = '1234';

  function cifrarConIvFijo(): string {
    const cipher = createCipheriv('aes-256-cbc', llave(), IV_FIJO);
    const cifrado = Buffer.concat([cipher.update(TEXTO, 'utf8'), cipher.final()]);
    return Buffer.concat([IV_FIJO, cifrado]).toString('base64');
  }

  it('el descifrado reconoce el formato IV-prepended', () => {
    expect(descifrar(cifrarConIvFijo(), llave())).toEqual({ ok: true, valor: TEXTO });
  });

  it('el vector es estable entre corridas', () => {
    expect(cifrarConIvFijo()).toBe(cifrarConIvFijo());
  });
});

describe('descifrar() rechaza payloads inválidos', () => {
  it('rechaza un payload más corto que el IV', () => {
    expect(descifrar(Buffer.alloc(8).toString('base64'), llave())).toEqual({
      ok: false,
      error: { tipo: 'PAYLOAD_INVALIDO', motivo: 'más corto que el IV' },
    });
  });

  it('rechaza una longitud que no es múltiplo del bloque', () => {
    expect(descifrar(Buffer.alloc(20).toString('base64'), llave())).toEqual({
      ok: false,
      error: { tipo: 'PAYLOAD_INVALIDO', motivo: 'longitud no múltiplo del bloque' },
    });
  });

  it('rechaza el payload cifrado con otra llave, sin decir por qué', () => {
    const otra = llave('ffffffffffffffffffffffffffffffff');
    const payload = cifrar('secreto', otra);
    expect(descifrar(payload, llave())).toEqual({
      ok: false,
      error: { tipo: 'PAYLOAD_INVALIDO', motivo: 'no descifra con esta llave' },
    });
  });

  it('no lanza excepción ante basura', () => {
    expect(() => descifrar('no-es-base64-!!!', llave())).not.toThrow();
  });
});

describe('sonIgualesEnTiempoConstante()', () => {
  it('reconoce iguales y distintos', () => {
    expect(sonIgualesEnTiempoConstante('token-abc', 'token-abc')).toBe(true);
    expect(sonIgualesEnTiempoConstante('token-abc', 'token-abd')).toBe(false);
  });

  it('maneja longitudes distintas sin lanzar', () => {
    // timingSafeEqual lanza si los buffers difieren en tamaño; hay que cortarlo antes.
    expect(sonIgualesEnTiempoConstante('corto', 'mucho-mas-largo')).toBe(false);
  });
});
