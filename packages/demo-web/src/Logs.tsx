/**
 * Logs de depuración.
 *
 * Junta los logs de la API (cada pedido y cada llamada al banco, con estado,
 * `responseCode` y demora) y del satélite (vigilancia, cierre diario) con los
 * errores que vio esta consola. Los de la API y el satélite están en disco:
 * se ven aunque los procesos se hayan reiniciado. Se actualiza cada 3 s
 * mientras la pestaña está abierta. Los textos ya vienen saneados: sin
 * cuerpos, credenciales, tokens ni teléfonos.
 */

import { useEffect, useState } from 'react';

import type { ClienteApi, LineaLog } from './api.js';
import { filtrarLogs, textoDeLinea, type FiltroLogs } from './formatoLogs.js';

const INTERVALO_MS = 3_000;

type Props = { readonly api: ClienteApi; readonly locales: readonly LineaLog[] };

export function Logs({ api, locales }: Props): React.JSX.Element {
  const [remotas, setRemotas] = useState<readonly LineaLog[]>([]);
  const [filtro, setFiltro] = useState<FiltroLogs>('todo');
  const [pausa, setPausa] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  useEffect(() => {
    if (pausa) {
      return undefined;
    }
    const tic = (): void => {
      void api.verLogs().then((r) => {
        if (r.ok) {
          setRemotas(r.valor.lineas);
          setFalla(null);
        } else {
          setFalla(`${r.error.codigo}: ${r.error.mensaje}`);
        }
      });
    };
    tic();
    const temporizador = setInterval(tic, INTERVALO_MS);
    return () => {
      clearInterval(temporizador);
    };
  }, [api, pausa]);

  const visibles = filtrarLogs([...remotas, ...locales], filtro);

  return (
    <section className="logs-seccion">
      <div className="acciones">
        <select value={filtro} onChange={(e) => { setFiltro(e.target.value as FiltroLogs); }}>
          <option value="todo">Todo</option>
          <option value="banco">Llamadas al banco</option>
          <option value="api">Pedidos a la API</option>
          <option value="satelite">Satélite (vigilancia y cierre diario)</option>
          <option value="consola">Errores de la consola</option>
          <option value="problemas">Solo avisos y errores</option>
        </select>
        <button type="button" onClick={() => { setPausa(!pausa); }}>
          {pausa ? 'Reanudar' : 'Pausar'}
        </button>
        <span className="tenue">
          {visibles.length} línea(s){pausa ? ' · en pausa' : ' · se actualiza cada 3 s'}
        </span>
      </div>
      {falla !== null && <p className="error">No se pudieron leer los logs de la API: {falla}</p>}
      <ol className="logs">
        {[...visibles].reverse().map((l) => (
          <li key={`${l.origen}-${String(l.n)}`} className={l.nivel}>
            {textoDeLinea(l)}
          </li>
        ))}
      </ol>
    </section>
  );
}
