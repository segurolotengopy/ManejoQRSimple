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
  explicarMarca,
  fijarCuentaDePrueba,
  leerAtribucionExplicita,
  leerCuentaDeCobro,
  prepararDatosDeLaCuenta,
  verificarProduccion,
  type AtribucionExplicita,
  type MarcaDeCuenta,
} from '@mqs/composicion';
import { aDecimalBob, esExito } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  combinarVerificadores,
  describirErrorDeConsumidores,
  leerConsumidores,
  verificadorDeConsumidores,
  verificadorDeTokenFijo,
} from './auth.js';
import { cupoDeConsumidores } from './api/cupo-consumidor.js';
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
  const verificadorDueño = verificadorDeTokenFijo(process.env['API_TOKEN_LOCAL']);
  if (verificadorDueño === null) {
    console.error(
      '✖ Falta API_TOKEN_LOCAL (mínimo 16 caracteres).\n' +
        '  La API no arranca sin autenticación: crea y anula cobros, y un endpoint\n' +
        '  abierto sería un agujero, no una comodidad de desarrollo.\n' +
        '  Generá uno con:  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"',
    );
    return 1;
  }

  // La cuenta de cobro de este proceso: la de sus credenciales. Cada cobro que
  // se cree la lleva, y cada consumidor tiene que cobrar en esta y no otra.
  const cuenta = leerCuentaDeCobro(process.env);
  if (cuenta === null) {
    console.error('✖ CUENTA solo admite minúsculas, números y guiones (hasta 24 caracteres).');
    return 1;
  }

  // Consumidores del contrato (docs/10), uno por variable CONSUMIDOR_TOKEN_* y
  // cada uno con su CONSUMIDOR_CUENTA_*. Sin ninguno configurado, `/api/v1/…`
  // simplemente no le responde a nadie: el contrato existe pero no tiene quién
  // lo use, que es el estado normal. Con uno a medio configurar, no se arranca.
  const consumidores = leerConsumidores(process.env, cuenta);
  if (!consumidores.ok) {
    console.error(
      `✖ Consumidores mal configurados: ${describirErrorDeConsumidores(consumidores.error)}\n` +
        '  La API no arranca así: un consumidor mal configurado puede crear y anular cobros, o hacerlo en la cuenta equivocada.\n' +
        '  Generá uno con:  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"',
    );
    return 1;
  }
  const verificador = combinarVerificadores(
    verificadorDueño,
    verificadorDeConsumidores(consumidores.consumidores),
  );
  const cupo = cupoDeConsumidores(process.env);

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
  let marca: MarcaDeCuenta | null = null;
  let atribucionExplicita: AtribucionExplicita = { permitida: false, aviso: null };
  if (process.env['MODO_PRUEBA_PRODUCCION'] === '1') {
    const leido = leerModoPrueba(process.env, puertos.valor.resumen);
    if (!esExito(leido)) {
      console.error(`✖ ${leido.error}`);
      return 1;
    }
    prueba = leido.valor;
    // Antes de tocar nada: ¿los datos de este emulador son de esta cuenta? La
    // marca no se crea sobre datos sin cuenta salvo que el dueño lo autorice
    // expresamente (ATRIBUIR_DATOS_ANTERIORES_A=<esta cuenta>).
    atribucionExplicita = leerAtribucionExplicita(process.env, cuenta);
    marca = await fijarCuentaDePrueba(db, prueba.cuenta, new Date(), atribucionExplicita.permitida);
    const problema = explicarMarca(marca);
    if (problema !== null) {
      console.error(`✖ ${problema}`);
      if (atribucionExplicita.aviso !== null) {
        console.error(`  ${atribucionExplicita.aviso}`);
      }
      return 1;
    }
  }
  // Siempre, con o sin modo prueba: un cobro pendiente sin cuenta queda fuera
  // de la consulta por cuenta y su QR seguiría pagable sin que nadie lo mire.
  // En modo prueba se le pasa la marca tal como quedó y si el dueño autorizó
  // atribuir: sin marca previa ni autorización, los datos viejos no se tocan.
  const preparada = await prepararDatosDeLaCuenta(
    marca === null
      ? { db, cuenta, modoPrueba: false }
      : { db, cuenta, modoPrueba: true, marca, atribucionExplicita: atribucionExplicita.permitida },
  );
  if (!esExito(preparada)) {
    console.error(`✖ ${preparada.error.mensaje}`);
    return 1;
  }
  if (preparada.valor.cobros + preparada.valor.abonos > 0) {
    registro.agregar(
      'info',
      'sistema',
      `Atribución de cuenta: ${String(preparada.valor.cobros)} cobro(s) y ${String(preparada.valor.abonos)} ` +
        `abono(s) anteriores quedaron en la cuenta «${cuenta}».`,
    );
  }

  if (prueba !== null) {
    // Reiniciar la API no pierde de vista los QRs de antes ni reinicia el cupo.
    const previos = await puertos.valor.deps.cobros.listarRecientes(500);
    if (!esExito(previos)) {
      console.error('✖ No se pudo leer el emulador para retomar la prueba. ¿Está corriendo prueba:emulador?');
      return 1;
    }
    reanudarCorrida(prueba, previos.valor, new Date());
  }
  // La bitácora es una sola para todas las cuentas: la línea de arranque es lo
  // que marca dónde empieza cada corrida y de qué cuenta es.
  registro.agregar(
    'info',
    'sistema',
    `API iniciada · ${puertos.valor.resumen} · cuenta ${cuenta}${prueba === null ? '' : ' · modo prueba'}`,
  );

  const puerto = Number(process.env['API_PORT'] ?? String(PUERTO_POR_DEFECTO));
  const origenPermitido = process.env['API_ORIGEN_PERMITIDO'] ?? 'http://localhost:5173';

  const servidor = crearServidor({
    ctx: {
      deps: puertos.valor.deps,
      cuentaCobro: cuenta,
      evidencia: puertos.valor.deps.evidencia,
      abonosSinConciliar: puertos.valor.abonosSinConciliar,
      horasDeVigenciaPorDefecto: HORAS_VIGENCIA_POR_DEFECTO,
      ahora: () => new Date(),
      leerImagenQr: imagenes.leer,
      registro,
      cupoConsumidores: cupo,
      ...(prueba === null ? {} : { prueba }),
    },
    verificador,
    origenPermitido,
    registro,
  });

  // Solo en la máquina local por defecto: la consola corre acá mismo, y nadie
  // más en la red tiene por qué llegar a una API que crea y anula cobros.
  const host = process.env['API_HOST'] ?? '127.0.0.1';
  servidor.listen(puerto, host, () => {
    console.log(`▶ API de ManejoQRSimple en http://${host}:${String(puerto)}`);
    console.log(`  Adaptadores: ${puertos.valor.resumen}`);
    console.log(`  Origen permitido: ${origenPermitido}`);
    console.log(`  Logs: ${directorioLogs} (también en la pestaña Logs, aunque se reinicie)`);
    console.log('  Autenticación: token fijo (Authorization: Bearer …)');
    console.log(
      consumidores.consumidores.size === 0
        ? '  Consumidores (/api/v1): ninguno configurado (CONSUMIDOR_TOKEN_*)'
        : `  Consumidores (/api/v1): ${[...consumidores.consumidores].map(([id, c]) => `${id}→${c.cuentaCobro}`).join(', ')} · hasta ${String(cupo.porHora)} QRs por hora cada uno`,
    );
    if (prueba !== null) {
      console.log(
        prueba.produccion
          ? `\n  ⚠ PRUEBA EN PRODUCCIÓN de la cuenta «${prueba.cuenta}»: QRs reales de Bs ${aDecimalBob(prueba.montoCentavos)}, ` +
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
