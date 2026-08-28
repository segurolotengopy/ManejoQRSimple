/**
 * Autenticación y caché del JWT del banco.
 *
 * El token vive **solo en memoria del proceso**: no se persiste ni se registra
 * (análisis §6.1). Un JWT filtrado es acceso directo a la API del comercio.
 *
 * La vigencia real no está documentada (pregunta B1 al banco), así que en vez
 * de asumir un número se lee el `exp` del propio token y se renueva con
 * anticipación. Si el token no trae `exp` legible, se cae a una vigencia corta
 * y conservadora: mejor autenticar de más que operar con un token vencido.
 */

import { esExito, exito, fallo, type ErrorPuerto, type Resultado } from '@mqs/qr-core';

import type { ConfigBaneco } from '../config.js';
import { cifrar } from '../crypto/aes.js';
import { errorDeEstado, errorPuerto, type Transporte } from '../client/http.js';
import { respuestaAutenticacion } from '../schemas.js';

/** Margen con el que se renueva antes del vencimiento declarado por el token. */
const MARGEN_RENOVACION_SEGUNDOS = 60;

/** Vigencia asumida cuando el token no declara `exp` legible. */
const VIGENCIA_CONSERVADORA_SEGUNDOS = 240;

export type Reloj = () => Date;

export class ProveedorDeToken {
  private token: string | null = null;
  private venceEn = 0;

  constructor(
    private readonly config: ConfigBaneco,
    private readonly transporte: Transporte,
    private readonly reloj: Reloj = () => new Date(),
  ) {}

  /** Devuelve un token vigente, autenticando si hace falta. */
  async obtener(): Promise<Resultado<string, ErrorPuerto>> {
    const ahora = this.reloj().getTime();
    if (this.token !== null && ahora < this.venceEn) {
      return exito(this.token);
    }
    return this.renovar();
  }

  /** Fuerza una autenticación nueva. Lo usa el reintento único ante 401. */
  async renovar(): Promise<Resultado<string, ErrorPuerto>> {
    this.token = null;

    const respuesta = await this.transporte({
      metodo: 'POST',
      url: `${this.config.baseUrl}/api/authentication/authenticate`,
      cuerpo: {
        userName: this.config.usuario,
        // La contraseña viaja cifrada con la llave AES del entorno (manual §3).
        password: cifrar(this.config.password.revelar(), this.config.llave),
      },
    });

    if (!esExito(respuesta)) {
      return respuesta;
    }
    if (respuesta.valor.status !== 200) {
      return fallo(errorDeEstado(respuesta.valor.status));
    }

    const validada = respuestaAutenticacion.safeParse(respuesta.valor.cuerpo);
    if (!validada.success) {
      return fallo(
        errorPuerto('RESPUESTA_INVALIDA', 'la respuesta de autenticación no tiene la forma esperada', false),
      );
    }
    if (validada.data.responseCode !== 0) {
      // El mensaje del banco puede nombrar al usuario; no se propaga tal cual.
      return fallo(
        errorPuerto(
          'NO_AUTORIZADO',
          'el banco rechazó las credenciales',
          false,
          String(validada.data.responseCode),
        ),
      );
    }

    this.token = validada.data.token;
    this.venceEn = this.calcularVencimiento(validada.data.token);
    return exito(this.token);
  }

  /** Invalida el token en memoria (cierre del proceso, rotación de llave). */
  olvidar(): void {
    this.token = null;
    this.venceEn = 0;
  }

  private calcularVencimiento(token: string): number {
    const exp = leerExp(token);
    const ahora = this.reloj().getTime();
    if (exp === null) {
      return ahora + VIGENCIA_CONSERVADORA_SEGUNDOS * 1000;
    }
    return exp * 1000 - MARGEN_RENOVACION_SEGUNDOS * 1000;
  }
}

/**
 * Lee el `exp` del JWT **sin verificar la firma**.
 *
 * No hace falta verificarla: el token nos lo dio el banco por un canal
 * autenticado y solo se lo devolvemos a él. Se lee el `exp` para saber cuándo
 * renovar, no para tomar ninguna decisión de seguridad.
 */
export function leerExp(token: string): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) {
    return null;
  }
  const payload = partes[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof json !== 'object' || json === null || !('exp' in json)) {
      return null;
    }
    const { exp } = json;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
