import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { GmailError, QuotaError } = await loadModule('src/gmail/api.ts')

test('un corte por cuota se distingue de una sesión caducada', () => {
  // Los dos llegan como 403. Confundirlos tiraba un token bueno y obligaba a
  // reconectar cada vez que Google frenaba las peticiones.
  const cuota = new QuotaError("Quota exceeded for quota metric 'Total Query Cost'", 403)
  const permisos = new GmailError('Request had insufficient authentication scopes', 403)

  assert.ok(cuota instanceof QuotaError)
  assert.ok(cuota instanceof GmailError, 'la cuota sigue siendo un error de Gmail')
  assert.equal(permisos instanceof QuotaError, false)
})

test('el error conserva el código y el mensaje de Google', () => {
  const error = new QuotaError('Quota exceeded', 429)
  assert.equal(error.status, 429)
  assert.match(error.message, /Quota exceeded/)
})

test('una sesión caducada es un 401', () => {
  const caducada = new GmailError('Invalid Credentials', 401)
  assert.equal(caducada.status, 401)
  assert.equal(caducada instanceof QuotaError, false)
})
