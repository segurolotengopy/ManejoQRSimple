/**
 * `@mqs/functions` — la API HTTP del demo.
 *
 * Restricciones estructurales:
 * - **Orquesta; no decide.** Ninguna regla de negocio vive acá: toda transición
 *   de estado pasa por los casos de uso de `@mqs/qr-core`.
 * - Es una raíz de composición: cablea puertos con `@mqs/composicion`.
 * - El despliegue a Firebase nunca es automático: lo pide el dueño.
 *
 * Los handlers no conocen el framework HTTP —reciben `Peticion`, devuelven
 * `Respuesta`—, así que se prueban llamándolos como funciones. El borde de hoy
 * es un servidor `node:http` local; el día que esto sea Cloud Functions, se
 * escribe otro borde y los handlers no se tocan.
 */

export const PAQUETE = '@mqs/functions' as const;

/** Las reglas de negocio viven en el dominio, no en la capa de orquestación. */
export const CONTIENE_REGLAS_DE_NEGOCIO = false;

export { enrutar, type VerificadorDeToken } from './api/enrutador.js';
export type { ContextoApi } from './api/handlers.js';
export {
  creado,
  error,
  noAutorizado,
  noEncontrado,
  ok,
  type Metodo,
  type Peticion,
  type Respuesta,
} from './api/tipos.js';
export {
  verificadorDeTokenFijo,
  verificadorFirebase,
  type VerificadorIdToken,
} from './auth.js';
export { crearServidor, type OpcionesServidor } from './servidor.js';
