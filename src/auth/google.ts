/**
 * Login con Google Identity Services. Se pide solo el permiso de lectura de
 * Gmail y el token vive en el navegador: nada sale del dispositivo, no hay
 * servidor por medio.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const TOKEN_KEY = 'pa.token.v1'
/** Marca de que el usuario cerró sesión a mano, para distinguirlo de un token caducado. */
const SIGNED_OUT_KEY = 'pa.signedOut.v1'
/** Marca de que esta cuenta ya dio el permiso alguna vez en este dispositivo. */
const CONSENT_KEY = 'pa.consent.v1'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string; hint?: string }): void
  callback: (response: TokenResponse) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type?: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('No se ha podido cargar el login de Google. ¿Hay conexión?'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface StoredToken {
  accessToken: string
  expiresAt: number
}

function readStored(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredToken
    // Cinco minutos de margen: una primera carga larga puede tardar un par de
    // minutos y no puede quedarse a medias porque el token caduque por el camino.
    return stored.expiresAt - 5 * 60_000 > Date.now() ? stored : null
  } catch {
    return null
  }
}

function store(token: StoredToken): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
  } catch {
    // Modo privado sin almacenamiento: se seguira pidiendo el token cada vez.
  }
}

export function storedToken(): string | null {
  return readStored()?.accessToken ?? null
}

/**
 * Si la ultima accion fue cerrar sesion. No es lo mismo que no tener token: un
 * token caducado deja la app funcionando con lo ya descargado, pero cerrar
 * sesion a mano tiene que llevar a la pantalla de entrada, o no hay forma de
 * saber si ha hecho algo.
 */
/**
 * Si esta cuenta ya concedió el permiso en este dispositivo. Solo entonces tiene
 * sentido intentar renovar el token en silencio: sin consentimiento previo,
 * Google abriría su ventana, que es justo lo que no se quiere al arrancar.
 */
export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

export function isSignedOut(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Consigue un token de acceso.
 *
 * Los tokens de Google duran una hora y en una app sin servidor no hay forma de
 * guardar un token de refresco. Lo que sí se puede es pedir uno nuevo en
 * silencio (`silent`), sin ventanas ni clics, mientras la sesión de Google del
 * navegador siga viva y el permiso ya esté concedido. Es lo que evita tener que
 * darle a "volver a conectar" cada hora.
 *
 * Sin `silent`, Google abre su ventana de permisos, así que hay que llamarlo
 * desde un gesto del usuario o el navegador la bloquea.
 */
export async function getAccessToken(
  clientId: string,
  options: { silent?: boolean; hint?: string } = {},
): Promise<string> {
  const cached = readStored()
  if (cached) return cached.accessToken

  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('El login de Google no está disponible.')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Permiso denegado.'))
          return
        }
        const token = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        }
        store(token)
        try {
          localStorage.removeItem(SIGNED_OUT_KEY)
          localStorage.setItem(CONSENT_KEY, '1')
        } catch {
          // Sin almacenamiento no hay marcas que tocar.
        }
        resolve(token.accessToken)
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? 'No se ha podido conectar con Google.'))
      },
    })
    // El `hint` con el correo evita que Google pregunte por la cuenta cuando
    // hay varias iniciadas en el navegador.
    client.requestAccessToken({
      prompt: options.silent ? 'none' : '',
      ...(options.hint ? { hint: options.hint } : {}),
    })
  })
}

/**
 * Tira el token caducado. No marca cierre de sesion ni revoca nada: el token ya
 * esta muerto, y la app tiene que seguir enseñando lo ya descargado en vez de
 * plantar la pantalla de entrada por una caducidad.
 */
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

/**
 * Cierra sesion a peticion del usuario: borra el token y le pide a Google que
 * lo invalide.
 *
 * La revocacion va por HTTP y no por la libreria de Google, que solo esta
 * cargada si el usuario ha pulsado "conectar" en esta misma sesion: entrando
 * con el token ya guardado no existe, y el permiso se quedaba vivo en la
 * cuenta. Se lee el token en crudo, sin mirar si ha caducado, porque un token
 * caducado tambien conviene revocarlo.
 */
export async function forgetToken(): Promise<void> {
  let raw: StoredToken | null = null
  try {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) raw = JSON.parse(stored) as StoredToken
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(CONSENT_KEY)
    localStorage.setItem(SIGNED_OUT_KEY, '1')
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }

  if (!raw?.accessToken) return
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(raw.accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  } catch {
    // Si no hay red, el token caduca solo en una hora. Lo importante es que ya
    // no esta en el dispositivo.
  }
}
