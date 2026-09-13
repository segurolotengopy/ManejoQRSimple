/**
 * Hito B0 — validación del contrato de Baneco contra **certificación**.
 *
 * Herramienta manual del dueño. **Nunca corre en CI** y nunca toca producción:
 * hay dos barreras independientes para eso, más abajo.
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
  hallazgosDelPago,
  leerEstado,
  leerModo,
  serializarEstado,
  type AnulacionDePagado,
  type EstadoPagoAsistido,
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
import { sanear, verificarSinSecretos } from './sanear.js';

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

  console.log(`▶ ${describir(config.valor)}`);

  const grabador = new Grabador(transporteFetch());
  const tokens = new ProveedorDeToken(config.valor, grabador.enviar);
  const cliente = new ClienteBaneco(config.valor, grabador.enviar, tokens);
  const codigos: CodigoObservado[] = [];
  const ctx: Contexto = { config: config.valor, cliente, tokens, grabador, codigos, ahora: new Date() };

  // Los modos del pago asistido se validan antes de tocar el banco: un archivo
  // de estado que falta o sobra se detecta sin gastar un login.
  const previo = await leerEstadoPago();
  if (modo.valor === 'EMITIR_PARA_PAGO' && previo !== 'NO_HAY') {
    console.error(`✖ Ya hay un QR de pago asistido pendiente (${ESTADO_PAGO}).`);
    console.error('  Capturalo con --capturar-pago o desistí con --anular-pendiente antes de emitir otro.');
    return 1;
  }
  if ((modo.valor === 'CAPTURAR_PAGO' || modo.valor === 'ANULAR_PENDIENTE') && typeof previo === 'string') {
    console.error(
      previo === 'NO_HAY'
        ? '✖ No hay ningún QR de pago asistido pendiente. Emitilo primero con --pago-asistido.'
        : `✖ El archivo ${ESTADO_PAGO} no tiene la forma esperada. Revisalo a mano.`,
    );
    return 1;
  }

  const hallazgos: Hallazgo[] = [];
  const login = await autenticar(ctx);
  hallazgos.push(...login.hallazgos);
  if (!login.ok) {
    console.error('✖ La autenticación falló. Se escribe el informe y se termina sin reintentar.');
    await escribirInforme(ctx, hallazgos, SALIDA_INFORME);
    return 2;
  }
  console.log('✓ Autenticado. El esquema de cifrado quedó validado por el propio banco.');

  switch (modo.valor) {
    case 'SONDEO':
      return sondeo(ctx, hallazgos);
    case 'EMITIR_PARA_PAGO':
      return emitirParaPago(ctx);
    case 'CAPTURAR_PAGO':
      return typeof previo === 'string' ? 1 : capturarPago(ctx, previo);
    case 'ANULAR_PENDIENTE':
      return typeof previo === 'string' ? 1 : anularPendiente(ctx, previo);
  }
}

/** El sondeo completo: todo QR que crea, lo anula. */
async function sondeo(ctx: Contexto, hallazgos: Hallazgo[]): Promise<number> {
  console.log('  Los QRs creados por este sondeo se anulan al terminar.\n');

  const { qr, hallazgo: falloGeneracion } = await generarQrDePrueba(ctx, 1, 3);
  if (falloGeneracion !== null) {
    hallazgos.push(falloGeneracion);
  }

  if (qr !== null) {
    console.log(`✓ QR de prueba generado: ${qr.qrId}`);
    await guardarImagen(qr.qrId, qr.imagenBase64);

    hallazgos.push(await estadoInicial(ctx, qr.qrId));
    await guardarFixture(ctx, 'statusQR-activo.json', '/statusQR/');

    hallazgos.push(...(await anularYReconsultar(ctx, qr.qrId)));
    await guardarFixture(ctx, 'statusQR-anulado.json', '/statusQR/');
    await guardarFixture(ctx, 'cancelQR.json', '/cancelQR');
    console.log('✓ Anulación y doble anulación sondeadas.');
  }

  hallazgos.push(await probarTransactionIdRepetido(ctx, 2));
  console.log('✓ Unicidad de transactionId sondeada.');

  hallazgos.push(...(await sondearVigenciaMaxima(ctx)));
  console.log('✓ Escalera de vigencias sondeada.');

  // El reporte diario del banco: sirve de fixture y confirma la forma de paidQR.
  const pagos = await ctx.cliente.pagosDelDia(ctx.ahora);
  if (esExito(pagos)) {
    await guardarFixture(ctx, 'paidQR-del-dia.json', '/paidQR/');
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

  await escribirInforme(ctx, hallazgos, SALIDA_INFORME);
  console.log(`\n✓ Informe escrito en ${SALIDA_INFORME}`);
  console.log('  Revisá los veredictos REFUTADO antes de seguir construyendo encima.');
  return 0;
}

/**
 * Primera corrida del pago asistido: un QR de 1 BOB que **no se anula**.
 *
 * Es la única excepción a "todo QR que crea, lo anula", y está acotada: uno
 * solo por vez (el archivo de estado lo impide), en certificación, y con
 * `--anular-pendiente` como salida si el banco nunca lo paga.
 */
async function emitirParaPago(ctx: Contexto): Promise<number> {
  const { qr, hallazgo } = await generarQrDePrueba(ctx, N_PAGO_ASISTIDO, DIAS_PAGO_ASISTIDO, 'B0 pago asistido');
  if (qr === null) {
    console.error(`✖ No se pudo generar el QR: ${hallazgo?.detalle ?? 'sin detalle'}`);
    return 1;
  }

  await guardarImagen(qr.qrId, qr.imagenBase64);
  const estado: EstadoPagoAsistido = {
    qrId: qr.qrId,
    transactionId: transactionId(ctx, N_PAGO_ASISTIDO),
    emitidoEn: ctx.ahora.toISOString(),
  };
  await mkdir(SALIDA_LOCAL, { recursive: true, mode: 0o700 });
  await writeFile(ESTADO_PAGO, serializarEstado(estado), { encoding: 'utf8', mode: 0o600 });

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
  await guardarFixture(ctx, 'statusQR-pagado.json', '/statusQR/');
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
    await guardarFixture(ctx, 'paidQR-con-pago.json', '/paidQR/');
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
  await escribirInforme(ctx, hallazgos, SALIDA_INFORME_PAGO, '02 — Hallazgos del pago asistido (Hito B0, A2)');
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

/** El estado del pago asistido: `NO_HAY`, `INVALIDO` o el estado leído. */
async function leerEstadoPago(): Promise<EstadoPagoAsistido | 'NO_HAY' | 'INVALIDO'> {
  let texto: string;
  try {
    texto = await readFile(ESTADO_PAGO, 'utf8');
  } catch {
    return 'NO_HAY';
  }
  return leerEstado(texto) ?? 'INVALIDO';
}

async function escribirInforme(
  ctx: Contexto,
  hallazgos: readonly Hallazgo[],
  destino: string,
  titulo?: string,
): Promise<void> {
  const texto = informe({
    fecha: ctx.ahora,
    baseUrl: ctx.config.baseUrl,
    hallazgos,
    codigos: ctx.codigos,
    ...(titulo === undefined ? {} : { titulo }),
  });

  const fuga = verificarSinSecretos(texto, secretosDe(ctx));
  if (fuga !== null) {
    console.error(`✖ El informe contiene el secreto "${fuga.pista}". No se escribe.`);
    return;
  }
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, texto, 'utf8');
}

/**
 * Guarda una respuesta cruda como fixture, saneada y verificada.
 *
 * Si el saneamiento no alcanzó —porque el banco mandó un campo que la lista no
 * contempla— **no se escribe nada**. Una fixture es un archivo que se commitea;
 * ante la duda, no se commitea.
 */
async function guardarFixture(ctx: Contexto, nombre: string, fragmentoUrl: string): Promise<void> {
  const cruda = ctx.grabador.ultima(fragmentoUrl);
  if (cruda === null) {
    return;
  }

  const saneada = sanear(cruda.cuerpo);
  const fuga = verificarSinSecretos(saneada, secretosDe(ctx));
  if (fuga !== null) {
    console.error(`✖ La fixture ${nombre} todavía contiene el secreto "${fuga.pista}". No se escribe.`);
    return;
  }

  await mkdir(SALIDA_FIXTURES, { recursive: true });
  const contenido = {
    _origen: 'Capturado del ambiente de certificación de Baneco por tools/baneco-b0.',
    _saneado: 'Nombre, documento y cuenta del pagador reemplazados por marcadores (reglas #4 y #9).',
    _fecha: ctx.ahora.toISOString(),
    status: cruda.status,
    cuerpo: saneada,
  };
  await writeFile(join(SALIDA_FIXTURES, nombre), `${JSON.stringify(contenido, null, 2)}\n`, 'utf8');
}

/** La imagen del QR va a una carpeta local git-ignored: no es evidencia versionable. */
async function guardarImagen(qrId: string, base64: string | null): Promise<void> {
  if (base64 === null) {
    return;
  }
  await mkdir(SALIDA_LOCAL, { recursive: true, mode: 0o700 });
  await writeFile(join(SALIDA_LOCAL, `${qrId}.png`), Buffer.from(base64, 'base64'), { mode: 0o600 });
}

/** Los valores que jamás pueden aparecer en un archivo escrito por esta herramienta. */
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
