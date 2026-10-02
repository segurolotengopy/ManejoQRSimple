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
  PaymentWatcherAbonosFirestore,
  COLECCION_ABONOS,
  ORIGEN_ABONOS,
} from './watcher-abonos.js';
export {
  AbonosSinConciliarFirestore,
  COLECCION_ABONOS_SIN_CONCILIAR,
} from './abonos-sin-conciliar.js';
export { AvisosFirestore, COLECCION_AVISOS } from './avisos.js';
export {
  atribuirCuentaALoAnterior,
  contarSinCuentaDeCobro,
  type AtribucionDeCuenta,
  type ConteoSinCuenta,
} from './atribucion-de-cuenta.js';
export {
  contarDatosSimulados,
  explicarMarca,
  fijarCuentaDePrueba,
  leerPresenciaDeMarca,
  COLECCION_CONFIGURACION,
  DOC_CUENTA_DE_PRUEBA,
  type DatosSimulados,
  type MarcaDeCuenta,
  type PresenciaDeMarca,
} from './cuenta-de-prueba.js';
export {
  cobroADocumento,
  documentoACobro,
  documentoAEvidencia,
  evidenciaADocumento,
  idDeEvidencia,
  qrADocumento,
  type ErrorMapeoFirestore,
} from './mapeo.js';

// Solo para las pruebas del emulador (guarda contra borrar sobre la base de la prueba real).
export { BaseDeEmuladorDePruebas } from './base-de-pruebas.js';
