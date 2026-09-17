import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { resolveDesignations } = await loadModule('src/store/resolve.ts')
const { matchKey, teamKey } = await loadModule('src/lib/text.ts')

const partido = (id, designacion, extra = {}) => ({
  id, designacion, otherDesignaciones: [], receivedAt: '2026-09-01T10:00:00.000Z',
  threadId: id, kickoff: '2026-09-20T12:00', competition: null, group: null,
  homeTeam: null, awayTeam: null, venue: null, city: null, role: 'ARBITRO',
  kind: 'asignada', cancelled: false, amount: null, amountSource: null, breakdown: [],
  isDemo: false, demoReason: null, demoHits: 0, watermarks: 0, pdfName: null,
  pdfText: null, emailText: null, error: null, ...extra,
})

// Las dos designaciones reales del mismo Córdoba CF – Pozuelo: una de la
// federación territorial y otra de la nacional, con formatos distintos.
const NACIONAL = partido('rfef', '4114989', {
  receivedAt: '2026-09-02T10:00:00.000Z',
  competition: 'SEGUNDA FEDERACIÓN DE FÚTBOL FEMENINO',
  group: 'LIGA - GRUPO 3',
  homeTeam: '(604001) Córdoba CF',
  awayTeam: '(503715) CF Pozuelo de Alarcón',
  venue: 'Ciudad Deportiva Córdoba CF campo 1',
  city: 'Córdoba',
  amount: null,
})

const TERRITORIAL = partido('rfaf', '1970459', {
  receivedAt: '2026-09-01T10:00:00.000Z',
  competition: 'SEGUNDA FEDERACION FEMENINA',
  homeTeam: 'CORDOBA CF',
  awayTeam: 'CF POZUELO DE ALARCON',
  venue: 'Córdoba - CIUDAD DEPORTIVA CORDOBA CF (F11) (N)',
  city: 'Córdoba',
  amount: 169.84,
})

test('los nombres de equipo se comparan sin códigos ni tildes', () => {
  assert.equal(teamKey('(604001) Córdoba CF'), 'CORDOBA CF')
  assert.equal(teamKey('CF Pozuelo de Alarcón'), teamKey('CF POZUELO DE ALARCON'))
})

test('sin fecha o sin equipos no se identifica el partido', () => {
  assert.equal(matchKey(null, 'A', 'B'), '')
  assert.equal(matchKey('2026-09-20T12:00', null, 'B'), '')
  assert.equal(matchKey('2026-09-20T12:00', 'A', null), '')
})

test('dos designaciones del mismo partido salen como un solo partido', () => {
  const r = resolveDesignations([NACIONAL, TERRITORIAL], {})
  assert.equal(r.matches.length, 1)
  assert.equal(r.sameMatch, 1)
})

test('se queda con la designación que trae el importe', () => {
  const r = resolveDesignations([NACIONAL, TERRITORIAL], {})
  assert.equal(r.matches[0].amount, 169.84)
  assert.equal(r.matches[0].designacion, '1970459')
  assert.deepEqual(r.matches[0].otherDesignaciones, ['4114989'])
})

test('el dinero no se cuenta dos veces', () => {
  const total = resolveDesignations([NACIONAL, TERRITORIAL], {}).matches
    .reduce((suma, m) => suma + (m.amount ?? 0), 0)
  assert.equal(total, 169.84)
})

test('partidos distintos no se juntan aunque coincida la hora', () => {
  const otro = partido('x', '999', { homeTeam: 'JAEN CF', awayTeam: 'LINARES' })
  const r = resolveDesignations([TERRITORIAL, otro], {})
  assert.equal(r.matches.length, 2)
  assert.equal(r.sameMatch, 0)
})

test('sin equipos leídos no se junta nada por si acaso', () => {
  const a = partido('a', '111')
  const b = partido('b', '222')
  assert.equal(resolveDesignations([a, b], {}).matches.length, 2)
})

test('arrastra lo marcado a mano en la designación que se descarta', () => {
  const marcas = {
    rfef: { paid: true, paidAt: '2026-09-25T10:00:00.000Z', deleted: false,
            deletedAt: null, amountOverride: null, demoOverride: null },
  }
  const r = resolveDesignations([NACIONAL, TERRITORIAL], marcas)
  assert.ok(r.flags.rfaf.paid)
  assert.equal(r.flags.rfaf.paidAt, '2026-09-25T10:00:00.000Z')
})
