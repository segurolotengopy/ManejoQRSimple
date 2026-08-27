/**
 * Montos en centavos enteros de boliviano (regla de negocio #5).
 *
 * Nunca float, nunca string con coma. El tipo `Centavos` está marcado
 * nominalmente: un `number` cualquiera no es asignable a `Centavos`, así que la
 * única forma de obtener uno es pasar por `centavos()` o `desdeDecimalBob()`,
 * que validan. Eso convierte "no usar floats para dinero" en algo que el
 * compilador impide, no en algo que hay que recordar.
 *
 * La conversión a decimal existe **solo para el borde** (la API de Baneco
 * espera `1.00`, no `100`), y se hace por aritmética entera: nunca
 * `centavos / 100`, que reintroduce el float que la regla prohíbe.
 */

import { exito, fallo, type Resultado } from './resultado.js';

declare const marcaCentavos: unique symbol;

/** Monto en centavos enteros de BOB. Solo se construye validando. */
export type Centavos = number & { readonly [marcaCentavos]: 'centavos' };

export type ErrorMonto =
  | { readonly tipo: 'NO_ES_ENTERO'; readonly valor: number }
  | { readonly tipo: 'NEGATIVO'; readonly valor: number }
  | { readonly tipo: 'FUERA_DE_RANGO'; readonly valor: number }
  | { readonly tipo: 'FORMATO_INVALIDO'; readonly texto: string };

/**
 * Construye un monto desde centavos enteros.
 *
 * Rechaza no-enteros (incluye `NaN` e `Infinity`), negativos y valores fuera
 * del rango seguro de enteros de JavaScript. No impone un máximo de negocio:
 * los límites regulatorios BCB/ASFI todavía no están verificados
 * (docs/02 §4 y pregunta C2 al banco) y este proyecto no inventa cifras.
 */
export function centavos(valor: number): Resultado<Centavos, ErrorMonto> {
  if (!Number.isInteger(valor)) {
    return fallo({ tipo: 'NO_ES_ENTERO', valor });
  }
  if (valor < 0) {
    return fallo({ tipo: 'NEGATIVO', valor });
  }
  if (!Number.isSafeInteger(valor)) {
    return fallo({ tipo: 'FUERA_DE_RANGO', valor });
  }
  return exito(valor as Centavos);
}

/**
 * Construye un monto desde el decimal que usan las APIs (`"1.00"`, `"1.5"`, `1`).
 *
 * Acepta punto como separador decimal y hasta dos decimales. Rechaza coma
 * (regla #5), separadores de miles, signos y cualquier cosa con más de dos
 * decimales: un tercer decimal significa que el importe no es representable en
 * centavos, y redondearlo en silencio es exactamente el error que produce
 * confirmaciones por montos que no coinciden.
 */
export function desdeDecimalBob(entrada: string | number): Resultado<Centavos, ErrorMonto> {
  const texto = typeof entrada === 'number' ? String(entrada) : entrada.trim();

  const coincidencia = /^(\d+)(?:\.(\d{1,2}))?$/.exec(texto);
  if (coincidencia === null) {
    return fallo({ tipo: 'FORMATO_INVALIDO', texto });
  }

  const enteros = coincidencia[1] ?? '';
  const decimales = (coincidencia[2] ?? '').padEnd(2, '0');

  // Aritmética entera de punta a punta: el decimal nunca pasa por un float.
  const total = Number(enteros) * 100 + Number(decimales);
  return centavos(total);
}

/**
 * Formatea para el borde: centavos → decimal con exactamente dos decimales.
 *
 * Por aritmética entera, para que el round-trip con `desdeDecimalBob` sea
 * exacto en todo el rango operativo.
 */
export function aDecimalBob(monto: Centavos): string {
  const enteros = Math.trunc(monto / 100);
  const resto = monto % 100;
  return `${String(enteros)}.${String(resto).padStart(2, '0')}`;
}

/** Formatea para mostrar a una persona. */
export function formatearBob(monto: Centavos): string {
  return `Bs ${aDecimalBob(monto)}`;
}

/** Suma dos montos, validando el resultado. */
export function sumar(a: Centavos, b: Centavos): Resultado<Centavos, ErrorMonto> {
  return centavos(a + b);
}

/** Igualdad exacta. La conciliación no admite tolerancia de monto. */
export function sonIguales(a: Centavos, b: Centavos): boolean {
  return a === b;
}
