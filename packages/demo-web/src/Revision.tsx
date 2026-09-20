/**
 * La cola de revisión manual.
 *
 * Es la única pantalla desde la que una persona puede llevar un cobro a
 * `CONFIRMADO`, y por eso está armada para frenar, no para apurar:
 *
 * - El botón de aceptar **solo aparece si el banco reportó un pago**
 *   (`confirmable`, que decide el dominio). Si no, lo que se ofrece es ir a
 *   buscarlo al banco. Un comprobante nunca alcanza (regla #1).
 * - Toda decisión pide un motivo, que queda en la evidencia (regla #8), y
 *   aceptar pide además una confirmación con los montos a la vista.
 * - Cada caso trae su recomendación, para que la decisión no dependa de que
 *   quien revisa se acuerde de la regla.
 */

import { useState } from 'react';

import type { AbonoSinConciliar, CasoRevision, ClienteApi, ColaRevision, ErrorApi } from './api.js';
import {
  antiguedad,
  describirMotivo,
  describirMotivoAbono,
  diferencia,
  recomendacion,
  recomendacionAbono,
  revisionPendiente,
  textoNivel,
  textoUltimaRevision,
  tonoDeNivel,
} from './alertas.js';
import { clienteParaMostrar, fechaCorta, montoParaMostrar } from './formato.js';

export type EstadoAvisos = 'activos' | 'inactivos' | 'no-disponibles';

type Props = {
  readonly api: ClienteApi;
  readonly cola: ColaRevision | null;
  readonly ultimaRevision: string | null;
  readonly avisos: EstadoAvisos;
  readonly onCambio: () => void;
  readonly onError: (e: ErrorApi) => void;
  readonly onMarcarRevisado: () => void;
  readonly onActivarAvisos: () => void;
};

