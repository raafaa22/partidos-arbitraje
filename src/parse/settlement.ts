import { fold } from '../lib/text'

/** Un fragmento de texto colocado en la pagina, tal y como lo da pdf.js. */
export interface PlacedText {
  x: number
  y: number
  width: number
  text: string
}

/**
 * Reconstruye las filas de una pagina a partir de los fragmentos sueltos.
 * pdf.js no devuelve lineas: devuelve cada celda de la tabla por su cuenta, y
 * sin volver a juntarlas por su posicion es imposible saber que importe
 * pertenece a que concepto.
 */
export function linesFromItems(items: PlacedText[]): string {
  // En PDF la Y crece hacia arriba: de mayor a menor es de arriba abajo.
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x))

  const lines: string[] = []
  let row: PlacedText[] = []
  for (const item of sorted) {
    if (row.length && Math.abs(item.y - row[0].y) > 3) {
      lines.push(joinRow(row))
      row = []
    }
    row.push(item)
  }
  if (row.length) lines.push(joinRow(row))

  return lines.filter((line) => line.trim()).join('\n')
}

/** Une las celdas de una fila metiendo un espacio solo donde habia hueco real. */
function joinRow(items: PlacedText[]): string {
  let out = ''
  let cursor = -Infinity
  for (const item of items) {
    if (out && item.x - cursor > 1) out += ' '
    out += item.text
    cursor = item.x + item.width
  }
  return out.replace(/\s+/g, ' ').trim()
}


/**
 * Lectura del importe en el impreso de liquidacion de la RFAF. Es logica pura
 * sobre el texto ya extraido, para poder probarla sin navegador.
 */

export interface Settlement {
  amount: number | null
  /** De donde sale el importe, para poder auditarlo desde la app. */
  amountSource: string
  breakdown: { label: string; value: number }[]
}

/** "1.234,56" -> 1234.56 ; "45,00" -> 45 ; "45" -> 45 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  let normalized: string
  if (cleaned.includes(',')) {
    // Coma decimal a la espanola: los puntos separan millares.
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+\.\d{1,2}$/.test(cleaned)) {
    normalized = cleaned
  } else {
    normalized = cleaned.replace(/\./g, '')
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

const MONEY = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)|\b\d+(?:\.\d{2})?\s*(?:€|EUR(?:OS)?\b)/gi

/** Ultimo importe de una linea; en una tabla es el de la columna de la derecha. */
function amountInLine(line: string): number | null {
  const hits = [...line.matchAll(MONEY)]
  return hits.length ? parseAmount(hits[hits.length - 1][0]) : null
}

/** Señales de que una designacion es una demostracion y no un partido de verdad. */
export interface DemoSigns {
  /** Anotaciones /Subtype /Watermark del PDF. */
  watermarks: number
  /** Apariciones de "demo" en el texto del PDF. */
  demoHits: number
  /** El correo dice "Su designacion ha sido cambiada" en vez de "Le ha sido asignada". */
  changed: boolean
}

/**
 * Hacen falta las DOS señales a la vez:
 *
 *  1. El PDF sale de PD4ML sin licencia, que estampa "PD4ML DEMO MODE" en los
 *     bordes. Esa marca no va en el texto de la pagina sino en anotaciones
 *     /Subtype /Watermark, asi que se cuentan: es el marcador que pone la
 *     propia libreria, no una palabra que haya que adivinar.
 *  2. El correo es de los de "Su designacion ha sido cambiada".
 *
 * Por separado ninguna de las dos basta: una designacion cambiada de verdad
 * trae un PDF limpio, y un PDF con marca de agua en un correo de asignacion
 * normal es un partido real generado con una licencia caducada.
 */
export function isDemoPdf(signs: DemoSigns, textThreshold: number): boolean {
  const marked = signs.watermarks > 0 || signs.demoHits >= textThreshold
  return marked && signs.changed
}

export function demoReason(signs: DemoSigns, textThreshold: number): string {
  const mark =
    signs.watermarks > 0
      ? `${signs.watermarks} marca(s) de agua (PD4ML DEMO MODE)`
      : signs.demoHits >= textThreshold
        ? `la palabra "demo" ${signs.demoHits} veces en el texto`
        : null

  if (mark && signs.changed) return `Demo: ${mark} y el correo es de designación cambiada`
  if (mark) return `Partido real: ${mark}, pero el correo es de asignación normal`
  if (signs.changed) return 'Partido real: designación cambiada, pero el PDF no tiene marcas'
  return 'Partido real: sin marcas de demostración'
}

