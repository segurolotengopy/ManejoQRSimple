import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { describir, leerConfig, URL_PRODUCCION } from './config.js';
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
    const r = leerConfig({ ...ENTORNO_CERT, BANECO_CERT_BASE_URL: 'http://localhost:8099/api/' });
    expect(esExito(r) && r.valor.baseUrl).toBe('http://localhost:8099/api');
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

  describe('en certificación solo se le habla a hosts permitidos (4B3)', () => {
    const conUrl = (url: string) => leerConfig({ ...ENTORNO_CERT, BANECO_CERT_BASE_URL: url });
    const tipoDeError = (url: string): string | null => {
      const r = conUrl(url);
      return esExito(r) ? null : r.error.tipo;
    };

    it.each([
      ['el host en mayúsculas', 'https://APIMKT.BANECO.COM.BO/apiGateway'],
      ['mayúsculas y minúsculas mezcladas', 'https://ApiMkt.Baneco.Com.Bo/apiGateway'],
      ['con puerto', 'https://apimkt.baneco.com.bo:443/apiGateway'],
      ['con usuario antes de la arroba', 'https://apimktdesa.baneco.com.bo@apimkt.baneco.com.bo/apiGateway'],
      ['en ancho completo', 'https://ａｐｉｍｋｔ.baneco.com.bo/apiGateway'],
      ['con el punto codificado', 'https://apimkt%2Ebaneco.com.bo/apiGateway'],
    ])('rechaza el host de producción: %s', (_caso, url) => {
      expect(tipoDeError(url)).toBe('URL_DE_PRODUCCION_EN_CERT');
    });

    it.each([
      ['con punto final', 'https://apimkt.baneco.com.bo./apiGateway'],
      ['un host que solo contiene el de certificación', 'https://apimktdesa.baneco.com.bo.otro.com/ApiGateway'],
      ['un alias del banco', 'https://api.baneco.com.bo/ApiGateway'],
      ['una IP', 'https://10.0.0.1/ApiGateway'],
      ['otro dominio', 'https://ejemplo.com/ApiGateway'],
      ['certificación por http', 'http://apimktdesa.baneco.com.bo/ApiGateway'],
      ['un dominio .test, que sale al DNS', 'https://banco.test/api/'],
      ['un dominio .localhost, que sale al DNS', 'http://simulado.localhost:8099/api'],
      ['una barra invertida que cambia el host', 'https://x\\@apimkt.baneco.com.bo/apiGateway'],
      ['localhost con punto final', 'http://localhost.:8099/api'],
      ['el loopback con otro nombre', 'http://[::ffff:127.0.0.1]:8099/api'],
      ['un protocolo que no es http', 'ftp://localhost/ApiGateway'],
    ])('rechaza lo que no está en la lista de permitidos: %s', (_caso, url) => {
      expect(tipoDeError(url)).toBe('HOST_NO_PERMITIDO_EN_CERT');
    });

    it('rechaza usuario o clave dentro de la URL, aun sobre un host permitido', () => {
      expect(tipoDeError('http://usuario:clave-sintetica@localhost:8099/api')).toBe('VARIABLE_INVALIDA');
      expect(tipoDeError('http://usuario@localhost:8099/api')).toBe('VARIABLE_INVALIDA');
    });

    it('rechaza una URL que no se puede interpretar', () => {
      expect(tipoDeError('esto no es una url')).toBe('VARIABLE_INVALIDA');
    });

    it.each([
      'https://apimktdesa.baneco.com.bo/ApiGateway',
      'https://APIMKTDESA.baneco.com.bo/ApiGateway',
      'http://localhost:8099/ApiGateway',
      'http://127.0.0.1:8099/ApiGateway',
      'http://[::1]:8099/ApiGateway',
    ])('admite %s', (url) => {
      expect(tipoDeError(url)).toBeNull();
    });

    it('el error lleva el host y nunca la URL completa, que puede traer usuario y clave', () => {
      const CLAVE = 'clave-sintetica';
      const USUARIO = 'usuario-sintetico';
      for (const host of ['apimkt.baneco.com.bo', 'ejemplo.com', 'localhost']) {
        const r = conUrl(`https://${USUARIO}:${CLAVE}@${host}/apiGateway`);
        expect(esExito(r)).toBe(false);
        expect(JSON.stringify(r)).not.toContain(CLAVE);
        expect(JSON.stringify(r)).not.toContain(USUARIO);
      }
    });

    it('en producción no cambia nada: la URL por defecto sigue funcionando', () => {
      const r = leerConfig({
        BANECO_ENV: 'prod',
        BANECO_PROD_USERNAME: 'usuario',
        BANECO_PROD_PASSWORD: 'password',
        BANECO_PROD_AES_KEY: LLAVE_DE_PRUEBA,
        BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
      });
      expect(esExito(r)).toBe(true);
    });
  });

  it('en producción la URL del banco no hace falta declararla', () => {
    // Es del banco, no de cada usuario API: la misma para toda cuenta de cobro.
    const r = leerConfig({
      BANECO_ENV: 'prod',
      BANECO_PROD_USERNAME: 'usuario',
      BANECO_PROD_PASSWORD: 'password',
      BANECO_PROD_AES_KEY: LLAVE_DE_PRUEBA,
      BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
    });
    expect(esExito(r) && r.valor.baseUrl).toBe(URL_PRODUCCION);
  });

  it('una URL declarada manda sobre la de por defecto', () => {
    const r = leerConfig({
      BANECO_ENV: 'prod',
      BANECO_PROD_BASE_URL: 'https://otra.test/apiGateway',
      BANECO_PROD_USERNAME: 'usuario',
      BANECO_PROD_PASSWORD: 'password',
      BANECO_PROD_AES_KEY: LLAVE_DE_PRUEBA,
      BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
    });
    expect(esExito(r) && r.valor.baseUrl).toBe('https://otra.test/apiGateway');
  });

  it('en certificación la URL sigue siendo obligatoria', () => {
    // La de desarrollo cambió de mayúsculas entre documentos (V1): no se adivina.
    const { BANECO_CERT_BASE_URL: _omitida, ...sinUrl } = ENTORNO_CERT;
    expect(leerConfig(sinUrl)).toEqual({
      ok: false,
      error: { tipo: 'FALTA_VARIABLE', variable: 'BANECO_CERT_BASE_URL' },
    });
  });

  it.each(['USERNAME', 'PASSWORD', 'AES_KEY', 'ACCOUNT_CREDIT'])(
    'un marcador <…> sin reemplazar no arranca, y se distingue de una variable ausente: %s',
    (sufijo) => {
      // Intentar el login con el texto de la plantilla es un intento fallido, y
      // el usuario API se bloquea con intentos fallidos (B4). El error dice
      // "marcador" y no "falta": si dijera "falta" sobre una línea completada,
      // el camino natural sería editar el valor de verdad y reintentar.
      const variable = `BANECO_CERT_${sufijo}`;
      const r = leerConfig({ ...ENTORNO_CERT, [variable]: '<completar>' });
      expect(esExito(r)).toBe(false);
      if (!esExito(r)) {
        expect(r.error).toMatchObject({ tipo: 'VARIABLE_INVALIDA', variable });
        expect(r.error.tipo === 'VARIABLE_INVALIDA' && r.error.motivo).toContain('falso positivo');
      }
    },
  );

  it('en producción, una URL declarada como marcador no se cae al valor por defecto', () => {
    // El caso real: el banco avisa que movió el gateway y la URL se pega con
    // los `<>` que le puso el correo. Arrancar contra la URL vieja parecería
    // una falla del banco.
    const r = leerConfig({
      BANECO_ENV: 'prod',
      BANECO_PROD_BASE_URL: '<https://nuevo.baneco.com.bo/apiGateway>',
      BANECO_PROD_USERNAME: 'usuario',
      BANECO_PROD_PASSWORD: 'password',
      BANECO_PROD_AES_KEY: LLAVE_DE_PRUEBA,
      BANECO_PROD_ACCOUNT_CREDIT: '1234567890',
    });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error).toMatchObject({ tipo: 'VARIABLE_INVALIDA', variable: 'BANECO_PROD_BASE_URL' });
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
