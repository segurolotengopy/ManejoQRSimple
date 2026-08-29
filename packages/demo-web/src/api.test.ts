import { describe, expect, it, vi } from 'vitest';

import { ClienteApi } from './api.js';

const BASE = 'http://api.test';
const TOKEN = 'token-de-prueba';

function conRespuesta(status: number, cuerpo: unknown, capturar?: (url: string, init: RequestInit) => void) {
  const fetchFalso = vi.fn(
    (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      // `Request` no tiene una representación en texto útil; en estos tests el
      // cliente siempre pasa un string, y así queda explícito.
      const comoTexto = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      capturar?.(comoTexto, init ?? {});
      return Promise.resolve(
        new Response(cuerpo === undefined ? '' : JSON.stringify(cuerpo), { status }),
      );
    },
  ) as unknown as typeof globalThis.fetch;
  return new ClienteApi({ baseUrl: BASE, token: TOKEN, fetch: fetchFalso });
}

describe('autenticación', () => {
  it('manda el token como Bearer en cada pedido', async () => {
    let cabeceras: HeadersInit | undefined;
    const api = conRespuesta(200, { cobros: [] }, (_u, init) => {
      cabeceras = init.headers;
    });

    await api.listarPendientes();
    expect((cabeceras as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });
});

describe('errores', () => {
  it('traduce el error de la API conservando su código', async () => {
    const api = conRespuesta(409, {
      error: { codigo: 'TRANSICION_TRANSICION_NO_PERMITIDA', mensaje: 'No corresponde.' },
    });
    const r = await api.enviar('x');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('TRANSICION_TRANSICION_NO_PERMITIDA');
      expect(r.error.status).toBe(409);
    }
  });

  it('tolera un cuerpo de error con forma inesperada', async () => {
    // No debe romper la consola: la API podría cambiar o haber un proxy en medio.
    const api = conRespuesta(500, { algo: 'raro' });
    const r = await api.listarPendientes();

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('ERROR_DESCONOCIDO');
    }
  });

  it('tolera una respuesta que no es JSON', async () => {
    const fetchFalso = vi.fn(() =>
      Promise.resolve(new Response('<html>502</html>', { status: 502 })),
    ) as unknown as typeof globalThis.fetch;
    const api = new ClienteApi({ baseUrl: BASE, token: TOKEN, fetch: fetchFalso });

    const r = await api.listarPendientes();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('RESPUESTA_INVALIDA');
    }
  });

  it('cuando la API no responde, dice qué hacer en vez de lanzar', async () => {
    // Una promesa rechazada dentro de un onClick desaparece sin dejar rastro.
    const fetchFalso = vi.fn(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    ) as unknown as typeof globalThis.fetch;
    const api = new ClienteApi({ baseUrl: BASE, token: TOKEN, fetch: fetchFalso });

    const r = await api.listarPendientes();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('SIN_CONEXION');
      expect(r.error.mensaje).toContain('npm run api');
    }
  });
});

describe('llamadas', () => {
  it('crear manda el monto como texto, nunca como número', async () => {
    let cuerpo: string | undefined;
    const api = conRespuesta(201, { id: 'x' }, (_u, init) => {
      cuerpo = init.body as string;
    });

    await api.crear({ telefonoCliente: '+59171234567', concepto: 'c', monto: '150.50' });
    expect(cuerpo).toContain('"monto":"150.50"');
    // Si fuera número, JSON.stringify lo escribiría sin comillas.
    expect(cuerpo).not.toContain('"monto":150.5');
  });

  it('escapa el id en la URL', async () => {
    let url = '';
    const api = conRespuesta(200, {}, (u) => {
      url = u;
    });

    await api.verCobro('con/barra y espacio');
    expect(url).toBe(`${BASE}/api/cobros/con%2Fbarra%20y%20espacio`);
  });

  it.each([
    ['enviar', (a: ClienteApi) => a.enviar('id-1'), '/api/cobros/id-1/enviar'],
    ['renovar', (a: ClienteApi) => a.renovar('id-1'), '/api/cobros/id-1/renovar'],
    ['verificar', (a: ClienteApi) => a.verificar('id-1'), '/api/cobros/id-1/verificar'],
  ])('%s pega en la ruta correcta', async (_n, llamar, esperada) => {
    let url = '';
    const api = conRespuesta(200, { cobro: {} }, (u) => {
      url = u;
    });
    await llamar(api);
    expect(url).toBe(`${BASE}${esperada}`);
  });

  it('listarPendientes desenvuelve el array de cobros', async () => {
    const api = conRespuesta(200, { cobros: [{ id: 'a' }, { id: 'b' }] });
    const r = await api.listarPendientes();

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.map((c) => c.id)).toEqual(['a', 'b']);
    }
  });
});