/**
 * Cuenta las apariciones de "demo" en el texto. Se mira tambien el texto sin
 * espacios porque algunas marcas de agua se dibujan letra a letra y pdf.js las
 * devuelve separadas ("D E M O").
 */
export function countDemoMarks(text: string): number {
  const flat = fold(text).toLowerCase()
  const spaced = (flat.match(/\bdemo(?:stracion)?\b/g) ?? []).length
  const squeezed = (flat.replace(/\s+/g, '').match(/demo/g) ?? []).length
  return Math.max(spaced, squeezed)
}

export function findDesignacion(text: string): string | null {
  const m = /designaci[oó]n\s*N[ºo°.]*\s*:?\s*(\d{4,})/i.exec(text)
  return m ? m[1] : null
}

/**
 * La pagina de la liquidacion personal: la que encabeza "Designacion de ARBITRO"
 * (o del rol que toque). Es la unica que lleva lo que cobra uno. Las otras
 * paginas del impreso llevan lo que paga el club al trio arbitral entero, que
 * es bastante mas: en un partido de 19 € para el arbitro, la hoja del club
 * pone 41 € porque incluye a los dos asistentes.
 */
function findPersonalPage(pages: string[]): number {
  // El titulo va despues del membrete de la RFAF, asi que se busca en toda la
  // pagina una linea que sea solo "Designacion de <rol>".
  return pages.findIndex((page) =>
    fold(page)
      .split('\n')
      .some((line) => /^designacion\s+de\s+\S/i.test(line.trim())),
  )
}

/** "Con fecha 05-09-2026 a las 20:00" -> { date, time }. Respaldo por si el correo no se deja leer. */
export function findKickoff(text: string): { date: string; time: string | null } | null {
  const m = /con\s+fecha\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})(?:\s*,?\s*a\s+las\s+(\d{1,2}[:.]\d{2}))?/i.exec(
    fold(text),
  )
  if (!m) return null
  return { date: m[1], time: m[2] ?? null }
}

const CONCEPT = /importe\s+arbitraje|gastos?\s+por\s+manutencion|manutencion|kilometraje|dietas?|desplazamiento/i

function readPage(page: string): Settlement['breakdown'] {
  const rows: Settlement['breakdown'] = []
  for (const line of page.split('\n')) {
    if (!CONCEPT.test(fold(line))) continue
    const value = amountInLine(line)
    if (value !== null) rows.push({ label: line.replace(MONEY, '').trim(), value })
  }
  return rows
}

function totalInPage(page: string): { value: number; line: string } | null {
  const lines = page.split('\n')
  // De abajo arriba: el total cierra el bloque de la liquidacion.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^total\b/i.test(fold(lines[i]).trim())) continue
    const value = amountInLine(lines[i])
    if (value !== null) return { value, line: lines[i].trim() }
  }
  return null
}

export function readSettlement(pages: string[]): Settlement {
  const personal = findPersonalPage(pages)

  if (personal !== -1) {
    const breakdown = readPage(pages[personal])
    const total = totalInPage(pages[personal])
    if (total) {
      return {
        amount: total.value,
        amountSource: `Total de la página de designación (pág. ${personal + 1}): "${total.line}"`,
        breakdown,
      }
    }
    if (breakdown.length) {
      return {
        amount: breakdown.reduce((sum, row) => sum + row.value, 0),
        amountSource: `Suma de los conceptos de la pág. ${personal + 1}`,
        breakdown,
      }
    }
  }

  // Sin pagina de designacion reconocible: el menor de los totales del
  // documento, que es el del arbitro y no el del trio arbitral entero.
  const totals = pages.flatMap((page) => {
    const hit = totalInPage(page)
    return hit && hit.value > 0 ? [hit.value] : []
  })
  if (totals.length) {
    return {
      amount: Math.min(...totals),
      amountSource: `Menor de los ${totals.length} totales del PDF (no se encontró la página de designación)`,
      breakdown: [],
    }
  }

  return { amount: null, amountSource: 'No se ha encontrado ningún importe', breakdown: [] }
}
