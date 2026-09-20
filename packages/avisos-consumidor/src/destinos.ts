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
  | { readonly tipo: 'SECRETO_SIN_LLENAR'; readonly consumidorId: string };

export type LecturaDestinos =
  | { readonly ok: true; readonly destinos: ReadonlyMap<string, Destino> }
  | { readonly ok: false; readonly error: ErrorDestino };

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
    if (variable.startsWith(PREFIJO_URL)) {
      urls.set(idDeVariable(variable, PREFIJO_URL), texto);
    } else if (variable.startsWith(PREFIJO_SECRETO)) {
      secretos.set(idDeVariable(variable, PREFIJO_SECRETO), texto);
    }
  }

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
    case 'SECRETO_SIN_LLENAR':
      return `El secreto de firma del consumidor "${error.consumidorId}" quedó con el marcador de la plantilla, sin llenar.`;
  }
}
