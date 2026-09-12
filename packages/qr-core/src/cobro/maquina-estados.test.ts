import { describe, expect, it } from 'vitest';

import { esExito, esFallo, exito } from '../comun/resultado.js';
import { anularEnProveedor } from './anulacion.js';
import {
  conciliar,
  POLITICA_POR_DEFECTO,
  type ConciliacionAprobada,
} from '../conciliacion/conciliar.js';
import { registrarDeteccion } from '../conciliacion/deteccion.js';
import { bs, enMinutos, T0, unCobro, unCobroEn, unQr } from '../pruebas/fixtures.js';
import { ESTADOS, ESTADOS_TERMINALES, type EstadoCobro } from './estados.js';
import { transicionar, type EventoCobro, type QrAnulado, type TipoEvento } from './maquina-estados.js';

/**
 * Constancia de anulación real, por la única vía que existe. En los tests el
 * anulador es un doble que siempre dice que sí.
 */
async function constancia(referenciaProveedor: string): Promise<QrAnulado> {
  const anulador = { anular: () => Promise.resolve(exito(undefined)) };
  const r = await anularEnProveedor(anulador, { referenciaProveedor }, T0);
  if (!esExito(r)) {
    throw new Error('el anulador de prueba no falla');
  }
  return r.valor;
}

/** Del QR de fixture: `unQr()` usa `qr-000001`. */
const ANULACION = await constancia('qr-000001');
/** De una versión anterior: no deja muerto al QR vigente. */
const ANULACION_DE_OTRO_QR = await constancia('qr-anterior');

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
      return { tipo, anulacion: ANULACION, origen: 'sistema' };
    case 'QR_RENOVADO':
      return { tipo, qr: unQr({ qrVersion: 2 }), origen: 'sistema' };
    case 'VENTANA_AGOTADA':
      return { tipo, anulacion: ANULACION, origen: 'sistema' };
    case 'ABONO_TARDIO':
      return { tipo, deteccion: deteccionValida, origen: 'watcher-baneco' };
    case 'DETECCION_EN_REVISION':
      return { tipo, deteccion: deteccionValida, origen: 'watcher-baneco' };
    case 'RESUELTO_MANUALMENTE':
      return { tipo, decision: 'RECHAZADO', motivo: 'no aparece el abono', origen: 'accion-manual' };
    case 'ANULADO':
      return { tipo, motivo: 'el cliente desistió', anulacion: ANULACION, origen: 'accion-manual' };
  }
}

/** La tabla de CLAUDE.md, escrita a mano para contrastarla con la implementación. */
const TRANSICIONES_ESPERADAS: ReadonlyArray<readonly [EstadoCobro, TipoEvento, EstadoCobro]> = [
  ['BORRADOR', 'QR_EMITIDO', 'QR_ACTIVO'],
  ['QR_ACTIVO', 'QR_ENVIADO', 'ENVIADO'],
  ['ENVIADO', 'COMPROBANTE_RECIBIDO', 'COMPROBANTE_RECIBIDO'],
  ['QR_ACTIVO', 'PAGO_DETECTADO', 'PAGO_DETECTADO'],
  ['ENVIADO', 'PAGO_DETECTADO', 'PAGO_DETECTADO'],
  ['COMPROBANTE_RECIBIDO', 'PAGO_DETECTADO', 'PAGO_DETECTADO'],
  ['PAGO_DETECTADO', 'PAGO_CONCILIADO', 'CONFIRMADO'],
  ['PAGO_DETECTADO', 'CONCILIACION_FALLIDA', 'EN_REVISION'],
  ['COMPROBANTE_RECIBIDO', 'VENTANA_AGOTADA', 'EN_REVISION'],
  ['QR_ACTIVO', 'QR_VENCIDO', 'VENCIDO'],
  ['ENVIADO', 'QR_VENCIDO', 'VENCIDO'],
  ['VENCIDO', 'QR_RENOVADO', 'QR_ACTIVO'],
  ['VENCIDO', 'ABONO_TARDIO', 'EN_REVISION'],
  ['EN_REVISION', 'DETECCION_EN_REVISION', 'EN_REVISION'],
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
        idDeduplicacion: 'baneco:qr-000001:tx-1',
        motivo: 'abono verificado a mano en la consola',
        origen: 'accion-manual',
      },
      T0,
    );
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobro.estado).toBe('CONFIRMADO');
      // Queda marcado como manual justamente para que sea auditable, con el
      // abono del banco que se aceptó.
      expect(r.valor.evidencia.origen).toBe('accion-manual');
      expect(r.valor.evidencia.datos['idDeduplicacion']).toBe('baneco:qr-000001:tx-1');
    }
  });

  it('confirmar a mano sin nombrar un abono del banco se rechaza (regla #1)', () => {
    const r = transicionar(
      unCobroEn('EN_REVISION'),
      {
        tipo: 'RESUELTO_MANUALMENTE',
        decision: 'CONFIRMADO',
        idDeduplicacion: '  ',
        motivo: 'el cliente mandó el comprobante',
        origen: 'accion-manual',
      },
      T0,
    );
    expect(r).toEqual({ ok: false, error: { tipo: 'CONFIRMACION_SIN_DETECCION' } });
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
    ABONO_TARDIO: true,
    DETECCION_EN_REVISION: true,
    RESUELTO_MANUALMENTE: true,
    ANULADO: true,
  };
}

