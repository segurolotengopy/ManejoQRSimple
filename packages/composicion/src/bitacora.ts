/**
 * Bitácora en disco: los logs de depuración de la API y del satélite, que
 * sobreviven a un reinicio.
 *
 * Hasta acá los logs vivían en memoria (la API) o en la terminal (el
 * satélite): un `responseCode` del banco o la línea del cierre diario había
 * que leerlos en el momento, o repetir la prueba para volver a verlos. Ahora
 * cada proceso escribe un archivo por día —`api-AAAA-MM-DD.jsonl` y
 * `satelite-AAAA-MM-DD.jsonl`, día de Bolivia— en un directorio **fuera del
 * repo** (`~/.manejoqr/logs/` por defecto), y la API los lee para la pestaña
 * Logs.
 *
 * Qué se escribe: lo mismo que ya se mostraba, **saneado antes de tocar el
 * disco** (`sanearTexto`): rutas, estados HTTP, `responseCode`, demoras,
 * conteos y claves del banco. Nunca cuerpos, credenciales, tokens, teléfonos
 * ni números de cuenta. Es append-only y no rota sola: borrar logs es una
 * decisión de una persona, no de un proceso.
 *
 * Garantías que no dependen de cómo se creó el directorio:
 * - El directorio y cada archivo tienen que ser **del usuario del proceso**; si
 *   no, no se escribe. Los permisos se corrigen a 700/600 si están abiertos.
 * - Los archivos se abren sin seguir enlaces simbólicos (`O_NOFOLLOW`).
 * - **Tope por archivo** (20 MB por día y proceso): lo que exceda no se escribe,
 *   para que nadie llene el disco a fuerza de pedidos.
 * - Al leer, solo la **cola** de cada archivo (1 MB): la pestaña Logs consulta
 *   cada 3 s y no puede bloquear la API leyendo archivos enteros.
 *
 * Una falla al escribir no tumba el proceso: se avisa una vez por la terminal
 * y se sigue. Perder una línea de depuración es mejor que dejar de cobrar.
 */

import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import type { LlamadaAlBanco } from '@mqs/baneco-gateway';

export type NivelLog = 'info' | 'aviso' | 'error';
export type OrigenLog = 'api' | 'banco' | 'sistema' | 'satelite';
export type Proceso = 'api' | 'satelite';

export type EntradaLog = {
  readonly en: string;
  readonly nivel: NivelLog;
  readonly origen: OrigenLog;
  readonly proceso: Proceso;
  readonly texto: string;
};

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

/** Una llamada al banco, como la informa el transporte observado. */
export type LlamadaObservada = LlamadaAlBanco;

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

/** Bolivia no tiene horario de verano: UTC-4 todo el año (respuesta D7). */
const OFFSET_BOLIVIA_MS = -4 * 3_600_000;

/** `AAAA-MM-DD` del instante, en hora de Bolivia: un archivo por día del negocio. */
export function diaBoliviano(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_BOLIVIA_MS).toISOString().slice(0, 10);
}

const ARCHIVO = /^(api|satelite)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const NIVELES: readonly string[] = ['info', 'aviso', 'error'];
const ORIGENES: readonly string[] = ['api', 'banco', 'sistema', 'satelite'];

/** Largo máximo del texto de una línea: una ruta enorme no infla el archivo. */
const LARGO_MAXIMO_TEXTO = 500;

export type OpcionesBitacora = {
  /** Bytes máximos por archivo (día y proceso). Por defecto, 20 MB. */
  readonly topeBytes?: number;
  /** Bytes que se leen del final de cada archivo. Por defecto, 1 MB. */
  readonly colaBytes?: number;
};

/** ¿Es del usuario de este proceso? Donde no hay uid (Windows), no se puede saber. */
function esPropio(info: { readonly uid: number }): boolean {
  return typeof process.getuid !== 'function' || info.uid === process.getuid();
}

export class Bitacora {
  private readonly avisados = new Set<string>();
  private readonly topeBytes: number;
  private readonly colaBytes: number;

  constructor(
    private readonly directorio: string,
    private readonly proceso: Proceso,
    private readonly alFallar: (mensaje: string) => void = (m) => {
      console.error(m);
    },
    opciones: OpcionesBitacora = {},
  ) {
    this.topeBytes = opciones.topeBytes ?? 20 * 1024 * 1024;
    this.colaBytes = opciones.colaBytes ?? 1024 * 1024;
  }

