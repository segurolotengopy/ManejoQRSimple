/**
 * Bitácora en disco: los logs de depuración de la API y del satélite, que
 * sobreviven a un reinicio.
 *
 * Hasta acá los logs vivían en memoria (la API) o en la terminal (el
 * satélite): un `responseCode` del banco o la línea del cierre diario había
 * que leerlos en el momento, o repetir la prueba para volver a verlos. Ahora
 * cada proceso escribe un archivo por día —`api-AAAA-MM-DD.jsonl` y
 * `satelite-AAAA-MM-DD.jsonl`, día de Bolivia— en un directorio **fuera del
 * repo** (`~/.manejoqr/logs/` por defecto, permisos 700/600), y la API los lee
 * para la pestaña Logs.
 *
 * Qué se escribe: lo mismo que ya se mostraba, **saneado antes de tocar el
 * disco** (`sanearTexto`): rutas, estados HTTP, `responseCode`, demoras,
 * conteos y claves del banco. Nunca cuerpos, credenciales, tokens, teléfonos
 * ni números de cuenta. Es append-only y no rota solo: borrar logs es una
 * decisión de una persona, no de un proceso.
 *
 * Una falla al escribir no tumba el proceso: se avisa una vez por la terminal
 * y se sigue. Perder una línea de depuración es mejor que dejar de cobrar.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
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

export class Bitacora {
  private avisado = false;

  constructor(
    private readonly directorio: string,
    private readonly proceso: Proceso,
    private readonly alFallar: (mensaje: string) => void = (m) => {
      console.error(m);
    },
  ) {}

  /** Sanea y agrega una línea al archivo del día. Devuelve la entrada escrita. */
  escribir(nivel: NivelLog, origen: OrigenLog, texto: string, en: Date = new Date()): EntradaLog {
    const entrada: EntradaLog = { en: en.toISOString(), nivel, origen, proceso: this.proceso, texto: sanearTexto(texto) };
    try {
      mkdirSync(this.directorio, { recursive: true, mode: 0o700 });
      appendFileSync(
        join(this.directorio, `${this.proceso}-${diaBoliviano(en)}.jsonl`),
        `${JSON.stringify(entrada)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      if (!this.avisado) {
        this.avisado = true;
        this.alFallar(`  ! No se pudo escribir la bitácora en ${this.directorio}; los logs siguen solo en memoria.`);
      }
    }
    return entrada;
  }

  /**
   * Las últimas `max` líneas de los procesos pedidos, de la más vieja a la más
   * nueva. Lee de los archivos más recientes hacia atrás hasta juntar `max`.
   * Una línea que no tiene la forma esperada se saltea: es un log, no un dato
   * del negocio.
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
      let contenido: string;
      try {
        contenido = readFileSync(join(this.directorio, nombre), 'utf8');
      } catch {
        continue;
      }
      for (const linea of contenido.split('\n')) {
        const entrada = aEntrada(linea);
        if (entrada !== null) {
          juntadas.push(entrada);
        }
      }
    }
    return juntadas.sort((a, b) => a.en.localeCompare(b.en)).slice(-max);
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
  return { en, nivel: nivel as NivelLog, origen: origen as OrigenLog, proceso, texto: sanearTexto(texto) };
}
