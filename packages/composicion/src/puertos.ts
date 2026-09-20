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
  transporteObservado,
  type AlmacenImagenQr,
  type ConfigBaneco,
  type LlamadaAlBanco,
} from '@mqs/baneco-gateway';
import {
  NotificadorHttp,
  describirErrorDestino,
  leerDestinos,
} from '@mqs/avisos-consumidor';
import {
  AbonosSinConciliarFirestore,
  AvisosFirestore,
  CobroRepositoryFirestore,
  EvidenceStoreFirestore,
  PaymentWatcherAbonosFirestore,
} from '@mqs/firestore-store';
import {
  AbonosSinConciliarEnMemoria,
  AvisosEnMemoria,
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  MessagingProviderEnMemoria,
  POLITICA_POR_DEFECTO,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
  esExito,
  exito,
  fallo,
  type AbonosSinConciliarStore,
  type AvisosStore,
  type CobroRepository,
  type Dependencias,
  type EvidenceStore,
  type MessagingProvider,
  type NotificadorConsumidor,
  type PaymentWatcher,
  type QrProvider,
  type Resultado,
} from '@mqs/qr-core';
import type { Firestore } from 'firebase-admin/firestore';

export const MODOS = ['mock', 'simulado', 'baneco', 'yape'] as const;
export type Modo = (typeof MODOS)[number];

export type ErrorComposicion =
  /**
   * Lleva el **nombre** de la variable, nunca su valor.
   *
   * El valor viene del entorno, que es donde viven las credenciales. Con no
   * imprimirlo no alcanza: si el error lo transporta, cualquier código futuro
   * que serialice el error lo filtra, y un analizador estático no puede
   * demostrar lo contrario. No cargarlo hace que no exista nada que filtrar.
   */
  | { readonly tipo: 'MODO_INVALIDO'; readonly variable: string }
  | { readonly tipo: 'MODO_NO_IMPLEMENTADO'; readonly variable: string; readonly modo: Modo }
  | { readonly tipo: 'MODO_NECESITA_FIRESTORE'; readonly variable: string; readonly modo: Modo }
  | { readonly tipo: 'CONFIG_BANECO'; readonly detalle: string }
  /**
   * Un consumidor con el aviso a medio configurar (docs/10 §4.6). Lleva el
   * texto ya armado por el adaptador, que nombra al consumidor y nunca su
   * URL ni su secreto.
   */
  | { readonly tipo: 'DESTINO_DE_AVISO'; readonly detalle: string };

export type OpcionesComposicion = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `null` ⇒ persistencia en memoria. Nunca se elige por variable de entorno. */
  readonly db: Firestore | null;
  /**
   * Proveedor de mensajería a usar cuando `MESSAGING_PROVIDER` no es `mock`.
   *
   * Se inyecta en vez de construirse acá porque hoy no hay adaptador real: lo
   * que llega es `MensajeriaNoConfigurada`, que falla a propósito.
   */
  readonly mensajeria: MessagingProvider;
  /**
   * Dónde guardar la imagen del QR que devuelve el banco. Sin almacén, el QR
   * se emite igual pero nadie puede verlo para pagarlo.
   */
  readonly almacenImagenesQr?: AlmacenImagenQr;
  /**
   * Se entera de cada llamada al banco (ruta, estado, `responseCode`, demora),
   * para los logs de depuración. Nunca recibe cuerpos ni credenciales.
   */
  readonly observarBanco?: (llamada: LlamadaAlBanco) => void;
};

export type { AlmacenImagenQr, LlamadaAlBanco };

export type PuertosArmados = {
  readonly deps: Dependencias;
  /**
   * Abonos que el cierre diario no pudo atar a un cobro. Lo escribe el
   * satélite y lo lee (y cierra) la API: en la misma persistencia que los
   * cobros, para que los dos procesos vean lo mismo.
   */
  readonly abonosSinConciliar: AbonosSinConciliarStore;
  /**
   * Quién entrega los avisos de confirmación a los consumidores. Lo usa el
   * satélite; la API solo los encola (por `deps.avisos`).
   */
  readonly notificador: NotificadorConsumidor;
  /** Qué quedó conectado detrás de cada puerto, para poder loguearlo. */
  readonly resumen: string;
};

