import { describe, expect, it } from 'vitest';

import { esExito, esFallo } from '../comun/resultado.js';
import {
  conciliar,
  POLITICA_POR_DEFECTO,
  type ConciliacionAprobada,
} from '../conciliacion/conciliar.js';
import { registrarDeteccion } from '../conciliacion/deteccion.js';
import { bs, enMinutos, T0, unCobro, unCobroEn, unQr } from '../pruebas/fixtures.js';
import { ESTADOS, ESTADOS_TERMINALES, type EstadoCobro } from './estados.js';
import { transicionar, type EventoCobro, type TipoEvento } from './maquina-estados.js';

/** Una detección que concilia contra el cobro por defecto. */
const deteccionValida = registrarDeteccion({
  idDeduplicacion: 'baneco:qr-000001:tx-1',
  montoCentavos: bs(12_345),
  ocurridoEn: enMinutos(30),
  origen: 'watcher-baneco',
  referencia: 'Pago servicio',
});

/** Conciliación aprobada real: el único camino a CONFIRMADO. */
function conciliacionDe(cobroId: string) {
  const r = conciliar({
    cobro: unCobroEn('PAGO_DETECTADO', { id: cobroId }),
    deteccion: deteccionValida,
    deteccionesPrevias: [],
    politica: POLITICA_POR_DEFECTO,
    ahora: enMinutos(31),
  });
  if (!esExito(r)) {
    throw new Error('la conciliación de fixture debería aprobar');
  }
  return r.valor;
}

/** Un evento válido de cada tipo, para recorrer la matriz completa. */
function eventoDe(tipo: TipoEvento, cobroId = 'cobro-1'): EventoCobro {
  switch (tipo) {
    case 'QR_EMITIDO':
      return { tipo, qr: unQr(), origen: 'sistema' };
    case 'QR_ENVIADO':
      return { tipo, origen: 'sistema' };
    case 'COMPROBANTE_RECIBIDO':
      return { tipo, referenciaComprobante: 'wa-msg-1', origen: 'webhook-whatsapp' };
    case 'PAGO_DETECTADO':
      return { tipo, deteccion: deteccionValida, origen: 'watcher-baneco' };
    case 'PAGO_CONCILIADO':
      return { tipo, conciliacion: conciliacionDe(cobroId), origen: 'sistema' };
    case 'CONCILIACION_FALLIDA':
      return { tipo, motivo: { tipo: 'SIN_QR_EMITIDO' }, origen: 'sistema' };
    case 'QR_VENCIDO':
      return { tipo, origen: 'sistema' };
    case 'QR_RENOVADO':
      return { tipo, qr: unQr({ qrVersion: 2 }), origen: 'sistema' };
    case 'VENTANA_AGOTADA':
      return { tipo, origen: 'sistema' };
    case 'RESUELTO_MANUALMENTE':
      return { tipo, decision: 'RECHAZADO', motivo: 'no aparece el abono', origen: 'accion-manual' };
    case 'ANULADO':
      return { tipo, motivo: 'el cliente desistió', origen: 'accion-manual' };
  }
}

/** La tabla de CLAUDE.md, escrita a mano para contrastarla con la implementación. */
const TRANSICIONES_ESPERADAS: ReadonlyArray<readonly [EstadoCobro, TipoEvento, EstadoCobro]> = [
  ['BORRADOR', 'QR_EMITIDO', 'QR_ACTIVO'],
  ['QR_ACTIVO', 'QR_ENVIADO', 'ENVIADO'],
  ['ENVIADO', 'COMPROBANTE_RECIBIDO', 'COMPROBANTE_RECIBIDO'],
  ['ENVIADO', 'PAGO_DETECTADO', 'PAGO_DETECTADO'],
  ['COMPROBANTE_RECIBIDO', 'PAGO_DETECTADO', 'PAGO_DETECTADO'],
  ['PAGO_DETECTADO', 'PAGO_CONCILIADO', 'CONFIRMADO'],
  ['PAGO_DETECTADO', 'CONCILIACION_FALLIDA', 'EN_REVISION'],
  ['COMPROBANTE_RECIBIDO', 'VENTANA_AGOTADA', 'EN_REVISION'],
  ['QR_ACTIVO', 'QR_VENCIDO', 'VENCIDO'],
  ['ENVIADO', 'QR_VENCIDO', 'VENCIDO'],
  ['VENCIDO', 'QR_RENOVADO', 'QR_ACTIVO'],
  ['EN_REVISION', 'RESUELTO_MANUALMENTE', 'RECHAZADO'],
  ['BORRADOR', 'ANULADO', 'ANULADO'],
  ['QR_ACTIVO', 'ANULADO', 'ANULADO'],
  ['ENVIADO', 'ANULADO', 'ANULADO'],
  ['VENCIDO', 'ANULADO', 'ANULADO'],
];

