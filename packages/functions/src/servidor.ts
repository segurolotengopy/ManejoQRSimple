/**
 * El borde HTTP: un servidor `node:http` que traduce a `Peticion`/`Respuesta`.
 *
 * Sin framework y sin dependencias nuevas. Todo lo que hace es parsear el
 * pedido, delegar en el enrutador y serializar la respuesta; la lógica está en
 * los handlers, que se prueban sin levantar nada.
 *
 * Cuando el demo se despliegue como Cloud Functions, este archivo se reemplaza
 * por otro borde equivalente y los handlers no se tocan.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { enrutar, type VerificadorDeToken } from './api/enrutador.js';
import type { ContextoApi } from './api/handlers.js';
import type { Metodo, Peticion } from './api/tipos.js';
import type { RegistroEventos } from './registro.js';

/** Tamaño máximo del cuerpo. Un pedido de cobro no necesita más que esto. */
const LIMITE_CUERPO_BYTES = 64 * 1024;

export type OpcionesServidor = {
  readonly ctx: ContextoApi;
  readonly verificador: VerificadorDeToken;
  /** Origen permitido para la consola. Sin comodín: es una API de escritura. */
  readonly origenPermitido: string;
  /** Logs de depuración: cada pedido con su estado y demora. */
  readonly registro?: RegistroEventos;
};

export function crearServidor(opciones: OpcionesServidor): Server {
  return createServer((req, res) => {
    void atender(opciones, req, res);
  });
}

async function atender(
  opciones: OpcionesServidor,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cabeceras: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // Un solo origen, nunca `*`: esta API crea y anula cobros.
    'Access-Control-Allow-Origin': opciones.origenPermitido,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cabeceras);
    res.end();
    return;
  }

  const metodo: Metodo | null =
    req.method === 'GET' || req.method === 'POST' ? req.method : null;
  if (metodo === null) {
    res.writeHead(405, cabeceras);
    res.end(JSON.stringify({ error: { codigo: 'METODO_NO_PERMITIDO', mensaje: 'Método no admitido.' } }));
    return;
  }

  const cuerpoCrudo = await leerCuerpo(req, res, cabeceras);
  if (cuerpoCrudo === null) {
    return;
  }

  let cuerpo: unknown = null;
  if (cuerpoCrudo !== '') {
    try {
      cuerpo = JSON.parse(cuerpoCrudo);
    } catch {
      res.writeHead(400, cabeceras);
      res.end(JSON.stringify({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON.' } }));
      return;
    }
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const peticion: Peticion = {
    metodo,
    ruta: url.pathname,
    // Solo el primer valor de cada parámetro: `?limite=1&limite=999` no puede
    // servir para colar el segundo donde se valida el primero.
    consulta: Object.fromEntries([...url.searchParams.keys()].map((k) => [k, url.searchParams.get(k) ?? ''])),
    cuerpo,
    token: tokenDe(req.headers.authorization),
  };

  const inicio = Date.now();
  const respuesta = await enrutar(opciones.ctx, opciones.verificador, peticion);
  res.writeHead(respuesta.status, cabeceras);
  res.end(JSON.stringify(respuesta.cuerpo));

  // Las lecturas exitosas no se registran: la consola consulta el estado cada
  // pocos segundos, y esas líneas tapaban lo que importa en un buffer de 500.
  // Tampoco los 401: son pedidos sin token válido, que cualquiera puede mandar
  // en cantidad, y con la bitácora en disco llenarían el disco. Sí queda toda
  // escritura autenticada, todo otro error y (aparte) toda llamada al banco.
  const esLecturaExitosa = metodo === 'GET' && respuesta.status < 400;
  if (opciones.registro !== undefined && !esLecturaExitosa && respuesta.status !== 401) {
    const { status } = respuesta;
    opciones.registro.agregar(
      status >= 500 ? 'error' : status >= 400 ? 'aviso' : 'info',
      'api',
      `${metodo} ${recortarRuta(peticion.ruta)} → ${String(status)}${sufijoDeError(respuesta.cuerpo)} · ${String(Date.now() - inicio)} ms`,
    );
  }
}

/** Prefijo cuyo último segmento lleva un dato de quien llama, no un id nuestro. */
const RUTA_CON_DATO_AJENO = '/api/v1/cobros/por-referencia/';

/**
 * La ruta para el log: recortada, y sin el dato que puso quien llama.
 *
 * El query string nunca se registra, pero `…/por-referencia/:referencia` lleva
 * la referencia externa **en la ruta**. Es opaca por contrato, pero la elige
 * el consumidor y bien puede armarla con el identificador de su cliente. El
 * enmascarado de la bitácora no la cubre: tapa teléfonos con `+591` y corridas
 * de nueve dígitos o más, y un celular boliviano sin prefijo son ocho. Así que
 * el segmento no llega al disco.
 */
function recortarRuta(ruta: string): string {
  const anonima = ruta.startsWith(RUTA_CON_DATO_AJENO) ? `${RUTA_CON_DATO_AJENO}***` : ruta;
  return anonima.length > 200 ? `${anonima.slice(0, 200)}…` : anonima;
}

/** ` CODIGO (tipo, responseCode N)` si la respuesta es un error de la API. */
function sufijoDeError(cuerpo: unknown): string {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('error' in cuerpo)) {
    return '';
  }
  const { error } = cuerpo;
  if (typeof error !== 'object' || error === null || !('codigo' in error) || typeof error.codigo !== 'string') {
    return '';
  }
  const detalle = 'detalle' in error && typeof error.detalle === 'object' && error.detalle !== null ? error.detalle : null;
  const tipo = detalle !== null && 'tipo' in detalle && typeof detalle.tipo === 'string' ? detalle.tipo : null;
  const codigo =
    detalle !== null && 'codigoProveedor' in detalle && typeof detalle.codigoProveedor === 'string'
      ? detalle.codigoProveedor
      : null;
  const extra = tipo === null ? '' : ` (${tipo}${codigo === null ? '' : `, responseCode ${codigo}`})`;
  return ` ${error.codigo}${extra}`;
}

/** Lee el cuerpo con tope. Devuelve `null` si ya respondió por exceso. */
async function leerCuerpo(
  req: IncomingMessage,
  res: ServerResponse,
  cabeceras: Record<string, string>,
): Promise<string | null> {
  const partes: Buffer[] = [];
  let total = 0;

  for await (const trozo of req) {
    const buffer = Buffer.isBuffer(trozo) ? trozo : Buffer.from(String(trozo));
    total += buffer.length;
    if (total > LIMITE_CUERPO_BYTES) {
      // Cortar acá evita que un cuerpo enorme consuma memoria del proceso.
      res.writeHead(413, cabeceras);
      res.end(JSON.stringify({ error: { codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'Cuerpo demasiado grande.' } }));
      return null;
    }
    partes.push(buffer);
  }
  return Buffer.concat(partes).toString('utf8');
}

function tokenDe(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }
  const [esquema, valor] = authorization.split(' ');
  return esquema?.toLowerCase() === 'bearer' && valor !== undefined && valor !== '' ? valor : null;
}
