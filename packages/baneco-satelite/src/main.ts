/**
 * Satélite de Baneco — el proceso (ADR-006, decisión D2 opción b).
 *
 * Su trabajo es **cablear y repetir**: pide los puertos a `@mqs/composicion`,
 * llama a `unaPasada()` cada intervalo y registra el resumen. Ninguna regla de
 * negocio vive acá; todas están en `qr-core`.
 *
 * Los adaptadores los elige el entorno (`QR_PROVIDER`, `PAYMENT_WATCHER`), así
 * que el mismo binario corre contra el banco de verdad o enteramente en mock —
 * útil mientras el Hito B0 sigue esperando credenciales de certificación.
 *
 * Corre fuera de Firebase —ThinkPad hoy, OCI después— con una credencial de
 * servicio de mínimo privilegio (docs/05 §4).
 *
 * Uso:
 *   npm run satelite:baneco           # bucle continuo
 *   npm run satelite:baneco -- --una  # una sola pasada y termina
 */

import {
  MensajeriaNoConfigurada,
  construirPuertos,
  describirError,
} from '@mqs/composicion';
import { esExito } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { describirPasada, unaPasada } from './pasada.js';

const INTERVALO_POR_DEFECTO_SEGUNDOS = 180;
const INTERVALO_MINIMO_SEGUNDOS = 30;

function intervaloSegundos(): number {
  const crudo =
    process.env['BANECO_POLL_INTERVAL_SECONDS'] ?? String(INTERVALO_POR_DEFECTO_SEGUNDOS);
  const valor = Number(crudo);
  // Un intervalo demasiado corto castiga al banco y al rate limit (pregunta D6).
  return Number.isInteger(valor) && valor >= INTERVALO_MINIMO_SEGUNDOS
    ? valor
    : INTERVALO_POR_DEFECTO_SEGUNDOS;
}

/**
 * Firestore solo si hay proyecto configurado. Sin él, el satélite corre en
 * memoria — sirve para probar el bucle, no para operar.
 */
function conectarFirestore(): ReturnType<typeof getFirestore> | null {
  const projectId = process.env['FIREBASE_PROJECT_ID'] ?? 'manejoqrsimple';
  if (process.env['SATELITE_SIN_FIRESTORE'] === '1') {
    return null;
  }
  const app = initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

async function main(): Promise<number> {
  const mensajeria = new MensajeriaNoConfigurada();
  const db = conectarFirestore();

  const puertos = construirPuertos({ env: process.env, db, mensajeria });
  if (!esExito(puertos)) {
    console.error(`✖ No se pudieron armar los puertos: ${describirError(puertos.error)}`);
    return 1;
  }

  const unaSola = process.argv.includes('--una');
  const intervalo = intervaloSegundos();

  console.log('▶ Satélite Baneco');
  console.log(`  Adaptadores: ${puertos.valor.resumen}`);
  console.log(unaSola ? '  Modo: una sola pasada.' : `  Intervalo: ${String(intervalo)} s.`);
  console.log('  Verifica y concilia; no emite ni renueva QRs.\n');

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
    const resultado = await unaPasada(puertos.valor.deps, new Date());

    if ('errorFatal' in resultado) {
      // No se pudo listar los cobros pendientes: no hay forma de saber cuáles
      // quedaron sin mirar, así que se reporta fuerte y se reintenta.
      console.error(`✖ Pasada fallida: ${JSON.stringify(resultado.errorFatal)}`);
    } else {
      console.log(`${new Date().toISOString()} ${describirPasada(resultado)}`);
      for (const { cobroId, error } of resultado.conError) {
        console.error(`  ! cobro ${cobroId}: ${error.tipo}`);
      }
      const sinEnviar = mensajeria.drenar();
      if (sinEnviar.length > 0) {
        console.warn(
          `  ! ${String(sinEnviar.length)} aviso(s) al cliente sin enviar: ` +
            'wa-bridge no está implementado (docs/04 §2).',
        );
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