describe('transiciones permitidas', () => {
  it.each(TRANSICIONES_ESPERADAS)('%s + %s → %s', (desde, tipo, hacia) => {
    const cobro = unCobroEn(desde);
    const r = transicionar(cobro, eventoDe(tipo), T0);

    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobro.estado).toBe(hacia);
      expect(r.valor.evidencia.desde).toBe(desde);
      expect(r.valor.evidencia.hacia).toBe(hacia);
    }
  });

  it('EN_REVISION puede resolverse a CONFIRMADO por acción manual del dueño', () => {
    const r = transicionar(
      unCobroEn('EN_REVISION'),
      {
        tipo: 'RESUELTO_MANUALMENTE',
        decision: 'CONFIRMADO',
        motivo: 'abono verificado a mano en la consola',
        origen: 'accion-manual',
      },
      T0,
    );
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobro.estado).toBe('CONFIRMADO');
      // Queda marcado como manual justamente para que sea auditable.
      expect(r.valor.evidencia.origen).toBe('accion-manual');
    }
  });
});

describe('matriz completa: todo lo que no está en la tabla se rechaza', () => {
  const permitidas = new Set(TRANSICIONES_ESPERADAS.map(([d, e]) => `${d}|${e}`));
  // La resolución manual a CONFIRMADO es la misma transición con otra decisión.
  permitidas.add('EN_REVISION|RESUELTO_MANUALMENTE');

  const pares = ESTADOS.flatMap((estado) =>
    (Object.keys(eventosPorTipo()) as TipoEvento[]).map((tipo) => [estado, tipo] as const),
  );

  it.each(pares.filter(([e, t]) => !permitidas.has(`${e}|${t}`)))(
    'rechaza %s + %s',
    (estado, tipo) => {
      const r = transicionar(unCobroEn(estado), eventoDe(tipo), T0);
      expect(esFallo(r)).toBe(true);
    },
  );
});

/** Sirve solo para enumerar los tipos de evento sin repetir la lista. */
function eventosPorTipo(): Record<TipoEvento, true> {
  return {
    QR_EMITIDO: true,
    QR_ENVIADO: true,
    COMPROBANTE_RECIBIDO: true,
    PAGO_DETECTADO: true,
    PAGO_CONCILIADO: true,
    CONCILIACION_FALLIDA: true,
    QR_VENCIDO: true,
    QR_RENOVADO: true,
    VENTANA_AGOTADA: true,
    RESUELTO_MANUALMENTE: true,
    ANULADO: true,
  };
}

describe('estados terminales', () => {
  it.each(ESTADOS_TERMINALES)('%s no acepta ninguna transición', (estado) => {
    for (const tipo of Object.keys(eventosPorTipo()) as TipoEvento[]) {
      const r = transicionar(unCobroEn(estado), eventoDe(tipo), T0);
      expect(r).toEqual({ ok: false, error: { tipo: 'COBRO_TERMINAL', estado } });
    }
  });
});

