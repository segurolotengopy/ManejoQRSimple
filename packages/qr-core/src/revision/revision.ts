/**
 * La cola de revisión manual.
 *
 * Un cobro en `EN_REVISION` es plata —o la promesa de plata— que el sistema no
 * pudo decidir solo y que tiene que mirar una persona. Este módulo arma, a
 * partir del cobro y su evidencia, lo que esa persona necesita para decidir:
 * por qué está ahí, desde cuándo, qué pagó el banco y qué tan urgente es.
 *
 * Todo sale de la **evidencia**, no de campos nuevos en el cobro: la evidencia
 * ya registró cada transición con sus datos (regla #8), y un segundo lugar
 * donde anotar el motivo sería un segundo lugar donde desincronizarse.
 *
 * La urgencia es regla de negocio y por eso vive acá y no en la consola: un
 * caso con plata recibida es más urgente que uno sin, porque del otro lado hay
 * un cliente que pagó y está esperando.
 */

import { centavos, type Centavos } from '../comun/dinero.js';
import { esExito } from '../comun/resultado.js';
import type { Cobro } from '../cobro/cobro.js';
import type { RegistroEvidencia, TipoEvento } from '../cobro/maquina-estados.js';

/** Por qué un cobro está en revisión, en el vocabulario del dueño. */
export const MOTIVOS_REVISION = [
  'MONTO_NO_COINCIDE',
  'FUERA_DE_VIGENCIA',
  'DUPLICADO',
  'ABONO_TARDIO',
  'VENTANA_AGOTADA',
  'OTRO',
] as const;
export type MotivoRevision = (typeof MOTIVOS_REVISION)[number];

export type NivelAlerta = 'AL_DIA' | 'ATRASADO' | 'CRITICO';

/** Un abono que el banco reportó y quedó en la evidencia del cobro. */
export type AbonoRegistrado = {
  readonly idDeduplicacion: string;
  readonly montoCentavos: Centavos;
  readonly ocurridoEn: Date;
};

export type CasoRevision = {
  readonly cobro: Cobro;
  readonly motivo: MotivoRevision;
  readonly enRevisionDesde: Date;
  readonly horasEnRevision: number;
  /**
   * El último abono que reportó el banco para este cobro. `null` si nunca
   * reportó ninguno — y entonces el caso **no se puede confirmar**, ni a mano.
   */
  readonly abono: AbonoRegistrado | null;
  readonly nivel: NivelAlerta;
};

export type UmbralesHoras = { readonly atrasado: number; readonly critico: number };

/**
 * Cuánto puede esperar un caso antes de alertar.
 *
 * Con plata recibida, un cliente pagó y espera su confirmación: 4 h ya es
 * atraso y un día es crítico. Sin plata (comprobante que el banco nunca vio),
 * lo más probable es un pago que no se hizo o un comprobante falso, y el
 * margen es más amplio.
 */
export type PoliticaRevision = {
  readonly conAbono: UmbralesHoras;
  readonly sinAbono: UmbralesHoras;
};

export const POLITICA_REVISION_POR_DEFECTO: PoliticaRevision = {
  conAbono: { atrasado: 4, critico: 24 },
  sinAbono: { atrasado: 24, critico: 72 },
};

export type ResumenRevision = {
  readonly total: number;
  readonly criticos: number;
  readonly atrasados: number;
};

const HORA_MS = 3_600_000;

/** Eventos cuya evidencia lleva una detección del banco. */
const EVENTOS_CON_DETECCION: readonly TipoEvento[] = [
  'PAGO_DETECTADO',
  'ABONO_TARDIO',
  'DETECCION_EN_REVISION',
];

/** Motivos de conciliación fallida que se muestran tal cual. */
const MOTIVOS_DE_CONCILIACION: readonly MotivoRevision[] = [
  'MONTO_NO_COINCIDE',
  'FUERA_DE_VIGENCIA',
  'DUPLICADO',
];

