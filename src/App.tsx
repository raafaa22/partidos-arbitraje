import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MatchCard from './components/MatchCard'
import MatchDetail from './components/MatchDetail'
import SettingsPanel from './components/SettingsPanel'
import { clearToken, forgetToken, getAccessToken, isSignedOut, storedToken } from './auth/google'
import { GmailError, getAccountEmail } from './gmail/api'
import { formatEuro, isPast } from './lib/text'
import {
  DATA_VERSION, EMPTY_FLAGS, adoptLegacyData, effectiveAmount, effectiveDemo, flagsFor,
  gmailQuery, loadAccount, loadFlags, loadMatches, loadSettings, saveAccount, saveFlags,
  saveMatches, saveSettings,
} from './store/db'
import { markOldAsPaid, purgeJunk, resolveDesignations } from './store/resolve'
import { reparseMatch, refreshMatch, syncMatches, type SyncProgress } from './sync'
import type { Filter, Match, MatchFlags, Settings } from './types'

/** Cuántos partidos se pintan de una tanda. */
const PAGE = 40

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'jugados', label: 'Jugados' },
  { id: 'proximos', label: 'Próximos' },
  { id: 'pagados', label: 'Cobrados' },
  { id: 'demos', label: 'Demos' },
  { id: 'anulados', label: 'Anulados' },
  { id: 'papelera', label: 'Papelera' },
]

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  // Cada cuenta de Google tiene sus propios partidos.
  const [account, setAccount] = useState<string | null>(loadAccount)
  const [matches, setMatches] = useState<Match[]>(() => loadMatches(loadAccount()))
  const [flags, setFlags] = useState<Record<string, MatchFlags>>(() => loadFlags(loadAccount()))

  const [token, setToken] = useState<string | null>(storedToken)
  // Cerrar sesión a mano lleva a la pantalla de entrada. Que caduque el token
  // no: ahí se sigue viendo lo ya descargado.
  const [signedOut, setSignedOut] = useState(isSignedOut)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [filter, setFilter] = useState<Filter>('jugados')
  // Con cientos de partidos, pintarlos todos de golpe deja el móvil pillado y
  // los filtros parecen no responder. Se enseñan por tandas.
  const [shown, setShown] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [storageError, setStorageError] = useState<string | null>(null)

  useEffect(() => {
    setStorageError(saveMatches(account, matches))
  }, [account, matches])
  useEffect(() => {
    setStorageError((current) => saveFlags(account, flags) ?? current)
  }, [account, flags])
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const updateFlags = useCallback((id: string, patch: Partial<MatchFlags>) => {
    setFlags((current) => {
      const next = { ...current, [id]: { ...EMPTY_FLAGS, ...current[id], ...patch } }
      latest.current = { ...latest.current, flags: next }
      return next
    })
  }, [])

  // En desarrollo React monta los efectos dos veces, y sin esto salen dos
  // sincronizaciones a la vez pidiendole a Gmail el doble de lo necesario.
  const running = useRef(false)

  /**
   * Espejo del estado, siempre al dia. La sincronizacion y el reanalisis duran
   * mucho y arrancan a la vez: si cada uno partiera de la copia que capturo al
   * empezar, el ultimo en terminar pisaria lo que hizo el otro. Es lo que hacia
   * que la purga de registros vacios se deshiciera sola, porque la
   * sincronizacion guardaba despues su copia, tomada antes de la purga.
   */
  const latest = useRef({ matches, flags })

  /** Guarda estado nuevo y actualiza el espejo en el mismo momento. */
  const apply = useCallback((nextMatches: Match[], nextFlags: Record<string, MatchFlags>) => {
    latest.current = { matches: nextMatches, flags: nextFlags }
    setMatches(nextMatches)
    setFlags(nextFlags)
  }, [])

  /**
   * Deja el estado en condiciones: fuera los registros que no son partidos, un
   * solo partido por designacion con su estado final, y los de antes de la
   * temporada dados por cobrados.
   *
   * La limpieza NO va detras de ningun numero de version. Un registro vacio es
   * basura siempre, y atarlo a una bandera de "ya migrado" hacia que un fallo
   * al aplicarla lo dejara ahi para siempre. Se ejecuta al arrancar y despues
   * de cada sincronizacion; es idempotente y sobre unos cientos de partidos no
   * se nota.
   *
   * `reparse` vuelve a analizar el texto guardado del PDF y del correo. Eso si
   * es caro, asi que solo se hace cuando cambian las reglas de analisis o
   * cuando el usuario lo pide.
   */
  const tidyUp = useCallback(
    (
      input: { matches: Match[]; flags: Record<string, MatchFlags> },
      { reparse = false }: { reparse?: boolean } = {},
    ) => {
      const clean = purgeJunk(input.matches, input.flags)
      const analysed = reparse
        ? clean.matches.map((match) => reparseMatch(match, settings.demoThreshold))
        : clean.matches
      const resolved = resolveDesignations(analysed, clean.flags)
      const old = markOldAsPaid(resolved.matches, resolved.flags, settings.seasonStart)
      apply(resolved.matches, old.flags)
      return { ...resolved, removed: clean.removed, marked: old.marked }
    },
    [apply, settings.demoThreshold, settings.seasonStart],
  )

  const reanalyze = useCallback(() => {
    const result = tidyUp(latest.current, { reparse: true })
    setShowSettings(false)
    setError(null)
    setNotice(
      [
        `${result.matches.length} partido(s) tras reanalizar`,
        result.removed ? `${result.removed} registros vacíos tirados, se reintentarán` : null,
        result.merged ? `${result.merged} correos eran del mismo partido` : null,
        result.sameMatch ? `${result.sameMatch} designación(es) de otra federación` : null,
        result.cancelled ? `${result.cancelled} anulado(s)` : null,
        result.marked ? `${result.marked} dados por cobrados por ser de antes de la temporada` : null,
      ]
        .filter(Boolean)
        .join(' · ') + '.',
    )
  }, [tidyUp])

  const sync = useCallback(
    async (accessToken: string) => {
      if (running.current) return
      running.current = true
      setSyncing(true)
      setError(null)
      setNotice(null)
      try {
        // De quién es esta sesión. Si es otra cuenta, se cambia de cajón: sus
        // partidos son suyos y no se mezclan con los del correo anterior.
        const email = await getAccountEmail(accessToken)
        if (email && email !== account) {
          if (!account) adoptLegacyData(email)
          const mine = { matches: loadMatches(email), flags: loadFlags(email) }
          latest.current = mine
          setAccount(email)
          saveAccount(email)
          setMatches(mine.matches)
          setFlags(mine.flags)
        }

        const known = latest.current
        const knownIds = new Set<string>(known.matches.map((match) => match.id))
        // Los borrados siguen contando como conocidos: no deben volver solos.
        for (const [id, entry] of Object.entries(known.flags)) {
          if (entry.deleted) knownIds.add(id)
        }

        const result = await syncMatches({
          token: accessToken,
          query: gmailQuery(settings),
          demoThreshold: settings.demoThreshold,
          knownIds,
          onProgress: setProgress,
        })

        // La resolución se aplica siempre, aunque no haya llegado nada nuevo:
        // varios correos hablan de la misma designación y hay que quedarse con
        // el estado final, o el partido sale repetido y el dinero se cuenta
        // tantas veces como correos hayan llegado.
        // Se parte del espejo, no de la copia de antes de la descarga: la
        // limpieza del arranque puede haber cambiado la lista mientras tanto.
        const base = latest.current
        const resolved = tidyUp({
          matches: [...base.matches, ...result.matches],
          flags: base.flags,
        })

        const demos = resolved.matches.filter((match) => match.isDemo).length
        setNotice(
          [
            result.matches.length
              ? `${result.matches.length} correo(s) nuevo(s)`
              : 'Sin correos nuevos',
            `${resolved.matches.length} partido(s)`,
            resolved.merged ? `${resolved.merged} correos del mismo partido` : null,
            resolved.sameMatch
              ? `${resolved.sameMatch} designación(es) duplicada(s) de otra federación`
              : null,
            resolved.removed ? `${resolved.removed} registros vacíos tirados` : null,
            resolved.cancelled ? `${resolved.cancelled} anulado(s)` : null,
            demos ? `${demos} demo(s)` : null,
            resolved.marked ? `${resolved.marked} de antes de la temporada, dados por cobrados` : null,
            result.failed ? `${result.failed} correos fallaron, se reintentarán` : null,
          ]
            .filter(Boolean)
            .join(' · ') + '.',
        )

        if (result.stoppedEarly) {
          setError(
            `Google ha cortado por exceso de peticiones. Se han guardado los ${result.matches.length} leídos ` +
              `y quedan ${result.remaining}. Espera un minuto y vuelve a sincronizar: seguirá por donde iba.`,
          )
        } else if (result.remaining > 0) {
          setError(
            `Quedan ${result.remaining} correos por leer. Se traen por tandas para no saturar a Gmail: ` +
              'vuelve a pulsar sincronizar.',
          )
        }
        setSettings((current) => ({ ...current, lastSync: new Date().toISOString() }))
      } catch (caught) {
        if (caught instanceof GmailError && (caught.status === 401 || caught.status === 403)) {
          clearToken()
          setToken(null)
          setError('La sesión de Google ha caducado. Vuelve a conectar.')
        } else {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        running.current = false
        setSyncing(false)
        setProgress(null)
      }
    },
    [account, apply, tidyUp, settings],
  )

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const accessToken = await getAccessToken(settings.clientId)
      setToken(accessToken)
      setSignedOut(false)
      return accessToken
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      setConnecting(false)
    }
  }, [settings.clientId])

  // Al abrir la app: primero se pone al día lo ya guardado si viene de una
  // versión anterior del análisis, y después se busca lo nuevo en Gmail, pero
  // solo si el token sigue vivo. Pedirlo sin que el usuario haya tocado nada
  // abriría una ventana de Google que el navegador bloquearía por no venir de
  // un gesto suyo.
  useEffect(() => {
    if (matches.length) {
      tidyUp(latest.current, { reparse: settings.dataVersion !== DATA_VERSION })
      setSettings((current) => ({ ...current, dataVersion: DATA_VERSION }))
    }

    const existing = storedToken()
    if (existing) void sync(existing)
    // Solo al montar: las sincronizaciones posteriores las pide el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Reconecta y sincroniza: lo que hace el botón cuando la sesión ha caducado. */
  const reconnect = useCallback(async () => {
    const accessToken = await connect()
    if (accessToken) await sync(accessToken)
  }, [connect, sync])

  const rows = useMemo(
    () =>
      matches.map((match) => {
        const entry = flagsFor(flags, match.id)
        return {
          match,
          flags: entry,
          amount: effectiveAmount(match, entry),
          isDemo: effectiveDemo(match, entry),
        }
      }),
    [matches, flags],
  )

  const buckets = useMemo(() => {
    const live = rows.filter((row) => !row.flags.deleted)
    // Un partido anulado no se arbitra: fuera de todas las cuentas.
    const active = live.filter((row) => !row.match.cancelled)
    const real = active.filter((row) => !row.isDemo)
    const played = real.filter((row) => isPast(row.match.kickoff))
    return {
      // Los cobrados siguen en la lista: marcar uno sin querer no lo esconde.
      jugados: played,
      pendientes: played.filter((row) => !row.flags.paid),
      proximos: real.filter((row) => !row.flags.paid && !isPast(row.match.kickoff)),
      pagados: real.filter((row) => row.flags.paid),
      demos: active.filter((row) => row.isDemo),
      anulados: live.filter((row) => row.match.cancelled),
      papelera: rows.filter((row) => row.flags.deleted),
    }
  }, [rows])

  const sum = (list: typeof rows) => list.reduce((total, row) => total + (row.amount ?? 0), 0)
  const owed = sum(buckets.pendientes)
  const upcoming = sum(buckets.proximos)
  const collected = sum(buckets.pagados)
  const unreadable = buckets.pendientes.filter((row) => row.amount === null).length

  const visible = useMemo(() => {
    const list = [...buckets[filter]]
    const time = (row: (typeof rows)[number]) =>
      row.match.kickoff ? new Date(row.match.kickoff).getTime() : 0
    if (filter === 'proximos') return list.sort((a, b) => time(a) - time(b))
    // En "Jugados" lo pendiente va primero y lo cobrado se queda al final.
    return list.sort(
      (a, b) => Number(a.flags.paid) - Number(b.flags.paid) || time(b) - time(a),
    )
  }, [buckets, filter])

  const open = openId ? rows.find((row) => row.match.id === openId) : null

  const onRefreshPdf = async (match: Match) => {
    const accessToken = token ?? (await connect())
    if (!accessToken) return
    setRefreshing(true)
    try {
      const updated = await refreshMatch(match, accessToken, settings.demoThreshold)
      const next = latest.current.matches.map((row) => (row.id === updated.id ? updated : row))
      apply(next, latest.current.flags)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRefreshing(false)
    }
  }

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ matches, flags, settings }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `partidos-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const wipe = () => {
    apply([], {})
    setShowSettings(false)
    setNotice('Datos borrados. Sincroniza para volver a traerlos de Gmail.')
  }

  // La pantalla de login solo se interpone cuando no hay nada que enseñar. Con
  // partidos guardados la app funciona sin conexión: se ve lo que te deben y se
  // marca lo cobrado, y ya se sincronizará cuando se vuelva a conectar.
  if (!token && (signedOut || matches.length === 0)) {
    return (
      <div className="app">
        <div className="gate">
          <div style={{ fontSize: 46 }}>⚽</div>
          <h2>Partidos arbitrados</h2>
          <p>
            Conecta tu Gmail y la app leerá las designaciones del Comité de Árbitros para
            llevarte la cuenta de lo que te deben.
          </p>
          {storageError && <div className="notice error">{storageError}</div>}
      {error && <div className="notice error">{error}</div>}
          <button
            className="primary"
            onClick={() => {
              setSignedOut(false)
              void connect()
            }}
            disabled={connecting}
          >
            {connecting ? 'Conectando…' : 'Conectar con Gmail'}
          </button>
          <p className="hint" style={{ marginTop: 18 }}>
            Solo se pide permiso de lectura. Los correos no salen de tu dispositivo.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Partidos arbitrados</h1>
        <div className="top-actions">
          <button
            className="icon-btn"
            onClick={() => void (token ? sync(token) : reconnect())}
            disabled={syncing || connecting}
            aria-label="Sincronizar"
          >
            {syncing || connecting ? '…' : '↻'}
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Ajustes">
            ⚙
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-label">Te deben</div>
        <p className="hero-value">{formatEuro(owed)}</p>
        <div className="hero-sub">
          {buckets.pendientes.length} partido{buckets.pendientes.length === 1 ? '' : 's'} jugado
          {buckets.pendientes.length === 1 ? '' : 's'} sin cobrar
          {unreadable > 0 && ` · ${unreadable} sin importe leído`}
        </div>
      </section>

      <div className="mini-stats">
        <div className="mini">
          <span>Próximos</span>
          <strong>{formatEuro(upcoming)}</strong>
        </div>
        <div className="mini">
          <span>Cobrado</span>
          <strong>{formatEuro(collected)}</strong>
        </div>
      </div>

      {!token && (
        <div className="notice error">
          Sin conexión con Gmail: esto es lo último que se descargó.{' '}
          <button className="link" onClick={() => void reconnect()} disabled={connecting}>
            {connecting ? 'Conectando…' : 'Volver a conectar'}
          </button>
        </div>
      )}
      {storageError && <div className="notice error">{storageError}</div>}
      {error && <div className="notice error">{error}</div>}
      {notice && !error && <div className="notice info">{notice}</div>}

      {syncing && progress && (
        <div className="notice info">
          {progress.label}
          <div className="progress">
            <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 10}%` }} />
          </div>
        </div>
      )}

      <nav className="filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className="chip"
            aria-pressed={filter === item.id}
            onClick={() => {
              setFilter(item.id)
              setShown(PAGE)
              // Sin esto, al pasar de una lista larga a una corta la pagina
              // encoge, el navegador deja el scroll al final y parece que no
              // ha cambiado nada.
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            {item.label}
            <span className="count">{buckets[item.id].length}</span>
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <div className="empty">
          {filter === 'jugados'
            ? 'Todavía no hay partidos jugados. Sincroniza para traerlos de Gmail.'
            : 'Nada por aquí.'}
        </div>
      ) : (
        visible.slice(0, shown).map((row) => (
          <MatchCard
            key={row.match.id}
            match={row.match}
            flags={row.flags}
            amount={row.amount}
            isDemo={row.isDemo}
            onTogglePaid={() =>
              updateFlags(row.match.id, {
                paid: !row.flags.paid,
                paidAt: row.flags.paid ? null : new Date().toISOString(),
              })
            }
            onOpen={() => setOpenId(row.match.id)}
            onDelete={() => updateFlags(row.match.id, { deleted: true, deletedAt: new Date().toISOString() })}
            onRestore={() => updateFlags(row.match.id, { deleted: false, deletedAt: null })}
          />
        ))
      )}

      {visible.length > shown && (
        <button className="primary show-more" onClick={() => setShown((current) => current + PAGE)}>
          Mostrar {Math.min(PAGE, visible.length - shown)} más
          <span className="rest"> · quedan {visible.length - shown}</span>
        </button>
      )}

      {open && (
        <MatchDetail
          match={open.match}
          flags={open.flags}
          amount={open.amount}
          isDemo={open.isDemo}
          busy={refreshing}
          onClose={() => setOpenId(null)}
          onAmountOverride={(value) => updateFlags(open.match.id, { amountOverride: value })}
          onDemoOverride={(value) => updateFlags(open.match.id, { demoOverride: value })}
          onRefresh={() => void onRefreshPdf(open.match)}
          onDelete={() => {
            updateFlags(open.match.id, { deleted: true, deletedAt: new Date().toISOString() })
            setOpenId(null)
          }}
          onRestore={() => updateFlags(open.match.id, { deleted: false, deletedAt: null })}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          account={account}
          matches={matches}
          matchCount={matches.length}
          onSave={setSettings}
          onClose={() => setShowSettings(false)}
          onSignOut={() => {
            void forgetToken()
            setToken(null)
            setSignedOut(true)
            setShowSettings(false)
            // Los avisos de la sesión anterior ya no vienen a cuento.
            setError(null)
            setNotice(null)
          }}
          onExport={exportData}
          onReanalyze={() => reanalyze()}
          onWipe={wipe}
        />
      )}
    </div>
  )
}
