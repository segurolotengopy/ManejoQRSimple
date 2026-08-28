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
  type ErrorComposicion,
  type Modo,
  type OpcionesComposicion,
  type PuertosArmados,
} from './puertos.js';
