import { describe, expect, it } from 'vitest';

import {
  combinarVerificadores,
  leerConsumidores,
  verificadorDeConsumidores,
  verificadorDeTokenFijo,
} from './auth.js';

describe('verificadorDeTokenFijo()', () => {
  // De mentira a propósito, y sin forma de token: un valor hexadecimal acá hace
  // saltar el escaneo de secretos del CI, aunque no sea secreto de nada.
  const TOKEN = 'token-de-mentira-para-el-test';

  it('acepta el token configurado y rechaza cualquier otro', async () => {
    const verificar = verificadorDeTokenFijo(TOKEN);
    expect(verificar).not.toBeNull();
    await expect(verificar?.(TOKEN)).resolves.toEqual({ tipo: 'dueño', id: 'dueño-local' });
    await expect(verificar?.('token-de-mentira-para-el-tesT')).resolves.toBeNull();
    await expect(verificar?.('corto')).resolves.toBeNull();
  });

  it.each([undefined, '', '   ', 'demasiado-corto'])('sin token usable no hay verificador: %s', (valor) => {
    expect(verificadorDeTokenFijo(valor)).toBeNull();
  });

  it('el marcador de la plantilla no es un token', () => {
    // Mide más de 16 caracteres, así que el largo no alcanza para descartarlo:
    // su valor exacto está publicado en este repositorio, y con él cualquiera
    // en la máquina podría crear y anular cobros contra la cuenta real.
    expect(verificadorDeTokenFijo('<token local de la consola>')).toBeNull();
  });
});

describe('leerConsumidores()', () => {
  // Largo suficiente y visiblemente de mentira, como el del dueño.
  const TOKEN_A = 'token-de-mentira-del-consumidor-a';
  const TOKEN_B = 'token-de-mentira-del-consumidor-b';

  it('lee una variable por consumidor y normaliza el identificador', () => {
    const r = leerConsumidores({
      CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A,
      CONSUMIDOR_TOKEN_OTRA_APP: TOKEN_B,
      OTRA_VARIABLE: 'no es de acá',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && [...r.tokens.keys()].sort()).toEqual(['novuchat', 'otra-app']);
  });

  it('sin ninguna variable, no hay consumidores y no es un error', () => {
    const r = leerConsumidores({});
    expect(r.ok && r.tokens.size).toBe(0);
  });

  it('un token corto corta el arranque, no se admite con un aviso', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: 'corto' });
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_CORTO', consumidorId: 'novuchat' } });
  });

  it('el marcador de la plantilla tampoco pasa', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: '<token del consumidor novuchat>' });
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_SIN_LLENAR', consumidorId: 'novuchat' } });
  });

  it('un identificador que no es un identificador se rechaza', () => {
    const r = leerConsumidores({ 'CONSUMIDOR_TOKEN_MI APP': TOKEN_A });
    expect(r).toEqual({ ok: false, error: { tipo: 'ID_INVALIDO', variable: 'CONSUMIDOR_TOKEN_MI APP' } });
  });

  it('dos variables que dan el mismo consumidor se rechazan', () => {
    // El guion bajo y el guion medio se equiparan: sin esta comprobación, el
    // segundo pisaría al primero y nadie se enteraría de cuál quedó.
    const r = leerConsumidores({
      'CONSUMIDOR_TOKEN_MI_APP': TOKEN_A,
      'CONSUMIDOR_TOKEN_MI-APP': TOKEN_B,
    });
    expect(r).toEqual({ ok: false, error: { tipo: 'ID_REPETIDO', consumidorId: 'mi-app' } });
  });
});

describe('verificadorDeConsumidores()', () => {
  const TOKEN_A = 'token-de-mentira-del-consumidor-a';
  const TOKEN_B = 'token-de-mentira-del-consumidor-b';
  const verificar = verificadorDeConsumidores(
    new Map([
      ['novuchat', TOKEN_A],
      ['otra-app', TOKEN_B],
    ]),
  );

  it('cada token identifica a su consumidor', async () => {
    await expect(verificar(TOKEN_A)).resolves.toEqual({ tipo: 'consumidor', consumidorId: 'novuchat' });
    await expect(verificar(TOKEN_B)).resolves.toEqual({ tipo: 'consumidor', consumidorId: 'otra-app' });
  });

  it('un token ajeno no es nadie', async () => {
    await expect(verificar('token-de-mentira-de-un-tercero-x')).resolves.toBeNull();
    await expect(verificar('')).resolves.toBeNull();
  });
});

describe('combinarVerificadores()', () => {
  const TOKEN_DUEÑO = 'token-de-mentira-del-dueño-local';
  const TOKEN_CONSUMIDOR = 'token-de-mentira-del-consumidor-a';

  it('el token del dueño no identifica a un consumidor, ni al revés', async () => {
    const dueño = verificadorDeTokenFijo(TOKEN_DUEÑO);
    expect(dueño).not.toBeNull();
    const verificar = combinarVerificadores(
      dueño as NonNullable<typeof dueño>,
      verificadorDeConsumidores(new Map([['novuchat', TOKEN_CONSUMIDOR]])),
    );

    await expect(verificar(TOKEN_DUEÑO)).resolves.toEqual({ tipo: 'dueño', id: 'dueño-local' });
    await expect(verificar(TOKEN_CONSUMIDOR)).resolves.toEqual({
      tipo: 'consumidor',
      consumidorId: 'novuchat',
    });
    await expect(verificar('cualquier-otra-cosa-larga-y-falsa')).resolves.toBeNull();
  });
});

describe('un token no puede valer para dos identidades', () => {
  const COMPARTIDO = 'token-de-mentira-compartido-por-dos';

  it('el mismo token para el dueño y un consumidor corta el arranque', () => {
    // Los dos viven en el mismo archivo y la plantilla los emite adyacentes:
    // pegar el mismo valor en dos líneas durante una rotación es un desliz de
    // un segundo. Sin esta comprobación, el token del consumidor resolvería
    // como **dueño** y abriría la consola entera.
    const r = leerConsumidores({
      API_TOKEN_LOCAL: COMPARTIDO,
      CONSUMIDOR_TOKEN_NOVUCHAT: COMPARTIDO,
    });
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_COMPARTIDO', consumidorId: 'novuchat' } });
  });

  it('dos consumidores con el mismo token tampoco arrancan', () => {
    const r = leerConsumidores({
      CONSUMIDOR_TOKEN_NOVUCHAT: COMPARTIDO,
      CONSUMIDOR_TOKEN_OTRA_APP: COMPARTIDO,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.tipo).toBe('TOKEN_COMPARTIDO');
  });

  it('ante la ambigüedad, combinarVerificadores no elige: falla cerrado', async () => {
    // Segunda barrera, por si alguien arma los verificadores por otro camino.
    // Quedarse con el primero convertiría el token de un consumidor en la
    // llave del dueño, que es justo el lado peligroso.
    const dueño = verificadorDeTokenFijo(COMPARTIDO);
    expect(dueño).not.toBeNull();
    const verificar = combinarVerificadores(
      dueño as NonNullable<typeof dueño>,
      verificadorDeConsumidores(new Map([['novuchat', COMPARTIDO]])),
    );
    await expect(verificar(COMPARTIDO)).resolves.toBeNull();
  });
});
