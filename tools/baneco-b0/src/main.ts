/**
 * Hito B0 — validación del contrato de Baneco contra **certificación**.
 *
 * Herramienta manual del dueño. **Nunca corre en CI** y nunca toca producción:
 * hay dos barreras independientes para eso, más abajo.
 *
 * Uso:
 *   npm run baneco:b0
 *
 * Requiere `.env` con el bloque `BANECO_CERT_*` cargado. Produce:
 * - `docs/Integraciones/baneco/02-hallazgos-certificacion.md` — el informe.
 * - `packages/baneco-gateway/fixtures/` — respuestas reales **saneadas**, que
 *   reemplazan a las fixtures derivadas de la especificación.
 * - `tools/baneco-b0/out/` — la imagen del QR de prueba (git-ignored).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describir, leerConfig, transporteFetch, ClienteBaneco, ProveedorDeToken } from '@mqs/baneco-gateway';
import { esExito } from '@mqs/qr-core';

import { Grabador } from './grabador.js';
import { informe, type CodigoObservado, type Hallazgo } from './hallazgos.js';
import {
  anularYReconsultar,
  autenticar,
  estadoInicial,
  generarQrDePrueba,
  probarTransactionIdRepetido,
  sondearVigenciaMaxima,
  type Contexto,
} from './pasos.js';
import { sanear, verificarSinSecretos } from './sanear.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SALIDA_INFORME = join(RAIZ, 'docs', 'Integraciones', 'baneco', '02-hallazgos-certificacion.md');
const SALIDA_FIXTURES = join(RAIZ, 'packages', 'baneco-gateway', 'fixtures');
const SALIDA_LOCAL = join(RAIZ, 'tools', 'baneco-b0', 'out');

async function main(): Promise<number> {
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
  console.log('  Los QRs creados por este sondeo se anulan al terminar.\n');

  const grabador = new Grabador(transporteFetch());
  const tokens = new ProveedorDeToken(config.valor, grabador.enviar);
  const cliente = new ClienteBaneco(config.valor, grabador.enviar, tokens);
  const codigos: CodigoObservado[] = [];
  const ctx: Contexto = { config: config.valor, cliente, tokens, grabador, codigos, ahora: new Date() };

  const hallazgos: Hallazgo[] = [];

  const login = await autenticar(ctx);
  hallazgos.push(...login.hallazgos);
  if (!login.ok) {
    console.error('✖ La autenticación falló. Se escribe el informe y se termina sin reintentar.');
    await escribirInforme(ctx, hallazgos);
    return 2;
  }
  console.log('✓ Autenticado. El esquema de cifrado quedó validado por el propio banco.');

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
  const pagos = await cliente.pagosDelDia(ctx.ahora);
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

  await escribirInforme(ctx, hallazgos);
  console.log(`\n✓ Informe escrito en ${SALIDA_INFORME}`);
  console.log('  Revisá los veredictos REFUTADO antes de seguir construyendo encima.');
  return 0;
}

async function escribirInforme(ctx: Contexto, hallazgos: readonly Hallazgo[]): Promise<void> {
  const texto = informe({
    fecha: ctx.ahora,
    baseUrl: ctx.config.baseUrl,
    hallazgos,
    codigos: ctx.codigos,
  });

  const fuga = verificarSinSecretos(texto, secretosDe(ctx));
  if (fuga !== null) {
    console.error(`✖ El informe contiene el secreto "${fuga.pista}". No se escribe.`);
    return;
  }
  await mkdir(dirname(SALIDA_INFORME), { recursive: true });
  await writeFile(SALIDA_INFORME, texto, 'utf8');
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
  await mkdir(SALIDA_LOCAL, { recursive: true });
  await writeFile(join(SALIDA_LOCAL, `${qrId}.png`), Buffer.from(base64, 'base64'));
}

/** Los valores que jamás pueden aparecer en un archivo escrito por esta herramienta. */
function secretosDe(ctx: Contexto): Readonly<Record<string, string>> {
  return {
    password: ctx.config.password,
    llaveAes: ctx.config.llave.toString('utf8'),
    cuentaAbono: ctx.config.cuentaAbono,
    usuario: ctx.config.usuario,
  };
}

const codigo = await main();
process.exit(codigo);
