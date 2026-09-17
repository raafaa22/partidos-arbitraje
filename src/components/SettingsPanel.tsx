import { useState } from 'react'
import { useSheet } from '../lib/useSheet'
import type { Match, Settings } from '../types'
import { diagnose } from '../store/diagnostics'
import { DATA_VERSION } from '../store/db'
import { DEFAULT_SETTINGS } from '../store/db'

interface Props {
  settings: Settings
  account: string | null
  matches: Match[]
  matchCount: number
  onSave: (settings: Settings) => void
  onClose: () => void
  onSignOut: () => void
  onExport: () => void
  onReanalyze: () => void
  onWipe: () => void
}

/** Momento en que se compiló lo que se está ejecutando. Sirve para saber de un
 *  vistazo si el navegador tiene cargada una versión vieja. */
const BUILD = __BUILD__

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (valor === null) return null
  return (
    <div className="row">
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  )
}

export default function SettingsPanel({
  settings, account, matches, matchCount, onSave, onClose, onSignOut, onExport, onReanalyze,
  onWipe,
}: Props) {
  useSheet(onClose)

  const [draft, setDraft] = useState(settings)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const info = diagnose(matches)

  const save = () => {
    onSave(draft)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <h2>Ajustes</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <label className="field">
          <span>Búsqueda en Gmail</span>
          <input
            value={draft.query}
            onChange={(event) => setDraft({ ...draft, query: event.target.value })}
          />
          <div className="hint">
            Se usa tal cual en el buscador de Gmail. Si algún partido no aparece, prueba a
            quitar una de las dos frases entrecomilladas.
          </div>
        </label>

        <label className="field">
          <span>Traer partidos desde</span>
          <input
            type="date"
            value={draft.seasonStart}
            onChange={(event) => setDraft({ ...draft, seasonStart: event.target.value })}
          />
          <div className="hint">
            Los partidos anteriores a esta fecha no se guardan. Se filtran por la fecha del
            partido, no por la del correo, así que las designaciones que llegaron en agosto
            para partidos de septiembre sí entran.
          </div>
        </label>

        <label className="field">
          <span>Apariciones de "demo" en el texto para descartar un PDF</span>
          <input
            inputMode="numeric"
            value={String(draft.demoThreshold)}
            onChange={(event) =>
              setDraft({ ...draft, demoThreshold: Math.max(1, Number(event.target.value) || 1) })
            }
          />
          <div className="hint">
            Solo es una red de seguridad: los PDF de prueba se detectan por sus marcas de agua
            (PD4ML DEMO MODE), no por el texto. Cada partido se puede corregir a mano desde su
            detalle.
          </div>
        </label>

        <label className="field">
          <span>Client ID de Google</span>
          <input
            value={draft.clientId}
            onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
          />
          <div className="hint">
            {draft.clientId === DEFAULT_SETTINGS.clientId
              ? 'El de la app. No hace falta tocarlo.'
              : 'Estás usando un Client ID distinto del que trae la app.'}
          </div>
        </label>

        <div className="sheet-actions">
          <button className="primary" onClick={save}>Guardar</button>
        </div>

        <h3 className="section">Diagnóstico</h3>
        <dl className="rows">
          <Fila etiqueta="Versión del análisis" valor={`v${DATA_VERSION} · ${BUILD}`} />
          <Fila etiqueta="Cuenta" valor={account} />
          <Fila etiqueta="Partidos guardados" valor={String(info.total)} />
          <Fila etiqueta="Sin importe leído" valor={String(info.sinImporte)} />
          <Fila etiqueta="Sin fecha de partido" valor={String(info.sinFecha)} />
          <Fila etiqueta="Sin equipos" valor={String(info.sinEquipos)} />
          <Fila etiqueta="Sin nº de designación" valor={String(info.sinDesignacion)} />
          <Fila etiqueta="Sin PDF adjunto" valor={String(info.sinPdf)} />
          {info.porTipo.map((fila) => (
            <Fila key={fila.tipo} etiqueta={`Correos «${fila.tipo}»`} valor={String(fila.cuantos)} />
          ))}
          {info.errores.map((fila) => (
            <Fila key={fila.mensaje} etiqueta={fila.mensaje} valor={String(fila.cuantos)} />
          ))}
          <Fila
            etiqueta="Correo más antiguo"
            valor={info.primerCorreo ? info.primerCorreo.slice(0, 10) : null}
          />
          <Fila
            etiqueta="Correo más reciente"
            valor={info.ultimoCorreo ? info.ultimoCorreo.slice(0, 10) : null}
          />
        </dl>

        <h3 className="section">Datos</h3>
        <div className="notice info">
          <strong>Reanalizar</strong> vuelve a leer los partidos guardados con las reglas
          actuales, usando el texto que ya está en el dispositivo. No descarga nada de Gmail y
          respeta lo que hayas marcado a mano.
          <br />
          <br />
          {matchCount} partidos guardados en este dispositivo{account ? ` para ${account}` : ''}.
          Cada cuenta de Google tiene los suyos por separado. Nada se sube a ningún servidor:
          la app lee tu Gmail desde el navegador y guarda el resultado aquí.
          {settings.lastSync && (
            <> Última sincronización: {new Date(settings.lastSync).toLocaleString('es-ES')}.</>
          )}
        </div>

        <div className="sheet-actions">
          <button className="ghost" onClick={onReanalyze}>Reanalizar lo guardado</button>
          <button className="ghost" onClick={onExport}>Exportar copia (JSON)</button>
          <button className="ghost" onClick={onSignOut}>Cerrar sesión de Google</button>
          {confirmWipe ? (
            <button className="ghost danger" onClick={onWipe}>
              Confirmar: borrar todo
            </button>
          ) : (
            <button className="ghost danger" onClick={() => setConfirmWipe(true)}>
              Borrar los datos locales
            </button>
          )}
        </div>
        {confirmWipe && (
          <div className="hint">
            Se borran los partidos y las marcas de cobrado de este dispositivo. Los correos de
            Gmail no se tocan, así que puedes volver a sincronizar desde cero.
          </div>
        )}
      </div>
    </div>
  )
}
