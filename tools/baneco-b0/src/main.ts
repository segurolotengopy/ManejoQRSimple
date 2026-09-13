/**
 * Hito B0 — validación del contrato de Baneco contra **certificación**.
 *
 * Herramienta manual del dueño. **Nunca corre en CI** y nunca toca producción:
 * hay tres barreras independientes para eso, más abajo.
 *
 * Uso:
 *   npm run baneco:b0                          # sondeo completo (anula todo lo que crea)
 *   npm run baneco:b0 -- --pago-asistido       # emite un QR para que lo pague el banco (A2)
 *   npm run baneco:b0 -- --capturar-pago       # captura el pago de ese QR como fixture
 *   npm run baneco:b0 -- --anular-pendiente    # desiste: anula ese QR si nunca se pagó
 *
 * Requiere `.env` con el bloque `BANECO_CERT_*` cargado. Produce:
 * - `docs/Integraciones/baneco/02-hallazgos-certificacion.md` — el informe del sondeo.
 * - `docs/Integraciones/baneco/02-hallazgos-pago-asistido.md` — el del pago asistido.
 * - `packages/baneco-gateway/fixtures/` — respuestas reales **saneadas**, que
 *   reemplazan a las fixtures derivadas de la especificación.
 * - `tools/baneco-b0/out/` — imágenes de QR y el estado del pago asistido (git-ignored).
 *
 * Códigos de salida: 0 bien; 1 error; 2 login rechazado; 3 el QR todavía no se
 * pagó; 4 se omitió algún archivo porque contenía un secreto o un dato del
 * pagador (revisar antes de commitear nada).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aCentavos,
  ClienteBaneco,
  describir,
  instanteDelPago,
  leerConfig,
  ProveedorDeToken,
  transporteFetch,
} from '@mqs/baneco-gateway';
import { esExito } from '@mqs/qr-core';

import { Grabador } from './grabador.js';
import { informe, type CodigoObservado, type Hallazgo } from './hallazgos.js';
import {
  accionSegunEstado,
  esHostDeCertificacion,
  esIdSeguro,
  hallazgosDelPago,
  HOST_CERTIFICACION,
  leerEstado,
  leerModo,
  leerReserva,
  reservaLiberable,
  serializarEstado,
  serializarReserva,
  type AnulacionDePagado,
  type EstadoPagoAsistido,
  type Reserva,
} from './pago-asistido.js';
import {
  anotarCodigo,
  anularYReconsultar,
  autenticar,
  estadoInicial,
  generarQrDePrueba,
  MONTO_SONDEO_CENTAVOS,
  probarTransactionIdRepetido,
  sondearVigenciaMaxima,
  transactionId,
  type Contexto,
} from './pasos.js';
import { datosDelPagador, NO_FILTRABLE, sanear, soloPagosDe, verificarSinSecretos } from './sanear.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SALIDA_INFORME = join(RAIZ, 'docs', 'Integraciones', 'baneco', '02-hallazgos-certificacion.md');
const SALIDA_INFORME_PAGO = join(RAIZ, 'docs', 'Integraciones', 'baneco', '02-hallazgos-pago-asistido.md');
const SALIDA_FIXTURES = join(RAIZ, 'packages', 'baneco-gateway', 'fixtures');
const SALIDA_LOCAL = join(RAIZ, 'tools', 'baneco-b0', 'out');
const ESTADO_PAGO = join(SALIDA_LOCAL, 'pago-asistido.json');

/** Número de transacción del QR de pago asistido: fuera del rango del sondeo. */
const N_PAGO_ASISTIDO = 900;
/** Vigencia del QR de pago asistido: el banco tarda hasta 48 h en responder (E2). */
const DIAS_PAGO_ASISTIDO = 4;

const SALIDA_OMITIDA = 4;