describe('CONFIRMADO solo por conciliación (reglas #1 y BANECO-1)', () => {
  it('confirma con una conciliación aprobada del mismo cobro', () => {
    const cobro = unCobroEn('PAGO_DETECTADO');
    const r = transicionar(
      cobro,
      { tipo: 'PAGO_CONCILIADO', conciliacion: conciliacionDe(cobro.id), origen: 'sistema' },
      T0,
    );
    expect(esExito(r) && r.valor.cobro.estado).toBe('CONFIRMADO');
  });

  it('rechaza la conciliación que pertenece a OTRO cobro', () => {
    // Sin esta guarda, el pago de un cobro confirmaría uno distinto.
    const cobro = unCobroEn('PAGO_DETECTADO', { id: 'cobro-1' });
    const r = transicionar(
      cobro,
      { tipo: 'PAGO_CONCILIADO', conciliacion: conciliacionDe('cobro-2'), origen: 'sistema' },
      T0,
    );
    expect(r).toEqual({
      ok: false,
      error: { tipo: 'CONCILIACION_DE_OTRO_COBRO', cobroId: 'cobro-1', conciliacionDe: 'cobro-2' },
    });
  });

  it('no se puede fabricar una ConciliacionAprobada por fuera de conciliar()', () => {
    // Test de compilación: si algún día el tipo dejara de estar marcado, el
    // objeto literal compilaría y `@ts-expect-error` pasaría a ser un error de
    // "directiva no usada" — o sea, `npm run typecheck` se pondría en rojo.
    // @ts-expect-error falta la marca nominal, y su símbolo no se exporta.
    const falsificada: ConciliacionAprobada = {
      cobroId: 'cobro-1',
      idDeduplicacion: 'inventado',
      montoCentavos: bs(12_345),
      conciliadoEn: T0,
    };
    expect(falsificada.cobroId).toBe('cobro-1');
  });

  it('un comprobante de WhatsApp no acerca el cobro a CONFIRMADO', () => {
    const r = transicionar(
      unCobroEn('ENVIADO'),
      { tipo: 'COMPROBANTE_RECIBIDO', referenciaComprobante: 'wa-1', origen: 'webhook-whatsapp' },
      T0,
    );
    expect(esExito(r) && r.valor.cobro.estado).toBe('COMPROBANTE_RECIBIDO');
  });

  it('una detección sin conciliar tampoco confirma', () => {
    const r = transicionar(
      unCobroEn('ENVIADO'),
      { tipo: 'PAGO_DETECTADO', deteccion: deteccionValida, origen: 'watcher-baneco' },
      T0,
    );
    expect(esExito(r) && r.valor.cobro.estado).toBe('PAGO_DETECTADO');
  });
});

describe('vencimiento y renovación (regla #6)', () => {
  it('renovar incrementa la versión sobre el mismo cobro, no crea otro', () => {
    const cobro = unCobroEn('VENCIDO', { qrVersion: 1 });
    const r = transicionar(
      cobro,
      { tipo: 'QR_RENOVADO', qr: unQr({ qrVersion: 2 }), origen: 'sistema' },
      T0,
    );
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobro.id).toBe(cobro.id);
      expect(r.valor.cobro.qrVersion).toBe(2);
      expect(r.valor.cobro.estado).toBe('QR_ACTIVO');
    }
  });

  it.each([1, 3, 0])('rechaza renovar saltando a la versión %p', (version) => {
    const r = transicionar(
      unCobroEn('VENCIDO', { qrVersion: 1 }),
      { tipo: 'QR_RENOVADO', qr: unQr({ qrVersion: version }), origen: 'sistema' },
      T0,
    );
    expect(r).toEqual({
      ok: false,
      error: { tipo: 'VERSION_QR_INVALIDA', esperada: 2, recibida: version },
    });
  });

  it('rechaza emitir un QR cuyo vencimiento no es posterior a la emisión', () => {
    const r = transicionar(
      unCobro(),
      { tipo: 'QR_EMITIDO', qr: unQr({ emitidoEn: T0, venceEn: T0 }), origen: 'sistema' },
      T0,
    );
    expect(r).toEqual({
      ok: false,
      error: { tipo: 'QR_SIN_VENCIMIENTO_VALIDO', qrVersion: 1 },
    });
  });
});

describe('evidencia (regla #8)', () => {
  it('registra timestamp, origen y el par de estados', () => {
    const r = transicionar(unCobro(), eventoDe('QR_EMITIDO'), T0);
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.evidencia).toMatchObject({
        cobroId: 'cobro-1',
        desde: 'BORRADOR',
        hacia: 'QR_ACTIVO',
        evento: 'QR_EMITIDO',
        origen: 'sistema',
        registradoEn: T0,
      });
    }
  });

  it('no filtra datos personales ni bancarios (reglas #4 y #9)', () => {
    const cobro = unCobroEn('ENVIADO');
    for (const tipo of ['PAGO_DETECTADO', 'COMPROBANTE_RECIBIDO'] as const) {
      const r = transicionar(cobro, eventoDe(tipo), T0);
      if (esExito(r)) {
        const serializado = JSON.stringify(r.valor.evidencia);
        expect(serializado).not.toContain(cobro.telefonoCliente);
        expect(serializado).not.toContain(cobro.concepto);
      }
    }
  });
});

describe('inmutabilidad', () => {
  it('no muta el cobro recibido: devuelve uno nuevo', () => {
    const cobro = unCobro();
    const copia = { ...cobro };
    const r = transicionar(cobro, eventoDe('QR_EMITIDO'), T0);

    expect(cobro).toEqual(copia);
    expect(esExito(r) && r.valor.cobro).not.toBe(cobro);
  });
});
