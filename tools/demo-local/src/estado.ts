/**
 * Muestra el estado de los cobros y su evidencia.
 *
 * Es la ventana al sistema sin abrir la UI del emulador. Imprime el rastro
 * append-only completo de cada cobro, que es lo que hace auditable al demo:
 * se ve **por qué** cada cobro está donde está.
 */

import { EvidenceStoreFirestore, documentoACobro } from '@mqs/firestore-store';
import { aDecimalBob, esExito } from '@mqs/qr-core';

import { conectarAlEmulador, telefonoParaMostrar } from './comun.js';

const SIMBOLO: Readonly<Record<string, string>> = {
  BORRADOR: '·',
  QR_ACTIVO: '○',
  ENVIADO: '→',
  COMPROBANTE_RECIBIDO: '✉',
  PAGO_DETECTADO: '?',
  CONFIRMADO: '✓',
  EN_REVISION: '!',
  RECHAZADO: '✗',
  VENCIDO: '⏱',
  ANULADO: '⊘',
};

async function main(): Promise<number> {
  const db = conectarAlEmulador();
  const evidencia = new EvidenceStoreFirestore(db);

  const snapshot = await db.collection('cobros').orderBy('__name__').get();
  if (snapshot.empty) {
    console.log('No hay cobros. Sembrá con `npm run demo`.');
    return 0;
  }

  console.log(`▶ ${String(snapshot.size)} cobro(s) en el emulador\n`);

  for (const doc of snapshot.docs) {
    const cobro = documentoACobro(doc.id, doc.data());
    if (!esExito(cobro)) {
      console.log(`  ✖ ${doc.id}: documento con forma inesperada`);
      continue;
    }
    const c = cobro.valor;
    console.log(
      `${SIMBOLO[c.estado] ?? '?'} ${c.id}  ${c.estado.padEnd(20)} ` +
        `Bs ${aDecimalBob(c.montoCentavos).padStart(9)}  qrVersion=${String(c.qrVersion)}`,
    );
    console.log(`    ${c.concepto} · ${telefonoParaMostrar(c.telefonoCliente)}`);

    const registros = await evidencia.listarDeCobro(c.id);
    if (esExito(registros)) {
      for (const r of registros.valor) {
        const datos = Object.entries(r.datos)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' ');
        console.log(
          `      ${r.registradoEn.toISOString()}  ${r.desde} → ${r.hacia}  ` +
            `[${r.evento} · ${r.origen}]${datos === '' ? '' : `  ${datos}`}`,
        );
      }
    }
    console.log();
  }

  const abonos = await db.collection('abonos').get();
  console.log(`▶ ${String(abonos.size)} abono(s) simulado(s) en \`abonos/*\``);
  for (const doc of abonos.docs) {
    console.log(`  ${doc.id}`);
  }
  return 0;
}

const codigo = await main();
process.exit(codigo);
