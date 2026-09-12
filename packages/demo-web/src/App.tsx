/**
 * La consola del comerciante.
 *
 * Componentes deliberadamente delgados: piden a `ClienteApi`, muestran lo que
 * vuelve y traducen con `formato.ts` y `alertas.ts`. **Ninguna decisión de
 * negocio vive acá** — la lista de acciones que se ofrecen es una conveniencia
 * visual, y el que decide de verdad es el dominio, que responde 409 si algo no
 * corresponde. Cuando eso pasa, la consola muestra el error tal cual: no lo
 * esconde.
 *
 * Dos pestañas: los cobros y la cola de revisión. La cola se consulta sola
 * cada minuto aunque se esté en la otra pestaña, porque su trabajo es avisar:
 * el título del navegador lleva la cantidad de casos, la pestaña se colorea
 * según el más urgente y, si el dueño lo permite, un caso crítico nuevo dispara
 * un aviso del sistema operativo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ClienteApi,
  Cobro,
  ColaRevision,
  DetalleCobro,
  ErrorApi,
  EstadoPrueba,
  LineaLog,
  ResumenRevision,
} from './api.js';
import { lineaDeError } from './formatoLogs.js';
import { Logs } from './Logs.js';
import { Pruebas } from './Pruebas.js';
import { nuevosCriticos, tituloDePagina, tonoInsignia } from './alertas.js';
import {
  accionesPosibles,
  describirEstado,
  fechaCorta,
  montoParaMostrar,
  tonoDeEstado,
  vigenciaRestante,
} from './formato.js';
import { Revision, type EstadoAvisos } from './Revision.js';

type Props = { readonly api: ClienteApi };

const TITULO = 'Cobros por QR';
const INTERVALO_REVISION_MS = 60_000;
const CLAVE_ULTIMA_REVISION = 'mqs.ultimaRevision';

/** `localStorage` puede no estar (navegación privada, políticas): no rompe la consola. */
function leerUltimaRevision(): string | null {
  try {
    return globalThis.localStorage.getItem(CLAVE_ULTIMA_REVISION);
  } catch {
    return null;
  }
}

function estadoAvisos(): EstadoAvisos {
  if (typeof Notification === 'undefined' || Notification.permission === 'denied') {
    return 'no-disponibles';
  }
  return Notification.permission === 'granted' ? 'activos' : 'inactivos';
}

/** El aviso lleva solo conteos: nada del cobro ni del cliente sale de la página (regla #9). */
function avisar(criticos: number): void {
  if (estadoAvisos() !== 'activos') {
    return;
  }
  new Notification('Cobros en revisión', {
    body: `${String(criticos)} caso(s) crítico(s) esperando revisión.`,
  });
}

