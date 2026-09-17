import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEmail } from '../scripts/_bundle.mjs'

const { parseDesignationEmail, isDesignationEmail, designationKind } = await loadEmail()

// Un correo real del Comité de Árbitros, con el DNI y el nombre cambiados.
const CORREO = `Le ha sido asignada la siguiente designación:

     Designacion: 1968465
     Para: APELLIDO APELLIDO, NOMBRE
     Con DNI: 00000000X
     En funcion de: ARBITRO

     Fecha partido: 05-09-2026
     Hora comienzo: 20:00

     Campo: Martos - CIUDAD DE MARTOS ESTADIO MUNICIPAL
     Direccion: C/ DR. FLEMING, S/N
     Localidad: Martos

     Competicion : AMISTOSO MARTOS JUVENIL
     Equipo de casa : MARTOS
     Equipo visitante : APEDEM

     Actuando como:

     ASISTENTE: OTRO OTRO, NOMBRE
     Telefonos: 600000000
`

test('reconoce un correo de designación', () => {
  assert.ok(isDesignationEmail(CORREO))
  assert.ok(isDesignationEmail('Le ha sido asignada la siguiente designacion:'))
  assert.ok(!isDesignationEmail('Boletín semanal del comité'))
})

test('saca todos los campos del partido', () => {
  const parsed = parseDesignationEmail(CORREO)
  assert.equal(parsed.designacion, '1968465')
  assert.equal(parsed.role, 'ARBITRO')
  assert.equal(parsed.kickoff, '2026-09-05T20:00')
  assert.equal(parsed.competition, 'AMISTOSO MARTOS JUVENIL')
  assert.equal(parsed.homeTeam, 'MARTOS')
  assert.equal(parsed.awayTeam, 'APEDEM')
  assert.equal(parsed.venue, 'Martos - CIUDAD DE MARTOS ESTADIO MUNICIPAL')
  assert.equal(parsed.city, 'Martos')
})

test('aguanta el espacio antes de los dos puntos y las tildes', () => {
  const variante = CORREO
    .replace('Competicion :', 'Competición:')
    .replace('Equipo de casa :', 'Equipo de casa:')
  const parsed = parseDesignationEmail(variante)
  assert.equal(parsed.competition, 'AMISTOSO MARTOS JUVENIL')
  assert.equal(parsed.homeTeam, 'MARTOS')
})

test('conserva las tildes en los valores', () => {
  const parsed = parseDesignationEmail(CORREO.replace('Localidad: Martos', 'Localidad: Jaén'))
  assert.equal(parsed.city, 'Jaén')
})

test('un correo incompleto no revienta', () => {
  const parsed = parseDesignationEmail('Le ha sido asignada la siguiente designación:\n\nDesignacion: 42\n')
  assert.equal(parsed.designacion, '42')
  assert.equal(parsed.kickoff, null)
  assert.equal(parsed.homeTeam, null)
})

// El mismo partido, pero avisando de un cambio. Trae "Grupo" y la errata
// "Categoroa" que escribe el propio comité.
const CORREO_CAMBIO = `Su designación ha sido cambiada:

     Designacion: 1966778
     Para: APELLIDO APELLIDO, NOMBRE
     En funcion de: ARBITRO

     Fecha partido: 06-09-2026
     Hora comienzo: 19:30

     Campo: Jamilena - CAMPO MUNICIPAL
     Direccion: GARCIA LORCA, S/N
     Localidad: Jamilena

     Competicion : 1ª Andaluza Sénior (Jaén)
     Grupo : Grupo Único
     Categoroa : 1ª ANDALUZA SENIOR (1AS)
     Equipo de casa : JAMILENA ATCO. C.D. DE FUTBOL
     Equipo visitante : C.D. TUGIA JUEGO LIMPIO ROMERO VERDE
`

test('reconoce también los correos de designación cambiada', () => {
  assert.ok(isDesignationEmail(CORREO_CAMBIO))
  assert.equal(parseDesignationEmail(CORREO_CAMBIO).kind, 'cambiada')
  assert.equal(parseDesignationEmail(CORREO).kind, 'asignada')
})

test('saca los campos de un correo de cambio', () => {
  const parsed = parseDesignationEmail(CORREO_CAMBIO)
  assert.equal(parsed.designacion, '1966778')
  assert.equal(parsed.kickoff, '2026-09-06T19:30')
  assert.equal(parsed.competition, '1ª Andaluza Sénior (Jaén)')
  assert.equal(parsed.group, 'Grupo Único')
  assert.equal(parsed.homeTeam, 'JAMILENA ATCO. C.D. DE FUTBOL')
  assert.equal(parsed.awayTeam, 'C.D. TUGIA JUEGO LIMPIO ROMERO VERDE')
  assert.equal(parsed.city, 'Jamilena')
})

