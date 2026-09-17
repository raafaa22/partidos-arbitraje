import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { plainTextBody } = await loadModule('src/gmail/api.ts')
const { parseDesignationEmail } = await loadModule('src/parse/email.ts')

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url')
const correo = (mimeType, texto) => ({
  id: 'x',
  threadId: 'x',
  payload: { mimeType, body: { data: b64(texto) } },
})

// El comité manda etiquetas HTML dentro de la parte de TEXTO PLANO.
const CON_BR = `Le ha sido asignada la siguiente designación:<BR>
     Designacion: 1968621<BR>
     En funcion de: ARBITRO<BR> <BR>
     Fecha partido: 13-09-2026<BR>
     Hora comienzo: 19:00<BR>
     Campo: Torredelcampo - CAMPO MUNICIPAL<BR>
     Localidad: Torre Del Campo<BR> <BR>
     Competicion : 2ª ANDALUZA CADETE (JAÉN)<BR>
     Grupo : GRUPO ÚNICO<BR>
     Equipo de casa : C.D. HISPANIA DE TORREDELCAMPO<BR>
     Equipo visitante : C.D. ALCALA ENJOY<BR> <BR>`

test('limpia las etiquetas aunque vengan en la parte de texto plano', () => {
  const texto = plainTextBody(correo('text/plain', CON_BR))
  assert.ok(!texto.includes('<BR>'), 'se han quedado etiquetas dentro')
  assert.ok(!texto.includes('<br>'))
})

test('los valores salen sin el <BR> pegado detrás', () => {
  const parsed = parseDesignationEmail(plainTextBody(correo('text/plain', CON_BR)))
  assert.equal(parsed.designacion, '1968621')
  assert.equal(parsed.role, 'ARBITRO')
  assert.equal(parsed.competition, '2ª ANDALUZA CADETE (JAÉN)')
  assert.equal(parsed.group, 'GRUPO ÚNICO')
  assert.equal(parsed.homeTeam, 'C.D. HISPANIA DE TORREDELCAMPO')
  assert.equal(parsed.awayTeam, 'C.D. ALCALA ENJOY')
  assert.equal(parsed.venue, 'Torredelcampo - CAMPO MUNICIPAL')
  assert.equal(parsed.city, 'Torre Del Campo')
  assert.equal(parsed.kickoff, '2026-09-13T19:00')
})

test('un correo de texto plano de verdad no se toca', () => {
  const llano = 'Le ha sido asignada la siguiente designación:\n\n     Designacion: 1968621\n'
  assert.equal(plainTextBody(correo('text/plain', llano)), llano)
})

test('un correo en HTML también se limpia', () => {
  const html = '<html><body><p>Le ha sido asignada la siguiente designación:</p>' +
    '<p>Designacion: 1968621</p><p>Equipo de casa : MARTOS</p></body></html>'
  const parsed = parseDesignationEmail(plainTextBody(correo('text/html', html)))
  assert.equal(parsed.designacion, '1968621')
  assert.equal(parsed.homeTeam, 'MARTOS')
})

test('las entidades se descodifican en el orden correcto', () => {
  // "&amp;lt;" es un "&lt;" escrito literalmente, no un "<".
  const texto = plainTextBody(correo('text/plain', '<p>Equipo de casa : A &amp;lt; B</p>'))
  assert.match(texto, /A &lt; B/)
})

test('el analizador limpia los <BR> aunque ya estén guardados', () => {
  // Lo descargado antes de saber que el comité mete etiquetas en el texto plano
  // se arregla al reanalizar, sin volver a bajarlo de Gmail.
  const parsed = parseDesignationEmail(CON_BR)
  assert.equal(parsed.role, 'ARBITRO')
  assert.equal(parsed.homeTeam, 'C.D. HISPANIA DE TORREDELCAMPO')
  assert.equal(parsed.competition, '2ª ANDALUZA CADETE (JAÉN)')
})
