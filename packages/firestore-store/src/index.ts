/**
 * `@mqs/firestore-store` — persistencia del cobro y su evidencia en Firestore.
 *
 * Restricción estructural: **único paquete que conoce el SDK de Firebase**
 * (validado en CI). El dominio ve `CobroRepository` y `EvidenceStore`; las
 * colecciones, los `Timestamp` y los códigos de error de Google viven acá.
 *
 * La conexión se **inyecta**, no se crea acá dentro: así los tests corren
 * contra el emulador y el satélite contra el proyecto real, sin que el
 * adaptador sepa la diferencia — y sin que exista un camino por el que un test
 * termine hablándole al proyecto de verdad.
 */

export {
  CobroRepositoryFirestore,
  EvidenceStoreFirestore,
  COLECCION_COBROS,
  SUBCOLECCION_EVIDENCIA,
  SUBCOLECCION_QRS,
} from './repositorio.js';
export {
  cobroADocumento,
  documentoACobro,
  documentoAEvidencia,
  evidenciaADocumento,
  idDeEvidencia,
  qrADocumento,
  type ErrorMapeoFirestore,
} from './mapeo.js';
