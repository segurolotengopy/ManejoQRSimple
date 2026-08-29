/**
 * La consola del comerciante.
 *
 * Componentes deliberadamente delgados: piden a `ClienteApi`, muestran lo que
 * vuelve y traducen con `formato.ts`. **Ninguna decisión de negocio vive acá**
 * — la lista de acciones que se ofrecen es una conveniencia visual, y el que
 * decide de verdad es el dominio, que responde 409 si algo no corresponde.
 * Cuando eso pasa, la consola muestra el error tal cual: no lo esconde.
 */

import { useCallback, useEffect, useState } from 'react';

import type { Cobro, DetalleCobro, ErrorApi, ClienteApi } from './api.js';
import {
  accionesPosibles,
  describirEstado,
  fechaCorta,
  montoParaMostrar,
  tonoDeEstado,
  vigenciaRestante,
} from './formato.js';

type Props = { readonly api: ClienteApi };

export function App({ api }: Props): React.JSX.Element {
  const [cobros, setCobros] = useState<readonly Cobro[]>([]);
  const [detalle, setDetalle] = useState<DetalleCobro | null>(null);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [cargando, setCargando] = useState(false);

  const refrescar = useCallback(async (): Promise<void> => {
    setCargando(true);
    const r = await api.listarPendientes();
    setCargando(false);
    if (r.ok) {
      setCobros(r.valor);
      setError(null);
    } else {
      setError(r.error);
    }
  }, [api]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const abrir = async (id: string): Promise<void> => {
    const r = await api.verCobro(id);
    if (r.ok) {
      setDetalle(r.valor);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Cobros por QR</h1>
        <button type="button" onClick={() => void refrescar()} disabled={cargando}>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      {error !== null && (
        <p className="error" role="alert">
          <strong>{error.codigo}</strong> — {error.mensaje}
        </p>
      )}

      <main>
        <section>
          <FormularioNuevoCobro
            api={api}
            onCreado={() => {
              void refrescar();
            }}
            onError={setError}
          />
          <ListaCobros cobros={cobros} onAbrir={(id) => void abrir(id)} />
        </section>

        <section>
          {detalle === null ? (
            <p className="vacio">Elegí un cobro para ver su detalle y su rastro de evidencia.</p>
          ) : (
            <Detalle
              api={api}
              detalle={detalle}
              onCambio={() => {
                void abrir(detalle.cobro.id);
                void refrescar();
              }}
              onError={setError}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function ListaCobros({
  cobros,
  onAbrir,
}: {
  readonly cobros: readonly Cobro[];
  readonly onAbrir: (id: string) => void;
}): React.JSX.Element {
  if (cobros.length === 0) {
    return <p className="vacio">No hay cobros pendientes.</p>;
  }
  return (
    <ul className="lista">
      {cobros.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => { onAbrir(c.id); }}>
            <span className={`chip ${tonoDeEstado(c.estado)}`}>{c.estado}</span>
            <span className="monto">{montoParaMostrar(c)}</span>
            <span className="concepto">{c.concepto}</span>
            <span className="tel">{c.telefonoCliente}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FormularioNuevoCobro({
  api,
  onCreado,
  onError,
}: {
  readonly api: ClienteApi;
  readonly onCreado: () => void;
  readonly onError: (e: ErrorApi) => void;
}): React.JSX.Element {
  const [telefonoCliente, setTelefono] = useState('+591');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (): Promise<void> => {
    setEnviando(true);
    const r = await api.crear({ telefonoCliente, concepto, monto });
    setEnviando(false);
    if (r.ok) {
      setConcepto('');
      setMonto('');
      onCreado();
    } else {
      onError(r.error);
    }
  };

  return (
    <form
      className="nuevo"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <h2>Cobro nuevo</h2>
      <label>
        Teléfono
        <input
          value={telefonoCliente}
          onChange={(e) => { setTelefono(e.target.value); }}
          placeholder="+59171234567"
        />
      </label>
      <label>
        Concepto
        <input value={concepto} onChange={(e) => { setConcepto(e.target.value); }} maxLength={100} />
      </label>
      <label>
        Monto (Bs)
        {/* Texto y no `type=number`: el monto viaja como decimal exacto, y un
            input numérico lo devolvería como float (regla #5). */}
        <input
          value={monto}
          onChange={(e) => { setMonto(e.target.value); }}
          placeholder="150.50"
          inputMode="decimal"
        />
      </label>
      <button type="submit" disabled={enviando}>
        {enviando ? 'Creando…' : 'Crear y emitir QR'}
      </button>
    </form>
  );
}

function Detalle({
  api,
  detalle,
  onCambio,
  onError,
}: {
  readonly api: ClienteApi;
  readonly detalle: DetalleCobro;
  readonly onCambio: () => void;
  readonly onError: (e: ErrorApi) => void;
}): React.JSX.Element {
  const { cobro, evidencia } = detalle;
  const [ocupado, setOcupado] = useState(false);

  const ejecutar = async (accion: string): Promise<void> => {
    setOcupado(true);
    const r = await correr(api, cobro.id, accion);
    setOcupado(false);
    if (r === null) return;
    if (r.ok) {
      onCambio();
    } else {
      onError(r.error);
    }
  };

  return (
    <article className="detalle">
      <h2>
        <span className={`chip ${tonoDeEstado(cobro.estado)}`}>{cobro.estado}</span>
        {montoParaMostrar(cobro)}
      </h2>
      <p className="descripcion">{describirEstado(cobro.estado)}</p>

      <dl>
        <dt>Concepto</dt>
        <dd>{cobro.concepto}</dd>
        <dt>Cliente</dt>
        <dd>{cobro.telefonoCliente}</dd>
        <dt>Creado</dt>
        <dd>{fechaCorta(cobro.creadoEn)}</dd>
        {cobro.qrVigente !== null && (
          <>
            <dt>QR v{cobro.qrVigente.qrVersion}</dt>
            <dd>
              {cobro.qrVigente.referenciaProveedor} ·{' '}
              {vigenciaRestante(cobro.qrVigente.venceEn, new Date()) ?? '—'}
            </dd>
          </>
        )}
      </dl>

      <div className="acciones">
        {accionesPosibles(cobro.estado).map((accion) => (
          <button key={accion} type="button" disabled={ocupado} onClick={() => void ejecutar(accion)}>
            {accion}
          </button>
        ))}
      </div>

      <h3>Evidencia</h3>
      <ol className="evidencia">
        {evidencia.map((r, i) => (
          <li key={`${r.registradoEn}-${String(i)}`}>
            <time>{fechaCorta(r.registradoEn)}</time>
            <span>
              {r.desde} → <strong>{r.hacia}</strong>
            </span>
            <em>
              {r.evento} · {r.origen}
            </em>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Traduce el nombre de la acción a la llamada correspondiente. */
async function correr(
  api: ClienteApi,
  id: string,
  accion: string,
): Promise<Awaited<ReturnType<ClienteApi['enviar']>> | null> {
  switch (accion) {
    case 'enviar':
      return api.enviar(id);
    case 'renovar':
      return api.renovar(id);
    case 'verificar': {
      const r = await api.verificar(id);
      return r.ok ? { ok: true, valor: r.valor.cobro } : r;
    }
    case 'anular': {
      const motivo = globalThis.prompt('¿Motivo de la anulación?');
      return motivo === null || motivo === '' ? null : api.anular(id, motivo);
    }
    case 'comprobante': {
      const referencia = globalThis.prompt('Referencia del comprobante (id del mensaje):');
      return referencia === null || referencia === ''
        ? null
        : api.registrarComprobante(id, referencia);
    }
    default:
      return null;
  }
}