async function main(): Promise<number> {
  const modo = leerModo(process.argv.slice(2));
  if (!esExito(modo)) {
    console.error(`✖ ${modo.error}`);
    return 1;
  }

  const config = leerConfig(process.env);
  if (!esExito(config)) {
    console.error(`✖ Configuración inválida: ${config.error.tipo}`);
    if ('variable' in config.error) {
      console.error(`  Variable: ${config.error.variable}`);
    }
    console.error('  Cargá el bloque BANECO_CERT_* en .env antes de correr esto.');
    return 1;
  }

  // Barrera 1: esta herramienta solo existe para certificación. `leerConfig`
  // ya rechaza una URL de producción en ambiente cert; esto además rechaza el
  // ambiente prod entero, aunque la URL fuera otra.
  if (config.valor.ambiente !== 'cert') {
    console.error('✖ B0 solo corre contra certificación. BANECO_ENV debe ser "cert".');
    return 1;
  }
  // Barrera 2: lista blanca del host. Una IP o un alias de producción pasarían
  // la barrera anterior, y el pago asistido deja un QR cobrable varios días.
  if (!esHostDeCertificacion(config.valor.baseUrl)) {
    console.error(`✖ B0 solo habla con ${HOST_CERTIFICACION}. Revisá BANECO_CERT_BASE_URL.`);
    return 1;
  }

  console.log(`▶ ${describir(config.valor)}`);

  const grabador = new Grabador(transporteFetch());
  const tokens = new ProveedorDeToken(config.valor, grabador.enviar);
  const cliente = new ClienteBaneco(config.valor, grabador.enviar, tokens);
  const codigos: CodigoObservado[] = [];
  const ctx: Contexto = { config: config.valor, cliente, tokens, grabador, codigos, ahora: new Date() };

  // Los modos del pago asistido se validan antes de tocar el banco: un archivo
  // de estado que falta o sobra se detecta sin gastar un login.
  const previo = await leerEstadoPago();
  if (modo.valor !== 'SONDEO' && typeof previo === 'object' && 'reserva' in previo) {
    // Una corrida anterior se cortó pidiendo el QR. Borrar el archivo a ciegas
    // podría dejar un QR vivo que nadie conoce: primero hay que preguntar.
    console.error(
      `✖ Hay una reserva de pago asistido sin terminar (transactionId ${previo.reserva.transactionId}, ` +
        `${previo.reserva.emitidoEn}).`,
    );
    console.error('  Una corrida anterior se cortó mientras pedía el QR: el banco pudo haberlo creado.');
    console.error('  Consultá al oficial por ese transactionId y, si hay un QR vivo, pedí que lo anule.');
    console.error(`  Recién después borrá ${ESTADO_PAGO}.`);
    return 1;
  }
  if (modo.valor === 'EMITIR_PARA_PAGO' && previo !== 'NO_HAY') {
    console.error(`✖ Ya hay (o no se puede leer) un estado de pago asistido en ${ESTADO_PAGO}.`);
    console.error('  Capturalo con --capturar-pago o desistí con --anular-pendiente antes de emitir otro.');
    return 1;
  }
  if ((modo.valor === 'CAPTURAR_PAGO' || modo.valor === 'ANULAR_PENDIENTE') && typeof previo === 'string') {
    console.error(
      previo === 'NO_HAY'
        ? '✖ No hay ningún QR de pago asistido pendiente. Emitilo primero con --pago-asistido.'
        : `✖ El archivo ${ESTADO_PAGO} no se puede leer o no tiene la forma esperada. Revisalo a mano.`,
    );
    return 1;
  }

  const hallazgos: Hallazgo[] = [];
  const login = await autenticar(ctx);
  hallazgos.push(...login.hallazgos);
  if (!login.ok) {
    console.error('✖ La autenticación falló. No se reintenta (el usuario API puede bloquearse, B4).');
    // Solo el sondeo escribe informe: en los otros modos pisaría el informe de
    // certificación ya versionado con un resultado que no es de ese sondeo.
    if (modo.valor === 'SONDEO') {
      await escribirInforme(ctx, hallazgos, SALIDA_INFORME);
    }
    return 2;
  }
  console.log('✓ Autenticado. El esquema de cifrado quedó validado por el propio banco.');

  switch (modo.valor) {
    case 'SONDEO':
      return sondeo(ctx, hallazgos);
    case 'EMITIR_PARA_PAGO':
      return emitirParaPago(ctx);
    case 'CAPTURAR_PAGO':
      return typeof previo === 'string' || 'reserva' in previo ? 1 : capturarPago(ctx, previo);
    case 'ANULAR_PENDIENTE':
      return typeof previo === 'string' || 'reserva' in previo ? 1 : anularPendiente(ctx, previo);
  }
}

