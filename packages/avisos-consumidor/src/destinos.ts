/**
 * A dónde avisarle a cada consumidor, y con qué secreto firmar.
 *
 * Dos variables por consumidor, con el mismo criterio que el token de la API:
 * una por consumidor y no una lista dentro de una sola, para poder rotar y
 * revocar de a uno.
 *
 *   CONSUMIDOR_AVISO_URL_<ID>      https://…  (https obligatorio)
 *   CONSUMIDOR_AVISO_SECRETO_<ID>  ≥ 32 caracteres
 *
 * **Las dos o ninguna.** Una URL sin secreto mandaría avisos sin firmar, que
 * es peor que no mandarlos: el consumidor no podría distinguirlos de los que
 * le invente cualquiera. Un secreto sin URL no hace nada, pero delata que
 * alguien quiso configurar esto y se quedó a mitad.
 *
 * Un consumidor sin destino no es un error: es el caso normal de quien
 * prefiere consultar por `estadoCobro`.
 */

/** Largo mínimo del secreto de firma. El mismo que el token de un consumidor. */
export const MINIMO_SECRETO = 32;

const PREFIJO_URL = 'CONSUMIDOR_AVISO_URL_';
const PREFIJO_SECRETO = 'CONSUMIDOR_AVISO_SECRETO_';

export type Destino = {
  readonly consumidorId: string;
  readonly url: string;
  readonly secreto: string;
};

export type ErrorDestino =
  | { readonly tipo: 'URL_SIN_SECRETO'; readonly consumidorId: string }
  | { readonly tipo: 'SECRETO_SIN_URL'; readonly consumidorId: string }
  | { readonly tipo: 'URL_INVALIDA'; readonly consumidorId: string }
  | { readonly tipo: 'URL_NO_ES_HTTPS'; readonly consumidorId: string }
  | { readonly tipo: 'SECRETO_CORTO'; readonly consumidorId: string }
  | { readonly tipo: 'SECRETO_SIN_LLENAR'; readonly consumidorId: string }
  /** El identificador que sale del nombre de la variable no es un identificador. */
  | { readonly tipo: 'ID_INVALIDO'; readonly variable: string }
  /** Dos variables que normalizan al mismo consumidor: una pisaría a la otra. */
  | { readonly tipo: 'ID_REPETIDO'; readonly consumidorId: string }
  /** Dos consumidores con el mismo secreto, o el secreto igual a un token de la API. */
  | { readonly tipo: 'SECRETO_COMPARTIDO'; readonly consumidorId: string };

export type LecturaDestinos =
  | { readonly ok: true; readonly destinos: ReadonlyMap<string, Destino> }
  | { readonly ok: false; readonly error: ErrorDestino };

/**
 * El mismo formato de identificador que exige `CONSUMIDOR_TOKEN_<ID>` en la API
 * (`functions/src/auth.ts`). Se repite acá y no se importa porque este paquete
 * no puede depender de `functions`.
 */
const ID_CONSUMIDOR = /^[a-z0-9][a-z0-9-]{1,30}$/;

const PREFIJO_TOKEN = 'CONSUMIDOR_TOKEN_';
const TOKEN_DEL_DUEÑO = 'API_TOKEN_LOCAL';

const idDeVariable = (variable: string, prefijo: string): string =>
  variable.slice(prefijo.length).toLowerCase().replace(/_/g, '-');

/** El marcador de la plantilla sin llenar, como en el resto del proyecto. */
const esMarcador = (valor: string): boolean => valor.startsWith('<') && valor.endsWith('>');

