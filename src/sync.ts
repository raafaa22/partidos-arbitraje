import {
  QuotaError, getAttachment, getMessage, header, listMessageIds, pdfAttachments, plainTextBody,
} from './gmail/api'
import { detailsFromPdf, mergeDetails, sanitizeDetails } from './parse/designation'
import { parseDesignationEmail } from './parse/email'
import { readDesignationPdf } from './parse/pdf'
import { demoReason, isDemoPdf } from './parse/settlement'
import type { Match } from './types'

/**
 * Cuanto texto se guarda de cada PDF y de cada correo. Con cientos de partidos
 * el almacenamiento del navegador (unos 5 MB) se llena y deja de guardar sin
 * avisar. Lo que se conserva es para el diagnostico y para poder reanalizar sin
 * volver a descargar: la primera pagina, que es donde esta todo, cabe de sobra.
 */
const TEXT_LIMIT = 4000

function clip(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n[…texto recortado]` : text
}

export interface SyncProgress {
  done: number
  total: number
  label: string
}

export interface SyncResult {
  matches: Match[]
  /** Correos que casaban la busqueda pero no hablaban de una designacion. */
  skipped: number
  /** Correos que no se han podido leer. Se reintentan en la proxima pasada. */
  failed: number
  /** Google ha cortado por cuota: quedan correos por traer. */
  stoppedEarly: boolean
  /** Correos que faltan por leer. */
  remaining: number
}

/**
 * Trae de Gmail los correos de designacion que aun no estan guardados y saca de
 * cada uno un partido. Los ya conocidos no se vuelven a descargar.
 *
 * Los datos del partido se leen del PDF y solo se completan con el correo: el
 * PDF siempre viene con la misma forma, mientras que el correo llega unas veces
 * en texto plano y otras en HTML, y al convertirlo se pierde la maquetacion en
 * la que se apoyan las etiquetas.
 */
/**
 * Cuantos correos nuevos se leen como mucho en una pasada. Gmail cobra por
 * peticion y corta si se le piden cientos seguidas. En uso normal llegan dos o
 * tres designaciones por semana y este tope no se toca nunca: solo existe para
 * la primera carga, que trae una temporada entera de golpe y se reparte en
 * varias pasadas.
 */
const MAX_PER_RUN = 60

export async function syncMatches(options: {
  token: string
  query: string
  demoThreshold: number
  knownIds: Set<string>
  maxPerRun?: number
  onProgress?: (progress: SyncProgress) => void
  signal?: AbortSignal
}): Promise<SyncResult> {
  const { token, query, demoThreshold, knownIds, onProgress, signal } = options
  const maxPerRun = options.maxPerRun ?? MAX_PER_RUN

  onProgress?.({ done: 0, total: 0, label: 'Buscando correos…' })
  const ids = await listMessageIds(token, query)
  const todo = ids.filter((id) => !knownIds.has(id))
  const pending = todo.slice(0, maxPerRun)
  const postponed = todo.length - pending.length

  const matches: Match[] = []
  let skipped = 0
  let failed = 0
  let stoppedEarly = false
  let done = 0

  for (const [index, id] of pending.entries()) {
    if (signal?.aborted) break
    onProgress?.({
      done: index,
      total: pending.length,
      label: `Leyendo correo ${index + 1} de ${pending.length}`,
    })

    try {
      const message = await getMessage(token, id)
      const emailText = plainTextBody(message)
      const parsed = parseDesignationEmail(emailText)

      // La busqueda de Gmail casa por palabras sueltas: hay que confirmar que
      // el correo habla de verdad de una designacion antes de contarlo.
      if (!parsed.kind) {
        skipped++
        done++
        continue
      }

      matches.push(await buildMatch({ token, id, message, emailText, parsed, demoThreshold }))
      done++
    } catch (error) {
      if (error instanceof QuotaError) {
        // Google ha cortado. Se para aqui y se devuelve lo conseguido: los
        // correos que faltan siguen sin conocerse y entran en la proxima pasada.
        stoppedEarly = true
        break
      }
      // Un fallo suelto NO se guarda como partido. Guardarlo dejaria su id
      // entre los conocidos y ese correo no se volveria a intentar nunca.
      console.warn('No se ha podido leer el correo', id, describe(error))
      failed++
      done++
    }
  }

  onProgress?.({ done: pending.length, total: pending.length, label: 'Listo' })
  return {
    matches,
    skipped,
    failed,
    stoppedEarly,
    remaining: pending.length - done + postponed,
  }
}

async function buildMatch(options: {
  token: string
  id: string
  message: Awaited<ReturnType<typeof getMessage>>
  emailText: string
  parsed: ReturnType<typeof parseDesignationEmail>
  demoThreshold: number
}): Promise<Match> {
  const { token, id, message, emailText, parsed, demoThreshold } = options

  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : (header(message, 'Date') ?? new Date().toISOString())

  const match: Match = {
    ...emptyMatch(id),
    threadId: message.threadId,
    kind: parsed.kind,
    cancelled: parsed.kind === 'anulada',
    receivedAt,
    emailText: clip(emailText),
  }

  const [pdf] = pdfAttachments(message)
  if (!pdf) {
    // Los correos de anulacion no traen liquidacion: no es un fallo.
    Object.assign(match, mergeDetails(parsed))
    if (parsed.kind !== 'anulada') match.error = 'El correo no traía ningún PDF adjunto.'
    return match
  }

  match.pdfName = pdf.filename
  try {
    const bytes = await getAttachment(token, id, pdf.attachmentId)
    const reading = await readDesignationPdf(bytes)
    const signs = { ...reading, changed: parsed.kind === 'cambiada' }

    Object.assign(match, mergeDetails(detailsFromPdf(reading.text), parsed))
    match.amount = reading.amount
    match.amountSource = reading.amountSource
    match.breakdown = reading.breakdown
    match.demoHits = reading.demoHits
    match.watermarks = reading.watermarks
    match.isDemo = isDemoPdf(signs, demoThreshold)
    match.demoReason = demoReason(signs, demoThreshold)
    match.pdfText = clip(reading.text)
  } catch (error) {
    Object.assign(match, mergeDetails(parsed))
    match.error = `No se ha podido leer el PDF: ${describe(error)}`
  }

  return match
}

function emptyMatch(id: string): Match {
  return {
    id,
    threadId: id,
    designacion: null,
    otherDesignaciones: [],
    kickoff: null,
    competition: null,
    group: null,
    homeTeam: null,
    awayTeam: null,
    venue: null,
    city: null,
    role: null,
    kind: null,
    cancelled: false,
    amount: null,
    amountSource: null,
    breakdown: [],
    isDemo: false,
    demoReason: null,
    demoHits: 0,
    watermarks: 0,
    receivedAt: new Date().toISOString(),
    pdfName: null,
    pdfText: null,
    emailText: null,
    error: null,
  }
}

/**
 * El mensaje del error mas su tipo y el primer punto de la pila. Un
 * "undefined is not a function" a secas no sirve para nada cuando el fallo solo
 * pasa en el movil de otra persona.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const origen = error.stack
    ?.split('\n')
    .slice(1)
    .find((linea) => linea.includes('.js') || linea.includes('.mjs'))
    ?.trim()
    .slice(0, 120)
  return [error.name, error.message, origen].filter(Boolean).join(' · ')
}

/**
 * Vuelve a analizar un partido ya guardado a partir del texto que se conserva
 * del PDF y del correo. No hace falta red: sirve para aplicar mejoras del
 * analisis a lo que ya estaba descargado.
 */
export function reparseMatch(match: Match, demoThreshold: number): Match {
  const parsed = match.emailText ? parseDesignationEmail(match.emailText) : null
  const fromPdf = match.pdfText ? detailsFromPdf(match.pdfText) : null
  const kind = parsed?.kind ?? match.kind

  const signs = {
    watermarks: match.watermarks,
    demoHits: match.demoHits,
    changed: kind === 'cambiada',
  }

  return {
    ...match,
    ...mergeDetails(fromPdf ?? {}, parsed ?? {}, sanitizeDetails(match)),
    kind,
    cancelled: kind === 'anulada',
    isDemo: isDemoPdf(signs, demoThreshold),
    demoReason: demoReason(signs, demoThreshold),
  }
}

/** Vuelve a bajar el PDF de un partido y lo relee entero. */
export async function refreshMatch(
  match: Match,
  token: string,
  demoThreshold: number,
): Promise<Match> {
  const message = await getMessage(token, match.id)
  const [pdf] = pdfAttachments(message)
  if (!pdf) {
    // Los correos de anulacion no traen liquidacion: no es un fallo.
    return match.kind === 'anulada'
      ? match
      : { ...match, error: 'El correo no traía ningún PDF adjunto.' }
  }

  const bytes = await getAttachment(token, match.id, pdf.attachmentId)
  const reading = await readDesignationPdf(bytes)
  const signs = { ...reading, changed: match.kind === 'cambiada' }

  return {
    ...match,
    ...mergeDetails(detailsFromPdf(reading.text), match),
    amount: reading.amount,
    amountSource: reading.amountSource,
    breakdown: reading.breakdown,
    demoHits: reading.demoHits,
    watermarks: reading.watermarks,
    isDemo: isDemoPdf(signs, demoThreshold),
    demoReason: demoReason(signs, demoThreshold),
    pdfText: clip(reading.text),
    pdfName: pdf.filename,
    error: null,
  }
}