/** El sondeo completo: todo QR que crea, lo anula. */
async function sondeo(ctx: Contexto, hallazgos: Hallazgo[]): Promise<number> {
  console.log('  Los QRs creados por este sondeo se anulan al terminar.\n');
  let completo = true;

  const { qr, hallazgo: falloGeneracion } = await generarQrDePrueba(ctx, 1, 3);
  if (falloGeneracion !== null) {
    hallazgos.push(falloGeneracion);
  }

  if (qr !== null) {
    console.log(`✓ QR de prueba generado: ${qr.qrId}`);
    await guardarImagen(qr.qrId, qr.imagenBase64);

    hallazgos.push(await estadoInicial(ctx, qr.qrId));
    completo = (await guardarFixture(ctx, 'statusQR-activo.json', '/statusQR/')) && completo;

    hallazgos.push(...(await anularYReconsultar(ctx, qr.qrId)));
    completo = (await guardarFixture(ctx, 'statusQR-anulado.json', '/statusQR/')) && completo;
    completo = (await guardarFixture(ctx, 'cancelQR.json', '/cancelQR')) && completo;
    console.log('✓ Anulación y doble anulación sondeadas.');
  }

  hallazgos.push(await probarTransactionIdRepetido(ctx, 2));
  console.log('✓ Unicidad de transactionId sondeada.');

  hallazgos.push(...(await sondearVigenciaMaxima(ctx)));
  console.log('✓ Escalera de vigencias sondeada.');

  // El reporte diario del banco: sirve de fixture y confirma la forma de paidQR.
  const pagos = await ctx.cliente.pagosDelDia(ctx.ahora);
  if (esExito(pagos)) {
    // Solo los pagos de QRs de esta corrida (en el sondeo, ninguno: todos se
    // anulan). El usuario de certificación es compartido (A3) y el resto son
    // pagos de otros integradores, con `transactionId` en texto libre.
    completo =
      (await guardarFixture(ctx, 'paidQR-del-dia.json', '/paidQR/', (c) => soloPagosDe(c, qr?.qrId ?? ''))) &&
      completo;
    hallazgos.push({
      pregunta: 'D7',
      titulo: 'Forma de la respuesta de `paidQR`',
      veredicto: 'CONFIRMADO',
      detalle: `El reporte del día devolvió ${String(pagos.valor.length)} pago(s) con la forma esperada.`,
    });
  } else {
    hallazgos.push({
      pregunta: 'D7',
      titulo: 'Forma de la respuesta de `paidQR`',
      veredicto: 'NO_CONCLUYENTE',
      detalle: `La consulta del día falló: ${pagos.error.tipo}.`,
    });
  }

  completo = (await escribirInforme(ctx, hallazgos, SALIDA_INFORME)) && completo;
  if (!completo) {
    console.error('\n✖ Se omitió al menos un archivo porque contenía un secreto o un dato del pagador.');
    console.error('  No commitees nada de esta corrida sin revisar qué quedó escrito.');
    return SALIDA_OMITIDA;
  }
  console.log(`\n✓ Informe escrito en ${SALIDA_INFORME}`);
  console.log('  Revisá los veredictos REFUTADO antes de seguir construyendo encima.');
  return 0;
}

/**
 * Primera corrida del pago asistido: un QR de 1 BOB que **no se anula**.
 *
 * Es la única excepción a "todo QR que crea, lo anula", y está acotada: uno
 * solo por vez (el archivo de estado lo impide), en certificación, y con
 * `--anular-pendiente` como salida si el banco nunca lo paga. Si algo impide
 * dejarlo bajo control (un id raro, un estado que no se puede escribir), se
 * anula en la misma corrida.
 */
