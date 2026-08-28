/**
 * Selección de adaptadores por variable de entorno.
 *
 * Es la pieza que hace real la promesa de ADR-002: el dominio no sabe qué hay
 * detrás de sus puertos, y cambiar de mock a banco de verdad es una variable de
 * entorno, no un cambio de código.
 *
 * `.env.example` declara `QR_PROVIDER` y `PAYMENT_WATCHER` (`mock|baneco|yape`)
 * desde la fundación del monorepo, pero hasta ahora no los leía nadie: el
 * satélite tenía el adaptador de Baneco cableado fijo. Acá se cumplen.
 *
 * La persistencia no se elige por variable sino por parámetro: si se pasa una
 * `Firestore`, se usan los adaptadores reales; si no, los de memoria. Así un
 * test o una demo local no dependen de que alguien recuerde poner la variable
 * correcta — y sobre todo, **no existe un valor de entorno que haga que un test
 * escriba en el proyecto real por accidente**.
 */

import {
  ClienteBaneco,
  PaymentWatcherBaneco,
  ProveedorDeToken,
  QrProviderBaneco,
  leerConfig,
  transporteFetch,
  type ConfigBaneco,
} from '@mqs/baneco-gateway';
import { CobroRepositoryFirestore, EvidenceStoreFirestore } from '@mqs/firestore-store';
import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  esExito,
  exito,
  fallo,
  type CobroRepository,
  type Dependencias,
  type EvidenceStore,
  type MessagingProvider,
  type PaymentWatcher,
  type QrProvider,
  type Resultado,
} from '@mqs/qr-core';
import type { Firestore } from 'firebase-admin/firestore';

export const MODOS = ['mock', 'baneco', 'yape'] as const;
export type Modo = (typeof MODOS)[number];

export type ErrorComposicion =
  | { readonly tipo: 'MODO_INVALIDO'; readonly variable: string; readonly valor: string }
  | { readonly tipo: 'MODO_NO_IMPLEMENTADO'; readonly variable: string; readonly modo: Modo }
  | { readonly tipo: 'CONFIG_BANECO'; readonly detalle: string };

export type OpcionesComposicion = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `null` ⇒ persistencia en memoria. Nunca se elige por variable de entorno. */
  readonly db: Firestore | null;
  readonly mensajeria: MessagingProvider;
};

export type PuertosArmados = {
  readonly deps: Dependencias;
  /** Qué quedó conectado detrás de cada puerto, para poder loguearlo. */
  readonly resumen: string;
};

function leerModo(
  env: OpcionesComposicion['env'],
  variable: string,
): Resultado<Modo, ErrorComposicion> {
  const valor = env[variable] ?? 'mock';
  if (!(MODOS as readonly string[]).includes(valor)) {
    return fallo({ tipo: 'MODO_INVALIDO', variable, valor });
  }
  return exito(valor as Modo);
}

/**
 * Arma los puertos según el entorno.
 *
 * El cliente de Baneco se construye **una sola vez** y lo comparten el
 * `QrProvider` y el `PaymentWatcher`: así el JWT se negocia una vez, y no una
 * por puerto.
 */
