import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSettlement } from '../scripts/_bundle.mjs'

const {
  readSettlement, countDemoMarks, findDesignacion, findKickoff, linesFromItems, parseAmount,
  isDemoPdf, demoReason,
} = await loadSettlement()

// Las tres paginas de un PDF real de la RFAF, con los nombres cambiados.
// Lo importante es la pagina 1: el "Total" del arbitro son 19,00 €, mientras
// que la pagina 2 (lo que paga el club al trio arbitral) pone 41,00 €.
const PAGINA_DESIGNACION = `C/ Afán de Ribera, 17-23
41006 Sevilla
COMITE TÉCNICO DE ÁRBITROS Tel.: 954 22 67 23
Web: http://rfaf.es
USUARIO comite 1
Designación de ARBITRO
Delegación: Designación Nº: 1968465
Con fecha 05-09-2026 a las 20:00, APELLIDO APELLIDO, NOMBRE actuará como ARBITRO entre los equipos
LOCAL y VISITANTE de la AMISTOSO JUVENIL.
El partido tendrá lugar en el campo Campo Municipal de Localidad.
Personal designado actuará como:
ASISTENTE : OTRO OTRO, NOMBRE
Telefonos: 600000000
Liquidación Euros
Importe arbitraje 19,00
Gastos por manutención 0,00
Kilometrajes 0,00
Total 19,00
En a de 20
Firma,`

const PAGINA_CLUB = `C/ Afán de Ribera, 17-23
41006 Sevilla
USUARIO comite 1
Liquidación
Delegación: Designación Nº: 1968465
D./Dª. APELLIDO APELLIDO, NOMBRE , en función de ARBITRO del partido que enfrentan a los equipos LOCAL
y VISITANTE de la competición AMISTOSO JUVENIL, hace liquidación a esta delegación de árbitros
Liquidación CLUB LOCAL Euros
Importe arbitraje 19,00
Importe asistentes 22,00
Remanente 41,00
Total 41,00`

const PAGINA_IMPRESO = `LIQUIDACIÓN GASTOS PARTIDO Temporada 2026-2027
DESGLOSE LIQUIDACIÓN
Total Cobrado a
CONCEPTOS Árbitro A. Asistente A. Asistente *4º Árbitro TOTAL
Por derechos..........................................................................
SUMA TOTAL.........................
TOTAL GASTOS LIQUIDACIÓN EQUIPO ARBITRAL..................................................................... Euros`

const PAGINAS = [PAGINA_DESIGNACION, PAGINA_CLUB, PAGINA_IMPRESO]

test('coge lo que cobra el árbitro, no lo que paga el club', () => {
  const { amount, amountSource } = readSettlement(PAGINAS)
  assert.equal(amount, 19)
  assert.match(amountSource, /designación/i)
})

test('el orden de las páginas da igual', () => {
  assert.equal(readSettlement([PAGINA_IMPRESO, PAGINA_CLUB, PAGINA_DESIGNACION]).amount, 19)
})

test('devuelve el desglose de conceptos', () => {
  const { breakdown } = readSettlement(PAGINAS)
  assert.deepEqual(
    breakdown.map((row) => row.value),
    [19, 0, 0],
  )
})

test('sin página de designación se queda con el total más bajo', () => {
  const { amount, amountSource } = readSettlement([PAGINA_CLUB, PAGINA_IMPRESO])
  assert.equal(amount, 41)
  assert.match(amountSource, /no se encontró/i)
})

test('sin ningún importe no se inventa nada', () => {
  assert.equal(readSettlement([PAGINA_IMPRESO]).amount, null)
})

test('lee el número de designación y la fecha', () => {
  assert.equal(findDesignacion(PAGINAS.join('\n')), '1968465')
  assert.deepEqual(findKickoff(PAGINA_DESIGNACION), { date: '05-09-2026', time: '20:00' })
})

test('un PDF real no se confunde con una demo', () => {
  assert.equal(countDemoMarks(PAGINAS.join('\n')), 0)
})

test('detecta la marca de agua aunque venga letra a letra', () => {
  assert.ok(countDemoMarks('D E M O\nTotal 19,00\nD E M O') >= 2)
  assert.ok(countDemoMarks('DEMO DEMO DEMO') >= 3)
})

test('interpreta los importes a la española', () => {
  assert.equal(parseAmount('19,00'), 19)
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('41,00 €'), 41)
  assert.equal(parseAmount('sin cifras'), null)
})

test('reconstruye las filas de una tabla por su posición', () => {
  const lines = linesFromItems([
    { x: 40, y: 200, width: 60, text: 'Importe arbitraje' },
    { x: 300, y: 200, width: 30, text: '19,00' },
    { x: 40, y: 180, width: 30, text: 'Total' },
    { x: 300, y: 180, width: 30, text: '19,00' },
  ])
  assert.equal(lines, 'Importe arbitraje 19,00\nTotal 19,00')
})

test('demo: marca de agua + correo de designación cambiada', () => {
  // Los PDF de prueba salen de PD4ML sin licencia: 8 anotaciones /Watermark.
  const signs = { watermarks: 8, demoHits: 0, changed: true }
  assert.ok(isDemoPdf(signs, 2))
  assert.match(demoReason(signs, 2), /PD4ML DEMO MODE/)
})

test('una marca de agua sola no basta', () => {
  const signs = { watermarks: 8, demoHits: 0, changed: false }
  assert.equal(isDemoPdf(signs, 2), false)
  assert.match(demoReason(signs, 2), /asignación normal/)
})

test('un cambio de designación con el PDF limpio es un partido real', () => {
  const signs = { watermarks: 0, demoHits: 0, changed: true }
  assert.equal(isDemoPdf(signs, 2), false)
  assert.match(demoReason(signs, 2), /no tiene marcas/)
})

test('un PDF limpio con correo normal es un partido real', () => {
  assert.equal(isDemoPdf({ watermarks: 0, demoHits: 0, changed: false }, 2), false)
})

test('el texto sigue valiendo como red de seguridad', () => {
  assert.ok(isDemoPdf({ watermarks: 0, demoHits: 5, changed: true }, 2))
  assert.equal(isDemoPdf({ watermarks: 0, demoHits: 1, changed: true }, 2), false)
})
