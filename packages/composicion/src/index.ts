/**
 * `@mqs/composicion` — la raíz de composición compartida.
 *
 * Elige los adaptadores por variable de entorno y arma los puertos del dominio.
 * La usan los procesos que necesitan el sistema cableado —el satélite de Baneco
 * y, cuando exista, `functions`— para no duplicar la lógica de selección: dos
 * copias de este cableado serían dos copias que se desincronizan.
 *
 * No contiene reglas de negocio. Construye e inyecta, nada más.
 */

export { MensajeriaNoConfigurada } from './mensajeria.js';
export {
  construirPuertos,
  describirError,
  MODOS,
  type AlmacenImagenQr,
  type LlamadaAlBanco,
  type ErrorComposicion,
  type Modo,
  type OpcionesComposicion,
  type PuertosArmados,
} from './puertos.js';
export { hablaConProduccion, verificarProduccion } from './produccion.js';
export {
  decidirSobreLaBase,
  esProcesoDeLaPrueba,
  verificarBaseDelProceso,
  type AccionSobreLaBase,
} from './base-de-la-prueba.js';
export {
  archivoDeCredenciales,
  esAliasDeCuenta,
  leerAtribucionExplicita,
  leerCuentaDeCobro,
  leerCuentaDePrueba,
  prepararDatosDeLaCuenta,
  VARIABLE_ATRIBUCION,
  type AtribucionExplicita,
  type ErrorPreparacionDeCuenta,
  ALIAS_DE_CUENTA,
  CUENTA_POR_DEFECTO,
} from './cuenta.js';
/**
 * La marca de cuenta del emulador se re-exporta desde acá para que los procesos
 * —la API y el satélite— no tengan que importar el adaptador de Firestore solo
 * por esto: la raíz de composición es la que cablea persistencia.
 */
export {
  atribuirCuentaALoAnterior,
  contarDatosSimulados,
  contarSinCuentaDeCobro,
  explicarMarca,
  fijarCuentaDePrueba,
  leerPresenciaDeMarca,
  type AtribucionDeCuenta,
  type ConteoSinCuenta,
  type DatosSimulados,
  type MarcaDeCuenta,
  type PresenciaDeMarca,
} from '@mqs/firestore-store';
export {
  Bitacora,
  describirLlamada,
  diaBoliviano,
  sanearTexto,
  type EntradaLog,
  type LlamadaObservada,
  type NivelLog,
  type OrigenLog,
  type Proceso,
} from './bitacora.js';
