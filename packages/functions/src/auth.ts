/**
 * Verificación del token de quien llama a la API.
 *
 * Hay dos mundos y ninguno es "sin autenticación":
 *
 * - **El dueño**, que opera su consola. `verificadorFirebase` valida un ID
 *   token de Firebase Auth contra el proyecto real; `verificadorDeTokenFijo`
 *   compara contra un valor del entorno, para el demo local donde levantar
 *   Firebase Auth sería desproporcionado.
 * - **Los consumidores** del contrato de docs/10: otros productos, cada uno
 *   con su token y su identidad. Un token de consumidor **no** abre la consola
 *   del dueño, y el enrutador es el que lo hace cumplir.
 *
 * Los tokens fijos se comparan con `timingSafeEqual`, nunca con `===` (regla
 * #10): `===` corta en la primera diferencia y filtra por cuánto tardó en
 * fallar, lo que permite adivinar el token carácter por carácter.
 *
 * Y nada arranca sin token configurado. Un default vacío que "solo es para
 * desarrollo" es exactamente el tipo de cosa que termina en producción.
 */

import { timingSafeEqual } from 'node:crypto';

import type { VerificadorDeToken } from './api/enrutador.js';
import type { Identidad } from './api/tipos.js';

export type ErrorAuth = { readonly tipo: 'FALTA_TOKEN_LOCAL' };

/** Largo mínimo del token del dueño. */
const MINIMO_TOKEN_DUEÑO = 16;

/**
 * Largo mínimo del token de un consumidor.
 *
 * Más exigente que el del dueño a propósito: el del dueño lo tipea una persona
 * en su máquina, el de un consumidor lo configura otro sistema y vive en su
 * entorno durante meses. 32 caracteres es lo que sale de
 * `randomBytes(16).toString('hex')`.
 */
export const MINIMO_TOKEN_CONSUMIDOR = 32;

/** Identificador de consumidor admitido: corto, en minúsculas y sin sorpresas. */
const ID_CONSUMIDOR = /^[a-z0-9][a-z0-9-]{1,30}$/;

const PREFIJO_ENV = 'CONSUMIDOR_TOKEN_';

/**
 * El marcador de la plantilla de credenciales, sin llenar.
 *
 * Mide más de los mínimos, así que el largo no alcanza para descartarlo: un
 * archivo a medio llenar levantaría la API con un token cuyo valor exacto está
 * publicado en este repositorio.
 */
const esMarcadorDePlantilla = (valor: string): boolean =>
  valor.startsWith('<') && valor.endsWith('>');

/** Compara dos textos en tiempo constante. Un largo distinto no llega a comparar. */
function iguales(recibido: string, esperado: Buffer): boolean {
  const bytes = Buffer.from(recibido, 'utf8');
  if (bytes.length !== esperado.length) {
    return false;
  }
  return timingSafeEqual(bytes, esperado);
}

/**
 * Compara contra un token fijo, en tiempo constante.
 *
 * Devuelve `null` si el entorno no define `API_TOKEN_LOCAL`: sin token no hay
 * verificador, y sin verificador la API no arranca.
 */
export function verificadorDeTokenFijo(tokenEsperado: string | undefined): VerificadorDeToken | null {
  const valor = tokenEsperado?.trim();
  if (valor === undefined || valor.length < MINIMO_TOKEN_DUEÑO || esMarcadorDePlantilla(valor)) {
    return null;
  }
  const esperado = Buffer.from(valor, 'utf8');

  return (token: string): Promise<Identidad | null> =>
    Promise.resolve(iguales(token, esperado) ? { tipo: 'dueño', id: 'dueño-local' } : null);
}

/** Forma mínima del verificador de Firebase Auth, para no acoplar el tipo. */
export type VerificadorIdToken = {
  verifyIdToken(token: string): Promise<{ uid: string }>;
};

/**
 * Valida un ID token de Firebase Auth.
 *
 * Se le inyecta el objeto `auth` en vez de importarlo: así este módulo no
 * arrastra el SDK de Firebase y la regla de dependencias se mantiene.
 */
export function verificadorFirebase(auth: VerificadorIdToken): VerificadorDeToken {
  return async (token: string): Promise<Identidad | null> => {
    try {
      const decodificado = await auth.verifyIdToken(token);
      return { tipo: 'dueño', id: decodificado.uid };
    } catch {
      // Token vencido, mal firmado o de otro proyecto. No se distingue el
      // motivo hacia afuera: eso solo ayudaría a quien esté probando tokens.
      return null;
    }
  };
}

export type ErrorConsumidores =
  | { readonly tipo: 'ID_INVALIDO'; readonly variable: string }
  | { readonly tipo: 'TOKEN_CORTO'; readonly consumidorId: string }
  | { readonly tipo: 'TOKEN_SIN_LLENAR'; readonly consumidorId: string }
  | { readonly tipo: 'ID_REPETIDO'; readonly consumidorId: string }
  /** Dos identidades con el mismo token: no se elige una, no se arranca. */
  | { readonly tipo: 'TOKEN_COMPARTIDO'; readonly consumidorId: string };

export type LecturaConsumidores =
  | { readonly ok: true; readonly tokens: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly error: ErrorConsumidores };

