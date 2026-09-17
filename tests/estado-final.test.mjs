import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from '../scripts/_bundle.mjs'

const { resolveDesignations, markOldAsPaid, purgeJunk } = await loadModule('src/store/resolve.ts')

const partido = (id, designacion, receivedAt, extra = {}) => ({
  id, designacion, receivedAt, threadId: id, kickoff: null, competition: null, group: null,
  homeTeam: null, awayTeam: null, venue: null, city: null, role: null, kind: 'asignada',
  cancelled: false, amount: 20, amountSource: null, breakdown: [], isDemo: false,
  demoReason: null, demoHits: 0, watermarks: 0, pdfName: null, pdfText: null,
  emailText: null, error: null, ...extra,
})

const marcas = (extra = {}) => ({
  paid: false, paidAt: null, deleted: false, deletedAt: null,
  amountOverride: null, demoOverride: null, ...extra,
})

test('varios correos de la misma designación dan un solo partido', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z', { role: 'ARBITRO' }),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z', { kind: 'cambiada', role: 'ASISTENTE' }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, 'b')
  assert.equal(r.matches[0].role, 'ASISTENTE')
  assert.equal(r.merged, 1)
})

test('si el último correo anula la designación, el partido queda anulado', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z'),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z', { kind: 'anulada', amount: null }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].cancelled, true)
  assert.equal(r.cancelled, 1)
})

test('una anulación antigua no anula una reasignación posterior', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z', { kind: 'anulada' }),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z', { kind: 'asignada' }),
    ],
    {},
  )
  assert.equal(r.matches[0].cancelled, false)
  assert.equal(r.cancelled, 0)
})

test('el correo de anulación no borra el importe ya leído', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z', { amount: 39.31 }),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z', { kind: 'anulada', amount: null }),
    ],
    {},
  )
  assert.equal(r.matches[0].amount, 39.31)
})

test('completa los datos que falten con los de otro correo del mismo partido', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z', {
        homeTeam: 'MARTOS', awayTeam: 'APEDEM', venue: 'ESTADIO MUNICIPAL', city: 'Martos',
      }),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z', { kind: 'cambiada', role: 'ARBITRO' }),
    ],
    {},
  )
  assert.equal(r.matches[0].id, 'b')
  assert.equal(r.matches[0].homeTeam, 'MARTOS')
  assert.equal(r.matches[0].city, 'Martos')
  assert.equal(r.matches[0].role, 'ARBITRO')
})

