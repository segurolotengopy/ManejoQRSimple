import { describe, expect, it } from 'vitest';

import { ESTADOS } from '../cobro/estados.js';
import { esExito } from '../comun/resultado.js';
import { bs, enMinutos, T0, unCobroEn, unQr } from '../pruebas/fixtures.js';
import { conciliar, POLITICA_POR_DEFECTO, type PoliticaConciliacion } from './conciliar.js';
import { claveBaneco, claveHash, registrarDeteccion } from './deteccion.js';

const MONTO = 12_345;

function unaDeteccion(sobrescribir: Partial<{ monto: number; ocurridoEn: Date; id: string }> = {}) {
  return registrarDeteccion({
    idDeduplicacion: sobrescribir.id ?? 'baneco:qr-000001:tx-1',
    montoCentavos: bs(sobrescribir.monto ?? MONTO),
    ocurridoEn: sobrescribir.ocurridoEn ?? enMinutos(30),
    origen: 'watcher-baneco',
    referencia: 'Pago servicio',
  });
}

function conciliarCon(
  args: Partial<{
    monto: number;
    ocurridoEn: Date;
    id: string;
    previas: readonly string[];
    politica: PoliticaConciliacion;
    estado: (typeof ESTADOS)[number];
    sinQr: boolean;
  }> = {},
) {
  const cobro = unCobroEn(args.estado ?? 'PAGO_DETECTADO', {
    montoCentavos: bs(MONTO),
    ...(args.sinQr === true ? { qrVigente: null } : {}),
  });
  return conciliar({
    cobro,
    deteccion: unaDeteccion(args),
    deteccionesPrevias: args.previas ?? [],
    politica: args.politica ?? POLITICA_POR_DEFECTO,
    ahora: enMinutos(31),
  });
}

describe('monto exacto', () => {
  it('concilia cuando el monto coincide al centavo', () => {
    const r = conciliarCon();
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobroId).toBe('cobro-1');
      expect(r.valor.montoCentavos).toBe(MONTO);
    }
  });

  it.each([MONTO - 1, MONTO + 1, MONTO - 100, 0])(
    'rechaza el monto %p: no hay tolerancia de monto',
    (monto) => {
      expect(conciliarCon({ monto })).toEqual({
        ok: false,
        error: { tipo: 'MONTO_NO_COINCIDE', esperado: MONTO, recibido: monto },
      });
    },
  );
});

describe('vigencia', () => {
  // El QR de fixture vence 72 h después de T0.
  const VENCE_EN_MINUTOS = 72 * 60;

  it('concilia un abono dentro de la vigencia', () => {
    expect(esExito(conciliarCon({ ocurridoEn: enMinutos(VENCE_EN_MINUTOS - 1) }))).toBe(true);
  });

  it('concilia justo en el instante del vencimiento', () => {
    expect(esExito(conciliarCon({ ocurridoEn: enMinutos(VENCE_EN_MINUTOS) }))).toBe(true);
  });

  it('concilia dentro de la tolerancia posterior al vencimiento', () => {
    // La tolerancia existe porque el reloj del banco no es el nuestro.
    const dentro = enMinutos(VENCE_EN_MINUTOS + POLITICA_POR_DEFECTO.toleranciaVencimientoMinutos);
    expect(esExito(conciliarCon({ ocurridoEn: dentro }))).toBe(true);
  });

  it('rechaza pasado el último minuto de tolerancia', () => {
    const fuera = enMinutos(
      VENCE_EN_MINUTOS + POLITICA_POR_DEFECTO.toleranciaVencimientoMinutos + 1,
    );
    const r = conciliarCon({ ocurridoEn: fuera });
    expect(esExito(r)).toBe(false);
    if (!esExito(r)) {
      expect(r.error.tipo).toBe('FUERA_DE_VIGENCIA');
    }
  });

  it('respeta una tolerancia configurada distinta', () => {
    const politica: PoliticaConciliacion = { toleranciaVencimientoMinutos: 0 };
    const unMinutoTarde = enMinutos(VENCE_EN_MINUTOS + 1);
    expect(esExito(conciliarCon({ ocurridoEn: unMinutoTarde, politica }))).toBe(false);
    expect(esExito(conciliarCon({ ocurridoEn: enMinutos(VENCE_EN_MINUTOS), politica }))).toBe(true);
  });
});

describe('idempotencia (regla #7)', () => {
  it('rechaza un abono ya conciliado antes', () => {
    const id = 'baneco:qr-000001:tx-1';
    expect(conciliarCon({ id, previas: [id] })).toEqual({
      ok: false,
      error: { tipo: 'DUPLICADO', idDeduplicacion: id },
    });
  });

  it('la segunda pasada del watcher sobre el mismo abono no produce otra confirmación', () => {
    const primera = conciliarCon();
    expect(esExito(primera)).toBe(true);
    if (!esExito(primera)) return;

    const segunda = conciliarCon({ previas: [primera.valor.idDeduplicacion] });
    expect(esExito(segunda)).toBe(false);
  });

  it('un abono distinto del mismo cobro sí concilia', () => {
    expect(esExito(conciliarCon({ id: 'baneco:qr-000001:tx-2', previas: ['otra-clave'] }))).toBe(
      true,
    );
  });
});

describe('estado del cobro', () => {
  const otros = ESTADOS.filter((e) => e !== 'PAGO_DETECTADO');

  it.each(otros)('rechaza conciliar un cobro en %s', (estado) => {
    // La detección es del adaptador; la conciliación llega después, nunca antes.
    expect(conciliarCon({ estado })).toEqual({
      ok: false,
      error: { tipo: 'ESTADO_NO_CONCILIABLE', estado },
    });
  });

  it('rechaza conciliar un cobro sin QR emitido', () => {
    expect(conciliarCon({ sinQr: true })).toEqual({
      ok: false,
      error: { tipo: 'SIN_QR_EMITIDO' },
    });
  });
});

describe('claves de deduplicación', () => {
  it('Baneco usa los identificadores del banco, sin hashear', () => {
    expect(claveBaneco('qr-1', 'tx-9')).toBe('baneco:qr-1:tx-9');
  });

  it('el hash es estable entre pasadas con los mismos datos', () => {
    const datos = {
      proveedor: 'yape',
      ocurridoEn: T0,
      montoCentavos: bs(MONTO),
      referencia: 'ref-1',
    };
    expect(claveHash(datos)).toBe(claveHash({ ...datos }));
  });

  it.each([
    ['monto', { montoCentavos: bs(MONTO + 1) }],
    ['fecha', { ocurridoEn: enMinutos(1) }],
    ['referencia', { referencia: 'ref-2' }],
  ])('el hash cambia si cambia %s', (_campo, cambio) => {
    const base = {
      proveedor: 'yape',
      ocurridoEn: T0,
      montoCentavos: bs(MONTO),
      referencia: 'ref-1' as string | null,
    };
    expect(claveHash({ ...base, ...cambio })).not.toBe(claveHash(base));
  });
});

describe('el QR vencido no bloquea por sí solo', () => {
  it('un abono puntual sobre un QR de vigencia corta concilia igual', () => {
    const cobro = unCobroEn('PAGO_DETECTADO', {
      montoCentavos: bs(MONTO),
      qrVigente: unQr({ venceEn: enMinutos(60) }),
    });
    const r = conciliar({
      cobro,
      deteccion: unaDeteccion({ ocurridoEn: enMinutos(59) }),
      deteccionesPrevias: [],
      politica: POLITICA_POR_DEFECTO,
      ahora: enMinutos(60),
    });
    expect(esExito(r)).toBe(true);
  });
});
