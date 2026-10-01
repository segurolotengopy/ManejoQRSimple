import { describe, expect, it } from 'vitest';

import {
  combinarVerificadores,
  describirErrorDeConsumidores,
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
  const CUENTA = 'cuenta-a';

  it('lee una variable por consumidor y normaliza el identificador', () => {
    const r = leerConsumidores(
      {
        CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A,
        CONSUMIDOR_CUENTA_NOVUCHAT: CUENTA,
        CONSUMIDOR_TOKEN_OTRA_APP: TOKEN_B,
        CONSUMIDOR_CUENTA_OTRA_APP: CUENTA,
        OTRA_VARIABLE: 'no es de acá',
      },
      CUENTA,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && [...r.consumidores.keys()].sort()).toEqual(['novuchat', 'otra-app']);
  });

  it('cada consumidor queda atado a su token y a la cuenta que declaró', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A, CONSUMIDOR_CUENTA_NOVUCHAT: CUENTA }, CUENTA);
    expect(r.ok && r.consumidores.get('novuchat')).toEqual({ token: TOKEN_A, cuentaCobro: CUENTA });
  });

  it('sin ninguna variable, no hay consumidores y no es un error', () => {
    const r = leerConsumidores({}, CUENTA);
    expect(r.ok && r.consumidores.size).toBe(0);
  });

  it('un consumidor sin cuenta corta el arranque: no se elige una por defecto', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'SIN_CUENTA', consumidorId: 'novuchat' } });
  });

  it('una cuenta vacía cuenta como sin cuenta', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A, CONSUMIDOR_CUENTA_NOVUCHAT: '  ' }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'SIN_CUENTA', consumidorId: 'novuchat' } });
  });

  it.each(['1234567890', '<alias>', 'PROD', '../otra', 'cuenta con espacio'])(
    'una cuenta que no es un alias válido (%s) es CUENTA_INVALIDA y el error no lleva el valor',
    (valor) => {
      const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A, CONSUMIDOR_CUENTA_NOVUCHAT: valor }, CUENTA);
      expect(r).toEqual({ ok: false, error: { tipo: 'CUENTA_INVALIDA', consumidorId: 'novuchat' } });
      expect(JSON.stringify(r)).not.toContain(valor);
    },
  );

  it('una cuenta que no es la del proceso es CUENTA_DE_OTRO_PROCESO', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A, CONSUMIDOR_CUENTA_NOVUCHAT: 'cuenta-b' }, CUENTA);
    expect(r).toEqual({
      ok: false,
      error: { tipo: 'CUENTA_DE_OTRO_PROCESO', consumidorId: 'novuchat', cuenta: 'cuenta-b', cuentaDelProceso: CUENTA },
    });
  });

  it('una cuenta declarada sin su token es CUENTA_SIN_TOKEN', () => {
    const r = leerConsumidores({ CONSUMIDOR_CUENTA_NOVUCHAT: CUENTA }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'CUENTA_SIN_TOKEN', consumidorId: 'novuchat' } });
  });

  it('una cuenta con otra forma de escribir el id, sin token, tampoco pasa inadvertida', () => {
    const r = leerConsumidores(
      { CONSUMIDOR_TOKEN_NOVUCHAT: TOKEN_A, CONSUMIDOR_CUENTA_NOVUCHAT: CUENTA, CONSUMIDOR_CUENTA_FANTASMA: CUENTA },
      CUENTA,
    );
    expect(r).toEqual({ ok: false, error: { tipo: 'CUENTA_SIN_TOKEN', consumidorId: 'fantasma' } });
  });

  it('un token corto corta el arranque, no se admite con un aviso', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: 'corto' }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_CORTO', consumidorId: 'novuchat' } });
  });

  it('el marcador de la plantilla tampoco pasa', () => {
    const r = leerConsumidores({ CONSUMIDOR_TOKEN_NOVUCHAT: '<token del consumidor novuchat>' }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_SIN_LLENAR', consumidorId: 'novuchat' } });
  });

  it('un identificador que no es un identificador se rechaza', () => {
    const r = leerConsumidores({ 'CONSUMIDOR_TOKEN_MI APP': TOKEN_A }, CUENTA);
    expect(r).toEqual({ ok: false, error: { tipo: 'ID_INVALIDO', variable: 'CONSUMIDOR_TOKEN_MI APP' } });
  });

  it('dos variables que dan el mismo consumidor se rechazan', () => {
    // El guion bajo y el guion medio se equiparan: sin esta comprobación, el
    // segundo pisaría al primero y nadie se enteraría de cuál quedó.
    const r = leerConsumidores(
      {
        'CONSUMIDOR_TOKEN_MI_APP': TOKEN_A,
        'CONSUMIDOR_CUENTA_MI_APP': CUENTA,
        'CONSUMIDOR_TOKEN_MI-APP': TOKEN_B,
        'CONSUMIDOR_CUENTA_MI-APP': CUENTA,
      },
      CUENTA,
    );
    expect(r).toEqual({ ok: false, error: { tipo: 'ID_REPETIDO', consumidorId: 'mi-app' } });
  });
});

