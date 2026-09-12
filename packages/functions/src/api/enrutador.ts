/**
 * Enrutado y autenticación de la API.
 *
 * La autenticación se resuelve **antes** de mirar la ruta, y sin excepciones:
 * no hay endpoint público. La consola opera la billetera del dueño, así que
 * cualquiera que pueda crear o anular un cobro sin identificarse es un agujero,
 * no una comodidad de desarrollo.
 *
 * El verificador se inyecta: en producción valida un ID token de Firebase Auth;
 * en el demo local acepta un token fijo del entorno. El enrutador no sabe la
 * diferencia — y sobre todo, **no existe un modo "sin autenticación"** que
 * alguien pueda activar por accidente.
 */

import {
  anular,
  buscarAbono,
  cerrarPrueba,
  comprobante,
  crearCobro,
  enviar,
  generarQrDePrueba,
  listarCobros,
  renovar,
  resolver,
  sondearAnulacion,
  verCobro,
  verificar,
  verLogs,
  verPrueba,
  verQr,
  verRevision,
  type ContextoApi,
} from './handlers.js';
import { error, noAutorizado, noEncontrado, type Peticion, type Respuesta } from './tipos.js';

/** Verifica el token del pedido. Devuelve `null` si no es válido. */
export type VerificadorDeToken = (token: string) => Promise<string | null>;

const PREFIJO = '/api/cobros';
const REVISION = '/api/revision';
const PRUEBAS = '/api/pruebas';

export async function enrutar(
  ctx: ContextoApi,
  verificar_: VerificadorDeToken,
  peticion: Peticion,
): Promise<Respuesta> {
  if (peticion.token === null) {
    return noAutorizado();
  }
  const identidad = await verificar_(peticion.token);
  if (identidad === null) {
    return noAutorizado();
  }

  return despachar(ctx, peticion);
}

async function despachar(ctx: ContextoApi, peticion: Peticion): Promise<Respuesta> {
  const { metodo, ruta, cuerpo } = peticion;

  if (ruta === REVISION) {
    return metodo === 'GET' ? verRevision(ctx) : metodoNoPermitido();
  }

  if (ruta === '/api/logs') {
    return metodo === 'GET' ? verLogs(ctx) : metodoNoPermitido();
  }

  // Sin modo prueba, estas rutas responden 404 como cualquier ruta inexistente.
  if (ruta === PRUEBAS) {
    return metodo === 'GET' ? verPrueba(ctx) : metodoNoPermitido();
  }
  if (ruta === `${PRUEBAS}/qr`) {
    return metodo === 'POST' ? generarQrDePrueba(ctx, cuerpo) : metodoNoPermitido();
  }
  if (ruta === `${PRUEBAS}/cerrar`) {
    return metodo === 'POST' ? cerrarPrueba(ctx) : metodoNoPermitido();
  }

  if (ruta === PREFIJO) {
    return metodo === 'GET' ? listarCobros(ctx) : crearCobro(ctx, cuerpo);
  }

  if (!ruta.startsWith(`${PREFIJO}/`)) {
    return noEncontrado();
  }

  const resto = ruta.slice(PREFIJO.length + 1);
  const [id, accion, sobrante] = resto.split('/');

  if (id === undefined || id === '' || sobrante !== undefined) {
    return noEncontrado();
  }

  if (accion === undefined) {
    return metodo === 'GET' ? verCobro(ctx, id) : metodoNoPermitido();
  }

  if (accion === 'qr') {
    return metodo === 'GET' ? verQr(ctx, id) : metodoNoPermitido();
  }

  if (metodo !== 'POST') {
    return metodoNoPermitido();
  }

  switch (accion) {
    case 'enviar':
      return enviar(ctx, id);
    case 'renovar':
      return renovar(ctx, id, cuerpo);
    case 'anular':
      return anular(ctx, id, cuerpo);
    case 'comprobante':
      return comprobante(ctx, id, cuerpo);
    case 'verificar':
      return verificar(ctx, id);
    case 'resolver':
      return resolver(ctx, id, cuerpo);
    case 'buscar-abono':
      return buscarAbono(ctx, id);
    case 'sondear-anulacion':
      return sondearAnulacion(ctx, id);
    default:
      return noEncontrado();
  }
}

const metodoNoPermitido = (): Respuesta =>
  error(405, 'METODO_NO_PERMITIDO', 'Ese método no aplica a esta ruta.');
