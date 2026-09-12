import { describe, expect, it } from 'vitest';

import type { LineaLog } from './api.js';
import { filtrarLogs, lineaDeError } from './formatoLogs.js';

const l = (n: number, origen: LineaLog['origen'], nivel: LineaLog['nivel'], en: string): LineaLog => ({
  n,
  en,
  nivel,
  origen,
  texto: `línea ${String(n)}`,
});

const LINEAS = [
  l(2, 'banco', 'aviso', '2026-09-12T12:00:02.000Z'),
  l(1, 'api', 'info', '2026-09-12T12:00:01.000Z'),
  l(1, 'consola', 'error', '2026-09-12T12:00:03.000Z'),
];

describe('filtrarLogs()', () => {
  it('junta API y consola en orden cronológico', () => {
    expect(filtrarLogs(LINEAS, 'todo').map((x) => x.origen)).toEqual(['api', 'banco', 'consola']);
  });

  it('filtra por origen o por gravedad', () => {
    expect(filtrarLogs(LINEAS, 'banco')).toHaveLength(1);
    expect(filtrarLogs(LINEAS, 'problemas').map((x) => x.nivel)).toEqual(['aviso', 'error']);
  });
});

describe('lineaDeError()', () => {
  it('lleva el código, el estado y el detalle técnico del banco', () => {
    const linea = lineaDeError(
      {
        codigo: 'PROVEEDOR_RECHAZO',
        mensaje: 'Un servicio externo rechazó la operación.',
        status: 502,
        detalle: { tipo: 'RECHAZADO_POR_PROVEEDOR', codigoProveedor: '57', mensajeTecnico: 'x' },
      },
      7,
      new Date('2026-09-12T12:00:00.000Z'),
    );
    expect(linea).toMatchObject({ n: 7, nivel: 'error', origen: 'consola' });
    expect(linea.texto).toBe(
      'PROVEEDOR_RECHAZO (HTTP 502): Un servicio externo rechazó la operación. · RECHAZADO_POR_PROVEEDOR responseCode 57',
    );
  });
});
