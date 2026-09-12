import { describe, expect, it } from 'vitest';

import { esExito } from '../comun/resultado.js';
import { aceptarAbono, type RegistroConDetecciones } from './aceptacion.js';

const COBRO = { id: 'cobro-1' };

function deteccion(evento: string, idDeduplicacion: string, cobroId = 'cobro-1'): RegistroConDetecciones {
  return { cobroId, evento, datos: { idDeduplicacion } };
}

describe('aceptarAbono()', () => {
  it('acepta el último abono que el banco reportó para el cobro', () => {
    const r = aceptarAbono(COBRO, [deteccion('PAGO_DETECTADO', 'tx-1')], 'tx-1');
    expect(esExito(r) && r.valor).toMatchObject({ cobroId: 'cobro-1', idDeduplicacion: 'tx-1' });
  });

  it('sin ninguna detección del banco no hay nada que aceptar', () => {
    // Un comprobante deja evidencia, pero no es una detección.
    const comprobante: RegistroConDetecciones = {
      cobroId: 'cobro-1',
      evento: 'COMPROBANTE_RECIBIDO',
      datos: { referenciaComprobante: 'wa-1' },
    };
    expect(aceptarAbono(COBRO, [comprobante], 'wa-1')).toEqual({
      ok: false,
      error: { tipo: 'SIN_DETECCION_DEL_BANCO' },
    });
  });

  it('rechaza un abono que ya no es el último: la persona miró algo que cambió', () => {
    const registros = [deteccion('PAGO_DETECTADO', 'tx-1'), deteccion('DETECCION_EN_REVISION', 'tx-2')];
    expect(aceptarAbono(COBRO, registros, 'tx-1')).toEqual({
      ok: false,
      error: { tipo: 'ABONO_DESACTUALIZADO', ultimo: 'tx-2' },
    });
  });

  it('ignora las detecciones de otro cobro', () => {
    const r = aceptarAbono(COBRO, [deteccion('PAGO_DETECTADO', 'tx-9', 'cobro-2')], 'tx-9');
    expect(!esExito(r) && r.error.tipo).toBe('SIN_DETECCION_DEL_BANCO');
  });
});
