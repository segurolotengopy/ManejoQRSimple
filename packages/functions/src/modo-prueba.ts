/**
 * Configuración de la prueba controlada en producción.
 *
 * Los topes se leen del entorno pero tienen **techos fijos en el código**: un
 * `.env` mal escrito no puede convertir la prueba en cobros de verdad. El
 * monto lo decide el servidor, no la consola.
 */

import { hablaConProduccion } from '@mqs/composicion';
import { centavos, esExito, exito, fallo, type Centavos, type Resultado } from '@mqs/qr-core';

/** Techo absoluto del monto de un QR de prueba: Bs 10. */
export const MONTO_TECHO_CENTAVOS = 1000;
/** Techo absoluto de QRs por corrida de la API. */
export const QRS_TECHO = 30;

export type ModoPrueba = {
  readonly montoCentavos: Centavos;
  readonly maxQrs: number;
  /** Qué adaptadores quedaron conectados, para mostrarlo en la consola. */
  readonly adaptadores: string;
  /**
   * ¿Los QRs son reales? Solo si se habla con la API de producción del banco.
   * Con el banco simulado el modo prueba sirve para ensayar, y decir "reales"
   * sería mentir.
   */
  readonly produccion: boolean;
  /** Estado de la corrida. Vive en memoria: reiniciar la API empieza otra. */
  readonly corrida: { intentos: number; readonly cobros: string[] };
};

type Entorno = Readonly<Record<string, string | undefined>>;

function entero(env: Entorno, variable: string, porDefecto: number, minimo: number, maximo: number): number | null {
  const crudo = env[variable] ?? String(porDefecto);
  const valor = Number(crudo);
  return Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : null;
}

const DIA_MS = 86_400_000;

/**
 * Retoma la corrida desde los cobros que ya están en el emulador de la prueba,
 * para que reiniciar la API no pierda de vista los QRs de antes ni reinicie el
 * cupo: cuentan los pedidos de las últimas 24 h.
 */
export function reanudarCorrida(
  modo: ModoPrueba,
  previos: readonly { readonly id: string; readonly creadoEn: Date }[],
  ahora: Date,
): void {
  const recientes = previos.filter((c) => ahora.getTime() - c.creadoEn.getTime() < DIA_MS);
  modo.corrida.intentos = Math.max(modo.corrida.intentos, recientes.length);
  for (const c of [...previos].reverse()) {
    if (!modo.corrida.cobros.includes(c.id)) {
      modo.corrida.cobros.push(c.id);
    }
  }
}

/** Lee los topes. El error nombra la variable y el rango, nunca un secreto. */
export function leerModoPrueba(env: Entorno, adaptadores: string): Resultado<ModoPrueba, string> {
  const monto = entero(env, 'PRUEBA_MONTO_CENTAVOS', 100, 1, MONTO_TECHO_CENTAVOS);
  if (monto === null) {
    return fallo(`PRUEBA_MONTO_CENTAVOS debe ser un entero entre 1 y ${String(MONTO_TECHO_CENTAVOS)} (Bs 10).`);
  }
  const maxQrs = entero(env, 'PRUEBA_MAX_QRS', 10, 1, QRS_TECHO);
  if (maxQrs === null) {
    return fallo(`PRUEBA_MAX_QRS debe ser un entero entre 1 y ${String(QRS_TECHO)}.`);
  }
  const montoCentavos = centavos(monto);
  if (!esExito(montoCentavos)) {
    return fallo('PRUEBA_MONTO_CENTAVOS no es un monto válido.');
  }
  return exito({
    montoCentavos: montoCentavos.valor,
    maxQrs,
    adaptadores,
    produccion: hablaConProduccion(env),
    corrida: { intentos: 0, cobros: [] },
  });
}
