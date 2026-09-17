/**
 * La prueba controlada en producción.
 *
 * Solo aparece si la API corre en modo prueba (`npm run prueba:api`). Emite QRs
 * **reales** por el monto que fija el servidor, los muestra para escanearlos,
 * sigue cada cobro hasta que el banco confirma el pago y dice qué hay que
 * anotar. Los topes y las barreras viven en el servidor: esta pantalla no
 * puede pedir un QR por más plata ni más veces de lo que la API permite.
 *
 * El seguimiento es de solo lectura salvo después de "Ya pagué": ahí consulta
 * al banco cada 10 s (el piso que acepta, D6) durante 5 minutos. El resto del
 * tiempo, verificar es trabajo del satélite.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClienteApi, DetalleCobro, ErrorApi, EstadoPrueba } from './api.js';
import { diagnosticar, sigueCambiando } from './diagnostico.js';
import { fechaCorta, montoParaMostrar, tonoDeEstado, vigenciaRestante } from './formato.js';
import { informe, PRUEBAS, type RegistroPruebas, type ResultadoPrueba } from './planPruebas.js';

type Seguimiento = {
  readonly detalle: DetalleCobro | null;
  readonly imagen: string | null;
  readonly imagenBuscada: boolean;
  readonly pagoDeclaradoEn: number | null;
  readonly ultimoError: ErrorApi | null;
  readonly sondeo: string | null;
};

const VACIO: Seguimiento = {
  detalle: null,
  imagen: null,
  imagenBuscada: false,
  pagoDeclaradoEn: null,
  ultimoError: null,
  sondeo: null,
};

const ESPERANDO = new Set(['QR_ACTIVO', 'ENVIADO', 'COMPROBANTE_RECIBIDO']);
const SONDEABLES = new Set(['CONFIRMADO', 'ANULADO', 'VENCIDO', 'RECHAZADO']);
const INTERVALO_MS = 10_000;
const VERIFICAR_TRAS_PAGO_MS = 5 * 60_000;
const CLAVE_PLAN = 'mqs.pruebaProduccion';

type Props = {
  readonly api: ClienteApi;
  readonly estado: EstadoPrueba;
  readonly onEstado: (e: EstadoPrueba) => void;
  readonly onError: (e: ErrorApi) => void;
};

export function Pruebas({ api, estado, onEstado, onError }: Props): React.JSX.Element {
  const [seguimiento, setSeguimiento] = useState<Readonly<Record<string, Seguimiento>>>({});
  const [vigencia, setVigencia] = useState(30);
  const [ocupado, setOcupado] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());
  const [cierre, setCierre] = useState<string | null>(null);
  const actual = useRef(seguimiento);
  /**
   * Desfase entre el reloj del servidor y el del navegador. Todo lo que se
   * compara con horas del servidor (vencimientos, evidencia) usa la hora del
   * servidor: un navegador atrasado no tiene que hacer creer que un QR venció.
   */
  const desfase = useRef(Date.parse(estado.ahora) - Date.now());
  const ahoraServidor = (): number => Date.now() + desfase.current;
  const cobros = useRef(estado.cobros);
  cobros.current = estado.cobros;
  const claveCobros = estado.cobros.join(',');

  useEffect(() => {
    actual.current = seguimiento;
  }, [seguimiento]);

  const actualizar = useCallback((id: string, cambios: Partial<Seguimiento>): void => {
    setSeguimiento((previo) => ({ ...previo, [id]: { ...(previo[id] ?? VACIO), ...cambios } }));
  }, []);

  const refrescar = useCallback(
    async (id: string, verificarAntes: boolean): Promise<void> => {
      const cambios: { -readonly [K in keyof Seguimiento]?: Seguimiento[K] } = {};
      if (verificarAntes) {
        const v = await api.verificar(id);
        // Un CONFLICTO es el satélite actualizando el mismo cobro: no es un problema.
        cambios.ultimoError = v.ok || v.error.codigo === 'CONFLICTO' ? null : v.error;
      }
      const d = await api.verCobro(id);
      if (d.ok) {
        cambios.detalle = d.valor;
      }
      if (!(actual.current[id]?.imagenBuscada ?? false)) {
        const q = await api.verQr(id);
        cambios.imagen = q.ok ? q.valor.png : null;
        cambios.imagenBuscada = true;
      }
      actualizar(id, cambios);
    },
    [api, actualizar],
  );

  useEffect(() => {
    const tic = (): void => {
      // El estado de la prueba trae la hora del servidor: se recalcula el desfase.
      void api.verPrueba().then((r) => {
        if (r.ok) {
          desfase.current = Date.parse(r.valor.ahora) - Date.now();
          onEstado(r.valor);
        }
      });
      setAhora(new Date(Date.now() + desfase.current));
      for (const id of cobros.current) {
        const s = actual.current[id] ?? VACIO;
        if (s.detalle !== null && !sigueCambiando(s.detalle.cobro.estado)) {
          continue;
        }
        const verificar =
          s.pagoDeclaradoEn !== null && Date.now() + desfase.current - s.pagoDeclaradoEn < VERIFICAR_TRAS_PAGO_MS;
        void refrescar(id, verificar);
      }
    };
    tic();
    const temporizador = setInterval(tic, INTERVALO_MS);
    return () => {
      clearInterval(temporizador);
    };
    // `claveCobros` y no `estado.cobros`: cada tic trae un arreglo nuevo con los
    // mismos ids, y reiniciar el temporizador por eso lo dispararía sin parar.
  }, [claveCobros, api, onEstado, refrescar]);

  const recargarEstado = async (): Promise<void> => {
    const e = await api.verPrueba();
    if (e.ok) {
      onEstado(e.valor);
    }
  };

  const generar = async (): Promise<void> => {
    setOcupado(true);
    const r = await api.generarQrDePrueba(vigencia);
    setOcupado(false);
    await recargarEstado();
    if (!r.ok) {
      onError(r.error);
      return;
    }
    actualizar(r.valor.cobro.id, { imagen: r.valor.imagen, imagenBuscada: true });
  };

  const cerrar = async (): Promise<void> => {
    if (!globalThis.confirm('Se anulan en el banco todos los QRs de prueba que no se pagaron. ¿Seguís?')) {
      return;
    }
    setOcupado(true);
    const r = await api.cerrarPrueba();
    setOcupado(false);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setCierre(r.valor.resultados.map((x) => `${x.id.slice(0, 8)}: ${x.resultado}`).join(' · ') || 'No había QRs.');
    for (const id of estado.cobros) {
      void refrescar(id, false);
    }
  };

  const anularEnBanco = async (id: string): Promise<void> => {
    const r = await api.anular(id, 'prueba en producción');
    if (!r.ok) {
      actualizar(id, { ultimoError: r.error });
    }
    await refrescar(id, false);
  };

  const sondear = async (id: string): Promise<void> => {
    const r = await api.sondearAnulacion(id);
    if (!r.ok) {
      actualizar(id, { ultimoError: r.error });
      return;
    }
    const d = r.valor.detalle;
    actualizar(id, {
      sondeo: r.valor.anulado
        ? 'El banco respondió que anuló el QR.'
        : `El banco lo rechazó: ${d?.tipo ?? '—'}, responseCode ${d?.codigoProveedor ?? '—'} (${d?.mensajeTecnico ?? ''}).`,
    });
  };

  const ids = [...estado.cobros].reverse();

  return (
    <section className="pruebas">
      <div className="resumen-revision">
        <p>
          <strong>{estado.produccion ? 'Prueba en producción' : 'Modo prueba'}</strong>
          {estado.produccion ? (
            <span className="chip mal">QRs reales · plata real</span>
          ) : (
            <span className="chip espera">banco simulado · nada es real</span>
          )}
          {/* Con dos cuentas en el mismo banco la pantalla es idéntica: el alias
              es lo único que distingue en cuál se está cobrando. */}
          <span className="chip">cuenta {estado.cuenta}</span>
        </p>
        <p className="tenue">
          Cada QR es de Bs {estado.monto}. Quedan {estado.restantes} de {estado.maxQrs}. {estado.adaptadores}
        </p>
        <div className="acciones">
          <label className="vigencia">
            Vence en{' '}
            <select value={vigencia} onChange={(e) => { setVigencia(Number(e.target.value)); }}>
              <option value={5}>5 min</option>
              <option value={30}>30 min</option>
              <option value={120}>2 h</option>
            </select>
          </label>
          <button type="button" className="primario" disabled={ocupado || estado.restantes === 0} onClick={() => void generar()}>
            Generar QR de prueba (Bs {estado.monto})
          </button>
          <button type="button" disabled={ocupado} onClick={() => void cerrar()}>
            Cerrar la prueba
          </button>
        </div>
        {cierre !== null && <p className="tenue">Cierre: {cierre}</p>}
      </div>

      {ids.length === 0 ? (
        <p className="vacio">Todavía no generaste ningún QR de prueba.</p>
      ) : (
        <ol className="cola">
          {ids.map((id) => {
            const s = seguimiento[id] ?? VACIO;
            return (
              <TarjetaPrueba
                key={id}
                id={id}
                s={s}
                ahora={ahora}
                onPague={() => {
                  actualizar(id, { pagoDeclaradoEn: ahoraServidor() });
                  void refrescar(id, true);
                }}
                onVerificar={() => void refrescar(id, true)}
                onAnular={() => void anularEnBanco(id)}
                onSondear={() => void sondear(id)}
              />
            );
          })}
        </ol>
      )}

      <Checklist
        cuenta={estado.cuenta}
        cobros={ids.map((id) => {
          const d = seguimiento[id]?.detalle;
          return { id, estado: d?.cobro.estado ?? '—', monto: d?.cobro.monto ?? estado.monto };
        })}
      />
    </section>
  );
}

