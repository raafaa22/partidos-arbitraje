import { useMemo, useState } from 'react'
import { formatEuro, formatShortDate } from '../lib/text'
import { seasonLabel } from '../lib/season'
import { availableSeasons, seasonBalance } from '../store/balance'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type Match, type MatchFlags } from '../types'

interface Props {
  matches: Match[]
  flags: Record<string, MatchFlags>
  expenses: Expense[]
  season: number
  onSeason: (season: number) => void
  onAdd: (expense: Omit<Expense, 'id'>) => void
  onDelete: (id: string) => void
}

const CATEGORY_LABEL = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c.label]))

export default function BalanceView({
  matches, flags, expenses, season, onSeason, onAdd, onDelete,
}: Props) {
  const [adding, setAdding] = useState(false)

  const seasons = useMemo(() => {
    const found = availableSeasons(matches, expenses)
    // La temporada elegida siempre sale, aunque todavía no tenga nada.
    return found.includes(season) ? found : [season, ...found].sort((a, b) => b - a)
  }, [matches, expenses, season])

  const balance = useMemo(
    () => seasonBalance({ season, matches, flags, expenses }),
    [season, matches, flags, expenses],
  )

  const ofSeason = useMemo(
    () =>
      expenses
        .filter((expense) => expense.date >= `${season}-07-01` && expense.date <= `${season + 1}-06-30`)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, season],
  )

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
        <p className="hero-value">{formatEuro(balance.net)}</p>
        <div className="hero-sub">
          {formatEuro(balance.gross)} arbitrados en {balance.matches} partido
          {balance.matches === 1 ? '' : 's'}, menos {formatEuro(balance.expenses)} de gastos
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
                <dd>{formatEuro(row.total)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h3 className="section">Gastos de la temporada</h3>

      {adding ? (
        <ExpenseForm
          season={season}
          onCancel={() => setAdding(false)}
          onSave={(expense) => {
            onAdd(expense)
            setAdding(false)
          }}
        />
      ) : (
        <button className="primary" onClick={() => setAdding(true)}>
          Añadir gasto
        </button>
      )}

      {ofSeason.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          Todavía no hay gastos apuntados en esta temporada.
        </div>
      ) : (
        <div className="rows" style={{ marginTop: 12 }}>
          {ofSeason.map((expense) => (
            <div className="row expense" key={expense.id}>
              <div>
                <strong>{expense.concept}</strong>
                <div className="meta">
                  {formatShortDate(expense.date)} ·{' '}
                  {CATEGORY_LABEL.get(expense.category) ?? expense.category}
                </div>
              </div>
              <div className="expense-right">
                <span className="amount">{formatEuro(expense.amount)}</span>
                <button
                  className="icon-btn"
                  onClick={() => onDelete(expense.id)}
                  aria-label={`Borrar ${expense.concept}`}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ExpenseForm({
  season, onSave, onCancel,
}: {
  season: number
  onSave: (expense: Omit<Expense, 'id'>) => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  // Si se apunta un gasto de una temporada pasada, la fecha por defecto cae
  // dentro de ella y no en el día de hoy.
  const inSeason = today >= `${season}-07-01` && today <= `${season + 1}-06-30`

  const [concept, setConcept] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(inSeason ? today : `${season}-09-01`)
  const [category, setCategory] = useState<ExpenseCategory>('cuota')
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
        <button className="primary" onClick={save}>Guardar gasto</button>
        <button className="ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
