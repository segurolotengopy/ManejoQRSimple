/**
 * Fixtures y transporte falso para los tests del adaptador.
 *
 * ⚠️ **Estas respuestas están derivadas de la especificación, NO grabadas
 * contra certificación.** El Hito B0 todavía no corrió: espera credenciales
 * propias (pregunta A3 al banco). Cuando corra, estas fixtures se reemplazan
 * por capturas reales y cualquier diferencia de forma aparecerá como test en
 * rojo — que es exactamente para lo que sirven.
 *
 * Ninguna fixture contiene datos reales: los nombres, cuentas e identificadores
 * son inventados para el test (reglas #2 y #4).
 */

import { exito, type ErrorPuerto, type Resultado } from '@mqs/qr-core';

import type { ConfigBaneco } from '../config.js';
import { llaveAes } from '../crypto/aes.js';
import { Secreto } from '../secreto.js';
import type { PeticionHttp, RespuestaHttp, Transporte } from '../client/http.js';

/** Llave de prueba propia. La del banco nunca entra al repo (regla #2). */
export const LLAVE_DE_PRUEBA = '0123456789abcdef0123456789abcdef';

export const QR_PAGADO = '21061401016000000006';
export const QR_ACTIVO = '21061401016000000007';
export const QR_ANULADO = '21061401016000000009';

/** JWT de juguete: `exp` dentro de una hora. No lo firmó nadie; no hace falta. */
export function jwtDePrueba(expEnSegundos: number): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify({ exp: expEnSegundos })).toString('base64url');
  return `${cabecera}.${cuerpo}.firma-de-juguete`;
}

export const PAGO_DE_EJEMPLO = {
  qrId: QR_PAGADO,
  transactionId: '1236342',
  paymentDate: '2021-06-14T00:00:00',
  paymentTime: '17:06:29',
  currency: 'BOB',
  amount: 150.5,
  senderBankCode: '1016',
  senderName: 'NOMBRE DE PRUEBA',
  // La espec. trae '0' acá, pero un valor de un solo dígito aparece por
  // casualidad en cualquier serialización y volvería vacía la aserción de que
  // este dato NO llega al dominio. Se usa uno distintivo e inventado.
  senderDocumentId: 'DOC-INVENTADO-7654321',
  senderAccount: '******1913',
  description: 'Pago Factura de Prueba 00987',
  branchCode: 'E0001',
} as const;

export function configDePrueba(sobrescribir: Partial<ConfigBaneco> = {}): ConfigBaneco {
  const llave = llaveAes(LLAVE_DE_PRUEBA);
  if (!llave.ok) {
    throw new Error('la llave de prueba debería ser válida');
  }
  return {
    ambiente: 'cert',
    baseUrl: 'https://apimktdesa.baneco.com.bo/ApiGateway',
    usuario: 'usuario-de-prueba',
    password: new Secreto('password-de-prueba'),
    llave: llave.valor,
    cuentaAbono: new Secreto('1234567890'),
    ttlQrHoras: 72,
    branchCode: 'E0001',
    ...sobrescribir,
  };
}

export type PeticionRegistrada = PeticionHttp;

export type OpcionesTransporte = {
  /** Fuerza un 401 en la primera petición autenticada, para probar el reintento. */
  readonly unUnico401?: boolean;
  /** Reemplaza la respuesta de una ruta por otra cosa. */
  readonly sobrescribir?: Readonly<Record<string, RespuestaHttp>>;
};

/**
 * Transporte falso: responde desde las fixtures y registra lo que se le pidió.
 *
 * Los tests nunca tocan la red — misma regla que el scraper: jamás la API viva
 * en CI.
 */
export class TransporteFalso {
  readonly peticiones: PeticionRegistrada[] = [];
  private un401Pendiente: boolean;

  constructor(private readonly opciones: OpcionesTransporte = {}) {
    this.un401Pendiente = opciones.unUnico401 ?? false;
  }

  readonly enviar: Transporte = (peticion): Promise<Resultado<RespuestaHttp, ErrorPuerto>> => {
    this.peticiones.push(peticion);
    const ruta = peticion.url.replace(/^https?:\/\/[^/]+/, '');

    const forzada = this.opciones.sobrescribir?.[ruta];
    if (forzada !== undefined) {
      return Promise.resolve(exito(forzada));
    }

    if (ruta.endsWith('/api/authentication/authenticate')) {
      return Promise.resolve(
        exito({
          status: 200,
          cuerpo: {
            token: jwtDePrueba(Math.floor(Date.now() / 1000) + 3600),
            responseCode: 0,
            message: '',
          },
        }),
      );
    }

    if (this.un401Pendiente) {
      this.un401Pendiente = false;
      return Promise.resolve(exito({ status: 401, cuerpo: null }));
    }

    if (ruta.endsWith('/api/qrsimple/generateQR')) {
      return Promise.resolve(
        exito({
          status: 200,
          cuerpo: { qrId: QR_ACTIVO, qrImage: 'iVBORw0KGgo=', responseCode: 0, message: '' },
        }),
      );
    }

    if (ruta.endsWith('/api/qrsimple/cancelQR')) {
      return Promise.resolve(exito({ status: 200, cuerpo: { responseCode: 0, message: '' } }));
    }

    if (ruta.includes('/api/qrsimple/v2/statusQR/')) {
      const qrId = ruta.slice(ruta.lastIndexOf('/') + 1);
      return Promise.resolve(exito({ status: 200, cuerpo: estadoDe(qrId) }));
    }

    if (ruta.includes('/api/qrsimple/v2/paidQR/')) {
      return Promise.resolve(
        exito({
          status: 200,
          cuerpo: { paymentList: [PAGO_DE_EJEMPLO], responseCode: 0, message: '' },
        }),
      );
    }

    return Promise.resolve(exito({ status: 404, cuerpo: null }));
  };
}

function estadoDe(qrId: string): unknown {
  if (qrId === QR_PAGADO) {
    return { statusQrCode: 1, payment: [PAGO_DE_EJEMPLO], responseCode: 0, message: '' };
  }
  if (qrId === QR_ANULADO) {
    return { statusQrCode: 9, payment: [], responseCode: 0, message: '' };
  }
  // Todo lo demás: activo, pendiente de pago.
  return { statusQrCode: 0, payment: [], responseCode: 0, message: '' };
}
