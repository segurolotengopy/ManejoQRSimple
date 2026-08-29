/**
 * Verificación del token de la consola.
 *
 * Dos implementaciones, y ninguna es "sin autenticación":
 *
 * - `verificadorFirebase` valida un ID token de Firebase Auth contra el
 *   proyecto real. Es la que va cuando el demo salga de la máquina del dueño.
 * - `verificadorDeTokenFijo` compara contra un valor del entorno. Sirve para el
 *   demo local, donde levantar Firebase Auth sería desproporcionado.
 *
 * El token fijo se compara con `timingSafeEqual`, nunca con `===` (regla #10):
 * `===` corta en la primera diferencia y filtra por cuánto tardó en fallar, lo
 * que permite adivinar el token carácter por carácter.
 *
 * Y no arranca sin token configurado. Un default vacío que "solo es para
 * desarrollo" es exactamente el tipo de cosa que termina en producción.
 */

import { timingSafeEqual } from 'node:crypto';

import type { VerificadorDeToken } from './api/enrutador.js';

export type ErrorAuth = { readonly tipo: 'FALTA_TOKEN_LOCAL' };

/**
 * Compara contra un token fijo, en tiempo constante.
 *
 * Devuelve `null` si el entorno no define `API_TOKEN_LOCAL`: sin token no hay
 * verificador, y sin verificador la API no arranca.
 */
export function verificadorDeTokenFijo(tokenEsperado: string | undefined): VerificadorDeToken | null {
  if (tokenEsperado === undefined || tokenEsperado.trim().length < 16) {
    return null;
  }
  const esperado = Buffer.from(tokenEsperado.trim(), 'utf8');

  return (token: string): Promise<string | null> => {
    const recibido = Buffer.from(token, 'utf8');
    if (recibido.length !== esperado.length) {
      return Promise.resolve(null);
    }
    return Promise.resolve(timingSafeEqual(recibido, esperado) ? 'dueño-local' : null);
  };
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
  return async (token: string): Promise<string | null> => {
    try {
      const decodificado = await auth.verifyIdToken(token);
      return decodificado.uid;
    } catch {
      // Token vencido, mal firmado o de otro proyecto. No se distingue el
      // motivo hacia afuera: eso solo ayudaría a quien esté probando tokens.
      return null;
    }
  };
}
