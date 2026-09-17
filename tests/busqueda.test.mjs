import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'
import { loadEmail } from '../scripts/_bundle.mjs'

const { DEFAULT_SETTINGS, gmailQuery } = await loadModule('src/store/db.ts')
const { designationKind } = await loadEmail()

test('la búsqueda pide los tres tipos de correo del comité', () => {
  const q = DEFAULT_SETTINGS.query
  assert.match(q, /Le ha sido asignada la siguiente designación/)
  // Por el tronco común, para que entren cambios, cancelaciones y anulaciones.
  assert.match(q, /Su designación ha sido/)
})

test('las frases que se buscan son las que se saben reconocer', () => {
  // Si Gmail trae un correo que el analizador no entiende, se descarta y el
  // partido se pierde en silencio. Y al revés: una frase reconocible que no
  // esté en la búsqueda no llega nunca.
  for (const frase of [
    'Le ha sido asignada la siguiente designación:',
    'Su designación ha sido cambiada:',
    'Su designación ha sido cancelada:',
    'Su designación ha sido anulada:',
  ]) {
    assert.ok(designationKind(frase), `sin reconocer: ${frase}`)
  }
})

test('el filtro de fecha deja margen hacia atrás', () => {
  // El "after:" va sobre la fecha del correo, que llega antes que el partido.
  const q = gmailQuery({ ...DEFAULT_SETTINGS, seasonStart: '2026-09-01' })
  assert.match(q, /after:2026\/7\/18/)
})
