import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { esExito } from '@mqs/qr-core';
import { afterEach, describe, expect, it } from 'vitest';

import { transporteFetch } from './http.js';

const servidores: Server[] = [];

async function levantar(
  atender: Parameters<typeof createServer>[1] & object,
): Promise<{ readonly url: string }> {
  const servidor = createServer(atender);
  servidores.push(servidor);
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  return { url: `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}` };
}

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (s) =>
        new Promise<void>((listo) => {
          s.close(() => {
            listo();
          });
        }),
    ),
  );
});

describe('transporteFetch', () => {
  it('no sigue redirecciones: el cuerpo del login no viaja a otro host', async () => {
    let llamadasAlDestino = 0;
    const destino = await levantar((_req, res) => {
      llamadasAlDestino += 1;
      res.statusCode = 200;
      res.end('{}');
    });
    const origen = await levantar((_req, res) => {
      res.statusCode = 307;
      res.setHeader('Location', `${destino.url}/api/authentication/authenticate`);
      res.end();
    });

    const r = await transporteFetch(2_000)({
      metodo: 'POST',
      url: `${origen.url}/api/authentication/authenticate`,
      cuerpo: { userName: 'u', password: 'p' },
    });

    expect(esExito(r)).toBe(false);
    expect(llamadasAlDestino).toBe(0);
  });

  it('una respuesta normal sigue funcionando', async () => {
    const banco = await levantar((_req, res) => {
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
    const r = await transporteFetch(2_000)({ metodo: 'GET', url: `${banco.url}/x` });
    expect(esExito(r) && r.valor.cuerpo).toEqual({ ok: true });
  });
});
