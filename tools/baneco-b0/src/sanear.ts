/**
 * Saneamiento de las respuestas del banco antes de guardarlas como fixture.
 *
 * Es la pieza crítica de esta herramienta: las fixtures **se commitean**, y las
 * respuestas crudas de certificación traen nombre, documento y cuenta del
 * pagador (reglas #4 y #9). Lo que salga de acá se va a versionar, así que se
 * asume culpable hasta demostrar lo contrario.
 *
 * Tres capas:
 * 1. **Dentro de un pago** (`payment`, `paymentList`), lista de campos
 *    **permitidos**: todo lo demás se reemplaza, incluida la glosa, que en
 *    Baneco trae el nombre del pagador (respuesta F1). Un campo nuevo o con
 *    otras mayúsculas no pasa por omisión.
 * 2. Fuera de los pagos, se reemplazan los campos conocidos y cualquier clave
 *    que, con cualquier mayúscula, suene a persona o cuenta.
 * 3. Una verificación final que **rechaza escribir** si el resultado contiene
 *    un secreto de configuración **o un valor del pagador** tomado de la
 *    respuesta cruda (`datosDelPagador`). Es redundante a propósito: si las
 *    listas quedan desactualizadas, esta capa no.
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

/** Claves que, con cualquier mayúscula, huelen a dato de una persona o de su cuenta. */
const CLAVE_PERSONAL = /sender|name|nombre|document|account|cuenta|glosa/i;

/**
 * Las listas de pagos del banco (`statusQR` y `paidQR`), sin distinguir
 * mayúsculas: el banco ya mostró variaciones de ese tipo (V4).
 */
const LISTAS_DE_PAGOS: readonly string[] = ['payment', 'paymentlist', 'payments'];
const esListaDePagos = (clave: string): boolean => LISTAS_DE_PAGOS.includes(clave.toLowerCase());

/** Dentro de un pago, lo único que se conserva. Nada identifica a una persona. */
const CAMPOS_DE_PAGO_PERMITIDOS: readonly string[] = [
  'qrId',
  'transactionId',
  'paymentDate',
  'paymentTime',
  'currency',
  'amount',
  'senderBankCode',
  'branchCode',
];

/** Campos que no son secretos pero inflan la fixture sin aportar nada. */
const CAMPOS_A_RECORTAR: readonly string[] = ['qrImage'];

const marcadorPersonal = (clave: string): string => `<<${clave}: posible dato personal, regla #4>>`;

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
    if (esListaDePagos(clave) && Array.isArray(contenido)) {
      salida[clave] = contenido.map(sanearPago);
      continue;
    }
    if (CLAVE_PERSONAL.test(clave)) {
      salida[clave] = contenido === null ? null : marcadorPersonal(clave);
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

/** Un pago: solo pasan los campos permitidos, el resto se reemplaza. */
function sanearPago(pago: unknown): unknown {
  if (typeof pago !== 'object' || pago === null || Array.isArray(pago)) {
    return sanear(pago);
  }
  const salida: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(pago)) {
    if (CAMPOS_DE_PAGO_PERMITIDOS.includes(clave) && (typeof contenido !== 'object' || contenido === null)) {
      salida[clave] = contenido;
    } else {
      salida[clave] = contenido === null ? null : `<<${clave}: fuera de la lista permitida, regla #4>>`;
    }
  }
  return salida;
}

/**
 * Los valores del pagador que trae una respuesta cruda, para la verificación
 * final: todo texto de un pago fuera de la lista permitida, y todo texto de una
 * clave personal fuera de los pagos. Las claves del resultado dicen de dónde
 * salió cada valor; nunca se imprimen los valores.
 */
export function datosDelPagador(valor: unknown, prefijo = 'pagador'): Readonly<Record<string, string>> {
  const encontrados: Record<string, string> = {};
  recolectar(valor, prefijo, false, encontrados);
  return encontrados;
}

const LARGO_MINIMO_DATO = 6;

function recolectar(valor: unknown, ruta: string, enPago: boolean, destino: Record<string, string>): void {
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => {
      recolectar(v, `${ruta}[${String(i)}]`, enPago, destino);
    });
    return;
  }
  if (typeof valor !== 'object' || valor === null) {
    return;
  }
  for (const [clave, contenido] of Object.entries(valor)) {
    const aqui = `${ruta}.${clave}`;
    if (typeof contenido === 'string') {
      const sensible = enPago ? !CAMPOS_DE_PAGO_PERMITIDOS.includes(clave) : CLAVE_PERSONAL.test(clave);
      // Seis caracteres como mínimo: una glosa de una palabra común ("Pago")
      // chocaría con cualquier texto y trabaría la escritura para siempre. Un
      // nombre, un documento o una cuenta ofuscada nunca son tan cortos.
      if (sensible && contenido.trim().length >= LARGO_MINIMO_DATO) {
        destino[aqui] = contenido.trim();
      }
      continue;
    }
    recolectar(contenido, aqui, enPago || esListaDePagos(clave), destino);
  }
}

/**
 * Deja en `paymentList` solo los pagos de un QR. El reporte diario trae todos
 * los pagos del usuario API, y en certificación ese usuario es compartido
 * (respuesta A3): el resto son pagos de terceros ajenos a la prueba.
 */
export function soloPagosDe(cuerpo: unknown, qrId: string): unknown {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    return NO_FILTRABLE;
  }
  // Lista blanca del sobre: arriba solo pueden venir el código, el mensaje y
  // una lista de pagos. Cualquier otra cosa —un pago suelto como objeto, una
  // clave nueva, una lista que no es lista— no se puede filtrar con certeza,
  // así que la fixture no se escribe (falla cerrado, no abierto).
  const salida: Record<string, unknown> = {};
  let listas = 0;
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (esListaDePagos(clave)) {
      if (!Array.isArray(valor) && valor !== null && valor !== undefined) {
        return NO_FILTRABLE;
      }
      listas += 1;
      salida[clave] = Array.isArray(valor) ? valor.filter(esPagoDe(qrId)) : valor;
    } else if (clave === 'responseCode' && (typeof valor === 'number' || typeof valor === 'string')) {
      salida[clave] = valor;
    } else if (clave === 'message' && (typeof valor === 'string' || valor === null || valor === undefined)) {
      // El mensaje de un reporte que trae pagos de terceros podría nombrar a
      // alguno: vacío se conserva, con texto se reemplaza.
      salida[clave] = typeof valor === 'string' && valor.trim() !== '' ? '<<message omitido: regla #4>>' : valor;
    } else {
      return NO_FILTRABLE;
    }
  }
  return listas <= 1 ? salida : NO_FILTRABLE;
}

/**
 * Marca de que un cuerpo de `paidQR` no tiene una forma que se pueda filtrar
 * con certeza. Quien la recibe **no escribe** la fixture.
 */
export const NO_FILTRABLE: unique symbol = Symbol('no-filtrable');

const esPagoDe =
  (qrId: string) =>
  (p: unknown): boolean =>
    typeof p === 'object' && p !== null && (p as Record<string, unknown>)['qrId'] === qrId;

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
