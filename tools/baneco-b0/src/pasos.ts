/**
 * Los sondeos del Hito B0 contra el ambiente de certificación.
 *
 * Cada paso responde una pregunta concreta de `01-preguntas-al-banco.md` y
 * devuelve un `Hallazgo`. Ninguno lanza: un paso que falla registra el
 * resultado y deja seguir a los demás, salvo la autenticación, sin la cual no
 * hay nada más que probar.
 *
 * Reglas duras de esta herramienta:
 * - **Nunca reintenta de forma agresiva.** El usuario API del banco puede
 *   bloquearse por intentos fallidos (pregunta B4); un script que insiste es
 *   peor que uno que se rinde y reporta.
 * - **Todo QR que crea, lo anula.** Los sondeos dejan objetos reales en el
 *   ambiente del banco; hay que limpiarlos.
 * - Los montos de prueba son de 1 BOB.
 */

import {
  cifrar,
  ESTADO_QR,
  leerExp,
  type ClienteBaneco,
  type ConfigBaneco,
  type ProveedorDeToken,
} from '@mqs/baneco-gateway';
import { aDecimalBob, centavos, esExito, type Centavos } from '@mqs/qr-core';

import { sobreDe, type Grabador } from './grabador.js';
import type { CodigoObservado, Hallazgo } from './hallazgos.js';

export type Contexto = {
  readonly config: ConfigBaneco;
  readonly cliente: ClienteBaneco;
  readonly tokens: ProveedorDeToken;
  readonly grabador: Grabador;
  readonly codigos: CodigoObservado[];
  readonly ahora: Date;
};

const UN_BOLIVIANO = 100;
const DIA_MS = 86_400_000;

function monto(valorEnCentavos: number): Centavos {
  const r = centavos(valorEnCentavos);
  if (!esExito(r)) {
    throw new Error('monto de sondeo inválido');
  }
  return r.valor;
}

/** Identificador de las transacciones de prueba: reconocible en el extracto. */
function transactionId(ctx: Contexto, n: number): string {
  const fecha = ctx.ahora.toISOString().slice(0, 10).replace(/-/g, '');
  return `B0-${fecha}-${String(n)}`;
}

/** Registra un `responseCode` observado para el catálogo empírico (E1). */
function anotarCodigo(ctx: Contexto, operacion: string, contexto: string): void {
  const cruda = ctx.grabador.ultima(operacion === 'authenticate' ? '/authenticate' : operacion);
  const sobre = cruda === null ? null : sobreDe(cruda.cuerpo);
  if (sobre !== null && sobre.codigo !== '0') {
    ctx.codigos.push({ operacion, codigo: sobre.codigo, mensaje: sobre.mensaje, contexto });
  }
}

/**
 * P1 — Autenticación. Confirma de paso el esquema de cifrado.
 *
 * Que el login funcione **es** la validación del AES: el banco descifra con su
 * llave el password que ciframos nosotros. Si lo acepta, el esquema
 * —AES-256-CBC, PKCS7, IV de 16 bytes antepuesto, Base64— es el correcto.
 * No hace falta el endpoint utilitario, cuyo contrato además no está en
 * ninguna fuente documentada de este repositorio.
 */
