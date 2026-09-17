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

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  Bitacora,
  MensajeriaNoConfigurada,
  construirPuertos,
  describirError,
  describirLlamada,
  explicarMarca,
  fijarCuentaDePrueba,
  leerCuentaDePrueba,
  verificarProduccion,
  type NivelLog,
} from '@mqs/composicion';
import { esExito } from '@mqs/qr-core';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { cerrarDiasPendientes, cerroCompleto, describirCierre, fueraDeVentana } from './cierre.js';
import { describirPasada, unaPasada } from './pasada.js';

/**
 * El banco acepta consultar un QR pendiente desde los 10 s en venta en línea, y
 * hoy no aplica rate limit (pregunta D6, 2026-09-11). El cobro por WhatsApp es
 * venta en línea: 30 s detecta el pago mientras el cliente todavía espera la
 * confirmación, sin acercarse al piso.
 */
const INTERVALO_POR_DEFECTO_SEGUNDOS = 30;
const INTERVALO_MINIMO_SEGUNDOS = 10;

function intervaloSegundos(): number {
  const crudo =
    process.env['BANECO_POLL_INTERVAL_SECONDS'] ?? String(INTERVALO_POR_DEFECTO_SEGUNDOS);
  const valor = Number(crudo);
  // El piso es el que fijó el banco. Anunció que podría implementar un rate
  // limit: bajar de ahí es pedir un bloqueo del usuario API.
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
  // Producción solo en la prueba controlada, y con los datos en el emulador.
  const barrera = verificarProduccion(process.env);
  if (barrera !== null) {
    console.error(`✖ ${barrera}`);
    return 1;
  }

  // Bitácora en disco, fuera del repo: el cierre diario y las llamadas al banco
  // se pueden leer después (pestaña Logs de la consola), no solo en esta terminal.
  const directorioLogs = process.env['BITACORA_DIR'] ?? join(homedir(), '.manejoqr', 'logs');
  const bitacora = new Bitacora(directorioLogs, 'satelite');
  /** Imprime en la terminal y deja la línea en la bitácora. */
  const registrar = (nivel: NivelLog, texto: string): void => {
    const imprimir = nivel === 'error' ? console.error : nivel === 'aviso' ? console.warn : console.log;
    imprimir(texto);
    bitacora.escribir(nivel, 'satelite', texto.trim());
  };

  const mensajeria = new MensajeriaNoConfigurada();
  const db = conectarFirestore();

  // En la prueba controlada, los datos son de una cuenta de cobro concreta: el
  // satélite no mira los QRs de una cuenta con las credenciales de otra.
  const cuenta = leerCuentaDePrueba(process.env);
  if (cuenta === null) {
    console.error('✖ CUENTA solo admite minúsculas, números y guiones (hasta 24 caracteres).');
    return 1;
  }
  if (process.env['MODO_PRUEBA_PRODUCCION'] === '1' && db !== null) {
    const problema = explicarMarca(await fijarCuentaDePrueba(db, cuenta, new Date()));
    if (problema !== null) {
      console.error(`✖ ${problema}`);
      return 1;
    }
  }

  const puertos = construirPuertos({
    env: process.env,
    db,
    mensajeria,
    // Las llamadas al banco, solo a la bitácora: en la terminal serían ruido.
    // Se omiten las consultas de estado exitosas: son una por cobro pendiente
    // en cada pasada, y taparían —y agrandarían— lo que importa.
    observarBanco: (llamada) => {
      const { nivel, texto } = describirLlamada(llamada);
      if (nivel === 'info' && llamada.ruta.includes('/statusQR/')) {
        return;
      }
      bitacora.escribir(nivel, 'satelite', `banco: ${texto}`);
    },
  });
  if (!esExito(puertos)) {
    console.error(`✖ No se pudieron armar los puertos: ${describirError(puertos.error)}`);
    return 1;
  }

  const unaSola = process.argv.includes('--una');
  const intervalo = intervaloSegundos();

  const enPrueba = process.env['MODO_PRUEBA_PRODUCCION'] === '1';
  console.log('▶ Satélite Baneco');
  console.log(`  Adaptadores: ${puertos.valor.resumen}`);
  if (enPrueba) {
    console.log(`  Cuenta de cobro: ${cuenta}`);
  }
  console.log(unaSola ? '  Modo: una sola pasada.' : `  Intervalo: ${String(intervalo)} s.`);
  console.log('  Verifica, concilia y anula en el banco los QRs que vencen; no emite ni renueva.');
  console.log('  Cierra los días anteriores contra el reporte paidQR del banco.');
  console.log(`  Logs: ${directorioLogs} (también en la pestaña Logs de la consola)\n`);
  bitacora.escribir(
    'info',
    'satelite',
    `Satélite iniciado · ${puertos.valor.resumen}${enPrueba ? ` · cuenta ${cuenta}` : ''}${unaSola ? ' · una pasada' : ''}`,
  );

  // En un objeto y no en un `let`: el manejador de señal lo muta desde una
  // clausura, y TypeScript no puede ver eso en una variable local.
  const control = { corriendo: true };
  /**
   * Días bolivianos cerrados sin errores, y días intentados que todavía no.
   * En memoria: al arrancar se revisa la ventana entera de nuevo, y como el
   * cierre es idempotente, repetir un día no duplica nada.
   */
  const cerrados = new Set<string>();
  const sinCerrar = new Set<string>();
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
      registrar('error', `✖ Pasada fallida: ${JSON.stringify(resultado.errorFatal)}`);
    } else {
      const lineaPasada = describirPasada(resultado);
      console.log(`${new Date().toISOString()} ${lineaPasada}`);
      // A disco solo las pasadas con novedades: una línea cada 10 s taparía lo que importa.
      const novedades =
        resultado.confirmados.length + resultado.enRevision.length + resultado.vencidos.length + resultado.conError.length;
      if (novedades > 0) {
        bitacora.escribir('info', 'satelite', `pasada: ${lineaPasada}`);
      }
      for (const { cobroId, error } of resultado.conError) {
        registrar('error', `  ! cobro ${cobroId}: ${error.tipo}`);
      }
      const ahora = new Date();
      const depsCierre = { ...puertos.valor.deps, abonosSinConciliar: puertos.valor.abonosSinConciliar };
      for (const cierre of await cerrarDiasPendientes(depsCierre, ahora, cerrados)) {
        if (cierre.tipo === 'CERRADO') {
          const lineaCierre = describirCierre(cierre.clave, cierre.resumen);
          console.log(`${ahora.toISOString()} ${lineaCierre}`);
          bitacora.escribir('info', 'satelite', lineaCierre);
          for (const id of cierre.resumen.nuevosParaRevisar) {
            // Plata en la cuenta que ningún cobro explica: nunca se descarta.
            // Ya quedó guardada; el aviso es para quien mira la terminal, y
            // solo por lo nuevo: un abono ya visto (o ya cerrado) no se repite.
            registrar('aviso', `  ! abono nuevo para revisar (pestaña Revisión): ${id}`);
          }
          for (const { idDeduplicacion, error } of cierre.resumen.conError) {
            registrar('error', `  ! abono ${idDeduplicacion} sin procesar (${error.tipo}); se reintenta.`);
          }
        } else {
          registrar('error', `  ! cierre ${cierre.clave} fallido (${cierre.error.tipo}); se reintenta.`);
        }
        if (cerroCompleto(cierre)) {
          cerrados.add(cierre.clave);
          sinCerrar.delete(cierre.clave);
        } else {
          sinCerrar.add(cierre.clave);
        }
      }
      for (const clave of fueraDeVentana(ahora, sinCerrar)) {
        // Salió de la ventana sin cerrarse: ya no se reintenta solo.
        registrar('error', `✖ El día ${clave} quedó sin cerrar: conciliarlo a mano contra paidQR.`);
        sinCerrar.delete(clave);
      }
      for (const clave of fueraDeVentana(ahora, cerrados)) {
        cerrados.delete(clave);
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
