import { describe, expect, it } from 'vitest';

import { ALIAS_DE_CUENTA, esAliasDeCuenta } from './cuenta-cobro.js';

describe('esAliasDeCuenta()', () => {
  it.each(['cuenta-2', 'prod', 'a'])('acepta %s', (alias) => {
    expect(esAliasDeCuenta(alias)).toBe(true);
  });

  it.each(['1234567890', '<alias>', '', 'PROD', '../otra', 'a'.repeat(25)])(
    'rechaza «%s»',
    (alias) => {
      expect(esAliasDeCuenta(alias)).toBe(false);
    },
  );

  it('expone el mismo patrón que usa la función', () => {
    expect(ALIAS_DE_CUENTA.test('cuenta-2')).toBe(true);
  });
});
