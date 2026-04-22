import crypto from 'crypto'

/**
 * Stateless unsubscribe tokens.
 *
 * Token format: `<base64url(studentId)>.<hmac-sig>`
 *   - HMAC-SHA256(studentId, secret), base64url-encoded
 *   - No timestamp / no expiry — an unsubscribe link in a two-year-old email
 *     should still work. The only way to invalidate one is to rotate the
 *     secret (which breaks *all* live tokens — so only do that if we suspect
 *     the secret has leaked).
 *
 * Why HMAC and not a DB table:
 *   - Zero round-trips on send (we build tokens for every send)
 *   - Zero storage churn (we send tens of thousands of these per year)
 *   - Gmail One-Click (RFC 8058) POSTs directly; verifying via HMAC lets us
 *     respond in <50ms without a DB read before the write.
 */

const SECRET_ENV = 'UNSUBSCRIBE_SECRET'

function getSecret(): string {
  // Primary: dedicated secret (Favour should set this in Vercel)
  const s = process.env[SECRET_ENV]
  if (s && s.length >= 16) return s
  // Fallback: derive from the service role key so the feature works on
  // deploys that haven't configured UNSUBSCRIBE_SECRET yet. Not ideal
  // (rotating the service key would invalidate every live unsub link) but
  // infinitely preferable to the feature being broken out of the box.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) {
    console.warn(`[unsubscribe-token] ${SECRET_ENV} not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret for stable unsub links across key rotations.`)
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

export function createUnsubscribeToken(studentId: string): string {
  const payload = base64url(Buffer.from(studentId, 'utf8'))
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyUnsubscribeToken(token: string | null | undefined): { ok: true; studentId: string } | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [payload, sig] = parts
  let expected: string
  try { expected = sign(payload) } catch (e: any) { return { ok: false, reason: e?.message ?? 'secret error' } }
  // Constant-time compare to avoid timing attacks. Uint8Array avoids
  // a TS mismatch in Node 20's Buffer typings under strict mode.
  const a = new Uint8Array(Buffer.from(sig))
  const b = new Uint8Array(Buffer.from(expected))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' }
  const studentId = base64urlDecode(payload).toString('utf8')
  // Minimal sanity — studentId looks like a UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
    return { ok: false, reason: 'payload not a UUID' }
  }
  return { ok: true, studentId }
}

/**
 * Build the absolute URL a recipient can click to unsubscribe. The origin is
 * read from NEXT_PUBLIC_SITE_URL (set in Vercel) so preview deployments
 * don't leak prod tokens into prod rows by accident; falls back to the
 * canonical prod URL for local dev convenience.
 */
export function buildUnsubscribeUrl(studentId: string): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://the-steps-foundation-intranet.vercel.app'
  const token = createUnsubscribeToken(studentId)
  return `${origin.replace(/\/$/, '')}/api/unsubscribe?token=${encodeURIComponent(token)}`
}
