/**
 * Constructores de datos para los tests del dominio.
 *
 * No forman parte del paquete publicado: `tsconfig.json` los excluye del build.
 * Viven acá para que los tests de estados y de conciliación compartan las
 * mismas piezas y un cambio de forma del `Cobro` se note en un solo lugar.
 */

import { centavos, type Centavos } from '../comun/dinero.js';
import { esExito } from '../comun/resultado.js';
import type { Cobro, QrEmitido } from '../cobro/cobro.js';
import type { EstadoCobro } from '../cobro/estados.js';

/** Monto válido o explota el test. Los montos de fixture son literales sanos. */
export function bs(valorEnCentavos: number): Centavos {
  const r = centavos(valorEnCentavos);
  if (!esExito(r)) {
    throw new Error(`monto de fixture inválido: ${String(valorEnCentavos)}`);
  }
  return r.valor;
}

export const T0 = new Date('2026-08-27T12:00:00.000Z');

/** `T0` desplazado en minutos. Evita aritmética de fechas dispersa en los tests. */
export function enMinutos(minutos: number, desde: Date = T0): Date {
  return new Date(desde.getTime() + minutos * 60_000);
}

export function unQr(sobrescribir: Partial<QrEmitido> = {}): QrEmitido {
  return {
    qrVersion: 1,
    referenciaProveedor: 'qr-000001',
    emitidoEn: T0,
    venceEn: enMinutos(72 * 60),
    origen: 'api-baneco',
    imagenRef: 'gs://demo/qr/000001.png',
    hashImagen: 'a'.repeat(64),
    ...sobrescribir,
  };
}

export function unCobro(sobrescribir: Partial<Cobro> = {}): Cobro {
  return {
    id: 'cobro-1',
    proveedor: 'baneco',
    estado: 'BORRADOR',
    montoCentavos: bs(12_345),
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: T0,
    telefonoCliente: '+59171234567',
    concepto: 'Servicio de prueba',
    ...sobrescribir,
  };
}

/** Cobro en un estado dado, ya con QR emitido cuando el estado lo implica. */
export function unCobroEn(estado: EstadoCobro, sobrescribir: Partial<Cobro> = {}): Cobro {
  const necesitaQr = estado !== 'BORRADOR';
  return unCobro({
    estado,
    ...(necesitaQr ? { qrVersion: 1, qrVigente: unQr() } : {}),
    ...sobrescribir,
  });
}