export async function autenticar(ctx: Contexto): Promise<{
  readonly ok: boolean;
  readonly hallazgos: readonly Hallazgo[];
}> {
  const token = await ctx.tokens.renovar();
  anotarCodigo(ctx, 'authenticate', 'login inicial');

  if (!esExito(token)) {
    // Que no se pueda llegar al banco no refuta nada: distinguir "no llegué" de
    // "me rechazaron" es la diferencia entre un informe útil y uno que miente.
    const alcanzado = token.error.tipo !== 'INDISPONIBLE';
    const detalle = alcanzado
      ? `El banco rechazó el login (${token.error.tipo}` +
        `${token.error.codigoProveedor === null ? '' : `, responseCode ${token.error.codigoProveedor}`}). ` +
        'Puede ser que las credenciales de ejemplo de la especificación no sirvan y haga ' +
        'falta un usuario de certificación propio, o que el esquema de cifrado no sea el ' +
        'asumido. No se reintenta: el usuario API puede bloquearse (pregunta B4).'
      : `No se pudo contactar al ambiente de certificación (${token.error.mensaje}). ` +
        'No es un rechazo del banco: revisá conectividad, VPN o la URL base antes de ' +
        'sacar conclusiones sobre credenciales o cifrado.';

    return {
      ok: false,
      hallazgos: [
        {
          pregunta: 'A3',
          titulo: 'Autenticación en certificación con las credenciales disponibles',
          veredicto: alcanzado ? 'REFUTADO' : 'NO_CONCLUYENTE',
          detalle,
        },
        {
          pregunta: 'B2',
          titulo: 'Esquema de cifrado AES-256-CBC con IV antepuesto',
          veredicto: 'NO_CONCLUYENTE',
          detalle: alcanzado
            ? 'Sin un login exitoso no se puede distinguir un problema de credenciales de uno de cifrado.'
            : 'El banco no fue alcanzado, así que el esquema no llegó a probarse.',
        },
      ],
    };
  }

  const exp = leerExp(token.valor);
  const vigencia =
    exp === null
      ? 'El token no declara un `exp` legible; el cliente cae a una vigencia conservadora de 4 minutos.'
      : `El token declara \`exp\` = ${String(exp)} (${new Date(exp * 1000).toISOString()}), ` +
        `es decir ${String(Math.round((exp * 1000 - ctx.ahora.getTime()) / 60_000))} minutos desde la emisión.`;

  return {
    ok: true,
    hallazgos: [
      {
        pregunta: 'A3',
        titulo: 'Autenticación en certificación con las credenciales disponibles',
        veredicto: 'CONFIRMADO',
        detalle: 'El banco aceptó el login en el ambiente de certificación.',
      },
      {
        pregunta: 'B2',
        titulo: 'Esquema de cifrado AES-256-CBC, PKCS7, IV de 16 bytes antepuesto, Base64',
        veredicto: 'CONFIRMADO',
        detalle:
          'El banco descifró con su llave el password que ciframos con este esquema y aceptó ' +
          'el login. Es la validación end-to-end del módulo `crypto/aes.ts`.',
      },
      {
        pregunta: 'B1',
        titulo: 'Vigencia real del JWT',
        veredicto: exp === null ? 'NO_CONCLUYENTE' : 'CONFIRMADO',
        detalle: vigencia,
      },
    ],
  };
}

export type QrDePrueba = {
  readonly qrId: string;
  readonly imagenBase64: string | null;
};

/** P2 — Genera un QR de prueba de 1 BOB con vigencia de 72 h. */
export async function generarQrDePrueba(
  ctx: Contexto,
  n: number,
  diasDeVigencia: number,
): Promise<{ readonly qr: QrDePrueba | null; readonly hallazgo: Hallazgo | null }> {
  const venceEn = new Date(ctx.ahora.getTime() + diasDeVigencia * DIA_MS);
  const resultado = await ctx.cliente.generarQr({
    transactionId: transactionId(ctx, n),
    accountCredit: cifrarCuenta(ctx),
    currency: 'BOB',
    amount: aDecimalBob(monto(UN_BOLIVIANO)),
    description: `Sondeo B0 ${String(diasDeVigencia)}d`,
    dueDate: fechaBoliviana(venceEn),
    singleUse: true,
    modifyAmount: false,
  });
  anotarCodigo(ctx, 'generateQR', `vigencia de ${String(diasDeVigencia)} días`);

  if (!esExito(resultado)) {
    return {
      qr: null,
      hallazgo: {
        pregunta: 'C1',
        titulo: `Vigencia de \`dueDate\` de ${String(diasDeVigencia)} días`,
        veredicto: 'REFUTADO',
        detalle:
          `El banco rechazó generar un QR con ${String(diasDeVigencia)} días de vigencia ` +
          `(${resultado.error.tipo}${resultado.error.codigoProveedor === null ? '' : `, responseCode ${resultado.error.codigoProveedor}`}).`,
      },
    };
  }

  return {
    qr: { qrId: resultado.valor.qrId, imagenBase64: resultado.valor.qrImageBase64 },
    hallazgo: null,
  };
}

