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
  /** Ya viene enmascarado desde la API (regla #9). */
  readonly telefonoCliente: string;
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

export type ErrorApi = {
  readonly codigo: string;
  readonly mensaje: string;
  readonly status: number;
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
        return { codigo, mensaje, status };
      }
    }
  }
  return { codigo: 'ERROR_DESCONOCIDO', mensaje: `La API respondió ${String(status)}.`, status };
}
