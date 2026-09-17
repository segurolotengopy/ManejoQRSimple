import { describe, expect, it } from 'vitest';

import { archivoDeCredenciales, esAliasDeCuenta, leerCuentaDePrueba } from './cuenta.js';

describe('esAliasDeCuenta()', () => {
  it.each(['prod', 'sucursal-2', 'a', '0123456789012345678901234'.slice(0, 24)])('acepta %s', (alias) => {
    expect(esAliasDeCuenta(alias)).toBe(true);
  });

  it.each([
    ['', 'vacío'],
    ['-prod', 'empieza con guion'],
    ['../otra', 'es una ruta'],
    ['prod/prod', 'trae una barra'],
    ['PROD', 'mayúsculas'],
    ['cuenta 2', 'espacio'],
    ['a'.repeat(25), 'demasiado largo'],
  ])('rechaza «%s» (%s)', (alias) => {
    expect(esAliasDeCuenta(alias)).toBe(false);
  });
});

describe('leerCuentaDePrueba()', () => {
  it('sin variable, la primera cuenta', () => {
    expect(leerCuentaDePrueba({})).toBe('prod');
    expect(leerCuentaDePrueba({ PRUEBA_CUENTA: '  ' })).toBe('prod');
  });

  it('con alias válido, ese alias', () => {
    expect(leerCuentaDePrueba({ PRUEBA_CUENTA: ' sucursal-2 ' })).toBe('sucursal-2');
  });

  it('un alias que no sirve como nombre de archivo no se corrige solo', () => {
    // Si `CUENTA` está mal escrita, el archivo de credenciales que se cargó
    // tampoco es el que se cree: seguir con un valor inventado es peor.
    expect(leerCuentaDePrueba({ PRUEBA_CUENTA: '../otra' })).toBeNull();
  });
});

describe('archivoDeCredenciales()', () => {
  it('es la convención que arman los scripts prueba:*', () => {
    expect(archivoDeCredenciales('prod')).toBe('baneco-prod.env');
    expect(archivoDeCredenciales('sucursal-2')).toBe('baneco-sucursal-2.env');
  });
});