function TarjetaPrueba({
  id,
  s,
  ahora,
  onPague,
  onVerificar,
  onAnular,
  onSondear,
}: {
  readonly id: string;
  readonly s: Seguimiento;
  readonly ahora: Date;
  readonly onPague: () => void;
  readonly onVerificar: () => void;
  readonly onAnular: () => void;
  readonly onSondear: () => void;
}): React.JSX.Element {
  const cobro = s.detalle?.cobro ?? null;
  if (cobro === null) {
    return <li className="caso">Cargando {id.slice(0, 8)}…</li>;
  }
  const esperando = ESPERANDO.has(cobro.estado);
  const problemas = diagnosticar({
    cobro,
    evidencia: s.detalle?.evidencia ?? [],
    hayImagen: s.imagen !== null,
    ultimoError: s.ultimoError,
    pagoDeclaradoEn: s.pagoDeclaradoEn === null ? null : new Date(s.pagoDeclaradoEn),
    ahora,
  });

  return (
    <li className={`caso prueba ${tonoDeEstado(cobro.estado)}`}>
      <header>
        <span className={`chip ${tonoDeEstado(cobro.estado)}`}>{cobro.estado}</span>
        <strong>
          {montoParaMostrar(cobro)} · {cobro.concepto}
        </strong>
        <time>{cobro.qrVigente === null ? '' : (vigenciaRestante(cobro.qrVigente.venceEn, ahora) ?? '')}</time>
      </header>

      <div className="prueba-cuerpo">
        {s.imagen !== null && esperando ? (
          <img className="qr" src={`data:image/png;base64,${s.imagen}`} alt="QR de prueba para escanear" />
        ) : null}
        <div>
          <ul className="problemas">
            {problemas.map((p, i) => (
              <li key={i} className={p.nivel}>
                {p.texto}
              </li>
            ))}
          </ul>
          {s.sondeo !== null && <p className="tenue">Sondeo: {s.sondeo}</p>}
          <p className="tenue">
            QR {cobro.qrVigente?.referenciaProveedor ?? '—'} · creado {fechaCorta(cobro.creadoEn)}
          </p>
          <ol className="evidencia">
            {(s.detalle?.evidencia ?? []).map((r, i) => (
              <li key={`${r.registradoEn}-${String(i)}`}>
                <time>{fechaCorta(r.registradoEn)}</time>
                <span>
                  {r.desde} → <strong>{r.hacia}</strong>
                </span>
                <em>{r.evento}</em>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="acciones">
        {esperando && (
          <>
            <button type="button" className="primario" onClick={onPague}>
              Ya pagué
            </button>
            <button type="button" onClick={onVerificar}>
              Verificar ahora
            </button>
            <button type="button" onClick={onAnular}>
              Anular en el banco
            </button>
          </>
        )}
        {SONDEABLES.has(cobro.estado) && (
          <button type="button" onClick={onSondear}>
            Sondear anulación
          </button>
        )}
      </div>
    </li>
  );
}

function leerPlan(): RegistroPruebas {
  try {
    const crudo = globalThis.localStorage.getItem(CLAVE_PLAN);
    return crudo === null ? {} : (JSON.parse(crudo) as RegistroPruebas);
  } catch {
    return {};
  }
}

function Checklist({
  cobros,
  cuenta,
}: {
  readonly cobros: readonly { id: string; estado: string; monto: string }[];
  /** Alias de la cuenta de cobro: encabeza el informe que se archiva. */
  readonly cuenta: string;
}): React.JSX.Element {
  const [registro, setRegistro] = useState<RegistroPruebas>(leerPlan);

  const cambiar = (id: string, cambios: Partial<{ resultado: ResultadoPrueba; nota: string }>): void => {
    setRegistro((previo) => {
      const nuevo = { ...previo, [id]: { resultado: 'pendiente' as ResultadoPrueba, nota: '', ...previo[id], ...cambios } };
      try {
        globalThis.localStorage.setItem(CLAVE_PLAN, JSON.stringify(nuevo));
      } catch {
        // Sin almacenamiento, el checklist dura lo que la pestaña abierta.
      }
      return nuevo;
    });
  };

  return (
    <div className="checklist">
      <h3>Plan de pruebas</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Prueba</th>
            <th>Qué hacer / qué se espera</th>
            <th>Resultado</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody>
          {PRUEBAS.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.titulo}</td>
              <td>
                {p.pasos}
                <br />
                <span className="tenue">Esperado: {p.esperado}</span>
              </td>
              <td>
                <select
                  value={registro[p.id]?.resultado ?? 'pendiente'}
                  onChange={(e) => { cambiar(p.id, { resultado: e.target.value as ResultadoPrueba }); }}
                >
                  <option value="pendiente">pendiente</option>
                  <option value="ok">ok</option>
                  <option value="falla">falla</option>
                  <option value="no-aplica">no aplica</option>
                </select>
              </td>
              <td>
                <input
                  value={registro[p.id]?.nota ?? ''}
                  onChange={(e) => { cambiar(p.id, { nota: e.target.value }); }}
                  placeholder="responseCode, banco, hora…"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Informe</h3>
      <textarea className="informe" readOnly value={informe(new Date(), registro, cobros, cuenta)} rows={16} />
    </div>
  );
}
