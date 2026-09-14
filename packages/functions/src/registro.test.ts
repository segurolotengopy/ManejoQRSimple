import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bitacora } from '@mqs/composicion';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('RegistroEventos con bitácora en disco', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'mqs-registro-'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('lo de ayer sigue en la pestaña Logs después de reiniciar la API', () => {
    // El caso real: el responseCode de "Sondear anulación" se perdía al reiniciar.
    const antes = new RegistroEventos(() => new Date('2026-09-14T05:01:30.000Z'), null, new Bitacora(base, 'api'));
    antes.agregar('aviso', 'banco', 'DELETE /apiGateway/api/qrsimple/cancelQR → HTTP 200 · responseCode 403 · 151 ms');

    const despues = new RegistroEventos(() => new Date('2026-09-15T10:00:00.000Z'), null, new Bitacora(base, 'api'));
    expect(despues.listar().map((l) => l.texto)).toEqual([
      'DELETE /apiGateway/api/qrsimple/cancelQR → HTTP 200 · responseCode 403 · 151 ms',
    ]);
  });

  it('muestra también las líneas del satélite, en orden', () => {
    const satelite = new Bitacora(base, 'satelite');
    satelite.escribir('info', 'satelite', 'cierre 2026-09-13: abonos=3 yaRegistrados=3 huerfanos=0', new Date('2026-09-14T04:52:10.000Z'));
    const registro = new RegistroEventos(() => new Date('2026-09-14T05:00:00.000Z'), null, new Bitacora(base, 'api'));
    registro.agregar('info', 'api', 'POST /api/pruebas/qr → 201');

    const lineas = registro.listar();
    expect(lineas.map((l) => [l.n, l.origen])).toEqual([
      [1, 'satelite'],
      [2, 'api'],
    ]);
  });
});
