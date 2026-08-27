import { describe, expect, it } from 'vitest';

import { PAQUETE, SOLO_LECTURA } from './index.js';

describe('@mqs/yape-scraper', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/yape-scraper');
  });

  it('el scraper es de solo lectura (regla de negocio #3)', () => {
    expect(SOLO_LECTURA).toBe(true);
  });
});
