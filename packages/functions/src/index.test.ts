import { describe, expect, it } from 'vitest';

import { CONTIENE_REGLAS_DE_NEGOCIO, PAQUETE } from './index.js';

describe('@mqs/functions', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/functions');
  });

  it('no aloja reglas de negocio: solo orquesta', () => {
    expect(CONTIENE_REGLAS_DE_NEGOCIO).toBe(false);
  });
});
