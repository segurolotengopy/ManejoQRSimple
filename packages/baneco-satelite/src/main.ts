/**
 * Satélite de Baneco — la raíz de composición (ADR-006, decisión D2 opción b).
 *
 * Es el único lugar del sistema donde se conocen a la vez el banco, Firestore y
 * el dominio. Su trabajo es **cablear y repetir**: construye los puertos, llama
 * a `unaPasada()` cada intervalo y registra el resumen. Ninguna regla de negocio
 * vive acá; todas están en `qr-core`.
 *
 * Corre fuera de Firebase —ThinkPad hoy, OCI después— con una credencial de
 * servicio de mínimo privilegio (docs/05 §4).
 *
 * Uso:
 *   npm run satelite:baneco           # bucle continuo
 *   npm run satelite:baneco -- --una  # una sola pasada y termina
 */

import {
  ClienteBaneco,
  PaymentWatcherBaneco,
  ProveedorDeToken,
  describir,
  leerConfig,
  transporteFetch,
} from '@mqs/baneco-gateway';
import { CobroRepositoryFirestore, EvidenceStoreFirestore } from '@mqs/firestore-store';
import { POLITICA_POR_DEFECTO, esExito, type DepsVerificacion } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { MensajeriaNoConfigurada } from './mensajeria.js';
import { describirPasada, unaPasada } from './pasada.js';

const INTERVALO_POR_DEFECTO_SEGUNDOS = 180;

function intervaloSegundos(): number {
  const crudo = process.env['BANECO_POLL_INTERVAL_SECONDS'] ?? String(INTERVALO_POR_DEFECTO_SEGUNDOS);
  const valor = Number(crudo);
  return Number.isInteger(valor) && valor >= 30 ? valor : INTERVALO_POR_DEFECTO_SEGUNDOS;
}

async function main(): Promise<number> {
  const config = leerConfig(process.env);
  if (!esExito(config)) {
    console.error(`✖ Configuración de Baneco inválida: ${config.error.tipo}`);
    if ('variable' in config.error) {
      console.error(`  Variable: ${config.error.variable}`);
    }
    return 1;
  }

  const projectId = process.env['FIREBASE_PROJECT_ID'] ?? 'manejoqrsimple';
  const app = initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(app);

  const transporte = transporteFetch();
  const tokens = new ProveedorDeToken(config.valor, transporte);
  const cliente = new ClienteBaneco(config.valor, transporte, tokens);
  const mensajeria = new MensajeriaNoConfigurada();

  const deps: DepsVerificacion = {
    cobros: new CobroRepositoryFirestore(db),
    evidencia: new EvidenceStoreFirestore(db),
    watcher: new PaymentWatcherBaneco(cliente),
    mensajeria,
    politica: POLITICA_POR_DEFECTO,
  };

  const unaSola = process.argv.includes('--una');
  const intervalo = intervaloSegundos();

  console.log(`▶ Satélite Baneco — ${describir(config.valor)}`);
  console.log(`  Firestore: ${projectId}`);
  console.log(unaSola ? '  Modo: una sola pasada.' : `  Intervalo: ${String(intervalo)} s.`);
  console.log('  El satélite verifica y concilia; no emite ni renueva QRs.\n');

  // En un objeto y no en un `let`: el manejador de señal lo muta desde una
  // clausura, y TypeScript no puede ver eso en una variable local.
  const control = { corriendo: true };
  /** Se lee por función: así el análisis de flujo no la estrecha a `true`. */
  const sigue = (): boolean => control.corriendo;
  const detener = (senal: string): void => {
    console.log(`\n${senal} recibido: se termina la pasada en curso y se sale.`);
    control.corriendo = false;
  };
  process.on('SIGINT', () => {
    detener('SIGINT');
  });
  process.on('SIGTERM', () => {
    detener('SIGTERM');
  });

  do {
    const resultado = await unaPasada(deps, new Date());

    if ('errorFatal' in resultado) {
      // No se pudo listar los cobros pendientes: no hay forma de saber cuáles
      // quedaron sin mirar, así que se reporta fuerte y se reintenta.
      console.error(`✖ Pasada fallida: ${JSON.stringify(resultado.errorFatal)}`);
    } else {
      console.log(`${new Date().toISOString()} ${describirPasada(resultado)}`);
      for (const { cobroId, error } of resultado.conError) {
        console.error(`  ! cobro ${cobroId}: ${error.tipo}`);
      }
      if (mensajeria.pendientes.length > 0) {
        console.warn(
          `  ! ${String(mensajeria.pendientes.length)} aviso(s) al cliente sin enviar: ` +
            'wa-bridge no está implementado todavía (docs/ESTADO.md, decisión 7).',
        );
        mensajeria.pendientes.length = 0;
      }
    }

    if (unaSola || !sigue()) {
      break;
    }
    await esperar(intervalo * 1000, sigue);
  } while (sigue());

  console.log('▪ Satélite detenido.');
  return 0;
}

/** Espera troceada, para que una señal no tenga que aguardar el intervalo entero. */
async function esperar(ms: number, sigueCorriendo: () => boolean): Promise<void> {
  const paso = 1000;
  for (let restante = ms; restante > 0 && sigueCorriendo(); restante -= paso) {
    await new Promise((resolver) => setTimeout(resolver, Math.min(paso, restante)));
  }
}

const codigo = await main();
process.exit(codigo);
