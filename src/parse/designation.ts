import { fold, parseSpanishDate, parseTime, tidy } from '../lib/text'


/** Los datos del partido, vengan del PDF o del correo. */
export interface MatchDetails {
  designacion: string | null
  role: string | null
  kickoff: string | null
  competition: string | null
  group: string | null
  homeTeam: string | null
  awayTeam: string | null
  venue: string | null
  city: string | null
}

export const EMPTY_DETAILS: MatchDetails = {
  designacion: null,
  role: null,
  kickoff: null,
  competition: null,
  group: null,
  homeTeam: null,
  awayTeam: null,
  venue: null,
  city: null,
}

/**
 * Lee el partido de la pagina de designacion del PDF, que lo cuenta en prosa:
 *
 *   Con fecha 05-09-2026 a las 20:00, APELLIDOS, NOMBRE actuará como ARBITRO
 *   entre los equipos MARTOS y APEDEM de la AMISTOSO MARTOS JUVENIL.
 *   El partido tendrá lugar en el campo Martos - ESTADIO MUNICIPAL de Martos.
 *
 * Es mas fiable que el cuerpo del correo: el PDF siempre viene con la misma
 * forma, mientras que el correo llega unas veces en texto y otras en HTML, y
 * al convertirlo se pierden los saltos de linea en los que se apoyaban las
 * etiquetas.
 */
export function detailsFromPdf(text: string): MatchDetails {
  // Solo la pagina de la designacion. El resto del impreso (los recibos del
  // club, el formulario de gastos) repite las mismas frases con otros datos, y
  // al aplanar el documento entero las expresiones saltaban de una pagina a
  // otra y se llevaban por delante medio PDF.
  const page = designationPage(text)
  // El texto se aplana: las frases se parten en varias lineas al maquetar.
  const flat = tidy(page.replace(/\u00a0/g, ' '))
  const plain = fold(flat)

  return {
    designacion: capture(flat, plain, /designacion\s*n[ºo°.]*\s*:?\s*(\d{4,})/i),
    role: capture(flat, plain, /actuar[aá]\s+como\s+([A-ZÁÉÍÓÚÑ0-9º\s.]+?)\s+entre\s+los\s+equipos/i)
      ?? capture(flat, plain, /designacion\s+de\s+([A-Z0-9º\s.]+?)\s{2,}/i),
    kickoff: kickoffFrom(plain),
    ...teamsAndCompetition(flat, plain),
    ...venueAndCity(flat, plain),
  }
}

/**
 * El trozo del documento que corresponde a la designacion del arbitro. Si no se
 * reconoce se devuelve el texto entero, que es mejor que nada.
 */
function designationPage(text: string): string {
  const pages = text.split('\f')
  const found = pages.find((page) =>
    fold(page)
      .split('\n')
      .some((line) => /^designacion\s+de\s+\S/i.test(line.trim())),
  )
  if (found) return found
  // Sin salto de pagina: se corta desde el titulo hasta el siguiente membrete.
  const start = fold(text).search(/designacion\s+de\s+\S/i)
  return start === -1 ? text : text.slice(start, start + 2500)
}

/**
 * Ningun dato de un partido es tan largo. Un valor pasado de aqui significa que
 * la expresion ha saltado de una frase a otra y se ha llevado por delante medio
 * documento: mejor dejarlo vacio que enseñar un ladrillo.
 */
const MAX_FIELD = 120

/** Busca sobre el texto sin acentos y devuelve el trozo original, que sí los lleva. */
function capture(original: string, plain: string, re: RegExp): string | null {
  const m = new RegExp(re.source, re.flags.includes('d') ? re.flags : re.flags + 'd').exec(plain)
  const at = m?.indices?.[1]
  if (!at) return null
  return sane(original.slice(at[0], at[1]))
}

/** Recorta, y descarta lo que sea absurdamente largo para ser un dato. */
function sane(raw: string): string | null {
  const value = tidy(raw)
  return value && value.length <= MAX_FIELD ? value : null
}