describe('describirErrorDeConsumidores()', () => {
  it('SIN_CUENTA, CUENTA_INVALIDA, CUENTA_DE_OTRO_PROCESO y CUENTA_SIN_TOKEN tienen su texto', () => {
    expect(describirErrorDeConsumidores({ tipo: 'SIN_CUENTA', consumidorId: 'novuchat' })).toBe(
      'El consumidor "novuchat" no tiene cuenta de cobro asignada (CONSUMIDOR_CUENTA_<ID>). Sin ella no se lo atiende: no se elige una cuenta por defecto.',
    );
    expect(describirErrorDeConsumidores({ tipo: 'CUENTA_INVALIDA', consumidorId: 'novuchat' })).toBe(
      'La cuenta de cobro del consumidor "novuchat" no es un alias válido (empieza con letra; minúsculas, números y guiones, hasta 24). No se muestra el valor: podría ser un número de cuenta.',
    );
    expect(
      describirErrorDeConsumidores({
        tipo: 'CUENTA_DE_OTRO_PROCESO',
        consumidorId: 'novuchat',
        cuenta: 'cuenta-b',
        cuentaDelProceso: 'cuenta-a',
      }),
    ).toBe(
      'El consumidor "novuchat" cobra en la cuenta «cuenta-b» y esta API es de la cuenta «cuenta-a». Cada cuenta se atiende con su proceso y su archivo de credenciales.',
    );
    expect(describirErrorDeConsumidores({ tipo: 'CUENTA_SIN_TOKEN', consumidorId: 'novuchat' })).toBe(
      'Hay cuenta de cobro para el consumidor "novuchat" pero no su token (CONSUMIDOR_TOKEN_<ID>).',
    );
  });

  it('con un número de cuenta pegado por error, el texto no lo contiene', () => {
    const NUMERO = '1234567890';
    const r = leerConsumidores(
      { CONSUMIDOR_TOKEN_X: 'token-de-mentira-del-consumidor-a', CONSUMIDOR_CUENTA_X: NUMERO },
      'cuenta-a',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(describirErrorDeConsumidores(r.error)).not.toContain(NUMERO);
  });
});

describe('verificadorDeConsumidores()', () => {
  const TOKEN_A = 'token-de-mentira-del-consumidor-a';
  const TOKEN_B = 'token-de-mentira-del-consumidor-b';
  const verificar = verificadorDeConsumidores(
    new Map([
      ['novuchat', { token: TOKEN_A, cuentaCobro: 'cuenta-a' }],
      ['otra-app', { token: TOKEN_B, cuentaCobro: 'cuenta-a' }],
    ]),
  );

  it('cada token identifica a su consumidor y lleva su cuenta en la identidad', async () => {
    await expect(verificar(TOKEN_A)).resolves.toEqual({
      tipo: 'consumidor',
      consumidorId: 'novuchat',
      cuentaCobro: 'cuenta-a',
    });
    await expect(verificar(TOKEN_B)).resolves.toEqual({
      tipo: 'consumidor',
      consumidorId: 'otra-app',
      cuentaCobro: 'cuenta-a',
    });
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
      verificadorDeConsumidores(new Map([['novuchat', { token: TOKEN_CONSUMIDOR, cuentaCobro: 'cuenta-a' }]])),
    );

    await expect(verificar(TOKEN_DUEÑO)).resolves.toEqual({ tipo: 'dueño', id: 'dueño-local' });
    await expect(verificar(TOKEN_CONSUMIDOR)).resolves.toEqual({
      tipo: 'consumidor',
      consumidorId: 'novuchat',
      cuentaCobro: 'cuenta-a',
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
    const r = leerConsumidores(
      {
        API_TOKEN_LOCAL: COMPARTIDO,
        CONSUMIDOR_TOKEN_NOVUCHAT: COMPARTIDO,
      },
      'cuenta-a',
    );
    expect(r).toEqual({ ok: false, error: { tipo: 'TOKEN_COMPARTIDO', consumidorId: 'novuchat' } });
  });

  it('dos consumidores con el mismo token tampoco arrancan', () => {
    const r = leerConsumidores(
      {
        CONSUMIDOR_TOKEN_NOVUCHAT: COMPARTIDO,
        CONSUMIDOR_CUENTA_NOVUCHAT: 'cuenta-a',
        CONSUMIDOR_TOKEN_OTRA_APP: COMPARTIDO,
        CONSUMIDOR_CUENTA_OTRA_APP: 'cuenta-a',
      },
      'cuenta-a',
    );
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
      verificadorDeConsumidores(new Map([['novuchat', { token: COMPARTIDO, cuentaCobro: 'cuenta-a' }]])),
    );
    await expect(verificar(COMPARTIDO)).resolves.toBeNull();
  });
});
