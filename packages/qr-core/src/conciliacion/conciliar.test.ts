import { describe, expect, it } from 'vitest';

import { ORIGENES_QR } from '../cobro/cobro.js';
import { ESTADOS, ORIGENES } from '../cobro/estados.js';
import { esExito } from '../comun/resultado.js';
import { bs, enMinutos, T0, unCobroEn, unQr } from '../pruebas/fixtures.js';
import { conciliar, POLITICA_POR_DEFECTO, type PoliticaConciliacion } from './conciliar.js';
import {
  claveBaneco,
  claveHash,
  ORIGENES_DETECCION,
  QRS_DEL_RIEL,
  registrarDeteccion,
  rielCorresponde,
  type OrigenDeteccion,
} from './deteccion.js';

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

describe('el riel de la detección corresponde al QR (regla #1)', () => {
  /** La clave que produciría ese riel: solo el banco usa el espacio `baneco:`. */
  const claveDe = (riel: OrigenDeteccion): string =>
    riel === 'watcher-baneco' ? 'baneco:qr-000001:tx-1' : `${riel}:qr-000001:tx-1`;

  function conRiel(
    origenDeteccion: OrigenDeteccion,
    origenQr: (typeof ORIGENES_QR)[number],
    previas: readonly string[] = [],
    idDeduplicacion: string = claveDe(origenDeteccion),
  ) {
    return conciliar({
      cobro: unCobroEn('PAGO_DETECTADO', {
        montoCentavos: bs(MONTO),
        qrVigente: unQr({ origen: origenQr }),
      }),
      deteccion: registrarDeteccion({
        idDeduplicacion,
        montoCentavos: bs(MONTO),
        ocurridoEn: enMinutos(30),
        origen: origenDeteccion,
        referencia: null,
      }),
      deteccionesPrevias: previas,
      politica: POLITICA_POR_DEFECTO,
      ahora: enMinutos(31),
    });
  }

  const PARES = ORIGENES_DETECCION.flatMap((riel) => ORIGENES_QR.map((qr) => [riel, qr] as const));

  it.each(PARES)('detección %s sobre QR %s: monto exacto y vigente', (riel, qr) => {
    const r = conRiel(riel, qr);
    if (QRS_DEL_RIEL[riel].includes(qr)) {
      expect(esExito(r)).toBe(true);
    } else {
      expect(r).toEqual({
        ok: false,
        error: { tipo: 'RIEL_NO_CORRESPONDE', origenDeteccion: riel, origenQr: qr },
      });
    }
  });

  it('solo concilian los pares de la tabla: banco con QR del banco, simulado con QR simulado', () => {
    const aprobados = PARES.filter(([riel, qr]) => esExito(conRiel(riel, qr)));
    expect(aprobados).toEqual([
      ['watcher-baneco', 'api-baneco'],
      ['scraper-yape', 'carga-manual'],
      ['scraper-yape', 'consola-asistida'],
      ['watcher-simulado', 'simulado'],
    ]);
  });

  it('un detector simulado no confirma un QR del banco, ni al revés', () => {
    expect(conRiel('watcher-simulado', 'api-baneco')).toMatchObject({ ok: false });
    expect(conRiel('watcher-baneco', 'simulado')).toMatchObject({ ok: false });
  });

  it('el duplicado se informa antes que el riel', () => {
    expect(conRiel('watcher-simulado', 'api-baneco', [claveDe('watcher-simulado')])).toEqual({
      ok: false,
      error: { tipo: 'DUPLICADO', idDeduplicacion: claveDe('watcher-simulado') },
    });
  });

  it('el riel se comprueba antes que el monto', () => {
    const r = conciliar({
      cobro: unCobroEn('PAGO_DETECTADO', { montoCentavos: bs(MONTO), qrVigente: unQr({ origen: 'api-baneco' }) }),
      deteccion: registrarDeteccion({
        idDeduplicacion: 'x',
        montoCentavos: bs(MONTO + 1),
        ocurridoEn: enMinutos(30),
        origen: 'watcher-simulado',
        referencia: null,
      }),
      deteccionesPrevias: [],
      politica: POLITICA_POR_DEFECTO,
      ahora: enMinutos(31),
    });
    expect(!esExito(r) && r.error.tipo).toBe('RIEL_NO_CORRESPONDE');
  });

  it('exhaustividad: cada riel tiene su fila, con QRs conocidos, y es un origen de transición', () => {
    expect(Object.keys(QRS_DEL_RIEL).sort()).toEqual([...ORIGENES_DETECCION].sort());
    for (const riel of ORIGENES_DETECCION) {
      expect(QRS_DEL_RIEL[riel].length).toBeGreaterThan(0);
      for (const qr of QRS_DEL_RIEL[riel]) {
        expect(ORIGENES_QR).toContain(qr);
      }
      expect(ORIGENES).toContain(riel);
      expect(rielCorresponde(riel, QRS_DEL_RIEL[riel][0] ?? 'simulado')).toBe(true);
    }
  });

  it('todo QR tiene al menos un riel que lo paga: no hay QR imposible de confirmar', () => {
    for (const qr of ORIGENES_QR) {
      expect(ORIGENES_DETECCION.some((riel) => rielCorresponde(riel, qr))).toBe(true);
    }
  });
});