/**
 * Lee los consumidores del entorno: una variable `CONSUMIDOR_TOKEN_<ID>` por
 * consumidor, p. ej. `CONSUMIDOR_TOKEN_NOVUCHAT`.
 *
 * Una variable por consumidor, y no una lista dentro de una sola: así cada
 * token se rota, se revoca y se audita por separado, y agregar el segundo
 * consumidor no obliga a nadie a parsear un formato propio.
 *
 * Un token corto **corta el arranque** en vez de admitirse con un aviso: un
 * consumidor mal configurado con un token débil es una puerta abierta a crear
 * y anular cobros, y un aviso en la terminal no la cierra.
 */
export function leerConsumidores(
  env: Readonly<Record<string, string | undefined>>,
): LecturaConsumidores {
  const tokens = new Map<string, string>();
  // El token del dueño y los de los consumidores viven en el **mismo** archivo
  // (`~/.manejoqr/baneco-<cuenta>.env`) y la plantilla los emite adyacentes.
  // Pegar el mismo valor en dos líneas durante una rotación es un desliz de un
  // segundo, y su consecuencia no es un error visible: el token del consumidor
  // pasaría a resolver como **dueño** y abriría toda la consola. Por eso se
  // compara acá y la API no arranca.
  const tokenDelDueño = env['API_TOKEN_LOCAL']?.trim();
  const bytesDelDueño =
    tokenDelDueño === undefined || tokenDelDueño === '' ? null : Buffer.from(tokenDelDueño, 'utf8');

  for (const [variable, valor] of Object.entries(env)) {
    if (!variable.startsWith(PREFIJO_ENV) || valor === undefined || valor.trim() === '') {
      continue;
    }
    const consumidorId = variable.slice(PREFIJO_ENV.length).toLowerCase().replace(/_/g, '-');
    if (!ID_CONSUMIDOR.test(consumidorId)) {
      return { ok: false, error: { tipo: 'ID_INVALIDO', variable } };
    }
    const token = valor.trim();
    if (esMarcadorDePlantilla(token)) {
      return { ok: false, error: { tipo: 'TOKEN_SIN_LLENAR', consumidorId } };
    }
    if (token.length < MINIMO_TOKEN_CONSUMIDOR) {
      return { ok: false, error: { tipo: 'TOKEN_CORTO', consumidorId } };
    }
    if (tokens.has(consumidorId)) {
      // `CONSUMIDOR_TOKEN_MI_APP` y `CONSUMIDOR_TOKEN_MI-APP` dan el mismo id.
      return { ok: false, error: { tipo: 'ID_REPETIDO', consumidorId } };
    }
    if (bytesDelDueño !== null && iguales(token, bytesDelDueño)) {
      return { ok: false, error: { tipo: 'TOKEN_COMPARTIDO', consumidorId } };
    }
    for (const [otro, suToken] of tokens) {
      if (iguales(token, Buffer.from(suToken, 'utf8'))) {
        // Dos consumidores con el mismo token: uno vería los cobros del otro.
        return { ok: false, error: { tipo: 'TOKEN_COMPARTIDO', consumidorId: otro } };
      }
    }
    tokens.set(consumidorId, token);
  }

  return { ok: true, tokens };
}

/**
 * Verificador de los consumidores del contrato (docs/10).
 *
 * Recorre **todos** los tokens configurados aunque ya haya encontrado el suyo:
 * cortar en el primero que coincide haría que la demora dependa de qué
 * consumidor es, lo que revela cuántos hay y en qué orden están.
 */
export function verificadorDeConsumidores(tokens: ReadonlyMap<string, string>): VerificadorDeToken {
  const esperados = [...tokens].map(([consumidorId, token]) => ({
    consumidorId,
    bytes: Buffer.from(token, 'utf8'),
  }));

  return (token: string): Promise<Identidad | null> => {
    let encontrado: string | null = null;
    for (const candidato of esperados) {
      if (iguales(token, candidato.bytes)) {
        encontrado = candidato.consumidorId;
      }
    }
    return Promise.resolve(
      encontrado === null ? null : { tipo: 'consumidor', consumidorId: encontrado },
    );
  };
}

/**
 * Prueba **todos** los verificadores y devuelve la identidad solo si es una.
 *
 * Falla cerrado ante la ambigüedad, y esa es la decisión que importa: si un
 * token resolviera a dos identidades, quedarse con la primera —el dueño—
 * convertiría un token de consumidor en la llave de la consola entera. Con dos
 * coincidencias no se elige ninguna y el pedido sale 401.
 *
 * `leerConsumidores` ya impide configurarlo así, y la API no arranca si pasa.
 * Esto es la segunda barrera, para el caso en que alguien arme los
 * verificadores por otro camino.
 */
export function combinarVerificadores(
  ...verificadores: readonly VerificadorDeToken[]
): VerificadorDeToken {
  return async (token: string): Promise<Identidad | null> => {
    const identidades: Identidad[] = [];
    for (const verificar of verificadores) {
      const identidad = await verificar(token);
      if (identidad !== null) {
        identidades.push(identidad);
      }
    }
    return identidades.length === 1 ? (identidades[0] ?? null) : null;
  };
}