function leerModo(
  env: OpcionesComposicion['env'],
  variable: string,
): Resultado<Modo, ErrorComposicion> {
  const valor = env[variable] ?? 'mock';
  if (!(MODOS as readonly string[]).includes(valor)) {
    // Se descarta el valor a propósito: ver el comentario de MODO_INVALIDO.
    return fallo({ tipo: 'MODO_INVALIDO', variable });
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
    baneco = construirBaneco(config.valor, opciones.almacenImagenesQr ?? null, opciones.observarBanco ?? null);
  }

  const qr = elegirQr(modoQr.valor, baneco);
  if (!esExito(qr)) return qr;

  const watcher = elegirWatcher(modoWatcher.valor, baneco, opciones.db);
  if (!esExito(watcher)) return watcher;

  // El default NO es `mock`: fingir que el mensaje salió es peor que fallar.
  // Solo el demo pide `mock` explícitamente.
  const mensajeriaEnMock = opciones.env['MESSAGING_PROVIDER'] === 'mock';
  const mensajeria = mensajeriaEnMock
    ? new MessagingProviderEnMemoria()
    : opciones.mensajeria;

  const enFirestore = opciones.db !== null;
  const cobros: CobroRepository = enFirestore
    ? new CobroRepositoryFirestore(opciones.db)
    : new CobroRepositoryEnMemoria(new EvidenceStoreEnMemoria());
  const evidencia: EvidenceStore = enFirestore
    ? new EvidenceStoreFirestore(opciones.db)
    : new EvidenceStoreEnMemoria();
  const abonosSinConciliar: AbonosSinConciliarStore = enFirestore
    ? new AbonosSinConciliarFirestore(opciones.db)
    : new AbonosSinConciliarEnMemoria();
  const avisos: AvisosStore = enFirestore
    ? new AvisosFirestore(opciones.db)
    : new AvisosEnMemoria();

  // Los destinos de los avisos se leen aunque no haya ninguno configurado: un
  // consumidor a medio configurar tiene que cortar el arranque, no descubrirse
  // el día que haya un pago que avisar.
  const destinos = leerDestinos(opciones.env);
  if (!destinos.ok) {
    return fallo({ tipo: 'DESTINO_DE_AVISO', detalle: describirErrorDestino(destinos.error) });
  }

  return exito({
    abonosSinConciliar,
    notificador: new NotificadorHttp(destinos.destinos),
    deps: {
      cobros,
      evidencia,
      avisos,
      qr: qr.valor,
      watcher: watcher.valor,
      mensajeria,
      politica: POLITICA_POR_DEFECTO,
    },
    resumen:
      `qr=${modoQr.valor} watcher=${modoWatcher.valor} ` +
      `mensajeria=${mensajeriaEnMock ? 'mock' : 'no-configurada'} ` +
      `persistencia=${enFirestore ? 'firestore' : 'memoria'} ` +
      `avisos=${destinos.destinos.size === 0 ? 'sin-destinos' : [...destinos.destinos.keys()].join('+')}`,
  });
}

function construirBaneco(
  config: ConfigBaneco,
  almacen: AlmacenImagenQr | null,
  observar: ((llamada: LlamadaAlBanco) => void) | null,
): { qr: QrProvider; watcher: PaymentWatcher } {
  const transporte = observar === null ? transporteFetch() : transporteObservado(transporteFetch(), observar);
  const tokens = new ProveedorDeToken(config, transporte);
  const cliente = new ClienteBaneco(config, transporte, tokens);
  return {
    qr: new QrProviderBaneco(config, cliente, undefined, almacen),
    watcher: new PaymentWatcherBaneco(cliente),
  };
}

function elegirQr(
  modo: Modo,
  baneco: { qr: QrProvider } | null,
): Resultado<QrProvider, ErrorComposicion> {
  switch (modo) {
    case 'mock':
    case 'simulado':
      // Para emitir QRs no hay diferencia entre "mock" y "simulado": los dos
      // producen un QR de mentira. La distinción solo importa del lado del
      // watcher, que es donde el simulador aporta algo.
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
  db: Firestore | null,
): Resultado<PaymentWatcher, ErrorComposicion> {
  switch (modo) {
    case 'mock':
      return exito(new PaymentWatcherEnMemoria());
    case 'simulado':
      // Lee los abonos de `abonos/*` en Firestore: el mismo lugar donde los
      // dejará el scraper (docs/05 §2). Sin base no tiene de dónde leer.
      return db === null
        ? fallo({ tipo: 'MODO_NECESITA_FIRESTORE', variable: 'PAYMENT_WATCHER', modo })
        : exito(new PaymentWatcherAbonosFirestore(db));
    case 'baneco':
      return baneco === null
        ? fallo({ tipo: 'CONFIG_BANECO', detalle: 'cliente no construido' })
        : exito(baneco.watcher);
    case 'yape':
      return fallo({ tipo: 'MODO_NO_IMPLEMENTADO', variable: 'PAYMENT_WATCHER', modo });
  }
}

/**
 * Mensaje legible para el arranque. Sin secretos: los errores no transportan
 * ningún valor leído del entorno, solo nombres de variable.
 */
export function describirError(error: ErrorComposicion): string {
  switch (error.tipo) {
    case 'MODO_INVALIDO':
      return `${error.variable} no tiene un modo válido. Valores admitidos: ${MODOS.join(', ')}.`;
    case 'MODO_NO_IMPLEMENTADO':
      return `${error.variable}=${error.modo}: ese adaptador todavía no está implementado.`;
    case 'MODO_NECESITA_FIRESTORE':
      return `${error.variable}=${error.modo} necesita una conexión a Firestore (levantá el emulador o configurá el proyecto).`;
    case 'CONFIG_BANECO':
      return `La configuración de Baneco es inválida (${error.detalle}). Revisá el bloque BANECO_* del .env.`;
    case 'DESTINO_DE_AVISO':
      return `Aviso a consumidores mal configurado: ${error.detalle}`;
  }
}
