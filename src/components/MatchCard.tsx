import type { Match, MatchFlags } from '../types'
import { formatEuro, formatKickoff } from '../lib/text'

interface Props {
  match: Match
  flags: MatchFlags
  amount: number | null
  isDemo: boolean
  onTogglePaid: () => void
  onOpen: () => void
  onDelete: () => void
  onRestore: () => void
}

export default function MatchCard({
  match, flags, amount, isDemo, onTogglePaid, onOpen, onDelete, onRestore,
}: Props) {
  const teams = [match.homeTeam, match.awayTeam].filter(Boolean).join(' – ') || 'Partido sin equipos'
  const place = [match.venue, match.city].filter(Boolean).join(' · ')
  const competition = [match.competition, match.group].filter(Boolean).join(' · ')

  return (
    <article
      className={`card${flags.paid ? ' is-paid' : ''}${isDemo || match.cancelled ? ' is-demo' : ''}`}
    >
      <div className="card-head">
        <div>
          {competition && <div className="competition">{competition}</div>}
          <h2 className="teams">{teams}</h2>
          <div className="meta">{formatKickoff(match.kickoff)}</div>
          {place && <div className="meta">{place}</div>}
        </div>
        {amount === null ? (
          <div className="amount missing">Sin importe</div>
        ) : (
          <div className="amount">{formatEuro(amount)}</div>
        )}
      </div>

      <div className="badges">
        {match.role && <span className="badge">{match.role}</span>}
        {isDemo && <span className="badge demo">Demo</span>}
        {match.cancelled && <span className="badge error">Anulado</span>}
        {match.error && <span className="badge error">Aviso</span>}
        {match.designacion && <span className="badge">Nº {match.designacion}</span>}
      </div>

      <div className="card-foot">
        {flags.deleted ? (
          <button className="pay-toggle" onClick={onRestore}>
            <span className="tick">↩</span> Restaurar
          </button>
        ) : (
          <button className="pay-toggle" aria-pressed={flags.paid} onClick={onTogglePaid}>
            <span className="tick">{flags.paid ? '✓' : ''}</span>
            {flags.paid ? 'Cobrado' : 'Marcar como cobrado'}
          </button>
        )}
        <button className="icon-btn" onClick={onOpen} aria-label="Ver detalle">ⓘ</button>
        {!flags.deleted && (
          <button className="icon-btn" onClick={onDelete} aria-label="Borrar partido">🗑</button>
        )}
      </div>
    </article>
  )
}
