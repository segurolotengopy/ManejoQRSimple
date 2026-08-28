import { esExito } from '@mqs/qr-core';
import { describe, expect, it } from 'vitest';

import { MensajeriaNoConfigurada } from './mensajeria.js';
import { construirPuertos, describirError, type OpcionesComposicion } from './puertos.js';

const LLAVE = '0123456789abcdef0123456789abcdef';

const ENTORNO_BANECO = {
  BANECO_ENV: 'cert',
  BANECO_CERT_BASE_URL: 'https://apimktdesa.baneco.com.bo/ApiGateway',
  BANECO_CERT_USERNAME: 'usuario',
  BANECO_CERT_PASSWORD: 'password',
  BANECO_CERT_AES_KEY: LLAVE,
  BANECO_CERT_ACCOUNT_CREDIT: '1234567890',
} as const;

function armar(env: Record<string, string | undefined>, db: OpcionesComposicion['db'] = null) {
  return construirPuertos({ env, db, mensajeria: new MensajeriaNoConfigurada() });
}

describe('selección por variable de entorno', () => {
  it('sin variables, todo es mock: el default no toca el banco', () => {
    const r = armar({});
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.resumen).toBe('qr=mock watcher=mock persistencia=memoria');
    }
  });

  it('arma los adaptadores de Baneco cuando se los pide', () => {
    const r = armar({ ...ENTORNO_BANECO, QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'baneco' });
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.resumen).toContain('qr=baneco watcher=baneco');
    }
  });

  it('permite combinar: QR de mock, watcher del banco', () => {
    // Útil para probar la detección real sin emitir QRs de verdad.
    const r = armar({ ...ENTORNO_BANECO, QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'baneco' });
    expect(esExito(r) && r.valor.resumen).toContain('qr=mock watcher=baneco');
  });

  it('no exige configuración de Baneco si ningún puerto la necesita', () => {
    expect(esExito(armar({ QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'mock' }))).toBe(true);
  });

  it('falla si se pide Baneco sin su configuración', () => {
    const r = armar({ QR_PROVIDER: 'baneco', PAYMENT_WATCHER: 'mock' });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('CONFIG_BANECO');
    }
  });

  it.each(['QR_PROVIDER', 'PAYMENT_WATCHER'])('rechaza un modo inválido en %s', (variable) => {
    const r = armar({ [variable]: 'inventado' });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error).toEqual({ tipo: 'MODO_INVALIDO', variable, valor: 'inventado' });
    }
  });

  it.each(['QR_PROVIDER', 'PAYMENT_WATCHER'])('rechaza yape en %s: está diferido (D1)', (variable) => {
    // Arrancar con un adaptador esqueleto sería peor que no arrancar.
    const r = armar({ [variable]: 'yape' });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('MODO_NO_IMPLEMENTADO');
    }
  });
});

describe('persistencia', () => {
  it('sin db, usa memoria — y no hay variable de entorno que cambie eso', () => {
    // Es deliberado: ningún .env mal copiado puede hacer que un test escriba
    // en el proyecto real.
    const r = armar({});
    expect(esExito(r) && r.valor.resumen).toContain('persistencia=memoria');
  });

  it('con db, usa Firestore', () => {
    // Alcanza con un objeto que cumpla la forma: acá solo se prueba la elección.
    const dbFalsa = { collection: () => ({}) } as unknown as OpcionesComposicion['db'];
    const r = armar({}, dbFalsa);
    expect(esExito(r) && r.valor.resumen).toContain('persistencia=firestore');
  });
});

describe('describirError()', () => {
  it('explica cada falla sin filtrar secretos', () => {
    const invalido = describirError({
      tipo: 'MODO_INVALIDO',
      variable: 'QR_PROVIDER',
      valor: 'valor-que-podria-ser-un-secreto',
    });
    expect(invalido).toContain('QR_PROVIDER');
    // No ecoa el valor: viene del entorno, y ahí viven las credenciales.
    expect(invalido).not.toContain('valor-que-podria-ser-un-secreto');
    expect(
      describirError({ tipo: 'MODO_NO_IMPLEMENTADO', variable: 'PAYMENT_WATCHER', modo: 'yape' }),
    ).toContain('todavía no está implementado');

    const texto = describirError({ tipo: 'CONFIG_BANECO', detalle: 'FALTA_VARIABLE' });
    expect(texto).toContain('BANECO_');
    expect(texto).not.toContain(LLAVE);
  });
});

describe('MensajeriaNoConfigurada', () => {
  it('falla en vez de fingir éxito, y dice por qué', async () => {
    const m = new MensajeriaNoConfigurada();
    const r = await m.enviarConfirmacion({ id: 'c1' } as never);
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.mensaje).toContain('wa-bridge');
      expect(r.error.reintentable).toBe(true);
    }
  });

  it('drenar() devuelve lo pendiente y lo vacía', async () => {
    const m = new MensajeriaNoConfigurada();
    await m.enviarConfirmacion({ id: 'c1' } as never);
    await m.enviarConfirmacion({ id: 'c2' } as never);

    expect(m.drenar()).toEqual(['confirmación del cobro c1', 'confirmación del cobro c2']);
    expect(m.drenar()).toEqual([]);
  });
});
