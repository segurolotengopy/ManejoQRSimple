import { describe, expect, it } from 'vitest';

import { PAQUETE, PROVEEDORES, type Proveedor } from './index.js';

describe('@mqs/qr-core', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/qr-core');
  });

  it('contempla los proveedores del diseño multi-proveedor (D1)', () => {
    expect(PROVEEDORES).toEqual(['baneco', 'yape']);
  });

  it('deriva el tipo Proveedor de la lista, sin duplicar la fuente', () => {
    const proveedor: Proveedor = 'baneco';
    expect(PROVEEDORES).toContain(proveedor);
  });
});
