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
 *
 * Lo que sí sabe el enrutador es **quién** llama. Hay dos superficies
 * separadas y no dos niveles de permiso de la misma:
 *
 * - `/api/…` es la consola del dueño.
 * - `/api/v1/…` es el contrato para proyectos consumidores (docs/10).
 *
 * Ninguna identidad cruza a la otra, y el cruce responde 404 y no 403: un 403
 * confirmaría que la ruta del otro lado existe. La separación se hace acá, una
 * sola vez, en vez de que cada handler se acuerde de comprobarla.
 */

import {
  anular,
  buscarAbono,
  cerrarAbono,
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
import * as consumidores from './consumidores.js';
import {
  error,
  noAutorizado,
  noEncontrado,
  type Identidad,
  type Peticion,
  type Respuesta,
} from './tipos.js';

/** Verifica el token del pedido. Devuelve `null` si no es válido. */
export type VerificadorDeToken = (token: string) => Promise<Identidad | null>;

const PREFIJO = '/api/cobros';
const REVISION = '/api/revision';
const PRUEBAS = '/api/pruebas';
const ABONOS = '/api/abonos';
const CONSUMIDORES = '/api/v1/cobros';

/**
 * La clave de un abono viene del banco (`baneco:{qrId}:{tx}`) y la consola la
 * manda codificada. Se decodifica acá y se acota: nada de `/`, ni largos que no
 * son de una clave.
 */
const CLAVE_ABONO = /^[A-Za-z0-9:_.-]{1,200}$/;

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

  const esRutaDeConsumidor = peticion.ruta === CONSUMIDORES || peticion.ruta.startsWith(`${CONSUMIDORES}/`);
  if (identidad.tipo === 'consumidor') {
    // Un token de consumidor no abre la consola del dueño. Ni una ruta de
    // lectura: `GET /api/cobros` listaría los cobros de todos.
    return esRutaDeConsumidor
      ? despacharConsumidor(ctx, identidad.consumidorId, peticion)
      : noEncontrado();
  }
  // Y el dueño no entra por el contrato: su consola tiene sus propias rutas, y
  // un cobro de consumidor no es suyo para crearlo ni anularlo por ahí.
  return esRutaDeConsumidor ? noEncontrado() : despachar(ctx, peticion);
}

/**
 * Las cuatro operaciones del contrato (docs/10), más la imagen del QR.
 *
 * No hay ninguna que confirme un pago, y no es un olvido: es la asimetría que
 * define el contrato (reglas #1 y BANECO-1).
 */
function despacharConsumidor(
  ctx: ContextoApi,
  consumidorId: string,
  peticion: Peticion,
): Promise<Respuesta> | Respuesta {
  const { metodo, ruta, cuerpo, consulta } = peticion;

  if (ruta === CONSUMIDORES) {
    return metodo === 'GET'
      ? consumidores.listarCobros(ctx, consumidorId, consulta)
      : consumidores.crearCobro(ctx, consumidorId, cuerpo);
  }

  const resto = ruta.slice(CONSUMIDORES.length + 1);
  const [primero, segundo, sobrante] = resto.split('/');
  if (primero === undefined || primero === '' || sobrante !== undefined) {
    return noEncontrado();
  }

  if (primero === 'por-referencia') {
    if (metodo !== 'GET') {
      return metodoNoPermitido();
    }
    if (segundo === undefined || segundo === '') {
      return noEncontrado();
    }
    let referencia: string;
    try {
      referencia = decodeURIComponent(segundo);
    } catch {
      return noEncontrado();
    }
    return consumidores.verCobroPorReferencia(ctx, consumidorId, referencia);
  }

  if (segundo === undefined) {
    return metodo === 'GET' ? consumidores.verCobro(ctx, consumidorId, primero) : metodoNoPermitido();
  }
  if (segundo === 'qr') {
    return metodo === 'GET' ? consumidores.verQr(ctx, consumidorId, primero) : metodoNoPermitido();
  }
  if (segundo === 'anular') {
    return metodo === 'POST' ? consumidores.anular(ctx, consumidorId, primero, cuerpo) : metodoNoPermitido();
  }
  return noEncontrado();
}

async function despachar(ctx: ContextoApi, peticion: Peticion): Promise<Respuesta> {
  const { metodo, ruta, cuerpo } = peticion;

  if (ruta === REVISION) {
    return metodo === 'GET' ? verRevision(ctx) : metodoNoPermitido();
  }

  if (ruta === '/api/logs') {
    return metodo === 'GET' ? verLogs(ctx) : metodoNoPermitido();
  }

  if (ruta.startsWith(`${ABONOS}/`)) {
    return despacharAbono(ctx, metodo, ruta.slice(ABONOS.length + 1), cuerpo);
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

/** `/api/abonos/:id/cerrar`, la única acción sobre un abono sin conciliar. */
function despacharAbono(
  ctx: ContextoApi,
  metodo: Peticion['metodo'],
  resto: string,
  cuerpo: unknown,
): Promise<Respuesta> | Respuesta {
  const [codificado, accion, sobrante] = resto.split('/');
  if (codificado === undefined || accion !== 'cerrar' || sobrante !== undefined) {
    return noEncontrado();
  }
  let id: string;
  try {
    id = decodeURIComponent(codificado);
  } catch {
    return noEncontrado();
  }
  if (!CLAVE_ABONO.test(id)) {
    return noEncontrado();
  }
  return metodo === 'POST' ? cerrarAbono(ctx, id, cuerpo) : metodoNoPermitido();
}

const metodoNoPermitido = (): Respuesta =>
  error(405, 'METODO_NO_PERMITIDO', 'Ese método no aplica a esta ruta.');
