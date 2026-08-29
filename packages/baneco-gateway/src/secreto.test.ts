import { describe, expect, it } from 'vitest';

import { Secreto } from './secreto.js';

const VALOR = 'contraseña-del-banco-que-no-debe-filtrarse';

describe('Secreto', () => {
  it('devuelve el valor solo cuando se lo pide explícitamente', () => {
    expect(new Secreto(VALOR).revelar()).toBe(VALOR);
  });

  it('no se filtra en un template literal', () => {
    // El descuido más común: meterlo en un mensaje de log.
    expect(`password=${String(new Secreto(VALOR))}`).toBe('password=<<secreto>>');
  });

  it('no se filtra al concatenar', () => {
    expect('x' + String(new Secreto(VALOR))).not.toContain(VALOR);
  });

  it('no se filtra al serializar a JSON', () => {
    expect(JSON.stringify({ password: new Secreto(VALOR) })).toBe('{"password":"<<secreto>>"}');
  });

  it('no se filtra al serializar el objeto que lo contiene', () => {
    const config = { usuario: 'u', password: new Secreto(VALOR), otro: 1 };
    expect(JSON.stringify(config)).not.toContain(VALOR);
  });

  it('el valor no aparece entre las claves enumerables', () => {
    // Campo privado de clase: ni el spread ni Object.keys lo alcanzan.
    const s = new Secreto(VALOR);
    expect(Object.keys(s)).toEqual([]);
    // El spread sobre una instancia normalmente es un error —pierde el
    // prototipo— y por eso ESLint lo prohíbe. Acá es justo lo que se prueba:
    // que alguien que lo haga por descuido no se lleve el secreto.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    expect(JSON.stringify({ ...s })).toBe('{}');
  });

  it('expone la longitud sin exponer el valor', () => {
    expect(new Secreto(VALOR).longitud).toBe(VALOR.length);
  });

  it('se identifica como Secreto al inspeccionarlo', () => {
    expect(Object.prototype.toString.call(new Secreto(VALOR))).toBe('[object Secreto]');
  });
});
