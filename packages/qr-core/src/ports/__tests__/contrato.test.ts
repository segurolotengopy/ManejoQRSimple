/**
 * Corre los casos de contrato contra los adaptadores en memoria.
 *
 * `baneco-gateway` y `yape-scraper` importarán estos mismos casos desde
 * `@mqs/qr-core` y los correrán contra sus fixtures grabadas. Si un caso pasa
 * acá y falla allá, el problema es del adaptador, no del contrato.
 */

import { describe, expect, it } from 'vitest';

import {
  CASOS_COBRO_REPOSITORY,
  CASOS_EVIDENCE_STORE,
  CASOS_PAYMENT_WATCHER,
  CASOS_QR_PROVIDER,
} from '../contrato.js';
import {
  CobroRepositoryEnMemoria,
  EvidenceStoreEnMemoria,
  PaymentWatcherEnMemoria,
  QrProviderEnMemoria,
} from '../mocks.js';

describe('contrato de QrProvider', () => {
  it.each(CASOS_QR_PROVIDER)('$nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new QrProviderEnMemoria())).resolves.toBeUndefined();
  });
});

describe('contrato de PaymentWatcher', () => {
  it.each(CASOS_PAYMENT_WATCHER)('$nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new PaymentWatcherEnMemoria())).resolves.toBeUndefined();
  });
});

describe('contrato de EvidenceStore', () => {
  it.each(CASOS_EVIDENCE_STORE)('$nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new EvidenceStoreEnMemoria())).resolves.toBeUndefined();
  });
});

describe('contrato de CobroRepository', () => {
  it.each(CASOS_COBRO_REPOSITORY)('$nombre', async ({ ejecutar }) => {
    await expect(ejecutar(new CobroRepositoryEnMemoria())).resolves.toBeUndefined();
  });
});

describe('los casos de contrato detectan un adaptador que los incumple', () => {
  it('falla si el watcher devuelve error en vez de null para algo desconocido', async () => {
    // Un contrato que no puede fallar no prueba nada: acá se verifica que sí falla.
    const watcherMalo = {
      consultarCobro: () =>
        Promise.resolve({
          ok: false as const,
          error: {
            tipo: 'INDISPONIBLE' as const,
            mensaje: 'boom',
            reintentable: true,
            codigoProveedor: null,
          },
        }),
      listarAbonosDelDia: () => Promise.resolve({ ok: true as const, valor: [] }),
    };
    const caso = CASOS_PAYMENT_WATCHER[0];
    expect(caso).toBeDefined();
    await expect(caso?.ejecutar(watcherMalo)).rejects.toThrow(/contrato incumplido/);
  });

  it('falla si el EvidenceStore pisa registros en vez de agregarlos', async () => {
    const storeMalo = new (class {
      private ultimo: unknown = null;
      agregar(registro: unknown) {
        this.ultimo = registro; // pisa en vez de agregar
        return Promise.resolve({ ok: true as const, valor: undefined });
      }
      listarDeCobro() {
        return Promise.resolve({
          ok: true as const,
          valor: this.ultimo === null ? [] : [this.ultimo],
        });
      }
    })();
    const caso = CASOS_EVIDENCE_STORE[0];
    expect(caso).toBeDefined();
    await expect(caso?.ejecutar(storeMalo as never)).rejects.toThrow(/deben coexistir/);
  });
});
