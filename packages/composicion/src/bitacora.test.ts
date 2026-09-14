import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bitacora, diaBoliviano } from './bitacora.js';

let base: string;
const dir = (): string => join(base, 'logs');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mqs-bitacora-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('Bitacora', () => {
  it('lo escrito sobrevive a un reinicio: otra instancia lo lee', () => {
    // Es el motivo de todo esto: el responseCode de ayer se tiene que poder leer hoy.
    new Bitacora(dir(), 'api').escribir('aviso', 'banco', 'DELETE /cancelQR → HTTP 200 · responseCode 403', new Date('2026-09-14T05:01:30.000Z'));
    const releida = new Bitacora(dir(), 'api').leerUltimas(10, ['api']);
    expect(releida).toEqual([
      {
        en: '2026-09-14T05:01:30.000Z',
        nivel: 'aviso',
        origen: 'banco',
        proceso: 'api',
        texto: 'DELETE /cancelQR → HTTP 200 · responseCode 403',
      },
    ]);
  });

  it('sanea antes de tocar el disco', () => {
    new Bitacora(dir(), 'api').escribir('error', 'api', 'falló con Bearer secreto · cuenta 1234567890 · tel +59171234567');
    const [archivo] = readdirSync(dir());
    const crudo = readFileSync(join(dir(), archivo ?? ''), 'utf8');
    expect(crudo).not.toContain('secreto');
    expect(crudo).not.toContain('1234567890');
    expect(crudo).not.toContain('71234567');
  });

  it('un archivo por proceso y por día de Bolivia, con permisos 600 en un directorio 700', () => {
    // 02:00 UTC del 14 son las 22:00 del 13 en Bolivia.
    new Bitacora(dir(), 'satelite').escribir('info', 'satelite', 'cierre', new Date('2026-09-14T02:00:00.000Z'));
    expect(readdirSync(dir())).toEqual(['satelite-2026-09-13.jsonl']);
    expect(statSync(join(dir(), 'satelite-2026-09-13.jsonl')).mode & 0o777).toBe(0o600);
    expect(statSync(dir()).mode & 0o777).toBe(0o700);
  });

  it('junta los procesos pedidos en orden cronológico y respeta el tope', () => {
    const api = new Bitacora(dir(), 'api');
    const satelite = new Bitacora(dir(), 'satelite');
    satelite.escribir('info', 'satelite', 's1', new Date('2026-09-13T12:00:00.000Z'));
    api.escribir('info', 'api', 'a1', new Date('2026-09-13T12:00:01.000Z'));
    satelite.escribir('info', 'satelite', 's2', new Date('2026-09-14T12:00:00.000Z'));

    expect(api.leerUltimas(10, ['api', 'satelite']).map((e) => e.texto)).toEqual(['s1', 'a1', 's2']);
    expect(api.leerUltimas(2, ['api', 'satelite']).map((e) => e.texto)).toEqual(['a1', 's2']);
    expect(api.leerUltimas(10, ['satelite']).map((e) => e.texto)).toEqual(['s1', 's2']);
  });

  it('saltea líneas corruptas y archivos ajenos, y vuelve a sanear al leer', () => {
    const bitacora = new Bitacora(dir(), 'api');
    bitacora.escribir('info', 'api', 'buena', new Date('2026-09-13T12:00:00.000Z'));
    writeFileSync(join(dir(), 'api-2026-09-12.jsonl'), 'no-json\n{"en":"x"}\n' +
      `${JSON.stringify({ en: '2026-09-12T12:00:00.000Z', nivel: 'info', origen: 'api', proceso: 'api', texto: 'editada con Bearer abc' })}\n`);
    writeFileSync(join(dir(), 'notas.txt'), 'nada');

    expect(bitacora.leerUltimas(10, ['api']).map((e) => e.texto)).toEqual(['editada con Bearer ***', 'buena']);
  });

  it('si no puede escribir, avisa una sola vez y no rompe el proceso', () => {
    writeFileSync(join(base, 'archivo'), '');
    const avisos: string[] = [];
    // El "directorio" es un archivo: mkdir falla siempre.
    const bitacora = new Bitacora(join(base, 'archivo', 'logs'), 'api', (m) => avisos.push(m));
    expect(() => {
      bitacora.escribir('info', 'api', 'uno');
      bitacora.escribir('info', 'api', 'dos');
    }).not.toThrow();
    expect(avisos).toHaveLength(1);
    expect(bitacora.leerUltimas(10, ['api'])).toEqual([]);
  });
});

