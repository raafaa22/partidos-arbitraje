import { fold, parseSpanishDate, parseTime, tidy } from '../lib/text'
import { EMPTY_DETAILS, type MatchDetails } from './designation'

/** Los tipos de correo que manda el comité sobre una designación. */
export type DesignationKind = 'asignada' | 'cambiada' | 'anulada'

export interface ParsedEmail extends MatchDetails {
  kind: DesignationKind | null
}

/**
 * Las frases que identifican cada tipo. Se comparan sin acentos y en
 * minusculas, asi que aqui van ya en esa forma.
 */
const MARKERS: { kind: DesignationKind; texts: string[] }[] = [
  // La anulacion va primero: un correo de anulacion puede citar la designacion
  // original y arrastrar sus frases.
  {
    kind: 'anulada',
    texts: [
      'su designacion ha sido anulada',
      'su designacion ha sido cancelada',
      'le ha sido anulada la siguiente designacion',
      'designacion anulada',
      'ha sido desasignado',
      'ha sido desasignada',
      'queda sin efecto',
    ],
  },
  { kind: 'cambiada', texts: ['su designacion ha sido cambiada'] },
  { kind: 'asignada', texts: ['le ha sido asignada la siguiente designacion'] },
]

/** Qué tipo de correo es, o `null` si no habla de una designación. */
export function designationKind(text: string): DesignationKind | null {
  const flat = normalize(fold(text)).toLowerCase()
  for (const marker of MARKERS) {
    if (marker.texts.some((phrase) => flat.includes(phrase))) return marker.kind
  }
  return null
}

export function isDesignationEmail(text: string): boolean {
  return designationKind(text) !== null
}

/** Espacios raros a espacios normales: el comité usa mucho el espacio duro. */
function normalize(text: string): string {
  return text.replace(/[\u00a0\u2007\u202f\u2009]/g, ' ')
}

/** Las etiquetas del correo, con las variantes y erratas que escribe el comité. */
const LABELS: { key: keyof MatchDetails | 'date' | 'time'; names: string[] }[] = [
  { key: 'designacion', names: ['Designacion', 'Numero de designacion'] },
  { key: 'role', names: ['En funcion de', 'Funcion'] },
  { key: 'date', names: ['Fecha partido', 'Fecha del partido', 'Fecha'] },
  { key: 'time', names: ['Hora comienzo', 'Hora de comienzo', 'Hora'] },
  { key: 'venue', names: ['Campo', 'Instalacion'] },
  { key: 'city', names: ['Localidad', 'Municipio'] },
  { key: 'competition', names: ['Competicion', 'Categoria', 'Categoroa'] },
  { key: 'group', names: ['Grupo'] },
  { key: 'homeTeam', names: ['Equipo de casa', 'Equipo local'] },
  { key: 'awayTeam', names: ['Equipo visitante'] },
]

// Otras etiquetas que no interesan, pero que sirven para saber donde termina
// el valor de la anterior cuando el correo llega sin saltos de linea.
const STOP_LABELS = ['Para', 'Con DNI', 'DNI', 'Direccion', 'Actuando como', 'ASISTENTE', 'ARBITRO', 'Telefonos']

const ALL_LABELS = [...LABELS.flatMap((label) => label.names), ...STOP_LABELS]
  .sort((a, b) => b.length - a.length) // las largas primero: "Fecha partido" antes que "Fecha"
  .map((name) => name.replace(/ /g, '\\s+'))

// `(?<!\S)` exige que la etiqueta empiece linea o vaya tras un espacio, pero
// sin consumirlo: si lo consumiera, una etiqueta pegada al final del valor
// anterior quedaria fuera del alcance de la busqueda.
const BOUNDARY = new RegExp(String.raw`(?<!\S)(?:${ALL_LABELS.join('|')})\s*:`, 'gi')

/**
 * Lee un campo con formato "Etiqueta: valor".
 *
 * El valor llega hasta el final de la linea O hasta la siguiente etiqueta, lo
 * que ocurra antes. Esa segunda condicion es la que salva los correos que
 * llegan en HTML: al pasarlos a texto se pierden los saltos de linea y todos
 * los campos quedan pegados en un parrafo. Anclar solo al final de linea se
 * comia el resto del correo.
 */
function field(original: string, plain: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(String.raw`(?<!\S)${name.replace(/ /g, '\\s+')}\s*:[ \t]*`, 'gid')

    // Se recorren TODAS las apariciones de la etiqueta y se devuelve la primera
    // que traiga valor. Hace falta porque la frase que encabeza el correo ya
    // contiene la palabra ("...la siguiente designación:") y esa aparicion va
    // vacia: quedandose con la primera no se leeria nunca el numero.
    for (const m of plain.matchAll(re)) {
      if (!m.indices) continue
      const start = m.indices[0][1]
      let end = plain.length

      const newline = plain.indexOf('\n', start)
      if (newline !== -1) end = newline

      BOUNDARY.lastIndex = start
      const next = BOUNDARY.exec(plain)
      if (next && next.index < end) end = next.index

      const value = tidy(original.slice(start, end))
      if (value) return value
    }
  }
  return null
}

export function parseDesignationEmail(text: string): ParsedEmail {
  const original = normalize(text)
  const plain = fold(original)
  const get = (key: (typeof LABELS)[number]['key']) => {
    const label = LABELS.find((entry) => entry.key === key)
    return label ? field(original, plain, label.names) : null
  }

  const dateRaw = get('date')
  const timeRaw = get('time')
  const date = dateRaw ? parseSpanishDate(dateRaw) : null
  const time = timeRaw ? parseTime(timeRaw) : null

  return {
    ...EMPTY_DETAILS,
    kind: designationKind(text),
    designacion: get('designacion'),
    role: get('role'),
    kickoff: date ? (time ? `${date}T${time}` : date) : null,
    competition: get('competition'),
    group: get('group'),
    homeTeam: get('homeTeam'),
    awayTeam: get('awayTeam'),
    venue: get('venue'),
    city: get('city'),
  }
}