/** P3 — Estado de un QR recién creado: se espera 0 (activo). */
export async function estadoInicial(ctx: Contexto, qrId: string): Promise<Hallazgo> {
  const estado = await ctx.cliente.estadoQr(qrId);
  anotarCodigo(ctx, 'statusQR', 'consulta de QR recién creado');

  if (!esExito(estado)) {
    return {
      pregunta: 'V4',
      titulo: 'Forma de la respuesta de `statusQR` (`statusQrCode` vs `statusQRCode`)',
      veredicto: 'REFUTADO',
      detalle: `La consulta falló: ${estado.error.tipo} — ${estado.error.mensaje}.`,
    };
  }

  const cual = nombreDelCampoDeEstado(ctx);
  return {
    pregunta: 'V4',
    titulo: 'Forma de la respuesta de `statusQR`',
    veredicto: estado.valor.estado === ESTADO_QR.ACTIVO ? 'CONFIRMADO' : 'NO_CONCLUYENTE',
    detalle:
      `Un QR recién creado informa estado ${String(estado.valor.estado)} ` +
      `(se esperaba ${String(ESTADO_QR.ACTIVO)} = activo). ` +
      `El banco usa el campo \`${cual}\`.`,
  };
}

/** P4 — Anulación, re-consulta y doble anulación (preguntas C4 y C5). */
export async function anularYReconsultar(
  ctx: Contexto,
  qrId: string,
): Promise<readonly Hallazgo[]> {
  const hallazgos: Hallazgo[] = [];

  const primera = await ctx.cliente.anularQr(qrId);
  anotarCodigo(ctx, 'cancelQR', 'primera anulación');

  if (!esExito(primera)) {
    return [
      {
        pregunta: 'C5',
        titulo: 'Anulación de un QR vigente',
        veredicto: 'REFUTADO',
        detalle: `El banco rechazó anular un QR activo: ${primera.error.tipo}.`,
      },
    ];
  }

  const estado = await ctx.cliente.estadoQr(qrId);
  anotarCodigo(ctx, 'statusQR', 'consulta tras anular');
  hallazgos.push({
    pregunta: 'C4',
    titulo: 'Estado que informa un QR anulado',
    veredicto: esExito(estado) && estado.valor.estado === ESTADO_QR.ANULADO ? 'CONFIRMADO' : 'NO_CONCLUYENTE',
    detalle: esExito(estado)
      ? `Tras anular, \`statusQR\` informa ${String(estado.valor.estado)} (se esperaba ${String(ESTADO_QR.ANULADO)}).`
      : `La re-consulta falló: ${estado.error.tipo}.`,
  });

  const segunda = await ctx.cliente.anularQr(qrId);
  anotarCodigo(ctx, 'cancelQR', 'segunda anulación del mismo QR');
  hallazgos.push({
    pregunta: 'C5',
    titulo: 'Doble anulación del mismo QR',
    veredicto: 'CONFIRMADO',
    detalle: esExito(segunda)
      ? 'Anular dos veces el mismo QR devuelve éxito: la operación es idempotente, que es lo que el reintento del adaptador necesita.'
      : `La segunda anulación devuelve error (${segunda.error.tipo}` +
        `${segunda.error.codigoProveedor === null ? '' : `, responseCode ${segunda.error.codigoProveedor}`}). ` +
        'El adaptador debe tratar ese código como éxito idempotente al reintentar.',
  });

  return hallazgos;
}

