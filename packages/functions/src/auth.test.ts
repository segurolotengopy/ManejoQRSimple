import { describe, expect, it } from 'vitest';

import { verificadorDeTokenFijo } from './auth.js';

describe('verificadorDeTokenFijo()', () => {
  // De mentira a propósito, y sin forma de token: un valor hexadecimal acá hace
  // saltar el escaneo de secretos del CI, aunque no sea secreto de nada.
  const TOKEN = 'token-de-mentira-para-el-test';

  it('acepta el token configurado y rechaza cualquier otro', async () => {
    const verificar = verificadorDeTokenFijo(TOKEN);
    expect(verificar).not.toBeNull();
    await expect(verificar?.(TOKEN)).resolves.toBe('dueño-local');
    await expect(verificar?.('token-de-mentira-para-el-tesT')).resolves.toBeNull();
    await expect(verificar?.('corto')).resolves.toBeNull();
  });

  it.each([undefined, '', '   ', 'demasiado-corto'])('sin token usable no hay verificador: %s', (valor) => {
    expect(verificadorDeTokenFijo(valor)).toBeNull();
  });

  it('el marcador de la plantilla no es un token', () => {
    // Mide más de 16 caracteres, así que el largo no alcanza para descartarlo:
    // su valor exacto está publicado en este repositorio, y con él cualquiera
    // en la máquina podría crear y anular cobros contra la cuenta real.
    expect(verificadorDeTokenFijo('<token local de la consola>')).toBeNull();
  });
});