function kickoffFrom(plain: string): string | null {
  const m = /con\s+fecha\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})(?:\s*,?\s*a\s+las\s+(\d{1,2}[:.]\d{2}))?/i.exec(plain)
  if (!m) return null
  const date = parseSpanishDate(m[1])
  if (!date) return null
  const time = m[2] ? parseTime(m[2]) : null
  return time ? `${date}T${time}` : date
}

/**
 * "entre los equipos A y B de la COMPETICION, grupo GRUPO ." — el nombre de los
 * equipos lleva puntos y comas dentro ("C.D. TUGIA JUEGO LIMPIO"), asi que no
 * vale cortar por puntuacion: se corta por las palabras que separan los campos.
 */
function teamsAndCompetition(original: string, plain: string): Pick<
  MatchDetails,
  'homeTeam' | 'awayTeam' | 'competition' | 'group'
> {
  const teams =
    /entre\s+los\s+equipos\s+(.+?)\s+y\s+(.+?)\s+de\s+la\s+(.+?)\s*(?:,\s*grupo\s+(.+?)\s*)?\.(?:\s|$)/i
  const m = new RegExp(teams.source, teams.flags + 'd').exec(plain)
  if (!m?.indices) return { homeTeam: null, awayTeam: null, competition: null, group: null }

  const slice = (index: number) => {
    const at = m.indices?.[index]
    return at ? sane(original.slice(at[0], at[1])) : null
  }
  return {
    homeTeam: slice(1),
    awayTeam: slice(2),
    competition: slice(3),
    group: slice(4),
  }
}

/**
 * "tendrá lugar en el campo CAMPO de LOCALIDAD ."
 *
 * El nombre del campo suele llevar su propio "de" dentro ("CIUDAD DE MARTOS
 * ESTADIO MUNICIPAL"), asi que el campo se captura de forma codiciosa para que
 * el corte caiga en el ULTIMO "de", que es el que separa campo y localidad.
 */
function venueAndCity(original: string, plain: string): Pick<MatchDetails, 'venue' | 'city'> {
  // Se captura la frase completa, sin pasar del primer punto que cierra
  // oracion, y se parte despues. Buscar el "de" con una expresion codiciosa
  // hacia delante se llevaba por delante el resto del documento.
  const re = /en\s+el\s+campo\s+(.+?)\.(?:\s|$)/i
  const m = new RegExp(re.source, re.flags + 'd').exec(plain)
  const at = m?.indices?.[1]
  if (!at) return { venue: null, city: null }

  const sentence = original.slice(at[0], at[1])
  if (sentence.length > MAX_FIELD * 2) return { venue: null, city: null }

  // El nombre del campo lleva su propio "de" dentro ("CIUDAD DE MARTOS ESTADIO
  // MUNICIPAL"), asi que el corte con la localidad va por el ultimo.
  const cut = fold(sentence).toLowerCase().lastIndexOf(' de ')
  if (cut === -1) return { venue: sane(sentence), city: null }

  return {
    venue: sane(sentence.slice(0, cut)),
    city: sane(sentence.slice(cut + 4)),
  }
}

/**
 * Descarta los valores que ya venian mal de una version anterior. Sin esto, un
 * "campo" que se habia llevado medio PDF por delante se quedaria pegado para
 * siempre, porque al reanalizar sigue siendo el unico valor disponible si el
 * PDF ya no esta guardado.
 */
export function sanitizeDetails(details: Partial<MatchDetails>): Partial<MatchDetails> {
  const clean: Partial<MatchDetails> = {}
  for (const key of Object.keys(EMPTY_DETAILS) as (keyof MatchDetails)[]) {
    clean[key] = sane(details[key] ?? '')
  }
  return clean
}

/** Junta varias lecturas: gana la primera que tenga cada campo. */
export function mergeDetails(...sources: Partial<MatchDetails>[]): MatchDetails {
  const result = { ...EMPTY_DETAILS }
  for (const key of Object.keys(EMPTY_DETAILS) as (keyof MatchDetails)[]) {
    for (const source of sources) {
      const value = source[key]
      if (value) {
        result[key] = value
        break
      }
    }
  }
  return result
}