export function construirPuertos(
  opciones: OpcionesComposicion,
): Resultado<PuertosArmados, ErrorComposicion> {
  const modoQr = leerModo(opciones.env, 'QR_PROVIDER');
  if (!esExito(modoQr)) return modoQr;

  const modoWatcher = leerModo(opciones.env, 'PAYMENT_WATCHER');
  if (!esExito(modoWatcher)) return modoWatcher;

  const necesitaBaneco = modoQr.valor === 'baneco' || modoWatcher.valor === 'baneco';
  let baneco: { qr: QrProvider; watcher: PaymentWatcher } | null = null;

  if (necesitaBaneco) {
    const config = leerConfig(opciones.env);
    if (!esExito(config)) {
      return fallo({ tipo: 'CONFIG_BANECO', detalle: config.error.tipo });
    }
    baneco = construirBaneco(config.valor);
  }

  const qr = elegirQr(modoQr.valor, baneco);
  if (!esExito(qr)) return qr;

  const watcher = elegirWatcher(modoWatcher.valor, baneco);
  if (!esExito(watcher)) return watcher;

  const enFirestore = opciones.db !== null;
  const cobros: CobroRepository = enFirestore
    ? new CobroRepositoryFirestore(opciones.db)
    : new CobroRepositoryEnMemoria(new EvidenceStoreEnMemoria());
  const evidencia: EvidenceStore = enFirestore
    ? new EvidenceStoreFirestore(opciones.db)
    : new EvidenceStoreEnMemoria();

  return exito({
    deps: {
      cobros,
      evidencia,
      qr: qr.valor,
      watcher: watcher.valor,
      mensajeria: opciones.mensajeria,
      politica: POLITICA_POR_DEFECTO,
    },
    resumen:
      `qr=${modoQr.valor} watcher=${modoWatcher.valor} ` +
      `persistencia=${enFirestore ? 'firestore' : 'memoria'}`,
  });
}

function construirBaneco(config: ConfigBaneco): { qr: QrProvider; watcher: PaymentWatcher } {
  const transporte = transporteFetch();
  const tokens = new ProveedorDeToken(config, transporte);
  const cliente = new ClienteBaneco(config, transporte, tokens);
  return {
    qr: new QrProviderBaneco(config, cliente),
    watcher: new PaymentWatcherBaneco(cliente),
  };
}

function elegirQr(
  modo: Modo,
  baneco: { qr: QrProvider } | null,
): Resultado<QrProvider, ErrorComposicion> {
  switch (modo) {
    case 'mock':
      return exito(new QrProviderEnMemoria());
    case 'baneco':
      // `baneco` no es null: se construyó arriba justamente porque este modo lo pide.
      return baneco === null
        ? fallo({ tipo: 'CONFIG_BANECO', detalle: 'cliente no construido' })
        : exito(baneco.qr);
    case 'yape':
      // El riel Yape está diferido (D1) y su adaptador es un esqueleto. Fallar
      // acá es mejor que arrancar con un proveedor que no hace nada.
      return fallo({ tipo: 'MODO_NO_IMPLEMENTADO', variable: 'QR_PROVIDER', modo });
  }
}

function elegirWatcher(
  modo: Modo,
  baneco: { watcher: PaymentWatcher } | null,
): Resultado<PaymentWatcher, ErrorComposicion> {
  switch (modo) {
    case 'mock':
      return exito(new PaymentWatcherEnMemoria());
    case 'baneco':
      return baneco === null
        ? fallo({ tipo: 'CONFIG_BANECO', detalle: 'cliente no construido' })
        : exito(baneco.watcher);
    case 'yape':
      return fallo({ tipo: 'MODO_NO_IMPLEMENTADO', variable: 'PAYMENT_WATCHER', modo });
  }
}

/**
 * Mensaje legible para el arranque. Sin secretos.
 *
 * **No ecoa el valor recibido**, solo el nombre de la variable. El valor viene
 * del entorno, y el entorno es donde viven las credenciales: si alguien se
 * equivoca de variable al copiar un `.env`, echarlo al log convertiría un typo
 * en una credencial impresa en consola. El nombre de la variable y la lista de
 * modos válidos alcanzan para corregirlo.
 */
export function describirError(error: ErrorComposicion): string {
  switch (error.tipo) {
    case 'MODO_INVALIDO':
      return `${error.variable} no tiene un modo válido. Valores admitidos: ${MODOS.join(', ')}.`;
    case 'MODO_NO_IMPLEMENTADO':
      return `${error.variable}=${error.modo}: ese adaptador todavía no está implementado.`;
    case 'CONFIG_BANECO':
      return `La configuración de Baneco es inválida (${error.detalle}). Revisá el bloque BANECO_* del .env.`;
  }
}
