import { describe, expect, it } from 'vitest';

import { describirLlamada, RegistroEventos, sanearTexto } from './registro.js';

describe('sanearTexto()', () => {
  it('enmascara tokens, teléfonos y números de cuenta', () => {
    const t = sanearTexto('Authorization: Bearer abc.def.ghi · tel +59171234567 · cuenta 1234567890');
    expect(t).toBe('Authorization: Bearer *** · tel +591 ******** · cuenta **********');
  });

  it('deja los ids de QR del banco, que sirven para depurar', () => {
    expect(sanearTexto('GET /api/qrsimple/v2/statusQR/21061401016000000007')).toContain('21061401016000000007');
  });
});

describe('RegistroEventos', () => {
  it('guarda las últimas 500 líneas, numeradas', () => {
    const registro = new RegistroEventos(() => new Date('2026-09-12T12:00:00.000Z'));
    for (let i = 0; i < 510; i += 1) {
      registro.agregar('info', 'api', `línea ${String(i)}`);
    }
    const lineas = registro.listar();
    expect(lineas).toHaveLength(500);
    expect(lineas[0]?.n).toBe(11);
    expect(lineas.at(-1)).toMatchObject({ n: 510, texto: 'línea 509', en: '2026-09-12T12:00:00.000Z' });
  });

  it('sanea todo lo que entra', () => {
    const registro = new RegistroEventos();
    registro.agregar('error', 'api', 'falló con Bearer secreto');
    expect(registro.listar()[0]?.texto).toBe('falló con Bearer ***');
  });
});

describe('describirLlamada()', () => {
  it.each([
    [{ status: 200, responseCode: 0 }, 'info', '→ HTTP 200 · responseCode 0 · 120 ms'],
    [{ status: 200, responseCode: 57 }, 'aviso', '→ HTTP 200 · responseCode 57 · 120 ms'],
    [{ status: 401, responseCode: null }, 'aviso', '→ HTTP 401 · 120 ms'],
    [{ status: 503, responseCode: null }, 'error', '→ HTTP 503 · 120 ms'],
  ] as const)('%o → %s', (parcial, nivel, sufijo) => {
    const d = describirLlamada({ metodo: 'POST', ruta: '/api/qrsimple/generateQR', ms: 120, falla: null, ...parcial });
    expect(d.nivel).toBe(nivel);
    expect(d.texto).toBe(`POST /api/qrsimple/generateQR ${sufijo}`);
  });

  it('sin respuesta es un error, con el tipo de falla', () => {
    const d = describirLlamada({ metodo: 'GET', ruta: '/x', ms: 15000, status: null, responseCode: null, falla: 'INDISPONIBLE' });
    expect(d).toEqual({ nivel: 'error', texto: 'GET /x → sin respuesta (INDISPONIBLE) · 15000 ms' });
  });
});
