/**
 * Configuración del adaptador, leída del entorno.
 *
 * Ningún valor de acá se registra nunca: la llave AES, la contraseña y la
 * cuenta de abono son secretos (regla #2 y análisis §6.1). `describir()`
 * existe para poder loguear *algo* sin filtrar nada.
 */

import { esExito, exito, fallo, type Resultado } from '@mqs/qr-core';

import { llaveAes, type LlaveAes } from './crypto/aes.js';
import { Secreto } from './secreto.js';

export type Ambiente = 'cert' | 'prod';

export type ConfigBaneco = {
  readonly ambiente: Ambiente;
  readonly baseUrl: string;
  readonly usuario: string;
  /** Se cifra recién al autenticar. Envuelta para que no se pueda loguear. */
  readonly password: Secreto;
  readonly llave: LlaveAes;
  /** Se cifra en cada `generateQR`. Envuelta por el mismo motivo. */
  readonly cuentaAbono: Secreto;
  readonly ttlQrHoras: number;
  readonly branchCode: string | null;
};

export type ErrorConfig =
  | { readonly tipo: 'FALTA_VARIABLE'; readonly variable: string }
  | { readonly tipo: 'VARIABLE_INVALIDA'; readonly variable: string; readonly motivo: string }
  /** El host es el de producción. Solo el host: la URL puede traer usuario y clave. */
  | { readonly tipo: 'URL_DE_PRODUCCION_EN_CERT'; readonly host: string }
  /** En certificación solo se habla con el host de certificación o con uno local. */
  | { readonly tipo: 'HOST_NO_PERMITIDO_EN_CERT'; readonly host: string };

/**
 * Host de producción. Se usa **solo** para negarse a hablarle desde `cert`.
 *
 * Los hitos B0 y B1 no tocan producción, y un `.env` mal copiado es la forma
 * más fácil de que eso pase sin que nadie se dé cuenta.
 */
const HOST_PRODUCCION = 'apimkt.baneco.com.bo';

/** El único host del banco con el que `cert` puede hablar (verificación V1). */
const HOST_CERTIFICACION = 'apimktdesa.baneco.com.bo';

/**
 * ¿Puede `cert` hablarle a este host? **Lista de permitidos, no de bloqueados**:
 * un host que no se reconoce no se llama, así que un alias, una IP, un punto
 * final o un usuario antes de la arroba (`https://apimktdesa…@apimkt…`) no
 * llegan a producción. Se compara el `hostname` que entiende `new URL()`, ya
 * en minúsculas, y no un texto que «contenga» el host.
 *
 * Permitidos: el host de certificación, por `https`; y `localhost` y el
 * loopback, para los bancos simulados y las pruebas. **No** los dominios
 * `.test` ni `.localhost`: salen al resolver de DNS, y en una red hostil (o sin
 * `systemd-resolved`) pueden apuntar a un tercero que recibiría el login.
 */
function hostPermitidoEnCert(url: URL): boolean {
  const host = url.hostname;
  if (host === HOST_CERTIFICACION) {
    return url.protocol === 'https:';
  }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return loopback && (url.protocol === 'https:' || url.protocol === 'http:');
}

/**
 * URL de producción del API Gateway de Baneco.
 *
 * Es **del banco, no de cada usuario API** (dato del dueño, 2026-09-18): la
 * misma para toda cuenta de cobro. Por eso vive acá y no en el archivo de
 * credenciales de cada cuenta, que queda solo con lo que sí cambia —usuario,
 * contraseña, llave y cuenta de abono—. `BANECO_PROD_BASE_URL` sigue
 * existiendo para el día en que el banco la mueva.
 */
export const URL_PRODUCCION = 'https://apimkt.baneco.com.bo/apiGateway';

/**
 * Un marcador `<…>` sin reemplazar no es un valor: vale lo mismo que la
 * variable ausente.
 *
 * Importa más de lo que parece con la contraseña: intentar el login con el
 * texto de la plantilla es un intento fallido, y el usuario API se bloquea con
 * intentos fallidos (pregunta B4). Mejor no arrancar.
 */
