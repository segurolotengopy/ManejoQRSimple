/**
 * Simula que un cliente pagó: escribe el abono en `abonos/*`.
 *
 * Es exactamente lo que hará el `yape-scraper` cuando exista, y lo que el banco
 * reporta por `statusQR` en el riel Baneco. El sistema no distingue: para el
 * dominio es una detección más, que **todavía tiene que conciliar**.
 *
 * Por eso el demo sirve para probar de verdad: si simulás un pago por un monto
 * distinto, el cobro va a `EN_REVISION` en vez de confirmarse. Probalo.
 *
 * Uso:
 *   npm run demo:pagar -- demo-001            # paga el monto exacto
 *   npm run demo:pagar -- demo-001 --monto 1  # paga 1 centavo de menos
 */

import { aDecimalBob, esExito } from '@mqs/qr-core';
import { COLECCION_ABONOS, documentoACobro } from '@mqs/firestore-store';
import { Timestamp } from 'firebase-admin/firestore';

import { conectarAlEmulador } from './comun.js';

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<number> {
  const cobroId = process.argv[2];
  if (cobroId === undefined || cobroId.startsWith('--')) {
    console.error('Uso: npm run demo:pagar -- <cobroId> [--monto <centavos>] [--tarde]');
    return 1;
  }

  const db = conectarAlEmulador();

  const doc = await db.collection('cobros').doc(cobroId).get();
  if (!doc.exists) {
    console.error(`✖ No existe el cobro ${cobroId}. ¿Corriste \`npm run demo\` para sembrar?`);
    return 1;
  }

  const cobro = documentoACobro(cobroId, doc.data());
  if (!esExito(cobro)) {
    console.error(`✖ El cobro ${cobroId} no tiene la forma esperada: ${cobro.error.motivo}`);
    return 1;
  }
  const qr = cobro.valor.qrVigente;
  if (qr === null) {
    console.error(`✖ El cobro ${cobroId} no tiene QR emitido, así que nadie pudo pagarlo.`);
    return 1;
  }

  const montoManual = argumento('--monto');
  const montoCentavos = montoManual === null ? cobro.valor.montoCentavos : Number(montoManual);
  if (!Number.isInteger(montoCentavos) || montoCentavos < 0) {
    console.error('✖ --monto tiene que ser un entero de centavos.');
    return 1;
  }

  // `--tarde` sitúa el abono después del vencimiento, para ver la conciliación
  // rechazarlo por fuera de vigencia.
  const tarde = process.argv.includes('--tarde');
  const ocurridoEn = tarde ? new Date(qr.venceEn.getTime() + 3_600_000) : new Date();

  // El id del documento es la clave de deduplicación (regla #7): repetir este
  // comando con los mismos datos no crea un segundo abono.
  const idDeduplicacion = `simulado:${qr.referenciaProveedor}:${String(montoCentavos)}`;

  await db
    .collection(COLECCION_ABONOS)
    .doc(idDeduplicacion)
    .set({
      referenciaProveedor: qr.referenciaProveedor,
      montoCentavos,
      ocurridoEn: Timestamp.fromDate(ocurridoEn),
      origen: 'watcher-baneco',
      referencia: cobro.valor.concepto,
    });

  console.log(`▶ Abono simulado para ${cobroId}`);
  console.log(`  QR:      ${qr.referenciaProveedor}`);
  console.log(`  Monto:   Bs ${aDecimalBob(cobro.valor.montoCentavos)} esperado`);
  console.log(`           Bs ${(montoCentavos / 100).toFixed(2)} pagado`);
  console.log(`  Momento: ${ocurridoEn.toISOString()}${tarde ? '  (después del vencimiento)' : ''}`);
  console.log(`  Clave:   ${idDeduplicacion}`);

  const coincide = montoCentavos === cobro.valor.montoCentavos;
  console.log(
    `\n  ${coincide && !tarde ? 'Debería CONFIRMAR' : 'NO debería conciliar → EN_REVISION'} en la próxima pasada.`,
  );
  console.log('  Corré:  npm run satelite:demo');
  return 0;
}

const codigo = await main();
process.exit(codigo);
