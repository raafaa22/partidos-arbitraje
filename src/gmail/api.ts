const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  snippet?: string
  payload?: GmailPart
}

export class GmailError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Google ha cortado por exceso de peticiones y no merece la pena insistir. */
export class QuotaError extends GmailError {}

/**
 * Gmail cobra por peticion y corta con "Quota exceeded" si se le lanzan cientos
 * seguidas. Con 400 correos eso pasa enseguida, asi que las llamadas van de una
 * en una y separadas por un hueco minimo.
 */
const MIN_GAP_MS = 110
let nextSlot = 0

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function slot(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + MIN_GAP_MS
  if (at > now) await wait(at - now)
}

function isRateLimit(status: number, message: string): boolean {
  if (status === 429) return true
  // Google devuelve 403 con este texto cuando se pasa de peticiones por minuto.
  return status === 403 && /quota|rate limit|user rate/i.test(message)
}

/** Reintentos ante un corte temporal, espaciandolos cada vez mas. */
const RETRY_DELAYS_MS = [1000, 3000, 9000, 20000]

async function call<T>(token: string, path: string): Promise<T> {
  let lastMessage = ''

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    await slot()
    const response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.ok) return response.json() as Promise<T>

    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    lastMessage = body?.error?.message ?? `Gmail respondió ${response.status}`

    const retryable = isRateLimit(response.status, lastMessage) || response.status >= 500
    if (!retryable) throw new GmailError(lastMessage, response.status)

    const delay = RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      throw new QuotaError(lastMessage, response.status)
    }
    // Se frena tambien el resto de la cola, no solo esta llamada.
    nextSlot = Date.now() + delay
    await wait(delay)
  }

  throw new QuotaError(lastMessage, 429)
}

/** Todos los ids de mensajes que casan con la busqueda, paginando hasta el final. */
export async function listMessageIds(token: string, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q: query, maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `/messages?${params}`,
    )
    for (const message of page.messages ?? []) ids.push(message.id)
    pageToken = page.nextPageToken
  } while (pageToken)
  return ids
}

/** La cuenta a la que pertenece el token. */
export async function getAccountEmail(token: string): Promise<string> {
  const profile = await call<{ emailAddress?: string }>(token, '/profile')
  return profile.emailAddress ?? ''
}

export function getMessage(token: string, id: string): Promise<GmailMessage> {
  return call<GmailMessage>(token, `/messages/${id}?format=full`)
}

export async function getAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const body = await call<{ data?: string }>(token, `/messages/${messageId}/attachments/${attachmentId}`)
  return body.data ? base64UrlToBytes(body.data) : new Uint8Array()
}

export function base64UrlToBytes(data: string): Uint8Array {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeBody(data: string): string {
  return new TextDecoder('utf-8').decode(base64UrlToBytes(data))
}

function walk(part: GmailPart | undefined, visit: (part: GmailPart) => void): void {
  if (!part) return
  visit(part)
  for (const child of part.parts ?? []) walk(child, visit)
}

/** El cuerpo en texto plano; si el correo solo trae HTML, se le quitan las etiquetas. */
export function plainTextBody(message: GmailMessage): string {
  let plain = ''
  let html = ''
  walk(message.payload, (part) => {
    const data = part.body?.data
    if (!data || part.filename) return
    if (part.mimeType === 'text/plain' && !plain) plain = decodeBody(data)
    if (part.mimeType === 'text/html' && !html) html = decodeBody(data)
  })
  if (plain) return plain
  if (!html) return message.snippet ?? ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

export interface Attachment {
  filename: string
  attachmentId: string
}

export function pdfAttachments(message: GmailMessage): Attachment[] {
  const found: Attachment[] = []
  walk(message.payload, (part) => {
    const id = part.body?.attachmentId
    const name = part.filename ?? ''
    if (!id || !name) return
    if (part.mimeType === 'application/pdf' || /\.pdf$/i.test(name)) {
      found.push({ filename: name, attachmentId: id })
    }
  })
  return found
}

export function header(message: GmailMessage, name: string): string | null {
  const wanted = name.toLowerCase()
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === wanted)?.value ?? null
  )
}