async function emitirParaPago(ctx: Contexto): Promise<number> {
  const tx = transactionId(ctx, N_PAGO_ASISTIDO);

  // Reserva atómica antes de hablar con el banco: dos corridas simultáneas no
  // pueden emitir dos QRs (`wx` falla si el archivo ya existe).
  try {
    await mkdir(SALIDA_LOCAL, { recursive: true, mode: 0o700 });
    await writeFile(ESTADO_PAGO, serializarReserva(tx, ctx.ahora.toISOString()), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    console.error(`✖ No se pudo reservar ${ESTADO_PAGO}: ¿otra corrida en curso o un estado previo?`);
    return 1;
  }

  const { qr, hallazgo, error: errorGeneracion } = await generarQrDePrueba(
    ctx,
    N_PAGO_ASISTIDO,
    DIAS_PAGO_ASISTIDO,
    'B0 pago asistido',
  );
  if (qr === null) {
    console.error(`✖ No se pudo generar el QR: ${hallazgo?.detalle ?? 'sin detalle'}`);
    // Solo un rechazo explícito del banco asegura que no se creó nada. Ante un
    // timeout, un 4xx del gateway o una respuesta ilegible, el QR pudo quedar
    // creado: la reserva se conserva y bloquea emitir otro hasta verificarlo.
    if (reservaLiberable(errorGeneracion)) {
      await rm(ESTADO_PAGO, { force: true });
    } else {
      console.error(`  ⚠ El banco pudo haber creado el QR igual (transactionId ${tx}).`);
      console.error(`  Consultalo con el oficial y recién después borrá ${ESTADO_PAGO}.`);
    }
    return 1;
  }

  if (!esIdSeguro(qr.qrId)) {
    // Guardarlo dejaría un QR vivo que ninguna corrida siguiente podría releer
    // ni anular. Se anula ya, sin guardarlo.
    const anulado = await ctx.cliente.anularQr(qr.qrId);
    console.error('✖ El banco devolvió un qrId con un formato que no se puede guardar con seguridad.');
    if (esExito(anulado)) {
      await rm(ESTADO_PAGO, { force: true });
      console.error('  El QR se anuló en esta misma corrida. Reportalo: el formato de qrId no es el esperado.');
    } else {
      console.error(`  ⚠ Y no se pudo anular (${anulado.error.tipo}): pedile al oficial que lo anule a mano.`);
      console.error(`  La reserva queda en ${ESTADO_PAGO} (transactionId ${tx}) hasta resolverlo.`);
    }
    return 1;
  }

  const estado: EstadoPagoAsistido = {
    qrId: qr.qrId,
    transactionId: tx,
    emitidoEn: ctx.ahora.toISOString(),
  };
  try {
    await writeFile(ESTADO_PAGO, serializarEstado(estado), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Sin estado, el "uno por vez" no se sostiene: el QR no queda vivo.
    const anulado = await ctx.cliente.anularQr(qr.qrId);
    console.error(`✖ No se pudo guardar el estado en ${ESTADO_PAGO}.`);
    if (esExito(anulado)) {
      // Anulado: la reserva ya no protege nada y solo bloquearía en falso.
      await rm(ESTADO_PAGO, { force: true }).catch(() => undefined);
      console.error('  El QR se anuló para no dejarlo vivo sin control.');
    } else {
      console.error(`  ⚠ Y no se pudo anular (${anulado.error.tipo}). QR ${qr.qrId}: pedile al oficial que lo anule.`);
    }
    return 1;
  }
  await guardarImagen(qr.qrId, qr.imagenBase64);

  console.log(`✓ QR de pago asistido generado: ${qr.qrId} (1 BOB, vence en ${String(DIAS_PAGO_ASISTIDO)} días).`);
  console.log(`  Imagen: ${join(SALIDA_LOCAL, `${qr.qrId}.png`)}`);
  console.log('\n  Siguiente paso (dueño):');
  console.log('  1. Mandá esa imagen por correo al oficial de cuenta y pedile que la pague (respuesta A2).');
  console.log('  2. Cuando confirme el pago: npm run baneco:b0 -- --capturar-pago');
  console.log('  Si el banco nunca lo paga: npm run baneco:b0 -- --anular-pendiente');
  return 0;
}

/** Segunda corrida: si el banco ya pagó, captura el pago y sondea anularlo. */
async function capturarPago(ctx: Contexto, estado: EstadoPagoAsistido): Promise<number> {
  const consulta = await ctx.cliente.estadoQr(estado.qrId);
  anotarCodigo(ctx, 'statusQR', 'QR de pago asistido');
  if (!esExito(consulta)) {
    console.error(`✖ No se pudo consultar el QR ${estado.qrId}: ${consulta.error.tipo}. Probá más tarde.`);
    return 1;
  }

  switch (accionSegunEstado(consulta.valor.estado)) {
    case 'ESPERAR':
      console.log(`… El QR ${estado.qrId} sigue activo: el banco todavía no lo pagó.`);
      console.log('  Volvé a correr esto cuando el oficial confirme el pago, o desistí con --anular-pendiente.');
      return 3;
    case 'YA_ANULADO':
      console.log(`▪ El QR ${estado.qrId} figura anulado: no hay pago que capturar. Se descarta el estado.`);
      await rm(ESTADO_PAGO, { force: true });
      return 1;
    case 'DESCONOCIDO':
      console.error(`✖ statusQR informa un estado inesperado (${String(consulta.valor.estado)}). Se conserva el estado.`);
      return 1;
    case 'CAPTURAR':
      break;
  }

  // La fixture antes de cualquier otra consulta: `ultima()` devuelve lo último.
  let completo = await guardarFixture(ctx, 'statusQR-pagado.json', '/statusQR/');
  const pagos = consulta.valor.pagos;
  const montosCentavos = pagos.map(aCentavos).filter(esExito).map((m) => m.valor as number);

  // El día del pago según el propio pago; si no se puede leer, el de hoy.
  const primero = pagos[0];
  const instante = primero === undefined ? null : instanteDelPago(primero);
  const dia = instante !== null && esExito(instante) ? instante.valor : ctx.ahora;
  const delDia = await ctx.cliente.pagosDelDia(dia);
  anotarCodigo(ctx, 'paidQR', 'día del pago asistido');
  let enPaidQr: boolean | null = null;
  if (esExito(delDia)) {
    // Solo el pago de este QR: el usuario de certificación es compartido (A3) y
    // el resto del reporte son pagos de terceros ajenos a la prueba.
    completo =
      (await guardarFixture(ctx, 'paidQR-con-pago.json', '/paidQR/', (c) => soloPagosDe(c, estado.qrId))) &&
      completo;
    enPaidQr = delDia.valor.some((p) => p.qrId === estado.qrId);
  }

  const anulado = await ctx.cliente.anularQr(estado.qrId);
  anotarCodigo(ctx, 'cancelQR', 'anular un QR ya pagado');
  const anulacion: AnulacionDePagado = esExito(anulado)
    ? { ok: true }
    : { ok: false, tipo: anulado.error.tipo, codigo: anulado.error.codigoProveedor };
  const despues = await ctx.cliente.estadoQr(estado.qrId);

  const hallazgos = hallazgosDelPago({
    montosCentavos,
    montoEsperadoCentavos: MONTO_SONDEO_CENTAVOS,
    enPaidQr,
    anulacion,
    estadoTrasAnular: esExito(despues) ? despues.valor.estado : null,
  });
  // El `message` del banco puede explicar un rechazo nombrando al pagador: en
  // este informe se registra solo el `responseCode`.
  const codigosSinMensaje = ctx.codigos.map((c) => ({
    ...c,
    mensaje: '(omitido en el pago asistido: puede nombrar al pagador)',
  }));
  completo =
    (await escribirInforme(ctx, hallazgos, SALIDA_INFORME_PAGO, {
      titulo: '02 — Hallazgos del pago asistido (Hito B0, A2)',
      codigos: codigosSinMensaje,
    })) && completo;

  if (!completo) {
    // El QR ya está pagado: conservar el estado no deja nada cobrable, y
    // permite repetir la captura una vez corregido el saneamiento.
    console.error('✖ Se omitió al menos un archivo porque contenía un secreto o un dato del pagador.');
    console.error('  Se conserva el estado para repetir la captura. No commitees nada de esta corrida sin revisarlo.');
    return SALIDA_OMITIDA;
  }
  await rm(ESTADO_PAGO, { force: true });
  console.log(`✓ Pago capturado. Informe en ${SALIDA_INFORME_PAGO}`);
  console.log('  Fixtures: statusQR-pagado.json y paidQR-con-pago.json en packages/baneco-gateway/fixtures/.');
  return 0;
}

/** Desiste del pago asistido: anula el QR si nunca se pagó. */
async function anularPendiente(ctx: Contexto, estado: EstadoPagoAsistido): Promise<number> {
  const consulta = await ctx.cliente.estadoQr(estado.qrId);
  if (!esExito(consulta)) {
    console.error(`✖ No se pudo consultar el QR ${estado.qrId}: ${consulta.error.tipo}. No se anula a ciegas.`);
    return 1;
  }
  switch (accionSegunEstado(consulta.valor.estado)) {
    case 'CAPTURAR':
      // Ya pagado: anularlo sería perder la captura que motivó todo esto.
      console.error(`✖ El QR ${estado.qrId} ya está pagado. Corré --capturar-pago en vez de anularlo.`);
      return 1;
    case 'YA_ANULADO':
      await rm(ESTADO_PAGO, { force: true });
      console.log(`▪ El QR ${estado.qrId} ya estaba anulado. Estado descartado.`);
      return 0;
    case 'DESCONOCIDO':
      console.error(`✖ statusQR informa un estado inesperado (${String(consulta.valor.estado)}). No se anula.`);
      return 1;
    case 'ESPERAR':
      break;
  }
  const anulado = await ctx.cliente.anularQr(estado.qrId);
  if (!esExito(anulado)) {
    console.error(`✖ El banco no anuló el QR (${anulado.error.tipo}). Se conserva el estado para reintentar.`);
    return 1;
  }
  await rm(ESTADO_PAGO, { force: true });
  console.log(`✓ QR ${estado.qrId} anulado. Ya se puede emitir otro con --pago-asistido.`);
  return 0;
}

/**
 * El estado del pago asistido: `NO_HAY`, `INVALIDO` o el estado leído. Solo
 * "el archivo no existe" cuenta como que no hay: cualquier otro error de
 * lectura (permisos, un directorio en su lugar) es `INVALIDO`, para que un
 * estado ilegible no habilite emitir un segundo QR vivo.
 */
async function leerEstadoPago(): Promise<
  EstadoPagoAsistido | { readonly reserva: Reserva } | 'NO_HAY' | 'INVALIDO'
> {
  let texto: string;
  try {
    texto = await readFile(ESTADO_PAGO, 'utf8');
  } catch (causa) {
    const codigo = typeof causa === 'object' && causa !== null && 'code' in causa ? causa.code : null;
    return codigo === 'ENOENT' ? 'NO_HAY' : 'INVALIDO';
  }
  const estado = leerEstado(texto);
  if (estado !== null) {
    return estado;
  }
  const reserva = leerReserva(texto);
  return reserva === null ? 'INVALIDO' : { reserva };
}

/** Escribe el informe. `false` si se omitió por contener un secreto o un dato del pagador. */
async function escribirInforme(
  ctx: Contexto,
  hallazgos: readonly Hallazgo[],
  destino: string,
  opciones: { readonly titulo?: string; readonly codigos?: readonly CodigoObservado[] } = {},
): Promise<boolean> {
  const texto = informe({
    fecha: ctx.ahora,
    baseUrl: ctx.config.baseUrl,
    hallazgos,
    codigos: opciones.codigos ?? ctx.codigos,
    ...(opciones.titulo === undefined ? {} : { titulo: opciones.titulo }),
  });

  // Con los `message` del banco en el catálogo, se verifica además contra los
  // datos del pagador de las respuestas de nuestros propios QRs (no las de
  // `paidQR`, que traen pagos de terceros y darían falsos positivos). Sin esos
  // mensajes, el informe no lleva texto del banco: bastan los secretos.
  const conMensajes = opciones.codigos === undefined;
  const pagador = conMensajes
    ? ctx.grabador.grabaciones
        .filter((g) => !g.url.includes('/paidQR/'))
        .map((g, i) => datosDelPagador(g.cuerpo, `respuesta${String(i)}`))
    : [];
  const fuga = verificarSinSecretos(texto, Object.assign({}, secretosDe(ctx), ...pagador) as Record<string, string>);
  if (fuga !== null) {
    console.error(`✖ El informe contiene "${fuga.pista}". No se escribe.`);
    return false;
  }
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, texto, 'utf8');
  return true;
}

/**
 * Guarda una respuesta cruda como fixture, saneada y verificada. `false` si se
 * omitió por seguridad (no haber capturado nada no es una omisión).
 *
 * Si el saneamiento no alcanzó —porque el banco mandó un campo que la lista no
 * contempla— **no se escribe nada**. Una fixture es un archivo que se commitea;
 * ante la duda, no se commitea.
 */
async function guardarFixture(
  ctx: Contexto,
  nombre: string,
  fragmentoUrl: string,
  transformar: (cuerpo: unknown) => unknown = (c) => c,
): Promise<boolean> {
  const cruda = ctx.grabador.ultima(fragmentoUrl);
  if (cruda === null) {
    return true;
  }

  // Los datos del pagador se toman del cuerpo que se va a escribir (ya
  // filtrado): los de pagos ajenos que el filtro sacó no pueden aparecer, y
  // contarlos solo daría falsos positivos.
  const cuerpo = transformar(cruda.cuerpo);
  if (cuerpo === NO_FILTRABLE) {
    console.error(`✖ La fixture ${nombre} trae los pagos con una forma que no se puede filtrar. No se escribe.`);
    return false;
  }
  const saneada = sanear(cuerpo);
  const fuga = verificarSinSecretos(saneada, { ...secretosDe(ctx), ...datosDelPagador(cuerpo) });
  if (fuga !== null) {
    console.error(`✖ La fixture ${nombre} todavía contiene "${fuga.pista}". No se escribe.`);
    return false;
  }

  await mkdir(SALIDA_FIXTURES, { recursive: true });
  const contenido = {
    _origen: 'Capturado del ambiente de certificación de Baneco por tools/baneco-b0.',
    _saneado: 'Datos del pagador reemplazados por marcadores; en pagos, solo campos permitidos (reglas #4 y #9).',
    _fecha: ctx.ahora.toISOString(),
    status: cruda.status,
    cuerpo: saneada,
  };
  await writeFile(join(SALIDA_FIXTURES, nombre), `${JSON.stringify(contenido, null, 2)}\n`, 'utf8');
  return true;
}

/** La imagen del QR va a una carpeta local git-ignored: no es evidencia versionable. */
async function guardarImagen(qrId: string, base64: string | null): Promise<void> {
  if (base64 === null || !esIdSeguro(qrId)) {
    return;
  }
  await mkdir(SALIDA_LOCAL, { recursive: true, mode: 0o700 });
  await writeFile(join(SALIDA_LOCAL, `${qrId}.png`), Buffer.from(base64, 'base64'), { mode: 0o600 });
}

/**
 * Los secretos de configuración, que jamás pueden aparecer en un archivo
 * escrito por esta herramienta. Los datos del pagador se suman en cada
 * escritura, según lo que se escribe.
 */
function secretosDe(ctx: Contexto): Readonly<Record<string, string>> {
  return {
    password: ctx.config.password.revelar(),
    llaveAes: ctx.config.llave.toString('utf8'),
    cuentaAbono: ctx.config.cuentaAbono.revelar(),
    usuario: ctx.config.usuario,
  };
}

const codigo = await main();
process.exit(codigo);
