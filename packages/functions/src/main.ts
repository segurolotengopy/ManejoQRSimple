/**
 * Arranque de la API. Raíz de composición.
 *
 * Cablea los puertos con `@mqs/composicion` y levanta el servidor. Ninguna
 * regla de negocio vive acá.
 *
 * Uso:
 *   npm run api            # contra el emulador, adaptadores en mock
 */

import { MensajeriaNoConfigurada, construirPuertos, describirError } from '@mqs/composicion';
import { esExito } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { verificadorDeTokenFijo } from './auth.js';
import { crearServidor } from './servidor.js';

const PUERTO_POR_DEFECTO = 8787;
const HORAS_VIGENCIA_POR_DEFECTO = 72;

function conectarFirestore(): ReturnType<typeof getFirestore> {
  const projectId = process.env['FIREBASE_PROJECT_ID'] ?? 'manejoqrsimple';
  const enEmulador = (process.env['FIRESTORE_EMULATOR_HOST'] ?? '') !== '';
  // Contra el emulador no hacen falta credenciales; contra el proyecto real, sí.
  const app = enEmulador
    ? initializeApp({ projectId }, `api-${String(Date.now())}`)
    : initializeApp({ credential: applicationDefault(), projectId }, `api-${String(Date.now())}`);
  return getFirestore(app);
}

function main(): number {
  const verificador = verificadorDeTokenFijo(process.env['API_TOKEN_LOCAL']);
  if (verificador === null) {
    console.error(
      '✖ Falta API_TOKEN_LOCAL (mínimo 16 caracteres).\n' +
        '  La API no arranca sin autenticación: crea y anula cobros, y un endpoint\n' +
        '  abierto sería un agujero, no una comodidad de desarrollo.\n' +
        '  Generá uno con:  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"',
    );
    return 1;
  }

  const db = conectarFirestore();
  const puertos = construirPuertos({
    env: process.env,
    db,
    mensajeria: new MensajeriaNoConfigurada(),
  });
  if (!esExito(puertos)) {
    console.error(`✖ No se pudieron armar los puertos: ${describirError(puertos.error)}`);
    return 1;
  }

  const puerto = Number(process.env['API_PORT'] ?? String(PUERTO_POR_DEFECTO));
  const origenPermitido = process.env['API_ORIGEN_PERMITIDO'] ?? 'http://localhost:5173';

  const servidor = crearServidor({
    ctx: {
      deps: puertos.valor.deps,
      evidencia: puertos.valor.deps.evidencia,
      horasDeVigenciaPorDefecto: HORAS_VIGENCIA_POR_DEFECTO,
      ahora: () => new Date(),
    },
    verificador,
    origenPermitido,
  });

  servidor.listen(puerto, () => {
    console.log(`▶ API de ManejoQRSimple en http://localhost:${String(puerto)}`);
    console.log(`  Adaptadores: ${puertos.valor.resumen}`);
    console.log(`  Origen permitido: ${origenPermitido}`);
    console.log('  Autenticación: token fijo (Authorization: Bearer …)\n');
  });

  const cerrar = (senal: string): void => {
    console.log(`\n${senal} recibido: cerrando.`);
    servidor.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => {
    cerrar('SIGINT');
  });
  process.on('SIGTERM', () => {
    cerrar('SIGTERM');
  });

  return 0;
}

const codigo = main();
if (codigo !== 0) {
  process.exit(codigo);
}