/** P5 — Unicidad de `transactionId` (pregunta C3). */
export async function probarTransactionIdRepetido(ctx: Contexto, n: number): Promise<Hallazgo> {
  const id = transactionId(ctx, n);
  const cuerpo = {
    transactionId: id,
    accountCredit: cifrarCuenta(ctx),
    currency: 'BOB' as const,
    amount: aDecimalBob(monto(UN_BOLIVIANO)),
    description: 'Sondeo B0 transactionId repetido',
    dueDate: fechaBoliviana(new Date(ctx.ahora.getTime() + DIA_MS)),
    singleUse: true,
    modifyAmount: false,
  };

  const primero = await ctx.cliente.generarQr(cuerpo);
  const segundo = await ctx.cliente.generarQr(cuerpo);
  anotarCodigo(ctx, 'generateQR', 'transactionId repetido');

  // Limpieza: los dos QRs que hayan quedado creados se anulan.
  for (const r of [primero, segundo]) {
    if (esExito(r)) {
      await ctx.cliente.anularQr(r.valor.qrId);
    }
  }

  if (esExito(primero) && !esExito(segundo)) {
    return {
      pregunta: 'C3',
      titulo: 'Unicidad de `transactionId`',
      veredicto: 'CONFIRMADO',
      detalle:
        'El banco rechaza un `transactionId` repetido' +
        `${segundo.error.codigoProveedor === null ? '' : ` con responseCode ${segundo.error.codigoProveedor}`}. ` +
        'La unicidad la valida el banco, así que sirve de defensa contra doble emisión.',
    };
  }
  if (esExito(primero) && esExito(segundo)) {
    return {
      pregunta: 'C3',
      titulo: 'Unicidad de `transactionId`',
      veredicto: 'REFUTADO',
      detalle:
        'El banco **acepta** dos QRs con el mismo `transactionId`. La unicidad queda ' +
        'enteramente de nuestro lado: hay que garantizarla antes de emitir.',
    };
  }
  return {
    pregunta: 'C3',
    titulo: 'Unicidad de `transactionId`',
    veredicto: 'NO_CONCLUYENTE',
    detalle: 'La primera generación ya falló, así que no se pudo probar el duplicado.',
  };
}

/**
 * P6 — Escalera de vigencias para encontrar el máximo de `dueDate` (pregunta C1).
 *
 * Escalera y no bisección real: cada paso crea un QR en el ambiente del banco,
 * y una bisección fina crearía muchos más objetos para afinar un número que de
 * todos modos hay que confirmar por escrito.
 */
export async function sondearVigenciaMaxima(ctx: Contexto): Promise<readonly Hallazgo[]> {
  const escalones = [7, 30, 90, 365];
  const aceptados: number[] = [];
  const rechazados: number[] = [];

  for (const [i, dias] of escalones.entries()) {
    const { qr } = await generarQrDePrueba(ctx, 100 + i, dias);
    if (qr === null) {
      rechazados.push(dias);
      continue;
    }
    aceptados.push(dias);
    await ctx.cliente.anularQr(qr.qrId);
  }

  const maximo = aceptados.length === 0 ? null : Math.max(...aceptados);
  return [
    {
      pregunta: 'C1',
      titulo: 'Vigencia máxima admitida en `dueDate`',
      veredicto: maximo === null ? 'NO_CONCLUYENTE' : 'CONFIRMADO',
      detalle:
        `Aceptados: ${aceptados.length === 0 ? 'ninguno' : `${aceptados.join(', ')} días`}. ` +
        `Rechazados: ${rechazados.length === 0 ? 'ninguno' : `${rechazados.join(', ')} días`}. ` +
        (maximo === null
          ? 'No se pudo generar ningún QR, así que el máximo queda sin determinar.'
          : `El máximo observado en esta escalera es ${String(maximo)} días; el límite exacto ` +
            'sigue necesitando confirmación escrita del banco.'),
    },
  ];
}

/** El banco espera la cuenta de abono cifrada (manual §4.1, regla #4). */
function cifrarCuenta(ctx: Contexto): string {
  return cifrar(ctx.config.cuentaAbono.revelar(), ctx.config.llave);
}

/** `yyyy-MM-dd` en hora boliviana, como espera `dueDate`. */
function fechaBoliviana(fecha: Date): string {
  return new Date(fecha.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
}

/** Detecta con qué mayúsculas nombró el banco el campo de estado (V4). */
function nombreDelCampoDeEstado(ctx: Contexto): string {
  const cruda = ctx.grabador.ultima('/statusQR/');
  if (cruda === null || typeof cruda.cuerpo !== 'object' || cruda.cuerpo === null) {
    return 'desconocido';
  }
  const claves = Object.keys(cruda.cuerpo);
  return claves.find((k) => k.toLowerCase() === 'statusqrcode') ?? 'ninguno de los dos';
}
