import { describe, expect, it } from 'vitest';

import type { Cobro, EstadoCobro, RegistroEvidencia } from './api.js';
import { diagnosticar, sigueCambiando, type EntradaDiagnostico } from './diagnostico.js';

const AHORA = new Date('2026-09-12T15:00:00.000Z');

function cobro(estado: EstadoCobro, venceEn = '2026-09-12T15:30:00.000Z'): Cobro {
  return {
    id: 'c1',
    estado,
    proveedor: 'baneco',
    monto: '1.00',
    moneda: 'BOB',
    concepto: 'PRUEBA 1 ManejoQRSimple',
    telefonoCliente: '+591 0** ***00',
    qrVersion: 1,
    creadoEn: '2026-09-12T14:55:00.000Z',
    qrVigente: {
      qrVersion: 1,
      referenciaProveedor: 'qr-1',
      emitidoEn: '2026-09-12T14:55:00.000Z',
      venceEn,
      origen: 'api-baneco',
      imagenRef: 'archivo:qr-1.png',
    },
  };
}

function registro(evento: string, hacia: string, datos: RegistroEvidencia['datos'] = {}, registradoEn = AHORA.toISOString()): RegistroEvidencia {
  return { desde: 'X', hacia, evento, origen: 'sistema', registradoEn, datos };
}

function entrada(sobrescribir: Partial<EntradaDiagnostico>): EntradaDiagnostico {
  return {
    cobro: cobro('QR_ACTIVO'),
    evidencia: [],
    hayImagen: true,
    ultimoError: null,
    pagoDeclaradoEn: null,
    ahora: AHORA,
    ...sobrescribir,
  };
}

const niveles = (e: EntradaDiagnostico) => diagnosticar(e).map((p) => p.nivel);
const textos = (e: EntradaDiagnostico) => diagnosticar(e).map((p) => p.texto).join(' | ');

describe('diagnosticar()', () => {
  it('un QR vivo con imagen y sin nada raro no tiene problemas', () => {
    expect(diagnosticar(entrada({}))).toEqual([]);
  });

  it('sin imagen no hay nada que escanear', () => {
    expect(niveles(entrada({ hayImagen: false }))).toEqual(['error']);
  });

  it('recién pagado espera; pasado un minuto sin reporte del banco, es un hallazgo', () => {
    expect(niveles(entrada({ pagoDeclaradoEn: new Date(AHORA.getTime() - 30_000) }))).toEqual(['aviso']);
    const tarde = entrada({ pagoDeclaradoEn: new Date(AHORA.getTime() - 90_000) });
    expect(niveles(tarde)).toEqual(['error']);
    expect(textos(tarde)).toMatch(/en línea \(D5\)/);
  });

  it('un QR vencido que sigue activo apunta al satélite', () => {
    const e = entrada({ cobro: cobro('QR_ACTIVO', '2026-09-12T14:57:00.000Z') });
    expect(textos(e)).toMatch(/prueba:satelite/);
  });

  it('confirmado dice cuánto tardó el banco en reportarlo', () => {
    const e = entrada({
      cobro: cobro('CONFIRMADO'),
      evidencia: [registro('PAGO_CONCILIADO', 'CONFIRMADO', {}, '2026-09-12T14:59:12.000Z')],
      pagoDeclaradoEn: new Date('2026-09-12T14:59:00.000Z'),
    });
    expect(diagnosticar(e)).toEqual([
      { nivel: 'ok', texto: 'Pago verificado contra el banco y conciliado. Se detectó 12 s después de "Ya pagué".' },
    ]);
  });

  it('vencido con el QR anulado en el banco está bien; sin constancia, no', () => {
    const conConstancia = entrada({
      cobro: cobro('VENCIDO'),
      evidencia: [registro('QR_VENCIDO', 'VENCIDO', { qrAnulado: 'qr-1' })],
    });
    expect(niveles(conConstancia)).toEqual(['ok']);
    expect(niveles(entrada({ cobro: cobro('VENCIDO') }))).toEqual(['error']);
  });

  it('credenciales rechazadas: no reintentar, el usuario se bloquea', () => {
    const e = entrada({
      ultimoError: {
        codigo: 'PROVEEDOR_RECHAZO',
        mensaje: 'x',
        status: 502,
        detalle: { tipo: 'NO_AUTORIZADO', codigoProveedor: '1', mensajeTecnico: 'el banco rechazó las credenciales' },
      },
    });
    expect(textos(e)).toMatch(/agencia/);
  });

  it('un rechazo con responseCode lo muestra para el catálogo de errores', () => {
    const e = entrada({
      ultimoError: {
        codigo: 'PROVEEDOR_RECHAZO',
        mensaje: 'x',
        status: 502,
        detalle: { tipo: 'RECHAZADO_POR_PROVEEDOR', codigoProveedor: '57', mensajeTecnico: 'cancelQR rechazado' },
      },
    });
    expect(textos(e)).toMatch(/responseCode 57/);
  });
});

describe('sigueCambiando()', () => {
  it('sigue refrescando un cobro en PAGO_DETECTADO: es un estado de paso', () => {
    // Prueba en producción del 2026-09-13: una consulta cayó entre la escritura
    // de la evidencia de CONFIRMADO y la del estado, y la tarjeta quedó
    // congelada en PAGO_DETECTADO aunque el cobro estaba confirmado.
    expect(sigueCambiando('PAGO_DETECTADO')).toBe(true);
  });

  it('sigue refrescando los que esperan pago y deja de hacerlo con los que ya se decidieron', () => {
    const estados: EstadoCobro[] = ['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO', 'CONFIRMADO', 'ANULADO', 'VENCIDO', 'EN_REVISION', 'RECHAZADO'];
    expect(estados.filter(sigueCambiando)).toEqual(['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO']);
  });
});
