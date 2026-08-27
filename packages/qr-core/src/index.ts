/**
 * `@mqs/qr-core` — dominio puro del cobro por QR.
 *
 * Restricción estructural (CLAUDE.md, docs/01 §4): este paquete **no importa a
 * nadie** — ni adaptadores, ni SDKs, ni I/O. Todo lo externo entra por los
 * puertos de `src/ports/`. La regla se valida en CI con dependency-cruiser.
 *
 * El contenido real (cobros, máquina de estados, conciliación, puertos) llega
 * en las sesiones de dominio; este módulo es hoy solo el ancla del paquete.
 */

/** Identidad del paquete. Sirve de marcador hasta que exista dominio real. */
export const PAQUETE = '@mqs/qr-core' as const;

/**
 * Proveedores de cobro contemplados por el diseño multi-proveedor (decisión D1).
 * Cada cobro nace asociado a uno; el dominio no conoce sus implementaciones.
 */
export const PROVEEDORES = ['baneco', 'yape'] as const;

export type Proveedor = (typeof PROVEEDORES)[number];
