import type { Match } from '../types'

export interface Diagnostics {
  total: number
  sinImporte: number
  sinFecha: number
  sinEquipos: number
  sinDesignacion: number
  sinPdf: number
  porTipo: { tipo: string; cuantos: number }[]
  errores: { mensaje: string; cuantos: number }[]
  primerCorreo: string | null
  ultimoCorreo: string | null
}

/**
 * Un resumen de por que los partidos no salen bien. Con cientos de correos no
 * hay forma de revisarlos de uno en uno, y este recuento dice de un vistazo si
 * el problema es que no llega el PDF, que no se lee la fecha o que los correos
 * no son designaciones.
 */
export function diagnose(matches: Match[]): Diagnostics {
  const errores = new Map<string, number>()
  const tipos = new Map<string, number>()
  const fechas: string[] = []

  for (const match of matches) {
    const tipo = match.kind ?? 'sin reconocer'
    tipos.set(tipo, (tipos.get(tipo) ?? 0) + 1)
    if (match.error) {
      // Los mensajes llevan detalles distintos: se agrupan por su comienzo.
      const clave = match.error.split(':')[0].trim()
      errores.set(clave, (errores.get(clave) ?? 0) + 1)
    }
    if (match.receivedAt) fechas.push(match.receivedAt)
  }

  fechas.sort()

  return {
    total: matches.length,
    sinImporte: matches.filter((match) => match.amount === null).length,
    sinFecha: matches.filter((match) => !match.kickoff).length,
    sinEquipos: matches.filter((match) => !match.homeTeam && !match.awayTeam).length,
    sinDesignacion: matches.filter((match) => !match.designacion).length,
    sinPdf: matches.filter((match) => !match.pdfName).length,
    porTipo: [...tipos.entries()]
      .map(([tipo, cuantos]) => ({ tipo, cuantos }))
      .sort((a, b) => b.cuantos - a.cuantos),
    errores: [...errores.entries()]
      .map(([mensaje, cuantos]) => ({ mensaje, cuantos }))
      .sort((a, b) => b.cuantos - a.cuantos)
      .slice(0, 4),
    primerCorreo: fechas[0] ?? null,
    ultimoCorreo: fechas[fechas.length - 1] ?? null,
  }
}