function esMarcador(valor: string): boolean {
  return valor.startsWith('<') && valor.endsWith('>');
}

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
    const valor = entorno[variable]?.trim();
    if (valor === undefined || valor === '') {
      return fallo({ tipo: 'FALTA_VARIABLE', variable });
    }
    if (esMarcador(valor)) {
      // Error distinto del que falta a propósito: "falta" sobre una línea que
      // el dueño sabe que completó lo empuja a editar el valor de verdad, y el
      // reintento siguiente es un login fallido — justo lo que hay que evitar.
      return fallo({
        tipo: 'VARIABLE_INVALIDA',
        variable,
        motivo:
          'parece un marcador <…> de la plantilla sin reemplazar. Si tu valor real ' +
          'empieza con "<" y termina con ">", es un falso positivo: avisá antes de ' +
          'cambiarlo, porque un login fallido acerca al bloqueo del usuario API (B4)',
      });
    }
    return exito(valor);
  };

  /** Igual que `requerida`, pero devuelve el valor ya envuelto en `Secreto`. */
  const secretoRequerido = (sufijo: string): Resultado<Secreto, ErrorConfig> => {
    const leido = requerida(sufijo);
    return esExito(leido) ? exito(new Secreto(leido.valor)) : leido;
  };

  // En producción la URL la sabe el sistema: es del banco, no de cada cuenta.
  // En certificación sigue siendo obligatoria — la de desarrollo cambió de
  // mayúsculas entre documentos (verificación V1) y no se adivina.
  // El valor por defecto es para la variable **ausente**, no para una declarada
  // y descartada: una URL nueva pegada con los `<>` del correo se caería en
  // silencio a la vieja, y el síntoma parecería una falla del banco.
  const leida = requerida('BASE_URL');
  const baseUrl =
    !esExito(leida) && leida.error.tipo === 'FALTA_VARIABLE' && ambiente === 'prod'
      ? exito(URL_PRODUCCION)
      : leida;
  if (!esExito(baseUrl)) return baseUrl;

  // Rail de seguridad: en certificación solo se le habla a hosts permitidos.
  // Los errores llevan el host y nunca la URL: puede traer usuario y clave.
  if (ambiente === 'cert') {
    let url: URL;
    try {
      url = new URL(baseUrl.valor);
    } catch {
      return fallo({
        tipo: 'VARIABLE_INVALIDA',
        variable: `${prefijo}BASE_URL`,
        motivo: 'no es una URL válida',
      });
    }
    if (url.hostname === HOST_PRODUCCION) {
      return fallo({ tipo: 'URL_DE_PRODUCCION_EN_CERT', host: url.hostname });
    }

    // Un usuario o una clave dentro de la URL acabarían en los logs y en los
    // mensajes de B0: la URL base no los lleva.
    if (url.username !== '' || url.password !== '') {
      return fallo({
        tipo: 'VARIABLE_INVALIDA',
        variable: `${prefijo}BASE_URL`,
        motivo: 'la URL no puede traer usuario ni clave',
      });
    }
    if (!hostPermitidoEnCert(url)) {
      return fallo({ tipo: 'HOST_NO_PERMITIDO_EN_CERT', host: url.hostname });
    }
  }

  const usuario = requerida('USERNAME');
  if (!esExito(usuario)) return usuario;

  // Los secretos se envuelven **en el momento de leerlos**: nunca existen como
  // `string` suelto en una variable de esta función, ni siquiera de paso.
  const claveAcceso = secretoRequerido('PASSWORD');
  if (!esExito(claveAcceso)) return claveAcceso;

  const llaveCruda = secretoRequerido('AES_KEY');
  if (!esExito(llaveCruda)) return llaveCruda;

  const llave = llaveAes(llaveCruda.valor.revelar());
  if (!esExito(llave)) {
    return fallo({
      tipo: 'VARIABLE_INVALIDA',
      variable: `${prefijo}AES_KEY`,
      motivo: 'la llave AES debe medir exactamente 32 bytes',
    });
  }

  const cuentaAbono = secretoRequerido('ACCOUNT_CREDIT');
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
    baseUrl: sinBarrasFinales(baseUrl.valor),
    usuario: usuario.valor,
    password: claveAcceso.valor,
    llave: llave.valor,
    cuentaAbono: cuentaAbono.valor,
    ttlQrHoras,
    branchCode: branchCode === undefined || branchCode === '' ? null : branchCode,
  });
}

/**
 * Quita las barras finales de la URL base.
 *
 * A mano y no con `/\/+$/`: ese patrón es vulnerable a backtracking polinómico
 * ante una entrada con muchas barras (CodeQL `js/polynomial-redos`). El origen
 * es una variable de entorno y el riesgo es mínimo, pero el bucle es igual de
 * corto y no tiene el problema.
 */
function sinBarrasFinales(url: string): string {
  let fin = url.length;
  while (fin > 0 && url[fin - 1] === '/') {
    fin -= 1;
  }
  return url.slice(0, fin);
}

/** Descripción segura para logs: sin secretos, ni siquiera ofuscados. */
export function describir(config: ConfigBaneco): string {
  return `Baneco[${config.ambiente}] ${config.baseUrl} ttlQr=${String(config.ttlQrHoras)}h`;
}