test('una demo no tapa al partido real aunque llegue después', () => {
  const r = resolveDesignations(
    [
      partido('real', '1966778', '2026-08-25T10:00:00.000Z', { amount: 98.3 }),
      partido('demo', '1966778', '2026-09-02T10:00:00.000Z', { amount: 98.3, isDemo: true }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, 'real')
  assert.equal(r.matches[0].amount, 98.3)
})

test('si todas son demos se conserva una', () => {
  const r = resolveDesignations(
    [
      partido('d1', '1966778', '2026-08-25T10:00:00.000Z', { isDemo: true }),
      partido('d2', '1966778', '2026-09-02T10:00:00.000Z', { isDemo: true }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.ok(r.matches[0].isDemo)
})

test('no pierde lo marcado a mano sobre el correo que se descarta', () => {
  const r = resolveDesignations(
    [
      partido('a', '1969747', '2026-08-20T10:00:00.000Z'),
      partido('b', '1969747', '2026-09-01T10:00:00.000Z'),
    ],
    { a: marcas({ paid: true, paidAt: '2026-09-10T10:00:00.000Z', amountOverride: 33.5 }) },
  )
  assert.ok(r.flags.b.paid)
  assert.equal(r.flags.b.paidAt, '2026-09-10T10:00:00.000Z')
  assert.equal(r.flags.b.amountOverride, 33.5)
  assert.equal(r.flags.a, undefined)
})

test('designaciones distintas no se tocan', () => {
  const r = resolveDesignations(
    [
      partido('a', '1966778', '2026-08-20T10:00:00.000Z'),
      partido('b', '1968465', '2026-09-01T10:00:00.000Z'),
    ],
    {},
  )
  assert.equal(r.matches.length, 2)
  assert.equal(r.merged, 0)
})

test('los partidos sin número de designación se quedan todos', () => {
  const r = resolveDesignations(
    [partido('a', null, '2026-08-20T10:00:00.000Z'), partido('b', null, '2026-09-01T10:00:00.000Z')],
    { a: marcas({ paid: true }) },
  )
  assert.equal(r.matches.length, 2)
  assert.ok(r.flags.a.paid)
})

test('los partidos anteriores a la temporada se dan por cobrados', () => {
  const partidos = [
    partido('viejo', '1', '2026-05-01T10:00:00.000Z', { kickoff: '2026-05-10T18:00' }),
    partido('nuevo', '2', '2026-09-01T10:00:00.000Z', { kickoff: '2026-09-10T18:00' }),
  ]
  const r = markOldAsPaid(partidos, {}, '2026-09-01')
  assert.ok(r.flags.viejo.paid)
  assert.equal(r.flags.viejo.paidAt, '2026-05-10T18:00')
  assert.equal(r.flags.nuevo, undefined)
  assert.equal(r.marked, 1)
})

test('no se tocan los partidos sin fecha ni los ya marcados', () => {
  const partidos = [
    partido('sinfecha', '1', '2026-05-01T10:00:00.000Z'),
    partido('yacobrado', '2', '2026-05-01T10:00:00.000Z', { kickoff: '2026-05-10T18:00' }),
  ]
  const r = markOldAsPaid(partidos, { yacobrado: marcas({ paid: true, paidAt: '2026-06-01' }) }, '2026-09-01')
  assert.equal(r.flags.sinfecha, undefined)
  assert.equal(r.flags.yacobrado.paidAt, '2026-06-01')
  assert.equal(r.marked, 0)
})

test('tira los registros que no son partidos', () => {
  // Los que quedaron de una petición fallida: sin tipo, sin designación y sin
  // fecha. Mientras estén guardados, ese correo no se reintenta nunca.
  const basura = { ...partido('x', null, '2026-09-01T10:00:00.000Z'), kind: null }
  const r = purgeJunk([partido('bueno', '1969747', '2026-09-01T10:00:00.000Z'), basura], {})
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, 'bueno')
  assert.equal(r.removed, 1)
})

test('no tira un partido que al menos tiene designación', () => {
  const parcial = { ...partido('p', '1969747', '2026-09-01T10:00:00.000Z'), kind: null }
  assert.equal(purgeJunk([parcial], {}).removed, 0)
})

test('no tira un partido que al menos tiene fecha', () => {
  const parcial = {
    ...partido('p', null, '2026-09-01T10:00:00.000Z'),
    kind: null,
    kickoff: '2026-09-13T11:15',
  }
  assert.equal(purgeJunk([parcial], {}).removed, 0)
})

test('al tirar un registro se lleva sus marcas', () => {
  const basura = { ...partido('x', null, '2026-09-01T10:00:00.000Z'), kind: null }
  const r = purgeJunk([basura], { x: marcas({ paid: true }) })
  assert.equal(r.flags.x, undefined)
})

test('el flujo asignada → cancelada deja el partido anulado', () => {
  const r = resolveDesignations(
    [
      partido('asig', '1944727', '2026-05-01T10:00:00.000Z', {
        kickoff: '2026-05-25T18:30', amount: 30, homeTeam: 'LOS VILLARES C.F.',
      }),
      partido('canc', '1944727', '2026-05-20T10:00:00.000Z', {
        kind: 'anulada', kickoff: '2026-05-25T18:30', amount: null,
      }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].cancelled, true)
  assert.equal(r.matches[0].homeTeam, 'LOS VILLARES C.F.')
  assert.equal(r.cancelled, 1)
})

test('un partido anulado no se marca como cobrado', () => {
  const anulado = partido('x', '1944727', '2026-05-20T10:00:00.000Z', {
    kind: 'anulada', kickoff: '2026-05-25T18:30', cancelled: true,
  })
  const r = markOldAsPaid([anulado], {}, '2026-09-01')
  assert.equal(r.marked, 0)
  assert.equal(r.flags.x, undefined)
})

test('una cancelación de demostración no anula un partido de verdad', () => {
  // El comité manda correos de prueba sobre designaciones reales. Si una
  // cancelación de demo pudiera anular el partido, su importe desaparecería
  // del total y no habría forma de notarlo.
  const r = resolveDesignations(
    [
      partido('real', '1944727', '2026-09-01T10:00:00.000Z', { amount: 30.36 }),
      partido('demo', '1944727', '2026-09-10T10:00:00.000Z', {
        kind: 'anulada', isDemo: true, amount: null,
      }),
    ],
    {},
  )
  assert.equal(r.matches[0].cancelled, false)
  assert.equal(r.matches[0].amount, 30.36)
  assert.equal(r.cancelled, 0)
})

test('un cambio de demostración tampoco pisa los datos buenos', () => {
  const r = resolveDesignations(
    [
      partido('real', '1944727', '2026-09-01T10:00:00.000Z', {
        amount: 30.36, homeTeam: 'LOS VILLARES C.F.',
      }),
      partido('demo', '1944727', '2026-09-10T10:00:00.000Z', {
        kind: 'cambiada', isDemo: true, amount: 99, homeTeam: 'EQUIPO DEMO',
      }),
    ],
    {},
  )
  assert.equal(r.matches[0].amount, 30.36)
  assert.equal(r.matches[0].homeTeam, 'LOS VILLARES C.F.')
})

test('si el grupo entero son demos, se conserva una y su estado', () => {
  const r = resolveDesignations(
    [
      partido('d1', '1944727', '2026-09-01T10:00:00.000Z', { isDemo: true }),
      partido('d2', '1944727', '2026-09-10T10:00:00.000Z', { kind: 'anulada', isDemo: true }),
    ],
    {},
  )
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].cancelled, true)
})

test('un cambio real sí actualiza la información', () => {
  const r = resolveDesignations(
    [
      partido('a', '1944727', '2026-09-01T10:00:00.000Z', {
        kickoff: '2026-09-13T18:30', venue: 'CAMPO VIEJO', amount: 30.36,
      }),
      partido('b', '1944727', '2026-09-05T10:00:00.000Z', {
        kind: 'cambiada', kickoff: '2026-09-13T19:00', venue: 'CAMPO NUEVO', amount: 30.36,
      }),
    ],
    {},
  )
  assert.equal(r.matches[0].kickoff, '2026-09-13T19:00')
  assert.equal(r.matches[0].venue, 'CAMPO NUEVO')
  assert.equal(r.matches[0].amount, 30.36)
})

test('un cambio de campo actualiza el importe, no solo la información', () => {
  // El kilometraje va dentro de la liquidación: si cambian el campo a otro
  // pueblo, el PDF nuevo trae otro total. Conservar el importe del primer
  // correo sería perder (o inventar) dinero sin que se note.
  const r = resolveDesignations(
    [
      partido('a', '1944727', '2026-09-01T10:00:00.000Z', {
        venue: 'CAMPO DE AL LADO', city: 'Jaén', amount: 86.52,
        breakdown: [{ label: 'Kilometraje', value: 0 }],
      }),
      partido('b', '1944727', '2026-09-05T10:00:00.000Z', {
        kind: 'cambiada', venue: 'CAMPO LEJOS', city: 'Jamilena', amount: 98.3,
        breakdown: [{ label: 'Kilometraje', value: 7.28 }],
      }),
    ],
    {},
  )
  assert.equal(r.matches[0].amount, 98.3)
  assert.equal(r.matches[0].city, 'Jamilena')
  assert.deepEqual(r.matches[0].breakdown, [{ label: 'Kilometraje', value: 7.28 }])
})

test('pero una demo posterior no cambia el importe', () => {
  const r = resolveDesignations(
    [
      partido('a', '1944727', '2026-09-01T10:00:00.000Z', { amount: 86.52 }),
      partido('b', '1944727', '2026-09-05T10:00:00.000Z', {
        kind: 'cambiada', isDemo: true, amount: 999,
      }),
    ],
    {},
  )
  assert.equal(r.matches[0].amount, 86.52)
})