describe('diaBoliviano()', () => {
  it('usa UTC-4', () => {
    expect(diaBoliviano(new Date('2026-09-14T03:59:59.000Z'))).toBe('2026-09-13');
    expect(diaBoliviano(new Date('2026-09-14T04:00:00.000Z'))).toBe('2026-09-14');
  });
});

describe('Bitacora: garantías que no dependen de cómo se creó el directorio', () => {
  it('corrige a 700/600 un directorio y un archivo que ya existían abiertos', () => {
    mkdirSync(dir(), { mode: 0o777 });
    chmodSync(dir(), 0o777);
    const archivo = join(dir(), 'api-2026-09-13.jsonl');
    writeFileSync(archivo, '', { mode: 0o666 });
    chmodSync(archivo, 0o666);

    new Bitacora(dir(), 'api').escribir('info', 'api', 'x', new Date('2026-09-13T12:00:00.000Z'));
    expect(statSync(dir()).mode & 0o777).toBe(0o700);
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
  });

  it('no sigue un enlace simbólico puesto en lugar del archivo del día', () => {
    mkdirSync(dir(), { mode: 0o700 });
    const victima = join(base, 'victima.txt');
    writeFileSync(victima, 'original');
    symlinkSync(victima, join(dir(), 'api-2026-09-13.jsonl'));
    const avisos: string[] = [];

    new Bitacora(dir(), 'api', (m) => avisos.push(m)).escribir('info', 'api', 'x', new Date('2026-09-13T12:00:00.000Z'));
    expect(readFileSync(victima, 'utf8')).toBe('original');
    expect(avisos).toHaveLength(1);
  });

  it('respeta el tope por archivo: nadie llena el disco a fuerza de pedidos', () => {
    const avisos: string[] = [];
    const bitacora = new Bitacora(dir(), 'api', (m) => avisos.push(m), { topeBytes: 300 });
    const en = new Date('2026-09-13T12:00:00.000Z');
    for (let i = 0; i < 20; i += 1) {
      bitacora.escribir('info', 'api', `línea ${String(i)}`, en);
    }
    expect(statSync(join(dir(), 'api-2026-09-13.jsonl')).size).toBeLessThan(300 + 200);
    expect(avisos).toHaveLength(1);
  });

  it('recorta un texto enorme antes de escribirlo', () => {
    const e = new Bitacora(dir(), 'api').escribir('aviso', 'api', `GET /${'x'.repeat(20_000)} → 401`);
    expect(e.texto.length).toBeLessThanOrEqual(500);
  });

  it('lee solo la cola del archivo: la pestaña Logs no carga archivos enteros', () => {
    const bitacora = new Bitacora(dir(), 'satelite', undefined, { colaBytes: 400 });
    const en = new Date('2026-09-13T12:00:00.000Z');
    for (let i = 0; i < 50; i += 1) {
      bitacora.escribir('info', 'satelite', `línea ${String(i).padStart(2, '0')}`, new Date(en.getTime() + i * 1000));
    }
    const leidas = bitacora.leerUltimas(100, ['satelite']).map((e) => e.texto);
    expect(leidas.length).toBeGreaterThan(0);
    expect(leidas.length).toBeLessThan(50);
    expect(leidas.at(-1)).toBe('línea 49');
    // Ninguna línea cortada: todas parsean completas.
    expect(leidas.every((t) => t.startsWith('línea '))).toBe(true);
  });
});
