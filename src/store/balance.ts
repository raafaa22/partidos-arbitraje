import { isInSeason, seasonLabel, seasonOf } from '../lib/season'
import type { Expense, ExpenseCategory, Match, MatchFlags } from '../types'
import { effectiveAmount, effectiveDemo, flagsFor } from './db'

export interface SeasonBalance {
  season: number
  label: string
  /** Todo lo arbitrado en la temporada, cobrado o no. */
  gross: number
  /** De lo anterior, lo ya cobrado. */
  collected: number
  /** Lo que queda por cobrar. */
  pending: number
  /** Gastos de la temporada. */
  expenses: number
  /** Bruto menos gastos. */
  net: number
  /** Partidos que cuentan. */
  matches: number
  /** Partidos de la temporada cuyo importe no se ha podido leer: el bruto se queda corto. */
  unknownAmounts: number
  byCategory: { category: ExpenseCategory; total: number }[]
}

/**
 * Las cuentas de una temporada. Solo entran los partidos que se arbitran de
 * verdad: fuera los borrados, las demos y los anulados.
 */
export function seasonBalance(options: {
  season: number
  matches: Match[]
  flags: Record<string, MatchFlags>
  expenses: Expense[]
}): SeasonBalance {
  const { season, matches, flags, expenses } = options

  const mine = matches.filter((match) => {
    const entry = flagsFor(flags, match.id)
    if (entry.deleted || match.cancelled) return false
    if (effectiveDemo(match, entry)) return false
    return isInSeason(match.kickoff, season)
  })

  let gross = 0
  let collected = 0
  let unknownAmounts = 0

  for (const match of mine) {
    const entry = flagsFor(flags, match.id)
    const amount = effectiveAmount(match, entry)
    if (amount === null) {
      unknownAmounts++
      continue
    }
    gross += amount
    if (entry.paid) collected += amount
  }

  const ofSeason = expenses.filter((expense) => isInSeason(expense.date, season))
  const spent = ofSeason.reduce((total, expense) => total + expense.amount, 0)

  const byCategory = new Map<ExpenseCategory, number>()
  for (const expense of ofSeason) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount)
  }

  return {
    season,
    label: seasonLabel(season),
    gross: round(gross),
    collected: round(collected),
    pending: round(gross - collected),
    expenses: round(spent),
    net: round(gross - spent),
    matches: mine.length,
    unknownAmounts,
    byCategory: [...byCategory.entries()]
      .map(([category, total]) => ({ category, total: round(total) }))
      .sort((a, b) => b.total - a.total),
  }
}

/** Las temporadas de las que hay algo guardado, de la más reciente a la más antigua. */
export function availableSeasons(matches: Match[], expenses: Expense[]): number[] {
  const years = new Set<number>()
  for (const match of matches) if (match.kickoff) years.add(seasonOf(match.kickoff))
  for (const expense of expenses) years.add(seasonOf(expense.date))
  return [...years].sort((a, b) => b - a)
}

/** Los céntimos se van acumulando al sumar en coma flotante. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
