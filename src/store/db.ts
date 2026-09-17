import type { Match, MatchFlags, Settings } from '../types'

const MATCHES_KEY = 'pa.matches.v1'
const FLAGS_KEY = 'pa.flags.v1'
const SETTINGS_KEY = 'pa.settings.v1'
const ACCOUNT_KEY = 'pa.account.v1'

/**
 * Los partidos se guardan por cuenta. Sin esto, entrar con otro correo mezcla
 * sus designaciones con las del anterior y los totales suman dinero de dos
 * personas distintas, sin que nada lo delate.
 */
function scoped(base: string, account: string | null): string {
  return account ? `${base}:${account}` : base
}

/** La cuenta con la que se entro la ultima vez. */
export function loadAccount(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_KEY)
  } catch {
    return null
  }
}

export function saveAccount(account: string | null): void {
  try {
    if (account) localStorage.setItem(ACCOUNT_KEY, account)
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // Sin almacenamiento no hay nada que recordar.
  }
}

/**
 * Los datos que se guardaron antes de separar por cuenta pasan a ser de la
 * primera cuenta que entra. Si no, al aprender de quien es la sesion, todo lo
 * ya descargado pareceria haber desaparecido.
 */
export function adoptLegacyData(account: string): void {
  try {
    for (const base of [MATCHES_KEY, FLAGS_KEY]) {
      const legacy = localStorage.getItem(base)
      if (legacy === null) continue
      if (localStorage.getItem(scoped(base, account)) === null) {
        localStorage.setItem(scoped(base, account), legacy)
      }
      localStorage.removeItem(base)
    }
  } catch {
    // Sin almacenamiento no hay nada que mover.
  }
}

/** Client ID de OAuth del proyecto de Google. No es un secreto: solo funciona
 *  desde los origenes autorizados en la consola de Google. */
const DEFAULT_CLIENT_ID = '553707784734-f84l7mbr8ehfi8hnqc1tnaskmp3n7j6h.apps.googleusercontent.com'

/**
 * Los correos del comite. Son varios y todos traen designacion:
 *
 *   "Le ha sido asignada la siguiente designación:"
 *   "Su designación ha sido cambiada:"
 *   "Su designación ha sido cancelada:"
 *
 * La segunda mitad se busca por el tronco comun "Su designación ha sido" en vez
 * de enumerar los finales: asi entran tambien las anulaciones y cualquier aviso
 * que el comite redacte manana de otra forma. El filtro fino se hace despues
 * sobre el texto del correo, que descarta lo que no sea una designacion.
 */
const DEFAULT_QUERY =
  '"Comité de Árbitros" ("Le ha sido asignada la siguiente designación" OR "Su designación ha sido")'

/**
 * Se sube cuando cambia la forma de analizar los correos o de resolver el
 * estado final. Al arrancar, si lo guardado viene de una version anterior, se
 * vuelve a analizar todo solo: si no, los partidos que se bajaron con las
 * reglas viejas se quedarian mal para siempre, porque la sincronizacion no
 * vuelve a tocar un correo que ya conoce.
 */
export const DATA_VERSION = 6

export const DEFAULT_SETTINGS: Settings = {
  clientId: DEFAULT_CLIENT_ID,
  query: DEFAULT_QUERY,
  // Lo anterior a septiembre de 2026 esta cobrado: no hace falta traerlo.
  seasonStart: '2026-09-01',
  demoThreshold: 2,
  lastSync: null,
  // Lo guardado por versiones anteriores no traia este campo: se reanaliza.
  dataVersion: 0,
}

/**
 * La busqueda que se manda a Gmail. El `after:` va sobre la fecha del CORREO,
 * que llega dias antes del partido, asi que se deja un mes y medio de margen
 * hacia atras y luego se descartan los partidos anteriores por su fecha real.
 */
export function gmailQuery(settings: Settings): string {
  const margin = new Date(settings.seasonStart)
  margin.setDate(margin.getDate() - 45)
  const after = `${margin.getFullYear()}/${margin.getMonth() + 1}/${margin.getDate()}`
  return `${settings.query} after:${after}`
}

export const EMPTY_FLAGS: MatchFlags = {
  paid: false,
  paidAt: null,
  deleted: false,
  deletedAt: null,
  amountOverride: null,
  demoOverride: null,
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Lo devuelto es el error a enseñar, o `null` si se guardó bien. */
function write(key: string, value: unknown): string | null {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return null
  } catch (error) {
    console.warn('No se ha podido guardar en el dispositivo', error)
    const full = error instanceof DOMException && error.name === 'QuotaExceededError'
    return full
      ? 'No cabe más en el almacenamiento del navegador: los últimos cambios no se han guardado. Borra partidos antiguos desde la papelera o exporta una copia.'
      : 'No se han podido guardar los cambios en este dispositivo.'
  }
}

export const loadMatches = (account: string | null): Match[] =>
  read<Match[]>(scoped(MATCHES_KEY, account), [])
export const saveMatches = (account: string | null, matches: Match[]): string | null =>
  write(scoped(MATCHES_KEY, account), matches)

export const loadFlags = (account: string | null): Record<string, MatchFlags> =>
  read(scoped(FLAGS_KEY, account), {})
export const saveFlags = (
  account: string | null,
  flags: Record<string, MatchFlags>,
): string | null => write(scoped(FLAGS_KEY, account), flags)

/**
 * Busquedas que fueron el valor por defecto en versiones anteriores. Si el
 * usuario tiene guardada una de ellas es que nunca la toco, asi que se cambia
 * por la actual: si no, una busqueda vieja se quedaria para siempre y dejaria
 * fuera los correos que se aprendieron a leer despues.
 */
const OLD_DEFAULT_QUERIES = [
  '"Comité de Árbitros" "Le ha sido asignada la siguiente designación"',
  '"Comité de Árbitros" ("Le ha sido asignada la siguiente designación" OR "Su designación ha sido cambiada")',
]

export function loadSettings(): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) }
  if (OLD_DEFAULT_QUERIES.includes(settings.query)) settings.query = DEFAULT_QUERY
  return settings
}
export const saveSettings = (settings: Settings): string | null => write(SETTINGS_KEY, settings)

export function flagsFor(flags: Record<string, MatchFlags>, id: string): MatchFlags {
  return { ...EMPTY_FLAGS, ...flags[id] }
}

/** El importe que cuenta: el corregido a mano si lo hay, si no el del PDF. */
export function effectiveAmount(match: Match, flags: MatchFlags): number | null {
  return flags.amountOverride ?? match.amount
}

/** Si es demo: manda siempre la decision manual sobre la deteccion automatica. */
export function effectiveDemo(match: Match, flags: MatchFlags): boolean {
  return flags.demoOverride ?? match.isDemo
}
