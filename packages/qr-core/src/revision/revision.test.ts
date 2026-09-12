import { describe, expect, it } from 'vitest';

import type { EstadoCobro } from '../cobro/estados.js';
import type { RegistroEvidencia, TipoEvento, ValorEvidencia } from '../cobro/maquina-estados.js';
import { enMinutos, unCobroEn } from '../pruebas/fixtures.js';
import {
  construirCaso,
  nivelDeAlerta,
  ordenarCasos,
  POLITICA_REVISION_POR_DEFECTO,
  resumirRevision,
  ultimaDeteccion,
  type CasoRevision,
  type NivelAlerta,
} from './revision.js';

const POLITICA = POLITICA_REVISION_POR_DEFECTO;

function reg(
  evento: TipoEvento,
  desde: EstadoCobro,
  hacia: EstadoCobro,
  minutos: number,
  datos: Record<string, ValorEvidencia> = {},
): RegistroEvidencia {
  return { cobroId: 'cobro-1', desde, hacia, evento, origen: 'sistema', registradoEn: enMinutos(minutos), datos };
}

const DETECCION = {
  idDeduplicacion: 'baneco:qr-000001:tx-1',
  montoCentavos: 12_344,
  ocurridoEn: enMinutos(30).toISOString(),
  origenDeteccion: 'watcher-baneco',
};

/** El rastro de un abono por un centavo menos: detectado y rechazado por la conciliación. */
const MONTO_DISTINTO: readonly RegistroEvidencia[] = [
  reg('QR_EMITIDO', 'BORRADOR', 'QR_ACTIVO', 0),
  reg('QR_ENVIADO', 'QR_ACTIVO', 'ENVIADO', 1),
  reg('PAGO_DETECTADO', 'ENVIADO', 'PAGO_DETECTADO', 31, DETECCION),
  reg('CONCILIACION_FALLIDA', 'PAGO_DETECTADO', 'EN_REVISION', 31, { motivo: 'MONTO_NO_COINCIDE' }),
];

/** Comprobante sin pago en el banco: la ventana se agotó. */
const SIN_PAGO: readonly RegistroEvidencia[] = [
  reg('QR_EMITIDO', 'BORRADOR', 'QR_ACTIVO', 0),
  reg('QR_ENVIADO', 'QR_ACTIVO', 'ENVIADO', 1),
  reg('COMPROBANTE_RECIBIDO', 'ENVIADO', 'COMPROBANTE_RECIBIDO', 20, { referenciaComprobante: 'wa-1' }),
  reg('VENTANA_AGOTADA', 'COMPROBANTE_RECIBIDO', 'EN_REVISION', 60),
];

describe('construirCaso()', () => {
  it('toma el motivo, la entrada a revisión y el abono de la evidencia', () => {
    const caso = construirCaso(unCobroEn('EN_REVISION'), MONTO_DISTINTO, enMinutos(31 + 60), POLITICA);
    expect(caso.motivo).toBe('MONTO_NO_COINCIDE');
    expect(caso.enRevisionDesde).toEqual(enMinutos(31));
    expect(caso.horasEnRevision).toBe(1);
    expect(caso.abono).toEqual({
      idDeduplicacion: 'baneco:qr-000001:tx-1',
      montoCentavos: 12_344,
      ocurridoEn: enMinutos(30),
    });
  });

  it('sin abono del banco, el caso no tiene detección que aceptar', () => {
    const caso = construirCaso(unCobroEn('EN_REVISION'), SIN_PAGO, enMinutos(120), POLITICA);
    expect(caso.motivo).toBe('VENTANA_AGOTADA');
    expect(caso.abono).toBeNull();
  });

  it('un abono adjuntado después no cambia desde cuándo está en revisión', () => {
    const conAbonoTardio = [
      ...SIN_PAGO,
      reg('DETECCION_EN_REVISION', 'EN_REVISION', 'EN_REVISION', 600, DETECCION),
    ];
    const caso = construirCaso(unCobroEn('EN_REVISION'), conAbonoTardio, enMinutos(660), POLITICA);
    expect(caso.enRevisionDesde).toEqual(enMinutos(60));
    expect(caso.motivo).toBe('VENTANA_AGOTADA');
    expect(caso.abono?.idDeduplicacion).toBe('baneco:qr-000001:tx-1');
  });

  it('un motivo de conciliación desconocido se muestra como OTRO, no se inventa', () => {
    const raro = [reg('CONCILIACION_FALLIDA', 'PAGO_DETECTADO', 'EN_REVISION', 5, { motivo: 'SIN_QR_EMITIDO' })];
    expect(construirCaso(unCobroEn('EN_REVISION'), raro, enMinutos(10), POLITICA).motivo).toBe('OTRO');
  });
});

describe('ultimaDeteccion()', () => {
  it('ignora registros con datos malformados en vez de inventar un abono', () => {
    const malformado = [reg('PAGO_DETECTADO', 'ENVIADO', 'PAGO_DETECTADO', 5, { idDeduplicacion: 'x', montoCentavos: 1.5 })];
    expect(ultimaDeteccion(malformado)).toBeNull();
  });
});

describe('nivelDeAlerta() — con plata recibida se alerta antes', () => {
  it.each([
    [3, true, 'AL_DIA'],
    [4, true, 'ATRASADO'],
    [24, true, 'CRITICO'],
    [23, false, 'AL_DIA'],
    [24, false, 'ATRASADO'],
    [72, false, 'CRITICO'],
  ] as const)('%p h, con abono=%p → %s', (horas, conAbono, esperado) => {
    expect(nivelDeAlerta(horas, conAbono, POLITICA)).toBe(esperado);
  });
});

describe('ordenarCasos() y resumirRevision()', () => {
  const caso = (id: string, nivel: NivelAlerta, horas: number): CasoRevision => ({
    cobro: unCobroEn('EN_REVISION', { id }),
    motivo: 'OTRO',
    enRevisionDesde: enMinutos(0),
    horasEnRevision: horas,
    abono: null,
    nivel,
  });
  const casos = [caso('a', 'AL_DIA', 1), caso('b', 'CRITICO', 80), caso('c', 'ATRASADO', 30), caso('d', 'CRITICO', 100)];

  it('lo más urgente primero y, a igual urgencia, lo más viejo', () => {
    expect(ordenarCasos(casos).map((c) => c.cobro.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('cuenta críticos y atrasados', () => {
    expect(resumirRevision(casos)).toEqual({ total: 4, criticos: 2, atrasados: 1 });
  });
});
