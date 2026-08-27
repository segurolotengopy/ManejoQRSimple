/**
 * `@mqs/demo-web` — consola del comerciante (React + Vite sobre Firebase Hosting).
 *
 * Estado: **esqueleto**. La app React todavía no existe; se levanta en su
 * propia sesión (docs/07). Se deja el paquete creado para que la regla de
 * dependencias y los gates lo cubran desde el principio.
 *
 * Restricciones estructurales:
 * - **Sin lógica de negocio**: consume la API HTTP de `@mqs/functions`.
 * - No habla con Firestore ni con adaptadores directamente.
 * - No muestra datos bancarios ni personales más allá del mínimo (reglas #4 y #9).
 */

/** Identidad del paquete. */
export const PAQUETE = '@mqs/demo-web' as const;

/** La consola solo consume la API; no decide nada del cobro. */
export const CONTIENE_REGLAS_DE_NEGOCIO = false;
