/**
 * Cliente de la API del demo.
 *
 * Es un módulo TypeScript plano, sin React: así se prueba sin DOM ni jsdom, y
 * los componentes quedan reducidos a mostrar lo que este cliente devuelve.
 * También es lo que hace cumplible la restricción de `demo-web` —**sin lógica
 * de negocio**—: acá no se decide nada, se pide y se traduce.
 *
 * Todo error se devuelve como valor, nunca como excepción: una promesa
 * rechazada dentro de un `onClick` de React desaparece sin dejar rastro.
 */

export type EstadoCobro =
  | 'BORRADOR'
  | 'QR_ACTIVO'
  | 'ENVIADO'
  | 'COMPROBANTE_RECIBIDO'
  | 'PAGO_DETECTADO'
  | 'CONFIRMADO'
  | 'EN_REVISION'
  | 'RECHAZADO'
  | 'VENCIDO'
  | 'ANULADO';

export type QrVigente = {
  readonly qrVersion: number;
  readonly referenciaProveedor: string;
  readonly emitidoEn: string;
  readonly venceEn: string;
  readonly origen: string;
  readonly imagenRef: string | null;
};

export type Cobro = {
  readonly id: string;
  readonly estado: EstadoCobro;
  readonly proveedor: string;
  /** Decimal con dos posiciones, como texto. Nunca un `number` (regla #5). */
  readonly monto: string;
  readonly moneda: string;
  readonly concepto: string;
  /**
   * Ya viene enmascarado desde la API (regla #9). `null` en los cobros que
   * pidió un consumidor: ahí el envío al pagador es suyo (docs/10).
   */
  readonly telefonoCliente: string | null;
  /** Quién pidió el cobro, si lo pidió un consumidor (docs/10). */
  readonly consumidor: { readonly consumidorId: string; readonly referenciaExterna: string } | null;
  readonly qrVersion: number;
  readonly creadoEn: string;
  readonly qrVigente: QrVigente | null;
};

export type RegistroEvidencia = {
  readonly desde: string;
  readonly hacia: string;
  readonly evento: string;
  readonly origen: string;
  readonly registradoEn: string;
  readonly datos: Readonly<Record<string, string | number | null>>;
};

export type DetalleCobro = {
  readonly cobro: Cobro;
  readonly evidencia: readonly RegistroEvidencia[];
};

export type NivelAlerta = 'AL_DIA' | 'ATRASADO' | 'CRITICO';

export type MotivoRevision =
  | 'MONTO_NO_COINCIDE'
  | 'FUERA_DE_VIGENCIA'
  | 'DUPLICADO'
  | 'ABONO_TARDIO'
  | 'VENTANA_AGOTADA'
  | 'OTRO';

/** El pago que reportó el banco para un caso en revisión. */
export type AbonoEnRevision = {
  readonly idDeduplicacion: string;
  /** Decimal como texto, igual que el monto del cobro (regla #5). */
  readonly monto: string;
  readonly ocurridoEn: string;
};

export type CasoRevision = {
  readonly cobro: Cobro;
  readonly motivo: MotivoRevision;
  readonly nivel: NivelAlerta;
  readonly enRevisionDesde: string;
  readonly horasEnRevision: number;
  /** Lo decide el dominio: sin un pago del banco, no se puede aceptar. */
  readonly confirmable: boolean;
  readonly abono: AbonoEnRevision | null;
};

export type MotivoAbono = 'HUERFANO' | 'SIN_CORROBORAR';

/**
 * Un pago que el cierre diario no pudo atar a ningún cobro. No se confirma
 * nada con él: se cierra con lo que se hizo con la plata.
 */
export type AbonoSinConciliar = {
  readonly idDeduplicacion: string;
  readonly motivo: MotivoAbono;
  readonly cobroId: string | null;
  /** Estado actual del cobro del QR, si existe. */
  readonly cobroEstado: EstadoCobro | null;
  /** El cobro ya registra este mismo pago: está explicado, no es plata para devolver. */
  readonly yaRegistradoEnElCobro: boolean;
  /** Decimal como texto (regla #5). */
  readonly monto: string;
  readonly ocurridoEn: string;
  readonly registradoEn: string;
  readonly horasAbierto: number;
  readonly nivel: NivelAlerta;
};

export type ResumenRevision = {
  readonly total: number;
  readonly criticos: number;
  readonly atrasados: number;
};

export type ColaRevision = {
  readonly casos: readonly CasoRevision[];
  readonly abonos: readonly AbonoSinConciliar[];
  readonly resumen: ResumenRevision;
  /** Hay más casos de los que entran en la cola: el resumen se queda corto. */
  readonly truncado: boolean;
};

