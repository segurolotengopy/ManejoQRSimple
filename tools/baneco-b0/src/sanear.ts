/**
 * Saneamiento de las respuestas del banco antes de guardarlas como fixture.
 *
 * Es la pieza crítica de esta herramienta: las fixtures **se commitean**, y las
 * respuestas crudas de certificación traen nombre, documento y cuenta del
 * pagador (reglas #4 y #9). Lo que salga de acá se va a versionar, así que se
 * asume culpable hasta demostrar lo contrario.
 *
 * Dos capas:
 * 1. Una lista de campos que se reemplazan por marcadores, aplicada en
 *    profundidad sobre toda la estructura.
 * 2. Una verificación final que **rechaza escribir** si el resultado todavía
 *    contiene alguno de los secretos de configuración. Es redundante a
 *    propósito: la lista de campos puede quedar desactualizada si el banco
 *    agrega uno nuevo, la verificación no.
 */

/** Campos que nunca se versionan, con el marcador que los reemplaza. */
const CAMPOS_A_REDACTAR: Readonly<Record<string, string>> = {
  senderName: '<<nombre del pagador — dato personal de un tercero, regla #4>>',
  senderDocumentId: '<<documento del pagador — dato personal, regla #4>>',
  senderAccount: '<<cuenta del pagador — dato personal, regla #4>>',
  accountCredit: '<<cuenta de abono cifrada — regla #4>>',
  password: '<<password cifrado>>',
  token: '<<JWT>>',
};

/** Campos que no son secretos pero inflan la fixture sin aportar nada. */
const CAMPOS_A_RECORTAR: readonly string[] = ['qrImage'];

export function sanear(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map((v) => sanear(v));
  }
  if (typeof valor !== 'object' || valor === null) {
    return valor;
  }

  const salida: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    const marcador = CAMPOS_A_REDACTAR[clave];
    if (marcador !== undefined) {
      salida[clave] = contenido === null ? null : marcador;
      continue;
    }
    if (CAMPOS_A_RECORTAR.includes(clave) && typeof contenido === 'string') {
      salida[clave] = `<<${clave} de ${String(contenido.length)} caracteres, recortado>>`;
      continue;
    }
    salida[clave] = sanear(contenido);
  }
  return salida;
}

export type ErrorSaneamiento = {
  readonly motivo: 'CONTIENE_SECRETO';
  readonly pista: string;
};

/**
 * Verifica que un valor ya saneado no contenga ninguno de los secretos dados.
 *
 * La comparación es sobre el JSON serializado: si un secreto aparece anidado en
 * un campo que la lista no contempla, igual se detecta. Solo se reporta **qué**
 * secreto apareció, nunca su valor.
 */
export function verificarSinSecretos(
  saneado: unknown,
  secretos: Readonly<Record<string, string>>,
): ErrorSaneamiento | null {
  const serializado = JSON.stringify(saneado);
  for (const [nombre, valor] of Object.entries(secretos)) {
    if (valor.length >= 4 && serializado.includes(valor)) {
      return { motivo: 'CONTIENE_SECRETO', pista: nombre };
    }
  }
  return null;
}
