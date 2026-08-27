import { describe, expect, it } from 'vitest';

import { EL_COMPROBANTE_CONFIRMA_PAGOS, PAQUETE } from './index.js';

describe('@mqs/wa-bridge', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/wa-bridge');
  });

  it('el comprobante del cliente nunca confirma un pago (ADR-005)', () => {
    expect(EL_COMPROBANTE_CONFIRMA_PAGOS).toBe(false);
  });
});
