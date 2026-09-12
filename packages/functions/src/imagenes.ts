/**
 * Imágenes de QR en un directorio local.
 *
 * El banco devuelve el QR como PNG en Base64. El dominio no lleva imágenes
 * inline (docs/02 §3): el adaptador las guarda acá y el cobro lleva la
 * referencia. Para el demo y la prueba en producción, "acá" es un directorio
 * **fuera del repo** (`~/.manejoqr/qrs/` por defecto, permisos 700/600): una
 * imagen de QR identifica la cuenta de cobro y no se versiona.
 *
 * El `qrId` viene del banco, así que se valida antes de usarlo como nombre de
 * archivo: una respuesta rara no puede escribir fuera del directorio.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Ids de QR aceptables como nombre de archivo. Nada de `/`, `..` ni espacios. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;
const PREFIJO = 'archivo:';

export type AlmacenLocal = {
  /** Guarda el PNG y devuelve su referencia, o `null` si no se pudo. */
  readonly guardar: (qrId: string, pngBase64: string) => Promise<string | null>;
  /** El PNG en Base64 de una referencia, o `null` si no existe o no es válida. */
  readonly leer: (imagenRef: string) => Promise<string | null>;
};

export function almacenEnDirectorio(directorio: string): AlmacenLocal {
  return {
    async guardar(qrId, pngBase64) {
      if (!ID_SEGURO.test(qrId)) {
        return null;
      }
      try {
        await mkdir(directorio, { recursive: true, mode: 0o700 });
        await writeFile(join(directorio, `${qrId}.png`), Buffer.from(pngBase64, 'base64'), { mode: 0o600 });
        return `${PREFIJO}${qrId}.png`;
      } catch {
        return null;
      }
    },

    async leer(imagenRef) {
      if (!imagenRef.startsWith(PREFIJO)) {
        return null;
      }
      const archivo = imagenRef.slice(PREFIJO.length);
      if (!archivo.endsWith('.png') || !ID_SEGURO.test(archivo.slice(0, -'.png'.length))) {
        return null;
      }
      try {
        return (await readFile(join(directorio, archivo))).toString('base64');
      } catch {
        return null;
      }
    },
  };
}
