/**
 * La temporada arbitral va de septiembre a junio, pero los partidos de
 * pretemporada (amistosos de julio y agosto) pertenecen a la que empieza, no a
 * la que acaba. Por eso el corte se pone el 1 de julio: asi ningun partido se
 * queda fuera de toda temporada.
 */

/** El año en que arranca la temporada a la que pertenece una fecha. */
export function seasonOf(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return month >= 7 ? year : year - 1
}

/** 2026 -> "2026/27" */
export function seasonLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** El primer y el último día de la temporada, en ISO. */
export function seasonRange(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` }
}

export function isInSeason(iso: string | null, startYear: number): boolean {
  return iso !== null && seasonOf(iso) === startYear
}

/** La temporada en curso a dia de hoy. */
export function currentSeason(now: Date = new Date()): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  return seasonOf(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`)
}
