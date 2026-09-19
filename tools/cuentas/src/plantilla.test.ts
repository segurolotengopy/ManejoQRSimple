import { describe, expect, it } from 'vitest';

import { plantilla, variablesSinCompletar, VARIABLES } from './plantilla.js';

describe('plantilla()', () => {
  it('sale con todas las variables y ningún valor', () => {
    const texto = plantilla('sucursal-2');
    expect(variablesSinCompletar(texto)).toEqual([...VARIABLES]);
  });

  it('nombra la cuenta y recuerda que el archivo no se versiona', () => {
    const texto = plantilla('sucursal-2');
    expect(texto).toContain('sucursal-2');
    expect(texto).toContain('600');
  });
});

describe('variablesSinCompletar()', () => {
  it('un archivo completo no tiene faltantes, sin declarar la URL del banco', () => {
    const completo = [
      'BANECO_PROD_USERNAME=usuario',
      // Valores de mentira a propósito: nada con forma de llave ni de token.
      'BANECO_PROD_PASSWORD=lo-que-sea',
      'BANECO_PROD_AES_KEY=llave-de-mentira-para-el-test',
      'BANECO_PROD_ACCOUNT_CREDIT=cuenta-de-mentira',
      'API_TOKEN_LOCAL=token-de-mentira',
    ].join('\n');
    expect(variablesSinCompletar(completo)).toEqual([]);
  });

  it('cuenta como faltante lo vacío, lo ausente y el marcador sin reemplazar', () => {
    const medio = ['BANECO_PROD_USERNAME=', 'BANECO_PROD_PASSWORD=<contraseña>', 'BANECO_PROD_AES_KEY=una-llave'].join('\n');
    expect(variablesSinCompletar(medio)).toEqual([
      'BANECO_PROD_USERNAME',
      'BANECO_PROD_PASSWORD',
      'BANECO_PROD_ACCOUNT_CREDIT',
      'API_TOKEN_LOCAL',
    ]);
  });

  it('una contraseña con < adentro no se confunde con un marcador', () => {
    const linea = 'BANECO_PROD_PASSWORD=abc<def';
    expect(variablesSinCompletar(linea)).not.toContain('BANECO_PROD_PASSWORD');
  });
});