/** Confirmar nombra el abono que se vio en pantalla; rechazar no lo necesita. */
export type Resolucion =
  | { readonly decision: 'CONFIRMADO'; readonly idDeduplicacion: string; readonly motivo: string }
  | { readonly decision: 'RECHAZADO'; readonly motivo: string };

/** Detalle técnico de una falla de un servicio externo: tipo y código del banco. */
export type DetalleError = {
  readonly tipo: string;
  readonly codigoProveedor: string | null;
  readonly mensajeTecnico: string;
};

export type ErrorApi = {
  readonly codigo: string;
  readonly mensaje: string;
  readonly status: number;
  readonly detalle?: DetalleError;
};

/**
 * Una línea de log: de la API (`api`, `banco`, `sistema`), del satélite
 * (`satelite`: vigilancia, cierre diario y sus llamadas al banco) o de la
 * propia consola. Las de la API y el satélite vienen de la bitácora en disco:
 * sobreviven a un reinicio.
 */
export type LineaLog = {
  readonly n: number;
  readonly en: string;
  readonly nivel: 'info' | 'aviso' | 'error';
  readonly origen: 'api' | 'banco' | 'sistema' | 'satelite' | 'consola';
  readonly texto: string;
};

/** La prueba controlada en producción, si la API corre en ese modo. */
export type EstadoPrueba = {
  readonly activo: true;
  /** Hora del servidor, para no depender del reloj del navegador. */
  readonly ahora: string;
  /** `true` si los QRs son reales (API de producción del banco); `false` con el banco simulado. */
  readonly produccion: boolean;
  /** Monto de cada QR de prueba, fijado por el servidor. */
  readonly monto: string;
  readonly maxQrs: number;
  readonly intentos: number;
  readonly restantes: number;
  readonly adaptadores: string;
  /** Alias de la cuenta de cobro de esta corrida (`prod`, `sucursal-2`). */
  readonly cuenta: string;
  readonly cobros: readonly string[];
};

export type Resultado<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: ErrorApi };

export type NuevoCobro = {
  readonly telefonoCliente: string;
  readonly concepto: string;
  readonly monto: string;
  readonly horasDeVigencia?: number;
};

export type ConfigApi = {
  readonly baseUrl: string;
  readonly token: string;
  /** Inyectable para poder probar sin red. */
  readonly fetch?: typeof globalThis.fetch;
};

export class ClienteApi {
  private readonly hacerFetch: typeof globalThis.fetch;

