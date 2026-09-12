import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { almacenEnDirectorio } from './imagenes.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mqs-qr-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('almacén local de imágenes de QR', () => {
  it('guarda y devuelve el PNG por su referencia', async () => {
    const almacen = almacenEnDirectorio(join(base, 'qrs'));
    const ref = await almacen.guardar('21061401016000000007', 'iVBORw0KGgo=');
    expect(ref).toBe('archivo:21061401016000000007.png');
    expect(await almacen.leer(ref ?? '')).toBe('iVBORw0KGgo=');
  });

  it('un id del banco con caracteres raros no escribe fuera del directorio', async () => {
    const almacen = almacenEnDirectorio(join(base, 'qrs'));
    expect(await almacen.guardar('../../etc/x', 'iVBORw0KGgo=')).toBeNull();
    expect(await readdir(base)).toEqual([]);
  });

  it('una referencia que no es de este almacén no se lee', async () => {
    const almacen = almacenEnDirectorio(join(base, 'qrs'));
    expect(await almacen.leer('archivo:../secreto.png')).toBeNull();
    expect(await almacen.leer('gs://bucket/x.png')).toBeNull();
    expect(await almacen.leer('archivo:no-existe.png')).toBeNull();
  });
});
