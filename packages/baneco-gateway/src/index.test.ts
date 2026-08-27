import { describe, expect, it } from 'vitest';

import { EL_WEBHOOK_CONFIRMA_PAGOS, PAQUETE } from './index.js';

describe('@mqs/baneco-gateway', () => {
  it('expone la identidad del paquete', () => {
    expect(PAQUETE).toBe('@mqs/baneco-gateway');
  });

  it('regla BANECO-1: el webhook del banco nunca confirma un pago', () => {
    expect(EL_WEBHOOK_CONFIRMA_PAGOS).toBe(false);
  });
});
