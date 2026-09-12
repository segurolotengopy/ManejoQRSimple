/**
 * Logs de depuración de la API, en memoria, para la pestaña Logs de la consola.
 *
 * Guarda las últimas 500 líneas: cada pedido a la API y cada llamada al banco.
 * Los textos se arman acá con campos seguros (rutas, estados, códigos, demoras)
 * y además pasan por `sanearTexto`, que enmascara lo que nunca debería llegar:
 * tokens, teléfonos y números de cuenta. Es defensa en profundidad, no la
 * primera línea: la primera es no poner esos datos en el texto.
 */

export type NivelLog = 'info' | 'aviso' | 'error';
export type OrigenLog = 'api' | 'banco' | 'sistema';

export type LineaLog = {
  readonly n: number;
  readonly en: string;
  readonly nivel: NivelLog;
  readonly origen: OrigenLog;
  readonly texto: string;
};

const CAPACIDAD = 500;

/**
 * Enmascara tokens `Bearer`, teléfonos bolivianos y secuencias de 9 a 17 dígitos
 * (números de cuenta). Deja las de 18 o más: son ids de QR del banco, que sirven
 * para depurar y no identifican a nadie.
 */
export function sanearTexto(texto: string): string {
  return texto
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/\+591\s?\d{8}/g, '+591 ********')
    .replace(/\d{9,}/g, (m) => (m.length >= 18 ? m : '*'.repeat(m.length)));
}

export class RegistroEventos {
  private readonly lineas: LineaLog[] = [];
  private siguiente = 1;

  constructor(
    private readonly reloj: () => Date = () => new Date(),
    /** Además de guardarla, qué hacer con cada línea (p. ej. errores a la terminal). */
    private readonly eco: ((linea: LineaLog) => void) | null = null,
  ) {}

  agregar(nivel: NivelLog, origen: OrigenLog, texto: string): void {
    const linea: LineaLog = {
      n: this.siguiente,
      en: this.reloj().toISOString(),
      nivel,
      origen,
      texto: sanearTexto(texto),
    };
    this.siguiente += 1;
    this.lineas.push(linea);
    if (this.lineas.length > CAPACIDAD) {
      this.lineas.shift();
    }
    this.eco?.(linea);
  }

  /** Las líneas guardadas, de la más vieja a la más nueva. */
  listar(): readonly LineaLog[] {
    return [...this.lineas];
  }
}

/** Una llamada al banco, como la informa el transporte observado. */
export type LlamadaObservada = {
  readonly metodo: string;
  readonly ruta: string;
  readonly ms: number;
  readonly status: number | null;
  readonly responseCode: number | null;
  readonly falla: string | null;
};

/** Nivel y texto de una llamada al banco. */
export function describirLlamada(l: LlamadaObservada): { readonly nivel: NivelLog; readonly texto: string } {
  if (l.status === null) {
    return { nivel: 'error', texto: `${l.metodo} ${l.ruta} → sin respuesta (${l.falla ?? '?'}) · ${String(l.ms)} ms` };
  }
  const codigo = l.responseCode === null ? '' : ` · responseCode ${String(l.responseCode)}`;
  const nivel: NivelLog =
    l.status >= 500 ? 'error' : l.status >= 400 || (l.responseCode !== null && l.responseCode !== 0) ? 'aviso' : 'info';
  return { nivel, texto: `${l.metodo} ${l.ruta} → HTTP ${String(l.status)}${codigo} · ${String(l.ms)} ms` };
}
