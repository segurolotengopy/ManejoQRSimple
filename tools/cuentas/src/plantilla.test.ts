import { describe, expect, it } from 'vitest';

import { consumidoresSinCuenta, plantilla, variablesSinCompletar, VARIABLES } from './plantilla.js';

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

describe('la plantilla y la cuenta de cada consumidor', () => {
  it('lleva la línea de la cuenta del consumidor, con el alias de la cuenta', () => {
    const texto = plantilla('sucursal-2');
    expect(texto).toContain('# CONSUMIDOR_CUENTA_NOVUCHAT=sucursal-2');
    expect(texto).toContain('la API no arranca');
  });

  it('sale sin consumidores activos: no hay nada que decir de su cuenta', () => {
    expect(consumidoresSinCuenta(plantilla('sucursal-2'), 'sucursal-2')).toEqual([]);
  });
});

describe('consumidoresSinCuenta()', () => {
  const TOKEN = 'CONSUMIDOR_TOKEN_NOVUCHAT=token-de-mentira-para-el-test';

  it('un token sin cuenta devuelve el nombre de la variable que falta', () => {
    expect(consumidoresSinCuenta(TOKEN, 'prod')).toEqual(['CONSUMIDOR_CUENTA_NOVUCHAT']);
  });

  it('una cuenta de otro alias devuelve el nombre, no el valor', () => {
    const contenido = [TOKEN, 'CONSUMIDOR_CUENTA_NOVUCHAT=sucursal-2'].join('\n');
    const salida = consumidoresSinCuenta(contenido, 'prod');
    expect(salida).toEqual(['CONSUMIDOR_CUENTA_NOVUCHAT']);
    expect(JSON.stringify(salida)).not.toContain('sucursal-2');
  });

  it('un valor que parece un número de cuenta tampoco aparece en la salida', () => {
    const contenido = [TOKEN, 'CONSUMIDOR_CUENTA_NOVUCHAT=1234567890'].join('\n');
    expect(JSON.stringify(consumidoresSinCuenta(contenido, 'prod'))).not.toContain('1234567890');
  });

  it('con la cuenta correcta no falta nada', () => {
    const contenido = [TOKEN, 'CONSUMIDOR_CUENTA_NOVUCHAT=prod'].join('\n');
    expect(consumidoresSinCuenta(contenido, 'prod')).toEqual([]);
  });

  it('una cuenta vacía cuenta como faltante', () => {
    const contenido = [TOKEN, 'CONSUMIDOR_CUENTA_NOVUCHAT='].join('\n');
    expect(consumidoresSinCuenta(contenido, 'prod')).toEqual(['CONSUMIDOR_CUENTA_NOVUCHAT']);
  });

  it('los consumidores comentados o sin valor no cuentan', () => {
    const contenido = ['# CONSUMIDOR_TOKEN_NOVUCHAT=token-de-mentira-para-el-test', 'CONSUMIDOR_TOKEN_OTRA='].join('\n');
    expect(consumidoresSinCuenta(contenido, 'prod')).toEqual([]);
  });

  it('una línea de cuenta comentada no cuenta como declarada', () => {
    const contenido = [TOKEN, '# CONSUMIDOR_CUENTA_NOVUCHAT=prod'].join('\n');
    expect(consumidoresSinCuenta(contenido, 'prod')).toEqual(['CONSUMIDOR_CUENTA_NOVUCHAT']);
  });

  it('con varios consumidores, devuelve solo los que fallan', () => {
    const contenido = [
      TOKEN,
      'CONSUMIDOR_CUENTA_NOVUCHAT=prod',
      'CONSUMIDOR_TOKEN_OTRA_APP=otro-token-de-mentira-para-el-test',
    ].join('\n');
    expect(consumidoresSinCuenta(contenido, 'prod')).toEqual(['CONSUMIDOR_CUENTA_OTRA_APP']);
  });
});
