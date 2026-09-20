import { describe, expect, it } from 'vitest';

import { firmar, verificarFirma } from './firma.js';

const SECRETO = 'secreto-de-mentira-para-el-test-x';
const CUERPO = '{"evento":"cobro.confirmado","idEvento":"cons-abc"}';
const AHORA = new Date('2026-09-20T12:00:00.000Z');

describe('firmar() y verificarFirma()', () => {
  it('una firma recién hecha verifica', () => {
    expect(verificarFirma(CUERPO, firmar(CUERPO, SECRETO, AHORA), SECRETO, AHORA)).toBe(true);
  });

  it('el cuerpo alterado no verifica', () => {
    // El escenario que la firma existe para impedir: alguien intercepta el
    // aviso y le cambia el importe antes de entregarlo.
    const cabecera = firmar(CUERPO, SECRETO, AHORA);
    const alterado = CUERPO.replace('cons-abc', 'cons-otro');
    expect(verificarFirma(alterado, cabecera, SECRETO, AHORA)).toBe(false);
  });

  it('otro secreto no verifica', () => {
    // Es lo que impide que cualquiera que conozca la URL del consumidor le
    // mande un aviso inventado y le haga entregar lo que vendió.
    const cabecera = firmar(CUERPO, SECRETO, AHORA);
    expect(verificarFirma(CUERPO, cabecera, 'otro-secreto-de-mentira-distinto', AHORA)).toBe(false);
  });

  it('un aviso viejo reenviado no verifica', () => {
    // Sin la marca de tiempo dentro de lo firmado, quien intercepte un aviso
    // válido podría reenviarlo cuando quisiera y la firma seguiría buena.
    const cabecera = firmar(CUERPO, SECRETO, AHORA);
    const seisMinutosDespues = new Date(AHORA.getTime() + 6 * 60_000);
    expect(verificarFirma(CUERPO, cabecera, SECRETO, seisMinutosDespues)).toBe(false);
    // Dentro de la tolerancia, sí.
    expect(verificarFirma(CUERPO, cabecera, SECRETO, new Date(AHORA.getTime() + 60_000))).toBe(true);
  });

  it('mover la marca de tiempo sin rehacer la firma no verifica', () => {
    const cabecera = firmar(CUERPO, SECRETO, AHORA);
    const conOtroT = cabecera.replace(/^t=\d+/, `t=${String(Math.floor(AHORA.getTime() / 1000) + 1)}`);
    expect(verificarFirma(CUERPO, conOtroT, SECRETO, AHORA)).toBe(false);
  });

  it.each([
    ['vacía', ''],
    ['sin marca de tiempo', 'v1=abc'],
    ['sin firma', 't=1790000000'],
    ['con una marca que no es un número', 't=ayer,v1=abc'],
    ['de otra versión del esquema', 't=1790000000,v2=abc'],
    ['con basura', 'cualquier cosa'],
  ])('una cabecera %s no verifica', (_caso, cabecera) => {
    expect(verificarFirma(CUERPO, cabecera, SECRETO, AHORA)).toBe(false);
  });

  it('la firma depende del cuerpo entero, no de su largo', () => {
    const a = firmar('{"a":1}', SECRETO, AHORA);
    const b = firmar('{"a":2}', SECRETO, AHORA);
    expect(a).not.toBe(b);
  });
});
