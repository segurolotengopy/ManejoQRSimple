import { describe, expect, it } from 'vitest';

import { CONTIENE_REGLAS_DE_NEGOCIO, PAQUETE } from './index.js';

describe('@mqs/demo-web', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/demo-web');
  });

  it('no aloja reglas de negocio: solo consume la API', () => {
    expect(CONTIENE_REGLAS_DE_NEGOCIO).toBe(false);
  });
});