describe('un QR pagable no se suelta sin anularlo en el proveedor (Baneco C4)', () => {
  const deOtroQr = ANULACION_DE_OTRO_QR;

  it('la constancia de anulación no se fabrica a mano', () => {
    // Test de compilación, como el de ConciliacionAprobada: si el tipo dejara
    // de estar marcado, `@ts-expect-error` sobraría y el typecheck fallaría.
    // @ts-expect-error falta la marca nominal: solo sale de anularEnProveedor().
    const falsa: QrAnulado = { referenciaProveedor: 'qr-000001', anuladoEn: T0 };
    expect(falsa.referenciaProveedor).toBe('qr-000001');
  });

  it.each(['QR_ACTIVO', 'ENVIADO'] as const)('%s no vence sin la anulación del QR vigente', (estado) => {
    // Anular una versión anterior no deja muerta la vigente.
    const r = transicionar(unCobroEn(estado), { tipo: 'QR_VENCIDO', anulacion: deOtroQr, origen: 'sistema' }, T0);
    expect(r).toEqual({
      ok: false,
      error: { tipo: 'QR_SIN_ANULAR_EN_PROVEEDOR', referenciaProveedor: 'qr-000001' },
    });
  });

  it('la ventana agotada también exige la anulación', () => {
    const r = transicionar(
      unCobroEn('COMPROBANTE_RECIBIDO'),
      { tipo: 'VENTANA_AGOTADA', anulacion: deOtroQr, origen: 'sistema' },
      T0,
    );
    expect(esFallo(r)).toBe(true);
  });

  it.each(['QR_ACTIVO', 'ENVIADO'] as const)('%s no se anula sin anular su QR en el banco', (estado) => {
    const r = transicionar(
      unCobroEn(estado),
      { tipo: 'ANULADO', motivo: 'x', anulacion: null, origen: 'accion-manual' },
      T0,
    );
    expect(esFallo(r)).toBe(true);
  });

  it.each(['BORRADOR', 'VENCIDO'] as const)(
    '%s se anula sin constancia: no tiene un QR pagable',
    (estado) => {
      // Un borrador nunca tuvo QR; uno vencido ya lo anuló al vencer.
      const r = transicionar(
        unCobroEn(estado),
        { tipo: 'ANULADO', motivo: 'x', anulacion: null, origen: 'accion-manual' },
        T0,
      );
      expect(esExito(r) && r.valor.cobro.estado).toBe('ANULADO');
    },
  );

  it('la evidencia del vencimiento registra qué QR se anuló y cuándo', () => {
    const r = transicionar(unCobroEn('ENVIADO'), eventoDe('QR_VENCIDO'), T0);
    expect(esExito(r) && r.valor.evidencia.datos).toMatchObject({
      qrAnulado: 'qr-000001',
      anuladoEn: T0.toISOString(),
    });
  });
});

describe('abono tardío: VENCIDO → EN_REVISION', () => {
  it('un pago sobre un QR vencido no se descarta ni se confirma solo', () => {
    const r = transicionar(unCobroEn('VENCIDO'), eventoDe('ABONO_TARDIO'), T0);
    expect(esExito(r)).toBe(true);
    if (esExito(r)) {
      expect(r.valor.cobro.estado).toBe('EN_REVISION');
      // Queda la detección, para que quien revise vea qué pagó el banco.
      expect(r.valor.evidencia.datos).toMatchObject({
        idDeduplicacion: 'baneco:qr-000001:tx-1',
        montoCentavos: 12_345,
      });
    }
  });
});

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
