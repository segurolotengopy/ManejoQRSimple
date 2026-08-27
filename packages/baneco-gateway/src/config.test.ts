import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { describir, leerConfig } from './config.js';
import { LLAVE_DE_PRUEBA } from './pruebas/fixtures.js';

const ENTORNO_CERT = {
  BANECO_ENV: 'cert',
  BANECO_CERT_BASE_URL: 'https://apimktdesa.baneco.com.bo/ApiGateway',
  BANECO_CERT_USERNAME: 'usuario',
  BANECO_CERT_PASSWORD: 'password',
  BANECO_CERT_AES_KEY: LLAVE_DE_PRUEBA,
  BANECO_CERT_ACCOUNT_CREDIT: '1234567890',
} as const;

describe('leerConfig()', () => {
  it('lee una configuración de certificación completa', () => {
    const r = leerConfig(ENTORNO_CERT);
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.ambiente).toBe('cert');
      expect(r.valor.ttlQrHoras).toBe(72);
      expect(r.valor.branchCode).toBeNull();
    }
  });

  it('usa cert por defecto si no se declara el ambiente', () => {
    const { BANECO_ENV: _omitido, ...sinAmbiente } = ENTORNO_CERT;
    const r = leerConfig(sinAmbiente);
    expect(esExito(r) && r.valor.ambiente).toBe('cert');
  });

  it('recorta la barra final de la URL base', () => {
    const r = leerConfig({ ...ENTORNO_CERT, BANECO_CERT_BASE_URL: 'https://x.test/api/' });
    expect(esExito(r) && r.valor.baseUrl).toBe('https://x.test/api');
  });

  it.each(['BASE_URL', 'USERNAME', 'PASSWORD', 'AES_KEY', 'ACCOUNT_CREDIT'])(
    'reporta qué variable falta cuando falta %s',
    (sufijo) => {
      const variable = `BANECO_CERT_${sufijo}`;
      const { [variable]: _omitida, ...incompleto } = ENTORNO_CERT as Record<string, string>;
      expect(leerConfig(incompleto)).toEqual({
        ok: false,
        error: { tipo: 'FALTA_VARIABLE', variable },
      });
    },
  );

  it('trata una variable vacía como faltante', () => {
    expect(leerConfig({ ...ENTORNO_CERT, BANECO_CERT_USERNAME: '   ' })).toEqual({
      ok: false,
      error: { tipo: 'FALTA_VARIABLE', variable: 'BANECO_CERT_USERNAME' },
    });
  });

  it('rechaza una llave AES que no mide 32 bytes', () => {
    const r = leerConfig({ ...ENTORNO_CERT, BANECO_CERT_AES_KEY: 'corta' });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('VARIABLE_INVALIDA');
    }
  });

  it.each(['0', '-1', 'muchas', '1.5'])('rechaza el TTL inválido %p', (ttl) => {
    const r = leerConfig({ ...ENTORNO_CERT, BANECO_QR_TTL_HORAS: ttl });
    expect(esExito(r)).toBe(false);
  });

  it('se niega a hablarle a producción desde certificación', () => {
    // Un .env mal copiado es la forma más fácil de que B0/B1 toquen producción
    // sin que nadie se dé cuenta.
    const r = leerConfig({
      ...ENTORNO_CERT,
      BANECO_CERT_BASE_URL: 'https://apimkt.baneco.com.bo/apiGateway',
    });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('URL_DE_PRODUCCION_EN_CERT');
    }
  });

  it('en ambiente prod lee las variables BANECO_PROD_*', () => {
    const r = leerConfig({
      BANECO_ENV: 'prod',
      BANECO_PROD_BASE_URL: 'https://apimkt.baneco.com.bo/apiGateway',
      BANECO_PROD_USERNAME: 'usuario',
      BANECO_PROD_PASSWORD: 'password',
      BANECO_PROD_AES_KEY: LLAVE_DE_PRUEBA,
      BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
    });
    expect(esExito(r) && r.valor.ambiente).toBe('prod');
  });

  it('rechaza un ambiente que no sea cert ni prod', () => {
    const r = leerConfig({ ...ENTORNO_CERT, BANECO_ENV: 'staging' });
    expect(esExito(r)).toBe(false);
  });
});

describe('describir()', () => {
  it('no filtra ningún secreto', () => {
    const r = leerConfig(ENTORNO_CERT);
    expect(esExito(r)).toBe(true);
    if (!esExito(r)) return;

    const texto = describir(r.valor);
    expect(texto).not.toContain(LLAVE_DE_PRUEBA);
    expect(texto).not.toContain('password');
    expect(texto).not.toContain('1234567890');
    expect(texto).not.toContain('usuario');
  });
});
