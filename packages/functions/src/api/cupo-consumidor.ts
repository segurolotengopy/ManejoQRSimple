/**
 * Cuántos QRs puede pedirle un consumidor al banco por hora.
 *
 * No es una protección contra abuso genérico: es contra el escenario que el
 * propio modelo de amenazas acepta (T14, un token que vive meses en el
 * entorno de otro sistema y se puede filtrar). Con el token robado no se puede
 * confirmar un pago ni ver lo de otro, pero sí pedir QRs en bucle — y cada QR
 * queda **pagable hasta la medianoche** (respuesta C4 del banco), porque el
 * banco los vence por día. Mil QRs vivos no se anulan de a uno a esa
 * velocidad: es la amenaza T10 a escala.
 *
 * **Sus límites, dichos de frente:** el contador vive en memoria del proceso,
 * así que reiniciar la API lo pone en cero, y con varias instancias cada una
 * tendría el suyo. Hoy la API corre como un proceso local y alcanza; el día
 * que se despliegue en serio, esto tiene que pasar a un contador compartido.
 * Está acá y no en un middleware genérico porque el recurso que protege no son
 * los pedidos HTTP sino los QRs emitidos en el banco.
 */

const HORA_MS = 3_600_000;

/** Techo del código: nadie sube el tope por variable de entorno más allá de esto. */
export const MAXIMO_ABSOLUTO_POR_HORA = 500;

/** Cuántos QRs por hora si no se configura nada. */
export const CUPO_POR_HORA_POR_DEFECTO = 60;

export type CupoDeConsumidores = {
  /** Registra un pedido y dice si estaba dentro del cupo. */
  readonly consumir: (consumidorId: string, ahora: Date) => boolean;
  readonly porHora: number;
};

/**
 * Lee el cupo del entorno (`CONSUMIDOR_MAX_QRS_POR_HORA`) y arma el contador.
 *
 * Un valor inválido no baja la guardia ni rompe el arranque: se usa el de por
 * defecto. Un valor por encima del techo del código se recorta.
 */
export function cupoDeConsumidores(
  env: Readonly<Record<string, string | undefined>>,
): CupoDeConsumidores {
  const pedido = Number(env['CONSUMIDOR_MAX_QRS_POR_HORA'] ?? '');
  const porHora =
    Number.isInteger(pedido) && pedido > 0
      ? Math.min(pedido, MAXIMO_ABSOLUTO_POR_HORA)
      : CUPO_POR_HORA_POR_DEFECTO;

  /** Marcas de tiempo de los pedidos de la última hora, por consumidor. */
  const pedidos = new Map<string, number[]>();

  return {
    porHora,
    consumir: (consumidorId: string, ahora: Date): boolean => {
      const desde = ahora.getTime() - HORA_MS;
      const recientes = (pedidos.get(consumidorId) ?? []).filter((t) => t > desde);
      if (recientes.length >= porHora) {
        // No se anota el rechazado: si no, un consumidor en bucle extendería
        // su propio castigo indefinidamente y nunca volvería a entrar.
        pedidos.set(consumidorId, recientes);
        return false;
      }
      recientes.push(ahora.getTime());
      pedidos.set(consumidorId, recientes);
      return true;
    },
  };
}
