/**
 * Un valor secreto que **no se puede loguear por accidente**.
 *
 * La regla #2 dice que las credenciales bancarias nunca van a logs. Mientras la
 * contraseña y la cuenta de abono fueran `string` sueltos, respetar esa regla
 * dependía de que nadie los metiera en un template literal por descuido — y un
 * descuido así no rompe ningún test: simplemente aparece la credencial en una
 * consola o en un archivo de log.
 *
 * Esta clase lo hace imposible en vez de improbable:
 *
 * - El valor vive en un campo privado (`#valor`), invisible para `Object.keys`,
 *   para el spread y para el `JSON.stringify` genérico.
 * - `toString()` devuelve un marcador, así que `${secreto}` imprime
 *   `<<secreto>>` y no la credencial.
 * - `toJSON()` devuelve el mismo marcador, así que serializar el objeto que lo
 *   contiene tampoco lo filtra.
 * - La única forma de obtener el valor es llamar a `revelar()`, que se ve en el
 *   diff y en la revisión.
 *
 * CodeQL marcaba `js/clear-text-logging` en los procesos que imprimen su
 * configuración al arrancar: seguía el rastro desde `process.env` hasta un
 * `console.log`, sin poder probar que la credencial no venía en el medio. El
 * rastro era real aunque el valor no viajara; con este tipo, deja de existir.
 */

const MARCADOR = '<<secreto>>';

export class Secreto {
  readonly #valor: string;

  constructor(valor: string) {
    this.#valor = valor;
  }

  /** Único acceso al valor en claro. Usar solo al borde que lo necesita. */
  revelar(): string {
    return this.#valor;
  }

  /** Longitud del valor, para validaciones que no necesitan verlo. */
  get longitud(): number {
    return this.#valor.length;
  }

  toString(): string {
    return MARCADOR;
  }

  toJSON(): string {
    return MARCADOR;
  }

  get [Symbol.toStringTag](): string {
    return 'Secreto';
  }
}
