/**
 * Siembra el emulador con cobros de demostración.
 *
 * No escribe documentos a mano: usa los **casos de uso reales**
 * (`emitirQr`, `enviarQr`) con el `QrProvider` de mock. Así los cobros
 * sembrados pasan por la máquina de estados de verdad y quedan con su rastro de
 * evidencia — si sembráramos los documentos directo, el demo probaría la forma
 * de los datos pero no el sistema.
 *
 * Cumple lo que `docs/05 §5` prometía: datos sintéticos para el entorno local.
 */

import { construirPuertos, describirError } from '@mqs/composicion';
import {
  MessagingProviderEnMemoria,
  aDecimalBob,
  emitirQr,
  enviarQr,
  esExito,
  type Cobro,
} from '@mqs/qr-core';

import { bs, conectarAlEmulador, telefonoParaMostrar } from './comun.js';

const AHORA = new Date();
const HORA = 3_600_000;

/** Los cobros del demo. Datos inventados: ningún cliente real acá. */
const SEMILLA: readonly { readonly id: string; readonly monto: number; readonly concepto: string; readonly horasDeVigencia: number }[] = [
  { id: 'demo-001', monto: 15_000, concepto: 'Consulta odontológica', horasDeVigencia: 72 },
  { id: 'demo-002', monto: 4_550, concepto: 'Delivery pedido #4482', horasDeVigencia: 72 },
  { id: 'demo-003', monto: 120_000, concepto: 'Alquiler de equipo — septiembre', horasDeVigencia: 72 },
  // Este nace ya vencido: sirve para ver al satélite marcarlo VENCIDO.
  { id: 'demo-004', monto: 8_900, concepto: 'Reparación de notebook', horasDeVigencia: -1 },
];

function cobroInicial(semilla: (typeof SEMILLA)[number]): Cobro {
  return {
    id: semilla.id,
    proveedor: 'baneco',
    estado: 'BORRADOR',
    montoCentavos: bs(semilla.monto),
    moneda: 'BOB',
    qrVersion: 0,
    qrVigente: null,
    creadoEn: AHORA,
    telefonoCliente: '+59171234567',
    concepto: semilla.concepto,
  };
}

async function main(): Promise<number> {
  const db = conectarAlEmulador();

  // Persistencia real (emulador) + QR de mock: no hace falta el banco.
  const puertos = construirPuertos({
    env: { ...process.env, QR_PROVIDER: 'mock', PAYMENT_WATCHER: 'simulado', MESSAGING_PROVIDER: 'mock' },
    db,
    // Acá SÍ va el mock de mensajería, al revés que en el satélite.
    //
    // En producción usamos `MensajeriaNoConfigurada`, que falla a propósito para
    // que nadie crea que el cliente fue avisado. Pero en el demo estamos
    // simulando el mundo entero —el banco incluido—, y si el envío fallara el
    // cobro se quedaría en QR_ACTIVO: `enviarQr` no transiciona a ENVIADO si el
    // mensaje no salió, y con razón, porque "ENVIADO" significa que salió.
    // Sin este mock no habría nada que el satélite pudiera mirar.
    mensajeria: new MessagingProviderEnMemoria(),
  });
  if (!esExito(puertos)) {
    console.error(`✖ ${describirError(puertos.error)}`);
    return 1;
  }
  const deps = puertos.valor.deps;

  console.log('▶ Sembrando cobros de demostración');
  console.log(`  Adaptadores: ${puertos.valor.resumen}\n`);

  for (const semilla of SEMILLA) {
    const venceEn = new Date(AHORA.getTime() + semilla.horasDeVigencia * HORA);

    const emitido = await emitirQr(deps, cobroInicial(semilla), venceEn, AHORA);
    if (!esExito(emitido)) {
      console.error(`  ✖ ${semilla.id}: no se pudo emitir el QR (${emitido.error.tipo})`);
      continue;
    }

    const enviado = await enviarQr(deps, emitido.valor, AHORA);
    if (!esExito(enviado)) {
      console.error(`  ✖ ${semilla.id}: no se pudo enviar el QR (${enviado.error.tipo})`);
      continue;
    }
    const cobro = enviado.valor;

    const vigencia = semilla.horasDeVigencia < 0 ? 'YA VENCIDO' : `${String(semilla.horasDeVigencia)} h`;
    console.log(
      `  ✓ ${cobro.id}  ${cobro.estado.padEnd(9)} Bs ${aDecimalBob(cobro.montoCentavos).padStart(9)}  ` +
        `qr=${cobro.qrVigente?.referenciaProveedor ?? '—'}  vence en ${vigencia}`,
    );
    console.log(`      ${semilla.concepto} · ${telefonoParaMostrar(cobro.telefonoCliente)}`);
  }

  console.log('\n  Los cobros quedaron en ENVIADO, listos para que el satélite los mire.');
  console.log('  (El envío por WhatsApp está simulado: wa-bridge no existe — docs/04 §2.)');
  console.log('  Simulá un pago con:  npm run demo:pagar -- demo-001');
  return 0;
}

const codigo = await main();
process.exit(codigo);
