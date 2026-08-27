/**
 * Configuración del adaptador, leída del entorno.
 *
 * Ningún valor de acá se registra nunca: la llave AES, la contraseña y la
 * cuenta de abono son secretos (regla #2 y análisis §6.1). `describir()`
 * existe para poder loguear *algo* sin filtrar nada.
 */

import { esExito, exito, fallo, type Resultado } from '@mqs/qr-core';

import { llaveAes, type LlaveAes } from './crypto/aes.js';

export type Ambiente = 'cert' | 'prod';

export type ConfigBaneco = {
  readonly ambiente: Ambiente;
  readonly baseUrl: string;
  readonly usuario: string;
  /** Contraseña en claro; se cifra recién al autenticar. */
  readonly password: string;
  readonly llave: LlaveAes;
  /** Cuenta de abono en claro; se cifra en cada `generateQR`. */
  readonly cuentaAbono: string;
  readonly ttlQrHoras: number;
  readonly branchCode: string | null;
};

export type ErrorConfig =
  | { readonly tipo: 'FALTA_VARIABLE'; readonly variable: string }
  | { readonly tipo: 'VARIABLE_INVALIDA'; readonly variable: string; readonly motivo: string }
  | { readonly tipo: 'URL_DE_PRODUCCION_EN_CERT'; readonly baseUrl: string };

/**
 * Host de producción. Se usa **solo** para negarse a hablarle desde `cert`.
 *
 * Los hitos B0 y B1 no tocan producción, y un `.env` mal copiado es la forma
 * más fácil de que eso pase sin que nadie se dé cuenta.
 */
const HOST_PRODUCCION = 'apimkt.baneco.com.bo';

export function leerConfig(
  entorno: Readonly<Record<string, string | undefined>>,
): Resultado<ConfigBaneco, ErrorConfig> {
  const ambienteCrudo = entorno['BANECO_ENV'] ?? 'cert';
  if (ambienteCrudo !== 'cert' && ambienteCrudo !== 'prod') {
    return fallo({
      tipo: 'VARIABLE_INVALIDA',
      variable: 'BANECO_ENV',
      motivo: 'debe ser "cert" o "prod"',
    });
  }
  const ambiente: Ambiente = ambienteCrudo;
  const prefijo = ambiente === 'cert' ? 'BANECO_CERT_' : 'BANECO_PROD_';

  const requerida = (sufijo: string): Resultado<string, ErrorConfig> => {
    const variable = `${prefijo}${sufijo}`;
    const valor = entorno[variable];
    if (valor === undefined || valor.trim() === '') {
      return fallo({ tipo: 'FALTA_VARIABLE', variable });
    }
    return exito(valor.trim());
  };

  const baseUrl = requerida('BASE_URL');
  if (!esExito(baseUrl)) return baseUrl;

  // Rail de seguridad: en certificación no se le habla al host de producción.
  if (ambiente === 'cert' && baseUrl.valor.includes(HOST_PRODUCCION)) {
    return fallo({ tipo: 'URL_DE_PRODUCCION_EN_CERT', baseUrl: baseUrl.valor });
  }

  const usuario = requerida('USERNAME');
  if (!esExito(usuario)) return usuario;

  const password = requerida('PASSWORD');
  if (!esExito(password)) return password;

  const llaveCruda = requerida('AES_KEY');
  if (!esExito(llaveCruda)) return llaveCruda;

  const llave = llaveAes(llaveCruda.valor);
  if (!esExito(llave)) {
    return fallo({
      tipo: 'VARIABLE_INVALIDA',
      variable: `${prefijo}AES_KEY`,
      motivo: 'la llave AES debe medir exactamente 32 bytes',
    });
  }

  const cuentaAbono = requerida('ACCOUNT_CREDIT');
  if (!esExito(cuentaAbono)) return cuentaAbono;

  const ttlCrudo = entorno['BANECO_QR_TTL_HORAS'] ?? '72';
  const ttlQrHoras = Number(ttlCrudo);
  if (!Number.isInteger(ttlQrHoras) || ttlQrHoras <= 0) {
    return fallo({
      tipo: 'VARIABLE_INVALIDA',
      variable: 'BANECO_QR_TTL_HORAS',
      motivo: 'debe ser un entero de horas mayor que cero',
    });
  }

  const branchCode = entorno['BANECO_BRANCH_CODE']?.trim();

  return exito({
    ambiente,
    baseUrl: baseUrl.valor.replace(/\/+$/, ''),
    usuario: usuario.valor,
    password: password.valor,
    llave: llave.valor,
    cuentaAbono: cuentaAbono.valor,
    ttlQrHoras,
    branchCode: branchCode === undefined || branchCode === '' ? null : branchCode,
  });
}

/** Descripción segura para logs: sin secretos, ni siquiera ofuscados. */
export function describir(config: ConfigBaneco): string {
  return `Baneco[${config.ambiente}] ${config.baseUrl} ttlQr=${String(config.ttlQrHoras)}h`;
}
