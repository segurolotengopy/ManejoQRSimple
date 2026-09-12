import { exito, fallo } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import type { Transporte } from './http.js';
import { transporteObservado, type LlamadaAlBanco } from './observacion.js';

describe('transporteObservado()', () => {
  it('informa método, ruta, estado, responseCode y demora — y nada del cuerpo', async () => {
    const vistas: LlamadaAlBanco[] = [];
    const base: Transporte = () => Promise.resolve(exito({ status: 200, cuerpo: { responseCode: 0, token: 'secreto' } }));
    let t = 1000;
    const observado = transporteObservado(base, (l) => vistas.push(l), () => (t += 250));

    await observado({
      metodo: 'POST',
      url: 'https://apimkt.baneco.com.bo/apiGateway/api/authentication/authenticate',
      cuerpo: { userName: 'u', password: 'cifrado' },
    });

    expect(vistas).toEqual([
      {
        metodo: 'POST',
        ruta: '/apiGateway/api/authentication/authenticate',
        ms: 250,
        status: 200,
        responseCode: 0,
        falla: null,
      },
    ]);
    expect(JSON.stringify(vistas)).not.toMatch(/secreto|cifrado|userName/);
  });

  it('nunca incluye la query string: la ruta de cifrado llevaría la llave', async () => {
    const vistas: LlamadaAlBanco[] = [];
    const base: Transporte = () => Promise.resolve(exito({ status: 200, cuerpo: 'x' }));
    await transporteObservado(base, (l) => vistas.push(l))({
      metodo: 'GET',
      url: 'https://host/api/authentication/encrypt?text=1234&aesKey=LLAVE',
    });
    expect(vistas[0]?.ruta).toBe('/api/authentication/encrypt');
    expect(JSON.stringify(vistas)).not.toContain('LLAVE');
  });

  it('sin respuesta del banco, informa el tipo de falla', async () => {
    const vistas: LlamadaAlBanco[] = [];
    const base: Transporte = () =>
      Promise.resolve(fallo({ tipo: 'INDISPONIBLE', mensaje: 'timeout', reintentable: true, codigoProveedor: null }));
    await transporteObservado(base, (l) => vistas.push(l))({ metodo: 'GET', url: 'https://host/x' });
    expect(vistas[0]).toMatchObject({ status: null, responseCode: null, falla: 'INDISPONIBLE' });
  });
});
