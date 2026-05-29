import crypto from 'crypto'

/**
 * Stateless RSVP tokens.
 *
 * Token format: `<base64url(applicationId)>.<hmac-sig>`
 *   - HMAC-SHA256(applicationId, secret), base64url-encoded
 *   - No timestamp / no expiry. An RSVP link in the acceptance email should
 *     work as long as the application row exists; deleted / withdrawn rows
 *     are handled server-side at write time (we just refuse the write and
 *     show a "no longer valid" page).
 *
 * Mirrors lib/withdraw-token.ts and lib/unsubscribe-token.ts on purpose. If
 * you change the signature, update the others.
 */

const SECRET_ENV = 'RSVP_SECRET'

function getSecret(): string {
  const s = process.env[SECRET_ENV]
  if (s && s.length >= 16) return s
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) {
    // eslint-disable-next-line no-console
    console.warn(`[rsvp-token] ${SECRET_ENV} not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret in Vercel for stable links across key rotations.`)
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

export function createRsvpToken(applicationId: string): string {
  const payload = base64url(Buffer.from(applicationId, 'utf8'))
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyRsvpToken(token: string | null | undefined): { ok: true; applicationId: string } | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [payload, sig] = parts
  let expected: string
  try { expected = sign(payload) } catch (e: unknown) {
    const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : 'secret error'
    return { ok: false, reason: msg }
  }
  const a = new Uint8Array(Buffer.from(sig))
  const b = new Uint8Array(Buffer.from(expected))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' }
  const applicationId = base64urlDecode(payload).toString('utf8')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
    return { ok: false, reason: 'payload not a UUID' }
  }
  return { ok: true, applicationId }
}

/**
 * Build the absolute RSVP URL embedded in acceptance emails. Lands on
 * /my/events/[id]/rsvp?token=... which auto-signs the student in via the
 * token and surfaces the 3-option picker. The page also handles
 * already-authed students by reading the application id from the URL.
 */
export function buildRsvpUrl(applicationId: string, eventId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://the-steps-foundation-intranet.vercel.app'
  const token = createRsvpToken(applicationId)
  return `${origin.replace(/\/$/, '')}/my/events/${eventId}/rsvp?token=${encodeURIComponent(token)}`
}

/** Regex used by the email-send pipeline to swap `{{rsvp_link}}` into a real anchor. */
export const RSVP_LINK_TAG_REGEX = /\{\{rsvp_link\}\}/g
