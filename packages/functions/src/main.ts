/**
 * Arranque de la API. Raíz de composición.
 *
 * Cablea los puertos con `@mqs/composicion` y levanta el servidor. Ninguna
 * regla de negocio vive acá.
 *
 * Uso:
 *   npm run api            # contra el emulador, adaptadores en mock
 *   npm run prueba:api     # prueba controlada contra producción (docs/Integraciones/baneco/03)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  Bitacora,
  MensajeriaNoConfigurada,
  construirPuertos,
  describirError,
  verificarProduccion,
} from '@mqs/composicion';
import { aDecimalBob, esExito } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { verificadorDeTokenFijo } from './auth.js';
import { almacenEnDirectorio } from './imagenes.js';
import { leerModoPrueba, reanudarCorrida, type ModoPrueba } from './modo-prueba.js';
import { describirLlamada, RegistroEventos } from './registro.js';
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

async function main(): Promise<number> {
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

  // Producción solo en la prueba controlada, y con los datos en el emulador.
  const barrera = verificarProduccion(process.env);
  if (barrera !== null) {
    console.error(`✖ ${barrera}`);
    return 1;
  }

  // Las imágenes de QR van fuera del repo: identifican la cuenta de cobro.
  const imagenes = almacenEnDirectorio(
    process.env['QR_IMAGENES_DIR'] ?? join(homedir(), '.manejoqr', 'qrs'),
  );

  // Logs de depuración para la pestaña Logs, persistidos fuera del repo: lo de
  // ayer se sigue viendo después de reiniciar. Los errores salen además por la terminal.
  const directorioLogs = process.env['BITACORA_DIR'] ?? join(homedir(), '.manejoqr', 'logs');
  const registro = new RegistroEventos(
    undefined,
    (linea) => {
      if (linea.nivel === 'error') {
        console.error(`  ! [${linea.origen}] ${linea.texto}`);
      }
    },
    new Bitacora(directorioLogs, 'api'),
  );

  const db = conectarFirestore();
  const puertos = construirPuertos({
    env: process.env,
    db,
    mensajeria: new MensajeriaNoConfigurada(),
    almacenImagenesQr: imagenes.guardar,
    observarBanco: (llamada) => {
      const { nivel, texto } = describirLlamada(llamada);
      registro.agregar(nivel, 'banco', texto);
    },
  });
  if (!esExito(puertos)) {
    console.error(`✖ No se pudieron armar los puertos: ${describirError(puertos.error)}`);
    return 1;
  }

  let prueba: ModoPrueba | null = null;
  if (process.env['MODO_PRUEBA_PRODUCCION'] === '1') {
    const leido = leerModoPrueba(process.env, puertos.valor.resumen);
    if (!esExito(leido)) {
      console.error(`✖ ${leido.error}`);
      return 1;
    }
    prueba = leido.valor;
    // Reiniciar la API no pierde de vista los QRs de antes ni reinicia el cupo.
    const previos = await puertos.valor.deps.cobros.listarRecientes(500);
    if (!esExito(previos)) {
      console.error('✖ No se pudo leer el emulador para retomar la prueba. ¿Está corriendo prueba:emulador?');
      return 1;
    }
    reanudarCorrida(prueba, previos.valor, new Date());
  }
  registro.agregar('info', 'sistema', `API iniciada · ${puertos.valor.resumen}${prueba === null ? '' : ' · modo prueba'}`);

  const puerto = Number(process.env['API_PORT'] ?? String(PUERTO_POR_DEFECTO));
  const origenPermitido = process.env['API_ORIGEN_PERMITIDO'] ?? 'http://localhost:5173';

  const servidor = crearServidor({
    ctx: {
      deps: puertos.valor.deps,
      evidencia: puertos.valor.deps.evidencia,
      abonosSinConciliar: puertos.valor.abonosSinConciliar,
      horasDeVigenciaPorDefecto: HORAS_VIGENCIA_POR_DEFECTO,
      ahora: () => new Date(),
      leerImagenQr: imagenes.leer,
      registro,
      ...(prueba === null ? {} : { prueba }),
    },
    verificador,
    origenPermitido,
    registro,
  });

  servidor.listen(puerto, () => {
    console.log(`▶ API de ManejoQRSimple en http://localhost:${String(puerto)}`);
    console.log(`  Adaptadores: ${puertos.valor.resumen}`);
    console.log(`  Origen permitido: ${origenPermitido}`);
    console.log(`  Logs: ${directorioLogs} (también en la pestaña Logs, aunque se reinicie)`);
    console.log('  Autenticación: token fijo (Authorization: Bearer …)');
    if (prueba !== null) {
      console.log(
        prueba.produccion
          ? `\n  ⚠ PRUEBA EN PRODUCCIÓN: QRs reales de Bs ${aDecimalBob(prueba.montoCentavos)}, ` +
              `hasta ${String(prueba.maxQrs)} por corrida. Datos en el emulador local.`
          : `\n  Modo prueba con el banco SIMULADO: los QRs no son reales (Bs ${aDecimalBob(prueba.montoCentavos)}, ` +
              `hasta ${String(prueba.maxQrs)} por corrida).`,
      );
      console.log('    Al terminar: botón "Cerrar la prueba" en la consola (anula lo que no se pagó).');
    }
    console.log('');
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

const codigo = await main();
if (codigo !== 0) {
  process.exit(codigo);
}
