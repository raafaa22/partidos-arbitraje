import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { detailsFromPdf, mergeDetails } = await loadModule('src/parse/designation.ts')

// Página de designación de un PDF real, con el nombre cambiado. El PDF cuenta
// el partido en prosa, no en campos etiquetados.
const PAGINA = `C/ Afán de Ribera, 17-23
41006 Sevilla
COMITE TÉCNICO DE ÁRBITROS Tel.: 954 22 67 23
Web: http://rfaf.es
USUARIO comite 1
Designación de ARBITRO
Delegación: Designación Nº: 1968465
Con fecha 05-09-2026 a las 20:00, APELLIDO APELLIDO, NOMBRE actuará como ARBITRO entre los equipos
MARTOS y APEDEM de la AMISTOSO MARTOS JUVENIL.
El partido tendrá lugar en el campo Martos - CIUDAD DE MARTOS ESTADIO MUNICIPAL de Martos.
Personal designado actuará como:
ASISTENTE : OTRO OTRO, NOMBRE
Liquidación Euros
Importe arbitraje 19,00
Total 19,00`

// El otro PDF real: nombres de equipo con puntos dentro y grupo.
const PAGINA_CON_GRUPO = `Designación de ARBITRO
Delegación: JAÉN Designación Nº: 1966778
Con fecha 06-09-2026 a las 19:30, APELLIDO APELLIDO, NOMBRE actuará como ARBITRO entre los equipos
JAMILENA ATCO. C.D. DE FUTBOL y C.D. TUGIA JUEGO LIMPIO ROMERO VERDE de la 1ª Andaluza Sénior
(Jaén), grupo Grupo Único .
El partido tendrá lugar en el campo Jamilena - CAMPO MUNICIPAL de Jamilena.`

test('lee el partido entero de la prosa del PDF', () => {
  const d = detailsFromPdf(PAGINA)
  assert.equal(d.designacion, '1968465')
  assert.equal(d.role, 'ARBITRO')
  assert.equal(d.kickoff, '2026-09-05T20:00')
  assert.equal(d.homeTeam, 'MARTOS')
  assert.equal(d.awayTeam, 'APEDEM')
  assert.equal(d.competition, 'AMISTOSO MARTOS JUVENIL')
  assert.equal(d.city, 'Martos')
})

test('el "DE" dentro del nombre del campo no parte la localidad', () => {
  // "Martos - CIUDAD DE MARTOS ESTADIO MUNICIPAL de Martos": el corte tiene que
  // caer en el último "de", no en el que lleva el nombre del campo dentro.
  const d = detailsFromPdf(PAGINA)
  assert.equal(d.venue, 'Martos - CIUDAD DE MARTOS ESTADIO MUNICIPAL')
  assert.equal(d.city, 'Martos')
})

test('los puntos dentro del nombre de un equipo no lo cortan', () => {
  const d = detailsFromPdf(PAGINA_CON_GRUPO)
  assert.equal(d.homeTeam, 'JAMILENA ATCO. C.D. DE FUTBOL')
  assert.equal(d.awayTeam, 'C.D. TUGIA JUEGO LIMPIO ROMERO VERDE')
  assert.equal(d.competition, '1ª Andaluza Sénior (Jaén)')
  assert.equal(d.group, 'Grupo Único')
  assert.equal(d.city, 'Jamilena')
})

test('las frases partidas en varias líneas se leen igual', () => {
  // Al maquetar, "entre los equipos" queda al final de una línea y los equipos
  // en la siguiente.
  assert.equal(detailsFromPdf(PAGINA).homeTeam, 'MARTOS')
})

test('un texto que no es una designación no inventa datos', () => {
  const d = detailsFromPdf('Circular informativa del comité técnico de árbitros.')
  assert.equal(d.homeTeam, null)
  assert.equal(d.kickoff, null)
  assert.equal(d.city, null)
})

test('mergeDetails coge el primero que tenga cada campo', () => {
  const d = mergeDetails(
    { homeTeam: 'MARTOS', city: null },
    { homeTeam: 'OTRO', city: 'Martos', role: 'ARBITRO' },
  )
  assert.equal(d.homeTeam, 'MARTOS')
  assert.equal(d.city, 'Martos')
  assert.equal(d.role, 'ARBITRO')
})
