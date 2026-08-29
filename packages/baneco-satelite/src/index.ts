/**
 * `@mqs/baneco-satelite` — proceso que verifica los pagos de Baneco contra el
 * banco y los concilia (ADR-006, decisión D2 opción b).
 *
 * Es una **raíz de composición**: el único lugar donde conviven el adaptador
 * del banco, el de Firestore y el dominio. No contiene reglas de negocio — las
 * decisiones están en `qr-core` y acá solo se cablean los puertos.
 *
 * Corre fuera de Firebase, con el mismo patrón que el scraper: ThinkPad en la
 * Fase 0–1, VM de OCI cuando el demo necesite 24/7 (ADR-003).
 *
 * El punto de entrada ejecutable es `main.ts`; este módulo expone la pasada
 * para poder probarla y reusarla.
 */

export { describirPasada, unaPasada, type ResumenPasada } from './pasada.js';