export function leerDestinos(
  env: Readonly<Record<string, string | undefined>>,
): LecturaDestinos {
  const urls = new Map<string, string>();
  const secretos = new Map<string, string>();

  for (const [variable, valor] of Object.entries(env)) {
    const texto = valor?.trim() ?? '';
    if (texto === '') {
      continue;
    }
    const esUrl = variable.startsWith(PREFIJO_URL);
    const esSecreto = variable.startsWith(PREFIJO_SECRETO);
    if (!esUrl && !esSecreto) {
      continue;
    }
    const consumidorId = idDeVariable(variable, esUrl ? PREFIJO_URL : PREFIJO_SECRETO);
    if (!ID_CONSUMIDOR.test(consumidorId)) {
      return { ok: false, error: { tipo: 'ID_INVALIDO', variable } };
    }
    const mapa = esUrl ? urls : secretos;
    if (mapa.has(consumidorId)) {
      // `..._MI_APP` y `..._MI-APP` dan el mismo id: sin esto, el segundo
      // pisaría al primero según el orden del entorno, y los avisos de un
      // consumidor —con su referencia y su monto— saldrían hacia la URL del otro.
      return { ok: false, error: { tipo: 'ID_REPETIDO', consumidorId } };
    }
    mapa.set(consumidorId, texto);
  }

  // Los tokens de la API —de cualquier consumidor y el del dueño—, para no
  // aceptar un secreto de firma igual a uno. Con el secreto de A igual al token
  // de B, B podría fabricarle avisos válidos a A, y A llamar a la API como B.
  const tokens = new Set<string>();
  for (const [variable, valor] of Object.entries(env)) {
    const texto = valor?.trim() ?? '';
    if (texto !== '' && (variable.startsWith(PREFIJO_TOKEN) || variable === TOKEN_DEL_DUEÑO)) {
      tokens.add(texto);
    }
  }
  const vistos = new Map<string, string>();

  const destinos = new Map<string, Destino>();

  for (const [consumidorId, url] of urls) {
    const secreto = secretos.get(consumidorId);
    if (secreto === undefined) {
      return { ok: false, error: { tipo: 'URL_SIN_SECRETO', consumidorId } };
    }
    if (esMarcador(secreto)) {
      return { ok: false, error: { tipo: 'SECRETO_SIN_LLENAR', consumidorId } };
    }
    if (secreto.length < MINIMO_SECRETO) {
      return { ok: false, error: { tipo: 'SECRETO_CORTO', consumidorId } };
    }

    let parseada: URL;
    try {
      parseada = new URL(url);
    } catch {
      return { ok: false, error: { tipo: 'URL_INVALIDA', consumidorId } };
    }
    // Sin https, el aviso —y su firma— viajan en claro por la red de
    // cualquiera. Firmar no sirve si el canal no es privado.
    if (parseada.protocol !== 'https:') {
      return { ok: false, error: { tipo: 'URL_NO_ES_HTTPS', consumidorId } };
    }

    // El secreto de firma es distinto de todo token de la API (con el token se
    // llama, con el secreto se verifica lo que sale) y del de cualquier otro
    // consumidor: con uno compartido, un consumidor le fabricaría avisos
    // válidos a otro que conozca su URL (T15).
    if (tokens.has(secreto) || vistos.has(secreto)) {
      return { ok: false, error: { tipo: 'SECRETO_COMPARTIDO', consumidorId } };
    }
    vistos.set(secreto, consumidorId);

    destinos.set(consumidorId, { consumidorId, url: parseada.toString(), secreto });
  }

  for (const consumidorId of secretos.keys()) {
    if (!urls.has(consumidorId)) {
      return { ok: false, error: { tipo: 'SECRETO_SIN_URL', consumidorId } };
    }
  }

  return { ok: true, destinos };
}

/** Mensaje para la terminal. Nombra al consumidor, nunca su secreto ni su URL. */
export function describirErrorDestino(error: ErrorDestino): string {
  switch (error.tipo) {
    case 'URL_SIN_SECRETO':
      return `El consumidor "${error.consumidorId}" tiene URL de aviso pero no secreto de firma. Sin firma, cualquiera podría mandarle un aviso inventado.`;
    case 'SECRETO_SIN_URL':
      return `El consumidor "${error.consumidorId}" tiene secreto de firma pero no URL de aviso.`;
    case 'URL_INVALIDA':
      return `La URL de aviso del consumidor "${error.consumidorId}" no es una URL.`;
    case 'URL_NO_ES_HTTPS':
      return `La URL de aviso del consumidor "${error.consumidorId}" no es https.`;
    case 'SECRETO_CORTO':
      return `El secreto de firma del consumidor "${error.consumidorId}" tiene menos de ${String(MINIMO_SECRETO)} caracteres.`;
    case 'ID_INVALIDO':
      return `${error.variable}: el identificador del consumidor solo admite letras, números y guiones (2 a 31 caracteres).`;
    case 'ID_REPETIDO':
      return `Hay dos variables de aviso que dan el mismo consumidor "${error.consumidorId}" (el guion bajo y el guion medio se equiparan).`;
    case 'SECRETO_COMPARTIDO':
      return `El secreto de firma del consumidor "${error.consumidorId}" es igual al de otro consumidor o a un token de la API. Cada uno necesita el suyo.`;
    case 'SECRETO_SIN_LLENAR':
      return `El secreto de firma del consumidor "${error.consumidorId}" quedó con el marcador de la plantilla, sin llenar.`;
  }
}