test('un correo cualquiera del comité no cuenta como designación', () => {
  assert.equal(parseDesignationEmail('Circular informativa del comité').kind, null)
})

test('aguanta los saltos de línea de un correo de verdad (CRLF)', () => {
  const parsed = parseDesignationEmail(CORREO.replace(/\n/g, '\r\n'))
  assert.equal(parsed.homeTeam, 'MARTOS')
  assert.equal(parsed.city, 'Martos')
})

test('aguanta la sangría con espacios duros', () => {
  const parsed = parseDesignationEmail(CORREO.replace(/ {5}/g, '     '))
  assert.equal(parsed.homeTeam, 'MARTOS')
  assert.equal(parsed.competition, 'AMISTOSO MARTOS JUVENIL')
})

test('aguanta un correo en HTML que ha perdido los saltos de línea', () => {
  // Al pasar el HTML a texto todos los campos quedan pegados en un párrafo.
  // Sin cortar por la siguiente etiqueta, el primer valor se comería el resto.
  const aplanado = CORREO.replace(/\s*\n\s*/g, ' ')
  const parsed = parseDesignationEmail(aplanado)
  assert.equal(parsed.designacion, '1968465')
  assert.equal(parsed.homeTeam, 'MARTOS')
  assert.equal(parsed.awayTeam, 'APEDEM')
  assert.equal(parsed.competition, 'AMISTOSO MARTOS JUVENIL')
  assert.equal(parsed.city, 'Martos')
  assert.equal(parsed.kickoff, '2026-09-05T20:00')
})

test('reconoce una anulación', () => {
  assert.equal(designationKind('Su designación ha sido anulada:'), 'anulada')
  assert.equal(designationKind('SU DESIGNACIÓN HA SIDO CANCELADA'), 'anulada')
  assert.equal(designationKind(CORREO), 'asignada')
})

// El flujo real de una designación anulada: primero se asigna y después se
// cancela. Los dos correos llevan el mismo número y el mismo cuerpo.
const CUERPO_1944727 = `
     Designacion: 1944727
     Para: APELLIDO APELLIDO, NOMBRE
     En funcion de: ARBITRO

     Fecha partido: 25-05-2026
     Hora comienzo: 18:30

     Campo: Los Villares - CAMPO J. ANTONIO MANRIQUE
     Direccion: LLANILLOS, S/N
     Localidad: Villares (Los)

     Competicion : Trofeo Copa Diputación Infantil (Jaén)
     Grupo : Fase Plata
     Categoroa : 3ª ANDALUZA INFANTIL (3AI)
     Equipo de casa : LOS VILLARES C.F.
     Equipo visitante : C.D. BETIS ILITURGITANO "B"

     Actuando como:
`

test('reconoce la cancelación tal y como la escribe el comité', () => {
  const parsed = parseDesignationEmail(`Su designación ha sido cancelada:\n${CUERPO_1944727}`)
  assert.equal(parsed.kind, 'anulada')
  assert.equal(parsed.designacion, '1944727')
})

test('la asignación y su cancelación dan los mismos datos', () => {
  const asignada = parseDesignationEmail(
    `Le ha sido asignada la siguiente designación:\n${CUERPO_1944727}`,
  )
  const cancelada = parseDesignationEmail(`Su designación ha sido cancelada:\n${CUERPO_1944727}`)

  assert.equal(asignada.kind, 'asignada')
  assert.equal(cancelada.kind, 'anulada')
  for (const campo of ['designacion', 'kickoff', 'homeTeam', 'awayTeam', 'competition', 'city']) {
    assert.equal(asignada[campo], cancelada[campo], campo)
  }
})

test('saca los campos con paréntesis y comillas dentro', () => {
  const parsed = parseDesignationEmail(`Su designación ha sido cancelada:\n${CUERPO_1944727}`)
  assert.equal(parsed.city, 'Villares (Los)')
  assert.equal(parsed.competition, 'Trofeo Copa Diputación Infantil (Jaén)')
  assert.equal(parsed.group, 'Fase Plata')
  assert.equal(parsed.homeTeam, 'LOS VILLARES C.F.')
  assert.equal(parsed.awayTeam, 'C.D. BETIS ILITURGITANO "B"')
  assert.equal(parsed.venue, 'Los Villares - CAMPO J. ANTONIO MANRIQUE')
  assert.equal(parsed.kickoff, '2026-05-25T18:30')
})
