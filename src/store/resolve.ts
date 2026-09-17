import { mergeDetails } from '../parse/designation'
import type { Match, MatchFlags } from '../types'
import { EMPTY_FLAGS, effectiveDemo } from './db'

export interface Resolution {
  matches: Match[]
  flags: Record<string, MatchFlags>
  /** Correos que eran repeticiones de una designación ya conocida. */
  merged: number
  /** Designaciones cuyo último correo era una anulación. */
  cancelled: number
}

/**
 * Deja un solo partido por designacion, con el estado final del flujo de
 * correos.
 *
 * El comite manda varios correos sobre la misma designacion: la asigna, la
 * cambia (por un cambio de asistente, de hora, de campo) y a veces la anula.
 * Todos llevan el mismo numero. Sin juntarlos, el mismo partido sale repetido
 * y el dinero se cuenta tantas veces como correos hayan llegado.
 *
 * Reglas, por orden:
 *
 *  1. Si el ultimo correo de la designacion la anula, el partido no se arbitra:
 *     se marca como anulado y deja de contar.
 *  2. Entre los que quedan gana el mas reciente que NO sea demo. Quedarse sin
 *     mas con el mas reciente seria un error caro: un partido puede llegar como
 *     designacion buena y despues otra vez en demo con marca de agua, y la demo
 *     taparia al partido real y su importe desapareceria del total.
 *  3. Los datos se completan con los del resto de correos del grupo: el que
 *     gana puede no traer campo o localidad, y otro correo del mismo partido si.
 *  4. Las marcas de cobrado y borrado se arrastran, para no perder lo que ya
 *     hubiera tocado el usuario sobre un correo que ahora se descarta.
 */
export function resolveDesignations(
  matches: Match[],
  flags: Record<string, MatchFlags>,
): Resolution {
  const groups = new Map<string, Match[]>()
  const loose: Match[] = []

  for (const match of matches) {
    // Sin numero de designacion no hay forma de saber si son el mismo partido.
    if (!match.designacion) {
      loose.push(match)
      continue
    }
    const group = groups.get(match.designacion)
    if (group) group.push(match)
    else groups.set(match.designacion, [match])
  }

  const kept: Match[] = [...loose]
  const nextFlags: Record<string, MatchFlags> = {}
  let merged = 0
  let cancelled = 0

  for (const match of loose) {
    if (flags[match.id]) nextFlags[match.id] = flags[match.id]
  }

  for (const group of groups.values()) {
    const recent = [...group].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    if (group.length > 1) merged += group.length - 1

    // Las demos no cuentan para decidir nada: son correos de prueba que el
    // comite manda sobre designaciones de verdad. Una cancelacion de
    // demostracion no puede anular un partido que si se arbitra. Solo cuando
    // todos los correos del grupo son demos se mira uno de ellos.
    const real = recent.filter((entry) => !effectiveDemo(entry, flagsFor(flags, entry.id)))
    const chain = real.length ? real : recent

    // El estado final lo marca el correo real mas reciente.
    const base = chain[0]
    const isCancelled = base.kind === 'anulada'
    if (isCancelled) cancelled++

    // El correo que gana puede venir incompleto: se rellena con los demas, y
    // los de anulacion no traen PDF, asi que el importe se busca hacia atras.
    const winner: Match = {
      ...base,
      ...mergeDetails(base, ...chain.slice(1), ...recent),
      cancelled: isCancelled,
      amount: base.amount ?? chain.find((entry) => entry.amount !== null)?.amount ?? null,
    }
    kept.push(winner)

    const combined = group.map((entry) => flagsFor(flags, entry.id))
    const winnerFlags = flagsFor(flags, winner.id)
    nextFlags[winner.id] = {
      paid: combined.some((entry) => entry.paid),
      paidAt: earliest(combined.map((entry) => entry.paidAt)),
      deleted: combined.some((entry) => entry.deleted),
      deletedAt: earliest(combined.map((entry) => entry.deletedAt)),
      // Lo corregido a mano manda si estaba en el que se queda.
      amountOverride:
        winnerFlags.amountOverride ??
        combined.find((entry) => entry.amountOverride !== null)?.amountOverride ??
        null,
      demoOverride:
        winnerFlags.demoOverride ??
        combined.find((entry) => entry.demoOverride !== null)?.demoOverride ??
        null,
    }
  }

  return { matches: kept, flags: nextFlags, merged, cancelled }
}

/**
 * Tira los registros que no son partidos: los que se guardaron cuando una
 * peticion a Gmail fallo y no tienen ni tipo de correo, ni numero de
 * designacion, ni fecha. Mientras esten guardados, su id cuenta como conocido
 * y ese correo no se vuelve a intentar nunca.
 */
export function purgeJunk(
  matches: Match[],
  flags: Record<string, MatchFlags>,
): { matches: Match[]; flags: Record<string, MatchFlags>; removed: number } {
  const kept = matches.filter(
    (match) => match.kind !== null || match.designacion !== null || match.kickoff !== null,
  )
  const alive = new Set(kept.map((match) => match.id))
  const nextFlags: Record<string, MatchFlags> = {}
  for (const [id, entry] of Object.entries(flags)) {
    if (alive.has(id)) nextFlags[id] = entry
  }
  return { matches: kept, flags: nextFlags, removed: matches.length - kept.length }
}

/**
 * Los partidos anteriores al arranque de temporada ya estan cobrados, asi que
 * se marcan como tal en vez de tirarlos: siguen consultables y no inflan la
 * cuenta de lo que queda por cobrar. Solo se tocan los que el usuario no haya
 * marcado ya a mano.
 */
export function markOldAsPaid(
  matches: Match[],
  flags: Record<string, MatchFlags>,
  seasonStart: string,
): { flags: Record<string, MatchFlags>; marked: number } {
  const next = { ...flags }
  let marked = 0

  for (const match of matches) {
    if (!match.kickoff || match.kickoff >= seasonStart) continue
    // Un partido anulado no se arbitro, asi que no hay nada que cobrar.
    if (match.cancelled) continue
    if (next[match.id]?.paid) continue
    next[match.id] = {
      ...EMPTY_FLAGS,
      ...next[match.id],
      paid: true,
      paidAt: next[match.id]?.paidAt ?? match.kickoff,
    }
    marked++
  }

  return { flags: next, marked }
}

function flagsFor(flags: Record<string, MatchFlags>, id: string): MatchFlags {
  return { ...EMPTY_FLAGS, ...flags[id] }
}

function earliest(dates: (string | null)[]): string | null {
  const real = dates.filter((date): date is string => date !== null).sort()
  return real[0] ?? null
}
