import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { configDePrueba, jwtDePrueba, TransporteFalso } from '../pruebas/fixtures.js';
import { leerExp, ProveedorDeToken } from './token.js';

function armar(ahora = new Date('2026-08-27T12:00:00.000Z')) {
  const transporte = new TransporteFalso();
  const proveedor = new ProveedorDeToken(configDePrueba(), transporte.enviar, () => ahora);
  return { transporte, proveedor };
}

describe('leerExp()', () => {
  it('lee el exp de un JWT sin verificar la firma', () => {
    expect(leerExp(jwtDePrueba(1_800_000_000))).toBe(1_800_000_000);
  });

  it.each([
    ['no es un JWT', 'cualquier-cosa'],
    ['tiene dos partes', 'a.b'],
    ['el payload no es JSON', 'a.bm8tanNvbg.c'],
  ])('devuelve null si %s', (_caso, token) => {
    expect(leerExp(token)).toBeNull();
  });

  it('devuelve null si el payload no trae exp', () => {
    const sinExp = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(leerExp(`a.${sinExp}.c`)).toBeNull();
  });
});

describe('ProveedorDeToken', () => {
  it('autentica la primera vez', async () => {
    const { proveedor, transporte } = armar();
    const r = await proveedor.obtener();

    expect(esExito(r)).toBe(true);
    expect(transporte.peticiones).toHaveLength(1);
  });

  it('reutiliza el token vigente en vez de autenticar de nuevo', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.obtener();
    await proveedor.obtener();
    await proveedor.obtener();

    expect(transporte.peticiones).toHaveLength(1);
  });

  it('manda la contraseña cifrada, nunca en claro', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.obtener();

    const cuerpo = transporte.peticiones[0]?.cuerpo as { password: string; userName: string };
    expect(cuerpo.password).not.toBe(configDePrueba().password.revelar());
    expect(cuerpo.userName).toBe(configDePrueba().usuario);
  });

  it('renovar() fuerza una autenticación nueva', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.obtener();
    await proveedor.renovar();

    expect(transporte.peticiones).toHaveLength(2);
  });

  it('olvidar() borra el token de memoria', async () => {
    const { proveedor, transporte } = armar();
    await proveedor.obtener();
    proveedor.olvidar();
    await proveedor.obtener();

    expect(transporte.peticiones).toHaveLength(2);
  });

  it('renueva cuando el token está por vencer', async () => {
    // El fixture emite tokens con exp a una hora del reloj del sistema; se
    // adelanta el reloj del proveedor más allá de eso.
    const transporte = new TransporteFalso();
    let ahora = new Date();
    const proveedor = new ProveedorDeToken(configDePrueba(), transporte.enviar, () => ahora);

    await proveedor.obtener();
    expect(transporte.peticiones).toHaveLength(1);

    ahora = new Date(ahora.getTime() + 2 * 3_600_000);
    await proveedor.obtener();
    expect(transporte.peticiones).toHaveLength(2);
  });

  it('trata un responseCode != 0 como credenciales rechazadas', async () => {
    const transporte = new TransporteFalso({
      sobrescribir: {
        '/ApiGateway/api/authentication/authenticate': {
          status: 200,
          cuerpo: { token: 'x.y.z', responseCode: 5, message: 'usuario inválido' },
        },
      },
    });
    const proveedor = new ProveedorDeToken(configDePrueba(), transporte.enviar);
    const r = await proveedor.obtener();

    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('NO_AUTORIZADO');
      expect(r.error.reintentable).toBe(false);
      expect(r.error.codigoProveedor).toBe('5');
    }
  });

  it('no propaga el mensaje del banco, que puede nombrar al usuario', async () => {
    const transporte = new TransporteFalso({
      sobrescribir: {
        '/ApiGateway/api/authentication/authenticate': {
          status: 200,
          cuerpo: { token: 'x.y.z', responseCode: 5, message: 'usuario 12345678 bloqueado' },
        },
      },
    });
    const r = await new ProveedorDeToken(configDePrueba(), transporte.enviar).obtener();
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.mensaje).not.toContain('12345678');
    }
  });

  it('rechaza una respuesta de autenticación con forma inesperada', async () => {
    const transporte = new TransporteFalso({
      sobrescribir: {
        '/ApiGateway/api/authentication/authenticate': { status: 200, cuerpo: { nada: true } },
      },
    });
    const r = await new ProveedorDeToken(configDePrueba(), transporte.enviar).obtener();
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('RESPUESTA_INVALIDA');
    }
  });
});
