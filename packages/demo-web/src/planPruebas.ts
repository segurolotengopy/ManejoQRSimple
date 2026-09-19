/**
 * El plan de la prueba en producción y su informe.
 *
 * Son las nueve pruebas de `docs/Integraciones/baneco/03-prueba-en-produccion.md`
 * §4. Si cambia una, cambia la otra. El informe es texto Markdown para pegar
 * en `02-hallazgos-produccion.md` (o mandárselo a quien lo documente).
 */

export type Prueba = {
  readonly id: string;
  readonly titulo: string;
  readonly pasos: string;
  readonly esperado: string;
};

export const PRUEBAS: readonly Prueba[] = [
  {
    id: 'P1',
    titulo: 'Autenticación en producción',
    pasos: 'Generá el primer QR.',
    esperado: 'El QR se genera y aparece su imagen: el banco aceptó credenciales y cifrado.',
  },
  {
    id: 'P2',
    titulo: 'Pago desde la app de Banco Económico',
    pasos: 'Escaneá el QR con la app de Baneco, pagá y tocá "Ya pagué".',
    esperado: 'CONFIRMADO en menos de un minuto.',
  },
  {
    id: 'P3',
    titulo: 'Pago desde otro banco',
    pasos: 'Generá otro QR y pagalo desde la app de otro banco.',
    esperado: 'CONFIRMADO. Anotá desde qué banco pagaste.',
  },
  {
    id: 'P4',
    titulo: 'Pagar un QR anulado',
    pasos: 'Generá un QR, tocá "Anular en el banco" e intentá pagarlo.',
    esperado: 'La app del banco rechaza el pago.',
  },
  {
    id: 'P5',
    titulo: 'Pagar dos veces el mismo QR',
    pasos: 'Con el QR ya pagado de P2, intentá pagarlo de nuevo.',
    esperado: 'La app rechaza el segundo pago (QR de un solo uso).',
  },
  {
    id: 'P6',
    titulo: 'Anular un QR ya pagado',
    pasos: 'Sobre el cobro confirmado de P2, tocá "Sondear anulación".',
    esperado: 'El banco lo rechaza. Anotá el responseCode que devuelve.',
  },
  {
    id: 'P7',
    titulo: 'Anular dos veces el mismo QR',
    pasos: 'Sobre el cobro anulado de P4, tocá "Sondear anulación".',
    esperado:
      'Éxito: el adaptador consulta el estado y trata la doble anulación como hecha. El banco en sí ' +
      'responde un código (en Baneco, 403): anotalo desde la pestaña Logs, línea DELETE cancelQR.',
  },
  {
    id: 'P8',
    titulo: 'El vencimiento anula el QR',
    pasos: 'Generá un QR de 5 minutos, no lo pagues, esperá a que venza e intentá pagarlo.',
    esperado: 'VENCIDO con el QR anulado en la evidencia; la app rechaza el pago.',
  },
  {
    id: 'P9',
    titulo: 'Cierre diario (al día siguiente)',
    pasos: 'Dejá el satélite corriendo pasada la medianoche, o arrancalo mañana.',
    esperado: 'El log muestra yaRegistrados con los pagos de hoy y huerfanos=0.',
  },
];

export type ResultadoPrueba = 'pendiente' | 'ok' | 'falla' | 'no-aplica';

export type RegistroPruebas = Readonly<Record<string, { readonly resultado: ResultadoPrueba; readonly nota: string }>>;

export type CobroDelInforme = { readonly id: string; readonly estado: string; readonly monto: string };

const MARCA: Readonly<Record<ResultadoPrueba, string>> = {
  pendiente: '⏳ pendiente',
  ok: '✅ ok',
  falla: '❌ falla',
  'no-aplica': '➖ no aplica',
};

/**
 * El informe de la corrida, en Markdown. Sin datos de quien pagó (regla #4).
 *
 * Encabeza con el **alias** de la cuenta de cobro, no con su número: la prueba
 * se repite entera por cada cuenta nueva, y un informe sin decir de cuál es no
 * se puede archivar.
 */
export function informe(
  fecha: Date,
  registro: RegistroPruebas,
  cobros: readonly CobroDelInforme[],
  cuenta: string,
): string {
  const filas = PRUEBAS.map((p) => {
    const r = registro[p.id] ?? { resultado: 'pendiente', nota: '' };
    const nota = r.nota.replace(/\|/g, '/').replace(/\n/g, ' ');
    return `| ${p.id} | ${p.titulo} | ${MARCA[r.resultado]} | ${nota} |`;
  });
  const lineasCobros = cobros.map((c) => `- \`${c.id.slice(0, 8)}\` — Bs ${c.monto} — ${c.estado}`);
  return [
    `## Prueba en producción — ${fecha.toISOString().slice(0, 10)} — cuenta \`${cuenta}\``,
    '',
    '| # | Prueba | Resultado | Nota |',
    '|---|---|---|---|',
    ...filas,
    '',
    '### Cobros de la corrida',
    '',
    ...(lineasCobros.length === 0 ? ['- (ninguno)'] : lineasCobros),
    '',
  ].join('\n');
}
