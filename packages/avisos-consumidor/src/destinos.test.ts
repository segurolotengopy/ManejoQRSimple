import { describe, expect, it } from 'vitest';

import { leerDestinos } from './destinos.js';

const SECRETO = 'secreto-de-mentira-de-32-caracter';
const URL_OK = 'https://novuchat.example/avisos/cobros';

describe('leerDestinos()', () => {
  it('lee la URL y el secreto de cada consumidor, y normaliza el identificador', () => {
    const r = leerDestinos({
      CONSUMIDOR_AVISO_URL_NOVUCHAT: URL_OK,
      CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: SECRETO,
      CONSUMIDOR_AVISO_URL_OTRA_APP: 'https://otra.example/hook',
      CONSUMIDOR_AVISO_SECRETO_OTRA_APP: SECRETO,
      OTRA_VARIABLE: 'no es de acá',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && [...r.destinos.keys()].sort()).toEqual(['novuchat', 'otra-app']);
  });

  it('sin ninguna variable no hay destinos, y no es un error', () => {
    // Es el caso normal: la mayoría de los consumidores consulta por
    // `estadoCobro` en vez de escuchar avisos.
    const r = leerDestinos({});
    expect(r.ok && r.destinos.size).toBe(0);
  });

  it('una URL sin secreto corta el arranque', () => {
    // Mandar avisos sin firmar es peor que no mandarlos: el consumidor no
    // podría distinguirlos de los que le invente cualquiera.
    const r = leerDestinos({ CONSUMIDOR_AVISO_URL_NOVUCHAT: URL_OK });
    expect(r).toEqual({ ok: false, error: { tipo: 'URL_SIN_SECRETO', consumidorId: 'novuchat' } });
  });

  it('un secreto sin URL también', () => {
    const r = leerDestinos({ CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: SECRETO });
    expect(r).toEqual({ ok: false, error: { tipo: 'SECRETO_SIN_URL', consumidorId: 'novuchat' } });
  });

  it('una URL que no es https se rechaza', () => {
    // Firmar no sirve si el canal no es privado: el aviso y su firma viajarían
    // en claro por la red de cualquiera.
    const r = leerDestinos({
      CONSUMIDOR_AVISO_URL_NOVUCHAT: 'http://novuchat.example/avisos',
      CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: SECRETO,
    });
    expect(r).toEqual({ ok: false, error: { tipo: 'URL_NO_ES_HTTPS', consumidorId: 'novuchat' } });
  });

  it.each([
    ['un secreto corto', { CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: 'corto' }, 'SECRETO_CORTO'],
    [
      'el marcador de la plantilla',
      { CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: '<secreto de firma de novuchat>' },
      'SECRETO_SIN_LLENAR',
    ],
    ['una URL que no es una URL', { CONSUMIDOR_AVISO_URL_NOVUCHAT: 'no-es-una-url' }, 'URL_INVALIDA'],
  ])('%s corta el arranque', (_caso, extra, tipo) => {
    const r = leerDestinos({
      CONSUMIDOR_AVISO_URL_NOVUCHAT: URL_OK,
      CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: SECRETO,
      ...extra,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.tipo).toBe(tipo);
  });

  it('ningún error transporta la URL ni el secreto, solo el consumidor', () => {
    // Los errores se imprimen en la terminal y pueden terminar en un log.
    const r = leerDestinos({ CONSUMIDOR_AVISO_SECRETO_NOVUCHAT: SECRETO });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain('novuchat.example');
  });
});