  /** Sanea y agrega una línea al archivo del día. Devuelve la entrada. */
  escribir(nivel: NivelLog, origen: OrigenLog, texto: string, en: Date = new Date()): EntradaLog {
    const entrada: EntradaLog = {
      en: en.toISOString(),
      nivel,
      origen,
      proceso: this.proceso,
      texto: sanearTexto(texto).slice(0, LARGO_MAXIMO_TEXTO),
    };
    try {
      this.prepararDirectorio();
      const fd = openSync(
        join(this.directorio, `${this.proceso}-${diaBoliviano(en)}.jsonl`),
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const info = fstatSync(fd);
        if (!esPropio(info)) {
          throw new Error('archivo de otro usuario');
        }
        if ((info.mode & 0o077) !== 0) {
          fchmodSync(fd, 0o600);
        }
        if (info.size >= this.topeBytes) {
          this.avisar(
            'tope',
            `  ! La bitácora de hoy (${this.proceso}) llegó a su tope: no se escriben más líneas hasta mañana.`,
          );
          return entrada;
        }
        writeSync(fd, `${JSON.stringify(entrada)}\n`);
      } finally {
        closeSync(fd);
      }
    } catch {
      this.avisar('falla', `  ! No se pudo escribir la bitácora en ${this.directorio}; los logs siguen solo en memoria.`);
    }
    return entrada;
  }

  /**
   * Las últimas `max` líneas de los procesos pedidos, de la más vieja a la más
   * nueva. Lee la cola de los archivos más recientes hacia atrás hasta juntar
   * `max`. Una línea que no tiene la forma esperada se saltea: es un log, no
   * un dato del negocio.
   */
  leerUltimas(max: number, procesos: readonly Proceso[]): readonly EntradaLog[] {
    let nombres: string[];
    try {
      nombres = readdirSync(this.directorio);
    } catch {
      return [];
    }
    const archivos = nombres
      .map((nombre) => ({ nombre, partes: ARCHIVO.exec(nombre) }))
      .filter((a): a is { nombre: string; partes: RegExpExecArray } => {
        const proceso = a.partes?.[1];
        return proceso !== undefined && (procesos as readonly string[]).includes(proceso);
      })
      // Por día, del más nuevo al más viejo.
      .sort((a, b) => (b.partes[2] ?? '').localeCompare(a.partes[2] ?? ''));

    const juntadas: EntradaLog[] = [];
    let diaAnterior: string | null = null;
    for (const { nombre, partes } of archivos) {
      // Se leen días completos: dos procesos del mismo día se mezclan bien.
      if (juntadas.length >= max && partes[2] !== diaAnterior) {
        break;
      }
      diaAnterior = partes[2] ?? null;
      for (const linea of this.leerCola(join(this.directorio, nombre))) {
        const entrada = aEntrada(linea);
        if (entrada !== null) {
          juntadas.push(entrada);
        }
      }
    }
    return juntadas.sort((a, b) => a.en.localeCompare(b.en)).slice(-max);
  }

  /** Las líneas completas del último tramo del archivo (sin seguir enlaces). */
  private leerCola(ruta: string): readonly string[] {
    let fd: number;
    try {
      fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return [];
    }
    try {
      const { size } = fstatSync(fd);
      const largo = Math.min(size, this.colaBytes);
      const buffer = Buffer.alloc(largo);
      readSync(fd, buffer, 0, largo, size - largo);
      const lineas = buffer.toString('utf8').split('\n');
      // Si no se leyó desde el principio, la primera línea puede estar cortada.
      return largo < size ? lineas.slice(1) : lineas;
    } catch {
      return [];
    } finally {
      closeSync(fd);
    }
  }

  /** Crea el directorio si falta y exige que sea del usuario, con permisos 700. */
  private prepararDirectorio(): void {
    mkdirSync(this.directorio, { recursive: true, mode: 0o700 });
    // `lstat`: un enlace simbólico en lugar del directorio no se sigue.
    const info = lstatSync(this.directorio);
    if (!info.isDirectory() || !esPropio(info)) {
      throw new Error('directorio de bitácora ajeno o no es un directorio');
    }
    if ((info.mode & 0o077) !== 0) {
      chmodSync(this.directorio, 0o700);
    }
  }

  private avisar(clave: string, mensaje: string): void {
    if (!this.avisados.has(clave)) {
      this.avisados.add(clave);
      this.alFallar(mensaje);
    }
  }
}

function aEntrada(linea: string): EntradaLog | null {
  if (linea.trim() === '') {
    return null;
  }
  let crudo: unknown;
  try {
    crudo = JSON.parse(linea);
  } catch {
    return null;
  }
  if (typeof crudo !== 'object' || crudo === null) {
    return null;
  }
  const { en, nivel, origen, proceso, texto } = crudo as Record<string, unknown>;
  if (
    typeof en !== 'string' ||
    Number.isNaN(Date.parse(en)) ||
    typeof nivel !== 'string' ||
    !NIVELES.includes(nivel) ||
    typeof origen !== 'string' ||
    !ORIGENES.includes(origen) ||
    (proceso !== 'api' && proceso !== 'satelite') ||
    typeof texto !== 'string'
  ) {
    return null;
  }
  // Se vuelve a sanear al leer: un archivo editado a mano no mete nada crudo.
  return {
    en,
    nivel: nivel as NivelLog,
    origen: origen as OrigenLog,
    proceso,
    texto: sanearTexto(texto).slice(0, LARGO_MAXIMO_TEXTO),
  };
}
