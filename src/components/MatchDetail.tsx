import { useState } from 'react'
import { useSheet } from '../lib/useSheet'
import type { Match, MatchFlags } from '../types'
import { formatEuro, formatKickoff } from '../lib/text'

interface Props {
  match: Match
  flags: MatchFlags
  amount: number | null
  isDemo: boolean
  busy: boolean
  onClose: () => void
  onAmountOverride: (value: number | null) => void
  onDemoOverride: (value: boolean | null) => void
  onRefresh: () => void
  onDelete: () => void
  onRestore: () => void
}

export default function MatchDetail({
  match, flags, amount, isDemo, busy,
  onClose, onAmountOverride, onDemoOverride, onRefresh, onDelete, onRestore,
}: Props) {
  useSheet(onClose)

  const [draft, setDraft] = useState(
    flags.amountOverride !== null ? String(flags.amountOverride).replace('.', ',') : '',
  )

  const applyOverride = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      onAmountOverride(null)
      return
    }
    const value = Number(trimmed.replace(',', '.'))
    if (Number.isFinite(value) && value >= 0) onAmountOverride(value)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <h2>{[match.homeTeam, match.awayTeam].filter(Boolean).join(' – ') || 'Partido'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {match.error && <div className="notice error">{match.error}</div>}

        <dl className="rows">
          <Row label="Fecha" value={formatKickoff(match.kickoff)} />
          <Row label="Competición" value={match.competition} />
          <Row label="Grupo" value={match.group} />
          <Row label="Campo" value={match.venue} />
          <Row label="Localidad" value={match.city} />
          <Row label="Función" value={match.role} />
          <Row label="Designación" value={match.designacion} />
          <Row
            label="Estado final"
            value={
              match.kind === 'anulada'
                ? 'Designación ANULADA: no cuenta'
                : match.kind === 'cambiada'
                  ? 'Designación cambiada'
                  : match.kind === 'asignada'
                    ? 'Designación asignada'
                    : null
            }
          />
          <Row label="Importe" value={amount !== null ? formatEuro(amount) : 'sin leer'} />
          <Row label="Origen del importe" value={match.amountSource} />
          <Row label="Detección de demo" value={match.demoReason} />
          <Row label="Adjunto" value={match.pdfName} />
        </dl>

        {match.breakdown.length > 0 && (
          <>
            <h3 className="section">Desglose de la liquidación</h3>
            <dl className="rows">
              {match.breakdown.map((line, index) => (
                <Row key={index} label={line.label} value={formatEuro(line.value)} />
              ))}
            </dl>
          </>
        )}

        <h3 className="section">Corregir a mano</h3>

        <label className="field">
          <span>Importe (déjalo vacío para usar el del PDF)</span>
          <input
            inputMode="decimal"
            placeholder={match.amount !== null ? String(match.amount).replace('.', ',') : '0,00'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={applyOverride}
          />
          <div className="hint">
            {flags.amountOverride !== null
              ? `Estás usando un importe corregido. El del PDF era ${
                  match.amount !== null ? formatEuro(match.amount) : 'ilegible'
                }.`
              : 'Solo hace falta si el PDF no se ha dejado leer bien.'}
          </div>
        </label>

        <label className="field">
          <span>¿Es un partido de demostración?</span>
          <select
            value={flags.demoOverride === null ? 'auto' : flags.demoOverride ? 'si' : 'no'}
            onChange={(event) => {
              const value = event.target.value
              onDemoOverride(value === 'auto' ? null : value === 'si')
            }}
          >
            <option value="auto">Automático ({match.isDemo ? 'detectado como demo' : 'partido real'})</option>
            <option value="si">Sí, es demo (no cuenta para el total)</option>
            <option value="no">No, es un partido real</option>
          </select>
          <div className="hint">
            {isDemo ? 'Ahora mismo no suma al total.' : 'Ahora mismo cuenta para el total.'}
          </div>
        </label>

        <details className="raw">
          <summary>Texto extraído del PDF</summary>
          <pre>{match.pdfText ?? 'No hay texto: el PDF no se pudo leer.'}</pre>
        </details>

        <details className="raw">
          <summary>Cuerpo del correo</summary>
          <pre>{match.emailText ?? 'No disponible.'}</pre>
        </details>

        <div className="sheet-actions">
          <button className="ghost" onClick={onRefresh} disabled={busy}>
            {busy ? 'Releyendo…' : 'Volver a leer el PDF'}
          </button>
          {flags.deleted ? (
            <button className="ghost" onClick={onRestore}>Restaurar</button>
          ) : (
            <button className="ghost danger" onClick={onDelete}>Borrar partido</button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
