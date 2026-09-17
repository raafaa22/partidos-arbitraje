const ACCENTED = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ'
const PLAIN = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'

/**
 * Quita acentos manteniendo la longitud exacta de la cadena, para poder buscar
 * con expresiones regulares sobre la version "plana" y recortar el valor de la
 * original conservando las tildes.
 */
export function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    const i = ACCENTED.indexOf(ch)
    out += i === -1 ? ch : PLAIN[i]
  }
  return out
}

/** Colapsa espacios y recorta. */
export function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** "05-09-2026" o "05/09/2026" -> "2026-09-05". Devuelve null si no cuadra. */
export function parseSpanishDate(value: string): string | null {
  const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(value)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** "20:00", "20.00" o "20h" -> "20:00". */
export function parseTime(value: string): string | null {
  const m = /(\d{1,2})[:.h](\d{2})/.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const min = Number(m[2])
  if (hour > 23 || min > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function formatEuro(value: number): string {
  return value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** "2026-09-05T20:00" -> "sábado 5 de septiembre, 20:00". */
export function formatKickoff(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const [datePart, timePart] = iso.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const label = `${WEEKDAYS[date.getDay()]} ${d} de ${MONTHS[m - 1]} de ${y}`
  return timePart ? `${label}, ${timePart}` : label
}

/** Un partido ya jugado es un partido que te deben. */
export function isPast(iso: string | null): boolean {
  if (!iso) return true
  return new Date(iso).getTime() < Date.now()
}

/**
 * Un nombre de equipo reducido a lo comparable. El mismo partido llega de dos
 * federaciones con formatos distintos: "(604001) Córdoba CF" y "CORDOBA CF"
 * son el mismo equipo, pero no se parecen en nada como cadenas.
 *
 * Se quitan los codigos entre parentesis, los acentos, la puntuacion y las
 * mayusculas.
 */
export function teamKey(name: string | null): string {
  if (!name) return ''
  return fold(name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * Identifica un partido con independencia de quien lo designe: mismo dia, misma
 * hora y mismos equipos. Vacio si falta algo, porque sin los tres datos no hay
 * forma de afirmar que dos designaciones son el mismo partido.
 */
export function matchKey(
  kickoff: string | null,
  homeTeam: string | null,
  awayTeam: string | null,
): string {
  const home = teamKey(homeTeam)
  const away = teamKey(awayTeam)
  if (!kickoff || !home || !away) return ''
  return `${kickoff}|${home}|${away}`
}
