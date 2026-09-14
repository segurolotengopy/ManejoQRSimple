/**
 * Logs de depuración de la API, para la pestaña Logs de la consola.
 *
 * Guarda las últimas 500 líneas: cada pedido a la API y cada llamada al banco.
 * Los textos se arman con campos seguros (rutas, estados, códigos, demoras) y
 * además pasan por `sanearTexto`, que enmascara lo que nunca debería llegar:
 * tokens, teléfonos y números de cuenta. Es defensa en profundidad, no la
 * primera línea: la primera es no poner esos datos en el texto.
 *
 * Con una `Bitacora`, además, cada línea se escribe a disco, y al arrancar se
 * cargan las del último tiempo: la pestaña Logs muestra lo de ayer aunque la
 * API se haya reiniciado, y suma las líneas del satélite (cierre diario,
 * llamadas al banco). Sin bitácora, se comporta como antes: solo en memoria.
 */

import {
  describirLlamada,
  sanearTexto,
  type Bitacora,
  type EntradaLog,
  type LlamadaObservada,
  type NivelLog,
  type OrigenLog,
} from '@mqs/composicion';

export { describirLlamada, sanearTexto, type LlamadaObservada, type NivelLog, type OrigenLog };

export type LineaLog = {
  readonly n: number;
  readonly en: string;
  readonly nivel: NivelLog;
  readonly origen: OrigenLog;
  readonly texto: string;
};

const CAPACIDAD = 500;

export class RegistroEventos {
  private readonly lineas: LineaLog[] = [];
  private siguiente = 1;

  constructor(
    private readonly reloj: () => Date = () => new Date(),
    /** Además de guardarla, qué hacer con cada línea (p. ej. errores a la terminal). */
    private readonly eco: ((linea: LineaLog) => void) | null = null,
    /** Dónde persistir las líneas. `null`: solo en memoria. */
    private readonly bitacora: Bitacora | null = null,
  ) {
    // Lo que la API escribió antes de reiniciarse vuelve a la pestaña Logs.
    for (const previa of bitacora?.leerUltimas(CAPACIDAD, ['api']) ?? []) {
      this.meter(previa);
    }
  }

  agregar(nivel: NivelLog, origen: OrigenLog, texto: string): void {
    const en = this.reloj();
    const entrada: Omit<EntradaLog, 'proceso'> = { en: en.toISOString(), nivel, origen, texto: sanearTexto(texto) };
    this.bitacora?.escribir(nivel, origen, texto, en);
    const linea = this.meter(entrada);
    this.eco?.(linea);
  }

  /**
   * Las líneas guardadas, de la más vieja a la más nueva. Con bitácora, junta
   * las de la API con las del satélite en orden cronológico y las numera de
   * nuevo (el número es solo para identificarlas en la consola).
   */
  listar(): readonly LineaLog[] {
    if (this.bitacora === null) {
      return [...this.lineas];
    }
    const delSatelite = this.bitacora.leerUltimas(CAPACIDAD, ['satelite']);
    return [...this.lineas, ...delSatelite]
      .sort((a, b) => a.en.localeCompare(b.en))
      .slice(-CAPACIDAD)
      .map((l, i) => ({ n: i + 1, en: l.en, nivel: l.nivel, origen: l.origen, texto: l.texto }));
  }

  private meter(entrada: Omit<EntradaLog, 'proceso'>): LineaLog {
    const linea: LineaLog = { n: this.siguiente, ...entrada };
    this.siguiente += 1;
    this.lineas.push(linea);
    if (this.lineas.length > CAPACIDAD) {
      this.lineas.shift();
    }
    return linea;
  }
}
