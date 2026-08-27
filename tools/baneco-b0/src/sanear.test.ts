import { describe, expect, it } from 'vitest';

import { sanear, verificarSinSecretos } from './sanear.js';

const RESPUESTA_CRUDA = {
  statusQrCode: 1,
  payment: [
    {
      qrId: '21061401016000000006',
      transactionId: '1236342',
      paymentDate: '2021-06-14T00:00:00',
      paymentTime: '17:06:29',
      currency: 'BOB',
      amount: 150.5,
      senderBankCode: '1016',
      senderName: 'JUAN PEREZ QUISPE',
      senderDocumentId: '1234567 LP',
      senderAccount: '******1913',
      description: 'B0-20260827-1',
      branchCode: 'E0001',
    },
  ],
  responseCode: 0,
  message: '',
};

describe('sanear()', () => {
  const saneado = sanear(RESPUESTA_CRUDA);
  const texto = JSON.stringify(saneado);

  it.each([
    ['nombre del pagador', 'JUAN PEREZ QUISPE'],
    ['documento del pagador', '1234567 LP'],
    ['cuenta del pagador', '******1913'],
  ])('quita el %s', (_campo, valor) => {
    expect(texto).not.toContain(valor);
  });

  it('conserva lo que sí sirve de fixture', () => {
    expect(texto).toContain('21061401016000000006');
    expect(texto).toContain('1236342');
    expect(texto).toContain('150.5');
    expect(texto).toContain('17:06:29');
  });

  it('sanea en profundidad, dentro de arrays y objetos anidados', () => {
    const anidado = sanear({ a: { b: [{ senderName: 'SECRETO' }] } });
    expect(JSON.stringify(anidado)).not.toContain('SECRETO');
  });

  it('conserva el null en vez de reemplazarlo por un marcador', () => {
    // Un null informa que el banco no mandó el campo; el marcador diría que sí.
    const r = sanear({ senderName: null }) as { senderName: unknown };
    expect(r.senderName).toBeNull();
  });

  it('recorta la imagen del QR, que no aporta nada a la fixture', () => {
    const r = sanear({ qrImage: 'x'.repeat(5000) }) as { qrImage: string };
    expect(r.qrImage).toBe('<<qrImage de 5000 caracteres, recortado>>');
  });

  it('quita también los campos cifrados que mandamos nosotros', () => {
    const r = JSON.stringify(sanear({ accountCredit: 'AbC123==', password: 'XyZ==' }));
    expect(r).not.toContain('AbC123==');
    expect(r).not.toContain('XyZ==');
  });

  it('no rompe con tipos primitivos ni con undefined', () => {
    expect(sanear(42)).toBe(42);
    expect(sanear('texto')).toBe('texto');
    expect(sanear(null)).toBeNull();
    expect(sanear(undefined)).toBeUndefined();
  });
});

describe('verificarSinSecretos()', () => {
  const secretos = {
    llaveAes: '0123456789abcdef0123456789abcdef',
    password: 'password-de-prueba',
    cuentaAbono: '1234567890',
  };

  it('acepta una respuesta saneada que no contiene ningún secreto', () => {
    expect(verificarSinSecretos(sanear(RESPUESTA_CRUDA), secretos)).toBeNull();
  });

  it('atrapa un secreto en un campo que la lista de redacción no contempla', () => {
    // Esta es la razón de ser de la segunda capa: si el banco agrega un campo
    // nuevo, la lista queda desactualizada pero esta verificación no.
    const conFuga = { campoNuevoDelBanco: '1234567890' };
    expect(verificarSinSecretos(conFuga, secretos)).toEqual({
      motivo: 'CONTIENE_SECRETO',
      pista: 'cuentaAbono',
    });
  });

  it('reporta qué secreto apareció, nunca su valor', () => {
    const error = verificarSinSecretos({ x: secretos.llaveAes }, secretos);
    expect(error?.pista).toBe('llaveAes');
    expect(JSON.stringify(error)).not.toContain(secretos.llaveAes);
  });

  it('ignora secretos demasiado cortos para ser buscados sin falsos positivos', () => {
    expect(verificarSinSecretos({ a: 'texto con 0 adentro' }, { corto: '0' })).toBeNull();
  });
});
