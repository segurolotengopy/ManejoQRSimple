/**
 * `@mqs/yape-scraper` — adaptador `PaymentWatcher` sobre la consola web de
 * Yape (BCP Bolivia). **Riel diferido** (decisión D1, 2026-08-27): la línea
 * principal del proyecto pasó a la API oficial de Banco Económico. Este
 * paquete se retoma cuando el dueño aporte las capturas de la consola.
 *
 * Restricciones estructurales, vigentes desde ya:
 * - **Solo lectura.** Navega y lee movimientos. Jamás ejecuta acciones
 *   transaccionales en la consola del banco.
 * - **Único paquete autorizado a usar Playwright.** La regla se valida en CI
 *   con dependency-cruiser, esté Playwright instalado o no.
 * - Corre como proceso satélite fuera de Firebase (ADR-003), porque necesita
 *   la sesión bancaria del dueño. El `storageState` vive en `~/.manejoqr/`,
 *   nunca en el repo.
 * - Los selectores no se inventan: se mapean desde `docs/consola-yape/` y se
 *   registran en `docs/03-scraping-yape-bcp.md` §6.
 */

/** Identidad del paquete. */
export const PAQUETE = '@mqs/yape-scraper' as const;

/** El scraper nunca escribe en la consola del banco (regla de negocio #3). */
export const SOLO_LECTURA = true;
