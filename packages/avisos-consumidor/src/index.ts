/**
 * `@mqs/avisos-consumidor` — entrega firmada del aviso de confirmación a los
 * proyectos consumidores (docs/10 §4.6).
 *
 * Es el único paquete que sabe que el aviso viaja por HTTP, con qué cuerpo y
 * con qué firma. Hacia el dominio solo expone un `NotificadorConsumidor`, que
 * es un puerto de `qr-core`: cambiar HTTP por otra cosa —una cola, un correo—
 * es escribir otro adaptador, igual que con el banco (ADR-002).
 *
 * El aviso es un **acelerador, nunca la fuente de verdad**: si nunca llega, el
 * consumidor obtiene lo mismo preguntando por `estadoCobro`. Por eso acá no
 * hay nada que pueda hacer fracasar un cobro.
 */

export const PAQUETE = '@mqs/avisos-consumidor' as const;

export { CABECERA_FIRMA, firmar, verificarFirma } from './firma.js';
export {
  describirErrorDestino,
  leerDestinos,
  MINIMO_SECRETO,
  type Destino,
  type ErrorDestino,
  type LecturaDestinos,
} from './destinos.js';
export {
  cuerpoDelAviso,
  NotificadorHttp,
  TIEMPO_LIMITE_MS,
  type Transporte,
} from './notificador.js';
