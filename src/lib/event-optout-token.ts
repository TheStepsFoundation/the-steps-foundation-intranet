import crypto from 'crypto'

/**
 * Per-event email opt-out tokens.
 *
 * Token format: `<base64url(studentId)>.<base64url(eventId)>.<hmac-sig>`
 *   - HMAC-SHA256 over `${studentId}|${eventId}`
 *   - No timestamp / no expiry. A student should still be able to opt out
 *     from a months-old invite. Rotate EVENT_OPTOUT_SECRET to invalidate
 *     every live link (destructive; only do this if leak suspected).
 *
 * Mirrors lib/withdraw-token.ts and lib/unsubscribe-token.ts on purpose —
 * keep these three in sync if the signing scheme changes.
 */

const SECRET_ENV = 'EVENT_OPTOUT_SECRET'

function getSecret(): string {
  const s = process.env[SECRET_ENV]
  if (s && s.length >= 16) return s
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) {
    console.warn(`[event-optout-token] ${SECRET_ENV} not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret in Vercel for stable links across key rotations.`)
    return fallback
  }
  throw new Error(`${SECRET_ENV} or SUPABASE_SERVICE_ROLE_KEY must be set`)
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(payload: string): string {
  return base64url(crypto.createHmac('sha256', getSecret()).update(payload).digest())
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createEventOptoutToken(studentId: string, eventId: string): string {
  const sPart = base64url(Buffer.from(studentId, 'utf8'))
  const ePart = base64url(Buffer.from(eventId, 'utf8'))
  const sig = sign(`${studentId}|${eventId}`)
  return `${sPart}.${ePart}.${sig}`
}

export function verifyEventOptoutToken(token: string | null | undefined):
  | { ok: true; studentId: string; eventId: string }
  | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' }
  const [sPart, ePart, sig] = parts
  let studentId: string
  let eventId: string
  try {
    studentId = base64urlDecode(sPart).toString('utf8')
    eventId = base64urlDecode(ePart).toString('utf8')
  } catch {
    return { ok: false, reason: 'malformed token' }
  }
  if (!UUID_RE.test(studentId) || !UUID_RE.test(eventId)) {
    return { ok: false, reason: 'payload not a UUID' }
  }
  let expected: string
  try { expected = sign(`${studentId}|${eventId}`) } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'secret error' }
  }
  const a = new Uint8Array(Buffer.from(sig))
  const b = new Uint8Array(Buffer.from(expected))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad signature' }
  }
  return { ok: true, studentId, eventId }
}

/**
 * Build the absolute opt-out URL for embedding in an event invite email.
 * Origin from NEXT_PUBLIC_SITE_URL so preview deployments don't write into
 * prod rows by accident; falls back to the canonical prod URL for local dev.
 */
export function buildEventOptoutUrl(studentId: string, eventId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://the-steps-foundation-intranet.vercel.app'
  const token = createEventOptoutToken(studentId, eventId)
  return `${origin.replace(/\/$/, '')}/api/event-optout?token=${encodeURIComponent(token)}`
}

export const EVENT_OPTOUT_LINK_TAG = '{{event_optout_link}}'
export const EVENT_OPTOUT_LINK_TAG_REGEX = /\{\{event_optout_link\}\}/g
