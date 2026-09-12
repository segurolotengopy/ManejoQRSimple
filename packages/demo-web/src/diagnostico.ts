/**
 * Diagnóstico de un cobro de prueba: qué está bien y qué hay que anotar.
 *
 * Traduce lo que se ve —estado, evidencia, errores, cuánto hace que se pagó—
 * a problemas concretos, cada uno con qué revisar. No decide nada del cobro:
 * eso lo hace el dominio. Solo ayuda a que la prueba no pase por alto un
 * hallazgo.
 */

import type { Cobro, ErrorApi, RegistroEvidencia } from './api.js';

export type Problema = { readonly nivel: 'error' | 'aviso' | 'ok'; readonly texto: string };

export type EntradaDiagnostico = {
  readonly cobro: Cobro;
  readonly evidencia: readonly RegistroEvidencia[];
  readonly hayImagen: boolean;
  readonly ultimoError: ErrorApi | null;
  /** Cuándo dijo quien prueba que pagó (botón "Ya pagué"). */
  readonly pagoDeclaradoEn: Date | null;
  readonly ahora: Date;
};

const ESPERANDO = new Set(['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO']);

/** El banco dice que el reflejo en statusQR es en línea (D5): un minuto es mucho. */
export const SEGUNDOS_PARA_DETECTAR = 60;
/** Margen para que el satélite anule un QR vencido (su intervalo en la prueba es 10 s). */
export const SEGUNDOS_GRACIA_SATELITE = 90;

const segundos = (desde: Date, hasta: Date): number => Math.floor((hasta.getTime() - desde.getTime()) / 1000);

function textoDeError(error: ErrorApi): string {
  const d = error.detalle;
  if (d?.tipo === 'NO_AUTORIZADO') {
    return (
      'El banco rechazó las credenciales. Revisá usuario, contraseña y llave en el archivo de ' +
      'credenciales. No reintentes en bucle: el usuario API se bloquea y se desbloquea solo en agencia (B4).'
    );
  }
  if (d?.tipo === 'INDISPONIBLE') {
    return `No se llega al banco (${d.mensajeTecnico}). Revisá la conexión y la URL de producción.`;
  }
  if (d !== undefined && d.codigoProveedor !== null) {
    return (
      `El banco rechazó la operación con responseCode ${d.codigoProveedor} (${d.mensajeTecnico}). ` +
      'Anotalo: arma el catálogo de errores que el banco no tiene (E1).'
    );
  }
  return `${error.codigo}: ${error.mensaje}`;
}

/** El último registro de un evento, si hay. */
function ultimo(evidencia: readonly RegistroEvidencia[], evento: string): RegistroEvidencia | undefined {
  return [...evidencia].reverse().find((r) => r.evento === evento);
}

export function diagnosticar(e: EntradaDiagnostico): readonly Problema[] {
  const problemas: Problema[] = [];
  const { cobro, evidencia, ahora } = e;
  const esperando = ESPERANDO.has(cobro.estado);

  if (!e.hayImagen && esperando) {
    problemas.push({
      nivel: 'error',
      texto: 'No hay imagen del QR: el banco no la devolvió o no se pudo guardar. No hay nada que escanear.',
    });
  }

  if (e.ultimoError !== null) {
    problemas.push({ nivel: 'error', texto: textoDeError(e.ultimoError) });
  }

  if (esperando && e.pagoDeclaradoEn !== null) {
    const s = segundos(e.pagoDeclaradoEn, ahora);
    problemas.push(
      s > SEGUNDOS_PARA_DETECTAR
        ? {
            nivel: 'error',
            texto:
              `Pagaste hace ${String(s)} s y el banco todavía no lo reporta. El banco dice que el reflejo ` +
              'es en línea (D5): anotalo como hallazgo, con la hora del pago y el banco desde el que pagaste.',
          }
        : { nivel: 'aviso', texto: `Esperando que el banco reporte el pago (${String(s)} s)…` },
    );
  }

  if (esperando && cobro.qrVigente !== null) {
    const vencidoHace = segundos(new Date(cobro.qrVigente.venceEn), ahora);
    if (vencidoHace > SEGUNDOS_GRACIA_SATELITE) {
      problemas.push({
        nivel: 'aviso',
        texto:
          'El QR venció y el cobro sigue activo. ¿Está corriendo el satélite (npm run prueba:satelite)? ' +
          'Es el que anula el QR en el banco al vencer.',
      });
    }
  }

  switch (cobro.estado) {
    case 'CONFIRMADO': {
      const confirmado = [...evidencia].reverse().find((r) => r.hacia === 'CONFIRMADO');
      const demora =
        e.pagoDeclaradoEn !== null && confirmado !== undefined
          ? ` Se detectó ${String(segundos(e.pagoDeclaradoEn, new Date(confirmado.registradoEn)))} s después de "Ya pagué".`
          : '';
      problemas.push({ nivel: 'ok', texto: `Pago verificado contra el banco y conciliado.${demora}` });
      break;
    }
    case 'EN_REVISION': {
      const motivo = ultimo(evidencia, 'CONCILIACION_FALLIDA')?.datos['motivo'];
      problemas.push({
        nivel: 'aviso',
        texto:
          `El pago fue a revisión${typeof motivo === 'string' ? ` (${motivo})` : ''}. Anotá por qué y ` +
          'resolvelo en la pestaña Revisión.',
      });
      break;
    }
    case 'VENCIDO':
      problemas.push(
        typeof ultimo(evidencia, 'QR_VENCIDO')?.datos['qrAnulado'] === 'string'
          ? { nivel: 'ok', texto: 'Venció y el QR quedó anulado en el banco. Intentá pagarlo: tiene que fallar (prueba 8).' }
          : { nivel: 'error', texto: 'Venció sin constancia de anulación en el banco.' },
      );
      break;
    case 'ANULADO':
      problemas.push(
        typeof ultimo(evidencia, 'ANULADO')?.datos['qrAnulado'] === 'string'
          ? { nivel: 'ok', texto: 'Anulado en el banco. Intentá pagarlo: tiene que fallar (prueba 4).' }
          : { nivel: 'aviso', texto: 'Anulado sin QR que anular en el banco.' },
      );
      break;
    case 'PAGO_DETECTADO':
      problemas.push({
        nivel: 'aviso',
        texto: 'El banco reportó el pago pero la conciliación no terminó. ¿Se cortó un proceso? Verificá de nuevo.',
      });
      break;
    default:
      break;
  }

  return problemas;
}