export function App({ api }: Props): React.JSX.Element {
  const [vista, setVista] = useState<'cobros' | 'revision' | 'pruebas' | 'logs'>('cobros');
  /** Errores que vio esta consola, para la pestaña Logs (los últimos 200). */
  const [logsLocales, setLogsLocales] = useState<readonly LineaLog[]>([]);
  /** Solo si la API corre en modo prueba en producción; si no, la pestaña no aparece. */
  const [prueba, setPrueba] = useState<EstadoPrueba | null>(null);
  const [cobros, setCobros] = useState<readonly Cobro[]>([]);
  const [detalle, setDetalle] = useState<DetalleCobro | null>(null);
  const [cola, setCola] = useState<ColaRevision | null>(null);
  const [error, setErrorVisible] = useState<ErrorApi | null>(null);

  /** Muestra el error y lo deja en la pestaña Logs. */
  const setError = useCallback((e: ErrorApi | null): void => {
    setErrorVisible(e);
    if (e !== null) {
      setLogsLocales((previas) => [...previas.slice(-199), lineaDeError(e, previas.length + 1, new Date())]);
    }
  }, []);
  const [cargando, setCargando] = useState(false);
  const [ultimaRevision, setUltimaRevision] = useState<string | null>(leerUltimaRevision);
  const [avisos, setAvisos] = useState<EstadoAvisos>(estadoAvisos);
  const resumenAnterior = useRef<ResumenRevision | null>(null);

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
  }, [api, setError]);

  const refrescarRevision = useCallback(async (): Promise<void> => {
    const r = await api.listarRevision();
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCola(r.valor);
    const nuevos = nuevosCriticos(resumenAnterior.current, r.valor.resumen);
    resumenAnterior.current = r.valor.resumen;
    if (nuevos > 0) {
      avisar(nuevos);
    }
  }, [api, setError]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  useEffect(() => {
    void api.verPrueba().then((r) => {
      // 404 = la API no está en modo prueba: no hay pestaña, y no es un error.
      setPrueba(r.ok ? r.valor : null);
    });
  }, [api]);

  useEffect(() => {
    void refrescarRevision();
    const id = setInterval(() => {
      void refrescarRevision();
    }, INTERVALO_REVISION_MS);
    return () => {
      clearInterval(id);
    };
  }, [refrescarRevision]);

  useEffect(() => {
    document.title = tituloDePagina(TITULO, cola?.resumen ?? null);
  }, [cola]);

  const abrir = async (id: string): Promise<void> => {
    const r = await api.verCobro(id);
    if (r.ok) {
      setDetalle(r.valor);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  const marcarRevisado = (): void => {
    const ahora = new Date().toISOString();
    try {
      globalThis.localStorage.setItem(CLAVE_ULTIMA_REVISION, ahora);
    } catch {
      // Sin almacenamiento, la marca dura lo que dure la pestaña abierta.
    }
    setUltimaRevision(ahora);
  };

  const activarAvisos = (): void => {
    void Notification.requestPermission().then(() => {
      setAvisos(estadoAvisos());
    });
  };

  const resumen = cola?.resumen ?? null;

  return (
    <div className="app">
      <header>
        <h1>{TITULO}</h1>
        <nav className="pestanas">
          <button
            type="button"
            className={vista === 'cobros' ? 'pestana activa' : 'pestana'}
            onClick={() => {
              setVista('cobros');
            }}
          >
            Cobros
          </button>
          <button
            type="button"
            className={vista === 'revision' ? 'pestana activa' : 'pestana'}
            onClick={() => {
              setVista('revision');
            }}
          >
            Revisión
            {resumen !== null && resumen.total > 0 && (
              <span className={`insignia ${tonoInsignia(resumen)}`}>{resumen.total}</span>
            )}
          </button>
          {prueba !== null && (
            <button
              type="button"
              className={vista === 'pruebas' ? 'pestana activa' : 'pestana'}
              onClick={() => {
                setVista('pruebas');
              }}
            >
              Pruebas{' '}
              <span className={`insignia ${prueba.produccion ? 'mal' : 'espera'}`}>
                {prueba.produccion ? 'PROD' : 'SIM'}
              </span>
            </button>
          )}
          <button
            type="button"
            className={vista === 'logs' ? 'pestana activa' : 'pestana'}
            onClick={() => {
              setVista('logs');
            }}
          >
            Logs
          </button>
        </nav>
        <button
          type="button"
          onClick={() => {
            void refrescar();
            void refrescarRevision();
          }}
          disabled={cargando}
        >
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      {error !== null && (
        <p className="error" role="alert">
          <strong>{error.codigo}</strong> — {error.mensaje}
        </p>
      )}

      {vista === 'logs' ? (
        <Logs api={api} locales={logsLocales} />
      ) : vista === 'pruebas' && prueba !== null ? (
        <Pruebas api={api} estado={prueba} onEstado={setPrueba} onError={setError} />
      ) : vista === 'revision' ? (
        <Revision
          api={api}
          cola={cola}
          ultimaRevision={ultimaRevision}
          avisos={avisos}
          onCambio={() => {
            void refrescarRevision();
            void refrescar();
          }}
          onError={setError}
          onMarcarRevisado={marcarRevisado}
          onActivarAvisos={activarAvisos}
        />
      ) : (
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
                  // Una verificación puede mandar el cobro a revisión.
                  void refrescarRevision();
                }}
                onError={setError}
              />
            )}
          </section>
        </main>
      )}
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
