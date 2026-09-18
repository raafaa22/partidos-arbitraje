import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { seasonOf, seasonLabel, seasonRange, isInSeason, currentSeason } =
  await loadModule('src/lib/season.ts')
const { seasonBalance, availableSeasons } = await loadModule('src/store/balance.ts')

test('la temporada va de julio a junio', () => {
  assert.equal(seasonOf('2026-09-20'), 2026)
  assert.equal(seasonOf('2026-12-31'), 2026)
  assert.equal(seasonOf('2027-01-01'), 2026)
  assert.equal(seasonOf('2027-06-30'), 2026)
  assert.equal(seasonOf('2027-07-01'), 2027)
})

test('los amistosos de pretemporada van a la temporada que empieza', () => {
  // Un amistoso de agosto de 2026 es de la 2026/27, no de la que acaba de
  // terminar: si no, se quedaría fuera de todo balance.
  assert.equal(seasonOf('2026-08-15'), 2026)
  assert.equal(seasonOf('2026-07-02'), 2026)
})

test('la etiqueta cruza bien el cambio de siglo', () => {
  assert.equal(seasonLabel(2026), '2026/27')
  assert.equal(seasonLabel(2099), '2099/00')
  assert.equal(seasonLabel(2009), '2009/10')
})

test('el rango de la temporada', () => {
  assert.deepEqual(seasonRange(2026), { from: '2026-07-01', to: '2027-06-30' })
})

test('una fecha sin rellenar no pertenece a ninguna temporada', () => {
  assert.equal(isInSeason(null, 2026), false)
})

test('la temporada en curso depende del mes', () => {
  assert.equal(currentSeason(new Date(2026, 8, 18)), 2026) // septiembre
  assert.equal(currentSeason(new Date(2027, 4, 3)), 2026) // mayo
  assert.equal(currentSeason(new Date(2027, 7, 3)), 2027) // agosto
})

// ---------- balance ----------

const partido = (id, kickoff, amount, extra = {}) => ({
  id, threadId: id, designacion: id, otherDesignaciones: [], kickoff,
  competition: null, group: null, homeTeam: 'A', awayTeam: 'B', venue: null,
  city: null, role: 'ARBITRO', kind: 'asignada', cancelled: false, amount,
  amountSource: null, breakdown: [], isDemo: false, demoReason: null, demoHits: 0,
  watermarks: 0, receivedAt: '2026-08-01T10:00:00.000Z', pdfName: null,
  pdfText: null, emailText: null, error: null, ...extra,
})

const marcas = (extra = {}) => ({
  paid: false, paidAt: null, deleted: false, deletedAt: null,
  amountOverride: null, demoOverride: null, ...extra,
})

const gasto = (id, date, amount, category = 'cuota') => ({
  id, date, amount, category, concept: 'x',
})

test('el bruto es todo lo arbitrado, se haya cobrado o no', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [partido('a', '2026-09-20T12:00', 100), partido('b', '2026-10-05T18:00', 50)],
    flags: { a: marcas({ paid: true }) },
    expenses: [],
  })
  assert.equal(b.gross, 150)
  assert.equal(b.collected, 100)
  assert.equal(b.pending, 50)
})

test('el neto descuenta los gastos del bruto', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [partido('a', '2026-09-20T12:00', 169.84)],
    flags: {},
    expenses: [gasto('g1', '2026-09-01', 120), gasto('g2', '2026-10-01', 30, 'material')],
  })
  assert.equal(b.gross, 169.84)
  assert.equal(b.expenses, 150)
  assert.equal(b.net, 19.84)
})

test('no se cuentan los de otra temporada', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [partido('a', '2026-09-20T12:00', 100), partido('vieja', '2026-05-20T12:00', 999)],
    flags: {},
    expenses: [gasto('g1', '2026-09-01', 10), gasto('vieja', '2026-03-01', 999)],
  })
  assert.equal(b.gross, 100)
  assert.equal(b.expenses, 10)
  assert.equal(b.matches, 1)
})

test('fuera demos, anulados y borrados', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [
      partido('bueno', '2026-09-20T12:00', 100),
      partido('demo', '2026-09-21T12:00', 999, { isDemo: true }),
      partido('anulado', '2026-09-22T12:00', 999, { cancelled: true }),
      partido('borrado', '2026-09-23T12:00', 999),
    ],
    flags: { borrado: marcas({ deleted: true }) },
    expenses: [],
  })
  assert.equal(b.gross, 100)
  assert.equal(b.matches, 1)
})

test('avisa de los partidos cuyo importe no se ha podido leer', () => {
  // Si no, el bruto se queda corto y parece que se ha ganado menos.
  const b = seasonBalance({
    season: 2026,
    matches: [partido('a', '2026-09-20T12:00', 100), partido('b', '2026-09-21T12:00', null)],
    flags: {},
    expenses: [],
  })
  assert.equal(b.gross, 100)
  assert.equal(b.unknownAmounts, 1)
  assert.equal(b.matches, 2)
})

test('el importe corregido a mano manda sobre el del PDF', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [partido('a', '2026-09-20T12:00', 100)],
    flags: { a: marcas({ amountOverride: 120 }) },
    expenses: [],
  })
  assert.equal(b.gross, 120)
})

test('los céntimos no se van al sumar', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [
      partido('a', '2026-09-20T12:00', 19.84),
      partido('b', '2026-09-21T12:00', 30.36),
      partido('c', '2026-09-22T12:00', 39.31),
    ],
    flags: {},
    expenses: [gasto('g', '2026-09-01', 0.1)],
  })
  assert.equal(b.gross, 89.51)
  assert.equal(b.net, 89.41)
})

test('desglosa los gastos por categoría, de mayor a menor', () => {
  const b = seasonBalance({
    season: 2026,
    matches: [],
    flags: {},
    expenses: [
      gasto('g1', '2026-09-01', 120, 'cuota'),
      gasto('g2', '2026-10-01', 30, 'material'),
      gasto('g3', '2026-11-01', 20, 'material'),
    ],
  })
  assert.deepEqual(b.byCategory, [
    { category: 'cuota', total: 120 },
    { category: 'material', total: 50 },
  ])
})

test('una temporada vacía da todo a cero', () => {
  const b = seasonBalance({ season: 2026, matches: [], flags: {}, expenses: [] })
  assert.deepEqual(
    [b.gross, b.collected, b.pending, b.expenses, b.net, b.matches],
    [0, 0, 0, 0, 0, 0],
  )
})

test('lista las temporadas de las que hay algo, de la más reciente primero', () => {
  const temporadas = availableSeasons(
    [partido('a', '2026-09-20T12:00', 10), partido('b', '2024-10-20T12:00', 10)],
    [gasto('g', '2025-09-01', 10)],
  )
  assert.deepEqual(temporadas, [2026, 2025, 2024])
})