export function Revision(props: Props): React.JSX.Element {
  const { cola } = props;
  if (cola === null) {
    return <p className="vacio">Cargando la cola de revisión…</p>;
  }

  const ahora = new Date();
  const { casos, resumen } = cola;
  const pendiente = revisionPendiente(props.ultimaRevision, ahora, resumen.total > 0);

  return (
    <section className="revision">
      <div className="resumen-revision">
        <p>
          <strong>{resumen.total}</strong> {resumen.total === 1 ? 'caso' : 'casos'} en revisión
          {resumen.criticos > 0 && <span className="chip mal">{resumen.criticos} crítico(s)</span>}
          {resumen.atrasados > 0 && <span className="chip atencion">{resumen.atrasados} atrasado(s)</span>}
        </p>
        <p className="tenue">{textoUltimaRevision(props.ultimaRevision, ahora)}</p>
        <div className="acciones">
          <button type="button" onClick={props.onMarcarRevisado}>
            Marcar revisión hecha
          </button>
          {props.avisos === 'inactivos' && (
            <button type="button" onClick={props.onActivarAvisos}>
              Activar avisos del navegador
            </button>
          )}
        </div>
      </div>

      {pendiente && (
        <p className="alerta" role="alert">
          {props.ultimaRevision === null
            ? 'Hay casos esperando y todavía no marcaste ninguna revisión.'
            : 'Hay casos esperando y pasaron más de 24 h desde la última revisión.'}{' '}
          Recorré la cola y marcala como hecha.
        </p>
      )}

      {cola.truncado && (
        <p className="alerta" role="alert">
          Hay más casos de los que entran en la cola: se muestran los primeros {casos.length}. Resolvé
          estos para ver el resto — los contadores se quedan cortos.
        </p>
      )}

      {casos.length === 0 && cola.abonos.length === 0 && <p className="vacio">No hay nada para revisar.</p>}

      {casos.length > 0 && (
        <ol className="cola">
          {casos.map((caso) => (
            <Caso
              key={caso.cobro.id}
              api={props.api}
              caso={caso}
              onCambio={props.onCambio}
              onError={props.onError}
            />
          ))}
        </ol>
      )}

      {cola.abonos.length > 0 && (
        <>
          <h3>Pagos sin cobro que los explique</h3>
          <p className="tenue">
            Los encontró el cierre diario: plata en la cuenta que ningún cobro espera. No confirman nada; se
            cierran dejando escrito qué se hizo con la plata.
          </p>
          <ol className="cola">
            {cola.abonos.map((abono) => (
              <AbonoCaso
                key={abono.idDeduplicacion}
                api={props.api}
                abono={abono}
                onCambio={props.onCambio}
                onError={props.onError}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function AbonoCaso({
  api,
  abono,
  onCambio,
  onError,
}: {
  readonly api: ClienteApi;
  readonly abono: AbonoSinConciliar;
  readonly onCambio: () => void;
  readonly onError: (e: ErrorApi) => void;
}): React.JSX.Element {
  const [ocupado, setOcupado] = useState(false);

  const cerrar = async (): Promise<void> => {
    const motivo = globalThis.prompt(
      '¿Qué se hizo con esta plata? (mínimo 10 caracteres; queda registrado. Ej.: "devuelto al pagador")',
    );
    if (motivo === null || motivo.trim() === '') {
      return;
    }
    setOcupado(true);
    const r = await api.cerrarAbono(abono.idDeduplicacion, motivo);
    setOcupado(false);
    if (r.ok) {
      onCambio();
    } else {
      onError(r.error);
    }
  };

  return (
    <li className={`caso ${tonoDeNivel(abono.nivel)}`}>
      <header>
        <span className={`chip ${tonoDeNivel(abono.nivel)}`}>{textoNivel(abono.nivel)}</span>
        <strong>{describirMotivoAbono(abono.motivo)}</strong>
        <time>{antiguedad(abono.horasAbierto)}</time>
      </header>

      <dl>
        <dt>Pago del banco</dt>
        <dd>
          Bs {abono.monto} · {fechaCorta(abono.ocurridoEn)}
        </dd>
        <dt>Clave del banco</dt>
        <dd>
          <code>{abono.idDeduplicacion}</code>
        </dd>
        <dt>Cobro del QR</dt>
        <dd>
          {abono.cobroId ?? 'Ninguno'}
          {abono.cobroEstado !== null && ` · ${abono.cobroEstado}`}
          {abono.yaRegistradoEnElCobro && <em> · ya registra este pago</em>}
        </dd>
        <dt>Encontrado por el cierre</dt>
        <dd>{fechaCorta(abono.registradoEn)}</dd>
      </dl>

      <p className="recomendacion">{recomendacionAbono(abono.motivo, abono.yaRegistradoEnElCobro)}</p>

      <div className="acciones">
        <button type="button" disabled={ocupado} onClick={() => void cerrar()}>
          Cerrar con un motivo
        </button>
      </div>
    </li>
  );
}

function Caso({
  api,
  caso,
  onCambio,
  onError,
}: {
  readonly api: ClienteApi;
  readonly caso: CasoRevision;
  readonly onCambio: () => void;
  readonly onError: (e: ErrorApi) => void;
}): React.JSX.Element {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { cobro, abono } = caso;
  const dif = abono === null ? null : diferencia(cobro.monto, abono.monto);

  const resolver = async (decision: 'CONFIRMADO' | 'RECHAZADO'): Promise<void> => {
    const motivo = globalThis.prompt(
      decision === 'CONFIRMADO'
        ? '¿Por qué aceptás este pago? (mínimo 10 caracteres; queda en la evidencia)'
        : '¿Por qué lo rechazás? (mínimo 10 caracteres; si hubo pago, devolvelo por fuera)',
    );
    if (motivo === null || motivo.trim() === '') {
      return;
    }
    if (
      decision === 'CONFIRMADO' &&
      !globalThis.confirm(
        `Vas a confirmar el cobro de ${montoParaMostrar(cobro)} aceptando el pago del banco de ` +
          `Bs ${abono?.monto ?? '—'}. Es definitivo. ¿Seguís?`,
      )
    ) {
      return;
    }
    setOcupado(true);
    // Confirmar nombra el abono que se ve en pantalla: si el banco reportó
    // otro mientras tanto, el dominio lo rechaza y hay que volver a mirar.
    const r =
      decision === 'CONFIRMADO' && abono !== null
        ? await api.resolver(cobro.id, { decision, idDeduplicacion: abono.idDeduplicacion, motivo })
        : await api.resolver(cobro.id, { decision: 'RECHAZADO', motivo });
    setOcupado(false);
    if (r.ok) {
      onCambio();
    } else {
      onError(r.error);
    }
  };

  const buscar = async (): Promise<void> => {
    setOcupado(true);
    const r = await api.buscarAbono(cobro.id);
    setOcupado(false);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    if (r.valor.encontrado) {
      onCambio();
    } else {
      setAviso('El banco no reporta ningún pago para este QR.');
    }
  };

  return (
    <li className={`caso ${tonoDeNivel(caso.nivel)}`}>
      <header>
        <span className={`chip ${tonoDeNivel(caso.nivel)}`}>{textoNivel(caso.nivel)}</span>
        <strong>{describirMotivo(caso.motivo)}</strong>
        <time>{antiguedad(caso.horasEnRevision)}</time>
      </header>

      <dl>
        <dt>Cobro</dt>
        <dd>
          {montoParaMostrar(cobro)} · {cobro.concepto}
        </dd>
        <dt>Cliente</dt>
        <dd>{clienteParaMostrar(cobro)}</dd>
        <dt>Pago del banco</dt>
        <dd>
          {abono === null ? 'Ninguno reportado' : `Bs ${abono.monto} · ${fechaCorta(abono.ocurridoEn)}`}
          {dif !== null && <em className="diferencia"> ({dif})</em>}
        </dd>
        <dt>En revisión desde</dt>
        <dd>{fechaCorta(caso.enRevisionDesde)}</dd>
      </dl>

      <p className="recomendacion">{recomendacion(caso.motivo)}</p>
      {aviso !== null && <p className="tenue">{aviso}</p>}

      <div className="acciones">
        {caso.confirmable ? (
          <button type="button" className="primario" disabled={ocupado} onClick={() => void resolver('CONFIRMADO')}>
            Aceptar el pago del banco
          </button>
        ) : (
          <button type="button" disabled={ocupado} onClick={() => void buscar()}>
            Buscar el pago en el banco
          </button>
        )}
        <button type="button" disabled={ocupado} onClick={() => void resolver('RECHAZADO')}>
          Rechazar
        </button>
      </div>
    </li>
  );
}
