/** Un partido tal y como lo guarda la app. El `id` es el id del mensaje de Gmail. */
export interface Match {
  id: string
  threadId: string
  /** Numero de designacion del comite, p.ej. "1968465". */
  designacion: string | null
  /** Otras designaciones del MISMO partido, cuando lo designa mas de una federacion. */
  otherDesignaciones: string[]
  /** Fecha y hora del partido, ISO local: "2026-09-05T20:00". */
  kickoff: string | null
  competition: string | null
  group: string | null
  homeTeam: string | null
  awayTeam: string | null
  venue: string | null
  city: string | null
  /** ARBITRO, ASISTENTE, CUARTO ARBITRO... */
  role: string | null
  /** Si el ultimo correo asignaba la designacion, la cambiaba o la anulaba. */
  kind: 'asignada' | 'cambiada' | 'anulada' | null
  /** La designacion acabo anulada: el partido no se arbitra. */
  cancelled: boolean
  /** Lo que cobra el arbitro, en euros. `null` si el PDF no se ha dejado leer. */
  amount: number | null
  /** De donde ha salido el importe, para poder auditarlo. */
  amountSource: string | null
  /** Desglose de la liquidacion personal. */
  breakdown: { label: string; value: number }[]
  /** El PDF lleva marca de agua de demostracion: no es un partido real. */
  isDemo: boolean
  /** Por que se ha marcado (o no) como demo. */
  demoReason: string | null
  demoHits: number
  watermarks: number
  /** Fecha del correo, ISO. */
  receivedAt: string
  pdfName: string | null
  /** Texto crudo del PDF y del correo, para la pantalla de diagnostico. */
  pdfText: string | null
  emailText: string | null
  /** Que fallo al procesar este correo, si fallo algo. */
  error: string | null
}

/** Lo que marca el usuario a mano. Vive aparte para sobrevivir a las resincronizaciones. */
export interface MatchFlags {
  paid: boolean
  paidAt: string | null
  deleted: boolean
  deletedAt: string | null
  /** Importe corregido a mano cuando el PDF no se deja leer. */
  amountOverride: number | null
  /** Fuerza o descarta la marca de demo cuando la deteccion se equivoca. */
  demoOverride: boolean | null
}

export interface Settings {
  clientId: string
  query: string
  /** Fecha desde la que interesan los partidos, en ISO: los anteriores ya estan cobrados. */
  seasonStart: string
  /** Apariciones de "demo" en el texto a partir de las cuales se descarta. */
  demoThreshold: number
  lastSync: string | null
  /** Con qué versión del análisis se procesó lo guardado. */
  dataVersion: number
}

export type Filter = 'jugados' | 'proximos' | 'pagados' | 'demos' | 'anulados' | 'papelera'

/** Las categorías de gasto de un árbitro. */
export type ExpenseCategory =
  | 'cuota'
  | 'mutualidad'
  | 'material'
  | 'desplazamiento'
  | 'cursos'
  | 'otros'

export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'cuota', label: 'Cuota' },
  { id: 'mutualidad', label: 'Mutualidad' },
  { id: 'material', label: 'Material' },
  { id: 'desplazamiento', label: 'Desplazamiento' },
  { id: 'cursos', label: 'Cursos y exámenes' },
  { id: 'otros', label: 'Otros' },
]

/** Un gasto derivado del arbitraje. */
export interface Expense {
  id: string
  concept: string
  /** En euros. */
  amount: number
  /** Fecha del gasto, ISO "aaaa-mm-dd". */
  date: string
  category: ExpenseCategory
}
