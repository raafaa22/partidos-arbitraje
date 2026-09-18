import { useMemo, useState } from 'react'
import { formatEuro, formatShortDate } from '../lib/text'
import { isInSeason, seasonLabel } from '../lib/season'
import { availableSeasons, seasonBalance } from '../store/balance'
import { effectiveAmount, effectiveDemo, flagsFor } from '../store/db'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type Match, type MatchFlags } from '../types'

interface Props {
  matches: Match[]
  flags: Record<string, MatchFlags>
  expenses: Expense[]
  season: number
  onSeason: (season: number) => void
  onAdd: (expense: Omit<Expense, 'id'>) => void
  onUpdate: (id: string, expense: Omit<Expense, 'id'>) => void
  onDelete: (id: string) => void
}

const CATEGORY_LABEL = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c.label]))

export default function BalanceView({
  matches, flags, expenses, season, onSeason, onAdd, onUpdate, onDelete,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const seasons = useMemo(() => {
    const found = availableSeasons(matches, expenses)
    // La temporada elegida siempre sale, aunque todavía no tenga nada.
    return found.includes(season) ? found : [season, ...found].sort((a, b) => b - a)
  }, [matches, expenses, season])

  const balance = useMemo(
    () => seasonBalance({ season, matches, flags, expenses }),
    [season, matches, flags, expenses],
  )

  /**
   * Todo lo que ha entrado y salido en la temporada, junto y por fecha. Los
   * ingresos salen de los partidos y no se pueden tocar aqui: vienen del correo
   * y se gestionan en la otra pantalla. A mano solo se apuntan gastos.
   */
  const movements = useMemo(() => {
    const income = matches
      .filter((match) => {
        const entry = flagsFor(flags, match.id)
        if (entry.deleted || match.cancelled) return false
        if (effectiveDemo(match, entry)) return false
        return isInSeason(match.kickoff, season)
      })
      .map((match) => {
        const entry = flagsFor(flags, match.id)
        const teams = [match.homeTeam, match.awayTeam].filter(Boolean).join(' – ')
        return {
          kind: 'ingreso' as const,
          id: match.id,
          date: (match.kickoff ?? '').slice(0, 10),
          concept: teams || 'Partido',
          detail: entry.paid ? 'Cobrado' : 'Por cobrar',
          amount: effectiveAmount(match, entry),
        }
      })

    const spending = expenses
      .filter((expense) => isInSeason(expense.date, season))
      .map((expense) => ({
        kind: 'gasto' as const,
        id: expense.id,
        date: expense.date,
        concept: expense.concept,
        detail: CATEGORY_LABEL.get(expense.category) ?? expense.category,
        amount: expense.amount,
      }))

    return [...income, ...spending].sort((a, b) => b.date.localeCompare(a.date))
  }, [matches, flags, expenses, season])

  return (
    <>
      {seasons.length > 1 && (
        <label className="field">
          <span>Temporada</span>
          <select value={season} onChange={(event) => onSeason(Number(event.target.value))}>
            {seasons.map((year) => (
              <option key={year} value={year}>
                {seasonLabel(year)}
              </option>
            ))}
          </select>
        </label>
      )}

      <section className="hero">
        <div className="hero-label">Neto temporada {balance.label}</div>
        <p className={`hero-value${balance.net < 0 ? ' negative' : ''}`}>
          {formatEuro(balance.net)}
        </p>
        <div className="hero-sub">
          {formatEuro(balance.gross)} arbitrados en {balance.matches} partido
          {balance.matches === 1 ? '' : 's'}, menos{' '}
          <span className="spent">{formatEuro(balance.expenses)}</span> de gastos
        </div>
      </section>

      <div className="mini-stats">
        <div className="mini">
          <span>Cobrado</span>
          <strong>{formatEuro(balance.collected)}</strong>
        </div>
        <div className="mini">
          <span>Por cobrar</span>
          <strong>{formatEuro(balance.pending)}</strong>
        </div>
      </div>

      {balance.unknownAmounts > 0 && (
        <div className="notice info">
          {balance.unknownAmounts} partido(s) de esta temporada sin importe leído: el bruto se
          queda corto. Ábrelos y ponles el importe a mano desde su detalle.
        </div>
      )}

      {balance.byCategory.length > 0 && (
        <>
          <h3 className="section">En qué se va</h3>
          <dl className="rows">
            {balance.byCategory.map((row) => (
              <div className="row" key={row.category}>
                <dt>{CATEGORY_LABEL.get(row.category) ?? row.category}</dt>
                <dd className="spent">{formatEuro(row.total)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h3 className="section">Ingresos y gastos</h3>

      {adding || editing ? (
        <ExpenseForm
          // Al pasar de un gasto a otro hay que rehacer el formulario, o se
          // quedarían dentro los valores del anterior.
          key={editing?.id ?? 'nuevo'}
          season={season}
          initial={editing}
          onCancel={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSave={(expense) => {
            if (editing) onUpdate(editing.id, expense)
            else onAdd(expense)
            setAdding(false)
            setEditing(null)
          }}
        />
      ) : (
        <button className="primary" onClick={() => setAdding(true)}>
          Añadir gasto
        </button>
      )}

      {movements.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          Todavía no hay nada apuntado en esta temporada.
        </div>
      ) : (
        <div className="rows" style={{ marginTop: 12 }}>
          {movements.map((movement) => (
            <div className="row expense" key={`${movement.kind}-${movement.id}`}>
              {movement.kind === 'gasto' ? (
                // Se pulsa el gasto para editarlo: dos botones por fila dejan
                // los nombres de los equipos sin sitio en una pantalla de móvil.
                <button
                  className="movement-main"
                  aria-label={`Editar ${movement.concept}`}
                  onClick={() => {
                    setAdding(false)
                    setEditing(expenses.find((e) => e.id === movement.id) ?? null)
                  }}
                >
                  <strong>{movement.concept}</strong>
                  <div className="meta">
                    {formatShortDate(movement.date)} · {movement.detail} · editar
                  </div>
                </button>
              ) : (
                <div>
                  <strong>{movement.concept}</strong>
                  <div className="meta">
                    {movement.date ? `${formatShortDate(movement.date)} · ` : ''}
                    {movement.detail}
                  </div>
                </div>
              )}
              <div className="expense-right">
                {movement.amount === null ? (
                  <span className="amount missing">Sin importe</span>
                ) : (
                  <span className={`amount ${movement.kind === 'gasto' ? 'spent' : 'earned'}`}>
                    {movement.kind === 'gasto' ? '−' : '+'}
                    {formatEuro(movement.amount)}
                  </span>
                )}
                {movement.kind === 'gasto' ? (
                  <button
                    className="icon-btn"
                    onClick={() => onDelete(movement.id)}
                    aria-label={`Borrar ${movement.concept}`}
                  >
                    🗑
                  </button>
                ) : (
                  // Los partidos vienen del correo: se editan desde su pantalla.
                  <span className="icon-slot" aria-hidden="true" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ExpenseForm({
  season, initial, onSave, onCancel,
}: {
  season: number
  /** El gasto que se está editando, o `null` si es uno nuevo. */
  initial: Expense | null
  onSave: (expense: Omit<Expense, 'id'>) => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  // Si se apunta un gasto de una temporada pasada, la fecha por defecto cae
  // dentro de ella y no en el día de hoy.
  const inSeason = today >= `${season}-07-01` && today <= `${season + 1}-06-30`

  const [concept, setConcept] = useState(initial?.concept ?? '')
  // Con dos decimales y coma, como se escribe y como se lee en la lista.
  const [amount, setAmount] = useState(initial ? initial.amount.toFixed(2).replace('.', ',') : '')
  const [date, setDate] = useState(initial?.date ?? (inSeason ? today : `${season}-09-01`))
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'cuota')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    const value = Number(amount.trim().replace(',', '.'))
    if (!concept.trim()) return setError('Ponle un concepto para saber qué es.')
    if (!Number.isFinite(value) || value <= 0) return setError('El importe tiene que ser un número mayor que cero.')
    if (!date) return setError('Falta la fecha.')
    onSave({ concept: concept.trim(), amount: Math.round(value * 100) / 100, date, category })
  }

  return (
    <div className="card">
      {error && <div className="notice error">{error}</div>}

      <label className="field">
        <span>Concepto</span>
        <input
          autoFocus
          value={concept}
          placeholder="Cuota de árbitro"
          onChange={(event) => setConcept(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Importe</span>
        <input
          inputMode="decimal"
          value={amount}
          placeholder="120,00"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Fecha</span>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>

      <label className="field">
        <span>Categoría</span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
        >
          {EXPENSE_CATEGORIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="sheet-actions">
        <button className="primary" onClick={save}>
          {initial ? 'Guardar cambios' : 'Guardar gasto'}
        </button>
        <button className="ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