  constructor(private readonly config: ConfigApi) {
    this.hacerFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  listarPendientes(): Promise<Resultado<readonly Cobro[]>> {
    return this.pedir<{ cobros: Cobro[] }>('GET', '/api/cobros').then((r) =>
      r.ok ? { ok: true as const, valor: r.valor.cobros } : r,
    );
  }

  verCobro(id: string): Promise<Resultado<DetalleCobro>> {
    return this.pedir<DetalleCobro>('GET', `/api/cobros/${encodeURIComponent(id)}`);
  }

  crear(datos: NuevoCobro): Promise<Resultado<Cobro>> {
    return this.pedir<Cobro>('POST', '/api/cobros', datos);
  }

  enviar(id: string): Promise<Resultado<Cobro>> {
    return this.accion(id, 'enviar');
  }

  renovar(id: string, horasDeVigencia?: number): Promise<Resultado<Cobro>> {
    return this.accion(id, 'renovar', horasDeVigencia === undefined ? {} : { horasDeVigencia });
  }

  anular(id: string, motivo: string): Promise<Resultado<Cobro>> {
    return this.accion(id, 'anular', { motivo });
  }

  registrarComprobante(id: string, referenciaComprobante: string): Promise<Resultado<Cobro>> {
    return this.accion(id, 'comprobante', { referenciaComprobante });
  }

  /** Le pregunta al banco ahora, sin esperar al satélite. */
  verificar(id: string): Promise<Resultado<{ resultado: string; cobro: Cobro }>> {
    return this.pedir('POST', `/api/cobros/${encodeURIComponent(id)}/verificar`, {});
  }

  /** La cola de revisión manual, lo más urgente primero. */
  listarRevision(): Promise<Resultado<ColaRevision>> {
    return this.pedir<ColaRevision>('GET', '/api/revision');
  }

  /** La decisión del dueño sobre un caso en revisión. El motivo queda en la evidencia. */
  resolver(id: string, resolucion: Resolucion): Promise<Resultado<Cobro>> {
    return this.accion(id, 'resolver', resolucion);
  }

  /** Le pregunta al banco si hay un pago para un cobro en revisión. */
  buscarAbono(id: string): Promise<Resultado<{ encontrado: boolean; cobro: Cobro }>> {
    return this.pedir('POST', `/api/cobros/${encodeURIComponent(id)}/buscar-abono`, {});
  }

  /** Cierra un pago sin cobro con lo que se hizo con la plata. No toca ningún cobro. */
  cerrarAbono(idDeduplicacion: string, motivo: string): Promise<Resultado<{ idDeduplicacion: string; cerrado: boolean }>> {
    return this.pedir('POST', `/api/abonos/${encodeURIComponent(idDeduplicacion)}/cerrar`, { motivo });
  }

  /** Las últimas líneas de log de la API. */
  verLogs(): Promise<Resultado<{ lineas: LineaLog[] }>> {
    return this.pedir('GET', '/api/logs');
  }

  /** Estado de la prueba en producción. 404 si la API no corre en ese modo. */
  verPrueba(): Promise<Resultado<EstadoPrueba>> {
    return this.pedir<EstadoPrueba>('GET', '/api/pruebas');
  }

  /** Emite un QR real por el monto de prueba. */
  generarQrDePrueba(vigenciaMinutos: number): Promise<Resultado<{ cobro: Cobro; imagen: string | null }>> {
    return this.pedir('POST', '/api/pruebas/qr', { vigenciaMinutos });
  }

  /** Anula en el banco los QRs de prueba que quedaron sin pagar. */
  cerrarPrueba(): Promise<Resultado<{ resultados: { id: string; resultado: string }[] }>> {
    return this.pedir('POST', '/api/pruebas/cerrar', {});
  }

  /** La imagen del QR en Base64. */
  verQr(id: string): Promise<Resultado<{ png: string }>> {
    return this.pedir('GET', `/api/cobros/${encodeURIComponent(id)}/qr`);
  }

  /** Pide al banco anular el QR sin tocar el cobro, para ver qué responde. */
  sondearAnulacion(id: string): Promise<Resultado<{ anulado: boolean; detalle: DetalleError | null }>> {
    return this.pedir('POST', `/api/cobros/${encodeURIComponent(id)}/sondear-anulacion`, {});
  }

  private accion(id: string, accion: string, cuerpo: unknown = {}): Promise<Resultado<Cobro>> {
    return this.pedir<Cobro>('POST', `/api/cobros/${encodeURIComponent(id)}/${accion}`, cuerpo);
  }

  private async pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<Resultado<T>> {
    let respuesta: Response;
    try {
      respuesta = await this.hacerFetch(`${this.config.baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      });
    } catch {
      // La API no está corriendo, o CORS la bloqueó. Es lo primero que pasa en
      // un demo local, así que merece un mensaje que diga qué hacer.
      return {
        ok: false,
        error: {
          codigo: 'SIN_CONEXION',
          mensaje: 'No se pudo contactar a la API. ¿Está corriendo `npm run api`?',
          status: 0,
        },
      };
    }

    const texto = await respuesta.text();
    let cuerpoRespuesta: unknown = null;
    if (texto !== '') {
      try {
        cuerpoRespuesta = JSON.parse(texto);
      } catch {
        return {
          ok: false,
          error: { codigo: 'RESPUESTA_INVALIDA', mensaje: 'La API respondió algo que no es JSON.', status: respuesta.status },
        };
      }
    }

    if (!respuesta.ok) {
      return { ok: false, error: comoError(cuerpoRespuesta, respuesta.status) };
    }
    return { ok: true, valor: cuerpoRespuesta as T };
  }
}

/** Traduce el cuerpo de error de la API, tolerando que no tenga la forma esperada. */
function comoError(cuerpo: unknown, status: number): ErrorApi {
  if (typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo) {
    const { error: err } = cuerpo;
    if (typeof err === 'object' && err !== null && 'codigo' in err && 'mensaje' in err) {
      const { codigo, mensaje } = err;
      if (typeof codigo === 'string' && typeof mensaje === 'string') {
        const detalle = 'detalle' in err ? comoDetalle(err.detalle) : undefined;
        return detalle === undefined ? { codigo, mensaje, status } : { codigo, mensaje, status, detalle };
      }
    }
  }
  return { codigo: 'ERROR_DESCONOCIDO', mensaje: `La API respondió ${String(status)}.`, status };
}

/** El detalle técnico del error, si vino con la forma esperada. */
function comoDetalle(valor: unknown): DetalleError | undefined {
  if (typeof valor !== 'object' || valor === null) {
    return undefined;
  }
  const tipo = 'tipo' in valor && typeof valor.tipo === 'string' ? valor.tipo : null;
  const mensajeTecnico =
    'mensajeTecnico' in valor && typeof valor.mensajeTecnico === 'string' ? valor.mensajeTecnico : '';
  const codigo = 'codigoProveedor' in valor ? valor.codigoProveedor : null;
  if (tipo === null) {
    return undefined;
  }
  return { tipo, codigoProveedor: typeof codigo === 'string' ? codigo : null, mensajeTecnico };
}