/** El último abono del banco que figura en la evidencia, o `null`. */
export function ultimaDeteccion(registros: readonly RegistroEvidencia[]): AbonoRegistrado | null {
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    const registro = registros[i];
    if (registro === undefined || !EVENTOS_CON_DETECCION.includes(registro.evento)) {
      continue;
    }
    const { idDeduplicacion, montoCentavos, ocurridoEn } = registro.datos;
    if (typeof idDeduplicacion !== 'string' || typeof montoCentavos !== 'number' || typeof ocurridoEn !== 'string') {
      continue;
    }
    const monto = centavos(montoCentavos);
    const instante = new Date(ocurridoEn);
    if (!esExito(monto) || Number.isNaN(instante.getTime())) {
      continue;
    }
    return { idDeduplicacion, montoCentavos: monto.valor, ocurridoEn: instante };
  }
  return null;
}

/**
 * La transición que metió al cobro en revisión: la última que llegó a
 * `EN_REVISION` desde otro estado (una detección adjuntada después no cuenta).
 */
function entradaARevision(registros: readonly RegistroEvidencia[]): RegistroEvidencia | null {
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    const registro = registros[i];
    if (registro !== undefined && registro.hacia === 'EN_REVISION' && registro.desde !== 'EN_REVISION') {
      return registro;
    }
  }
  return null;
}

function motivoDe(entrada: RegistroEvidencia | null): MotivoRevision {
  switch (entrada?.evento) {
    case 'ABONO_TARDIO':
      return 'ABONO_TARDIO';
    case 'VENTANA_AGOTADA':
      return 'VENTANA_AGOTADA';
    case 'CONCILIACION_FALLIDA': {
      const motivo = entrada.datos['motivo'];
      const conocido = MOTIVOS_DE_CONCILIACION.find((m) => m === motivo);
      return conocido ?? 'OTRO';
    }
    default:
      return 'OTRO';
  }
}

export function nivelDeAlerta(
  horasEnRevision: number,
  conAbono: boolean,
  politica: PoliticaRevision,
): NivelAlerta {
  const umbrales = conAbono ? politica.conAbono : politica.sinAbono;
  if (horasEnRevision >= umbrales.critico) {
    return 'CRITICO';
  }
  return horasEnRevision >= umbrales.atrasado ? 'ATRASADO' : 'AL_DIA';
}

/** Arma el caso de revisión de un cobro a partir de su evidencia. */
export function construirCaso(
  cobro: Cobro,
  registros: readonly RegistroEvidencia[],
  ahora: Date,
  politica: PoliticaRevision,
): CasoRevision {
  const entrada = entradaARevision(registros);
  // Sin el registro de entrada (no debería pasar), se cuenta desde la creación:
  // exagerar la antigüedad alerta de más, que es el error seguro.
  const enRevisionDesde = entrada?.registradoEn ?? cobro.creadoEn;
  const horasEnRevision = Math.max(0, (ahora.getTime() - enRevisionDesde.getTime()) / HORA_MS);
  const abono = ultimaDeteccion(registros);
  return {
    cobro,
    motivo: motivoDe(entrada),
    enRevisionDesde,
    horasEnRevision,
    abono,
    nivel: nivelDeAlerta(horasEnRevision, abono !== null, politica),
  };
}

const PESO: Readonly<Record<NivelAlerta, number>> = { CRITICO: 2, ATRASADO: 1, AL_DIA: 0 };

/** Lo más urgente primero; a igual urgencia, lo más viejo. */
export function ordenarCasos(casos: readonly CasoRevision[]): readonly CasoRevision[] {
  return [...casos].sort(
    (a, b) => PESO[b.nivel] - PESO[a.nivel] || b.horasEnRevision - a.horasEnRevision,
  );
}

/**
 * Cuenta los cobros en revisión **y** los abonos sin conciliar: los dos son
 * plata que espera a una persona, y las alertas (insignia, título, avisos)
 * tienen que ver los dos. Los abonos llegan por su forma (`{ nivel }`) y no
 * por su tipo, para que este módulo no dependa de `abono-sin-conciliar.ts`,
 * que ya depende de este.
 */
export function resumirRevision(
  casos: readonly CasoRevision[],
  abonos: readonly { readonly nivel: NivelAlerta }[] = [],
): ResumenRevision {
  const niveles = [...casos.map((c) => c.nivel), ...abonos.map((a) => a.nivel)];
  return {
    total: niveles.length,
    criticos: niveles.filter((n) => n === 'CRITICO').length,
    atrasados: niveles.filter((n) => n === 'ATRASADO').length,
  };
}
