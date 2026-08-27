import { describe, expect, it } from 'vitest';

import {
  aDecimalBob,
  centavos,
  desdeDecimalBob,
  formatearBob,
  sonIguales,
  sumar,
  type Centavos,
} from './dinero.js';
import { esExito } from './resultado.js';

/** Helper de test: construye un monto que sabemos válido. */
function bs(valorEnCentavos: number): Centavos {
  const r = centavos(valorEnCentavos);
  if (!esExito(r)) {
    throw new Error(`monto de prueba inválido: ${String(valorEnCentavos)}`);
  }
  return r.valor;
}

describe('centavos()', () => {
  it('acepta enteros no negativos', () => {
    expect(centavos(0)).toEqual({ ok: true, valor: 0 });
    expect(centavos(100)).toEqual({ ok: true, valor: 100 });
  });

  it.each([1.5, 0.1, 99.999])('rechaza el no-entero %p (regla #5)', (valor) => {
    expect(centavos(valor)).toEqual({ ok: false, error: { tipo: 'NO_ES_ENTERO', valor } });
  });

  it('rechaza NaN e Infinity', () => {
    expect(centavos(Number.NaN).ok).toBe(false);
    expect(centavos(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it('rechaza negativos: un cobro no puede ser por monto negativo', () => {
    expect(centavos(-1)).toEqual({ ok: false, error: { tipo: 'NEGATIVO', valor: -1 } });
  });

  it('rechaza valores fuera del rango seguro de enteros', () => {
    const enorme = Number.MAX_SAFE_INTEGER + 2;
    expect(centavos(enorme).ok).toBe(false);
  });
});

describe('desdeDecimalBob()', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.0', 100],
    ['1.00', 100],
    ['1.5', 150],
    ['1.50', 150],
    ['0.01', 1],
    ['0.99', 99],
    ['123.45', 12_345],
  ])('convierte %p a %p centavos', (texto, esperado) => {
    expect(desdeDecimalBob(texto)).toEqual({ ok: true, valor: esperado });
  });

  it('acepta también un number, como llega de un JSON', () => {
    expect(desdeDecimalBob(1.5)).toEqual({ ok: true, valor: 150 });
  });

  it('rechaza la coma como separador decimal (regla #5)', () => {
    expect(desdeDecimalBob('1,50')).toEqual({
      ok: false,
      error: { tipo: 'FORMATO_INVALIDO', texto: '1,50' },
    });
  });

  it('rechaza un tercer decimal en vez de redondearlo en silencio', () => {
    // Redondear acá es lo que produce confirmaciones por montos que no coinciden.
    expect(desdeDecimalBob('1.005').ok).toBe(false);
  });

  it.each(['', ' ', 'abc', '1.2.3', '-1.00', '+1.00', '1 000.00', '1e2', 'Bs 1.00'])(
    'rechaza la entrada malformada %p',
    (texto) => {
      expect(desdeDecimalBob(texto).ok).toBe(false);
    },
  );
});

describe('aDecimalBob()', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [99, '0.99'],
    [100, '1.00'],
    [150, '1.50'],
    [12_345, '123.45'],
    [100_000_000, '1000000.00'],
  ])('formatea %p centavos como %p', (valor, esperado) => {
    expect(aDecimalBob(bs(valor))).toBe(esperado);
  });

  it('siempre produce exactamente dos decimales', () => {
    for (let c = 0; c < 1000; c += 1) {
      expect(aDecimalBob(bs(c))).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe('round-trip centavos → decimal → centavos', () => {
  it('es exacto en el rango operativo, sin error de float', () => {
    // El caso clásico: 0.1 + 0.2 !== 0.3 en float. Acá tiene que dar exacto.
    for (let c = 0; c <= 100_000; c += 7) {
      const ida = aDecimalBob(bs(c));
      const vuelta = desdeDecimalBob(ida);
      expect(vuelta).toEqual({ ok: true, valor: c });
    }
  });

  it('es exacto también en montos grandes', () => {
    for (const c of [999_999_99, 1_000_000_00, 123_456_789]) {
      expect(desdeDecimalBob(aDecimalBob(bs(c)))).toEqual({ ok: true, valor: c });
    }
  });
});

describe('operaciones', () => {
  it('suma dos montos', () => {
    expect(sumar(bs(150), bs(250))).toEqual({ ok: true, valor: 400 });
  });

  it('compara por igualdad exacta: la conciliación no tolera diferencias de monto', () => {
    expect(sonIguales(bs(100), bs(100))).toBe(true);
    expect(sonIguales(bs(100), bs(99))).toBe(false);
  });

  it('formatea para mostrar a una persona', () => {
    expect(formatearBob(bs(12_345))).toBe('Bs 123.45');
  });
});
