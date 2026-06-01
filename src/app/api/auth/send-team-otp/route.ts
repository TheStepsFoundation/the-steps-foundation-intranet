import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/auth/send-team-otp
//
// Sends a 6-digit OTP to the given email ONLY IF the email is on the
// team_members allowlist. The check happens server-side with the service
// role so the browser never learns the answer, then the response is
// identical (200 { ok: true }) whether or not the email was allowlisted.
//
// Why it exists: the client used to call supabase.auth.signInWithOtp
// directly, which sent a code to any email anyone typed in. That
// (a) burnt the 2,000/day Workspace SMTP cap on noise, (b) created a
// throwaway auth.users row for every entered email (shouldCreateUser:
// true), and (c) gave a misleading "code sent" message to non-team users
// who then couldn't actually use the code. The post-verify team_members
// gate caught them, but only after the side-effects above.
//
// The UI still shows the standard non-enumerating message — "If this
// email is on our team list, we've sent you a 6-digit code" — to avoid
// confirming team membership from the response alone. Timing could
// theoretically leak (the allowlisted path actually waits on Supabase to
// send an email) but for a 16-person internal tool that's an acceptable
// trade.
//
// Body: { email: string }
// Returns: { ok: true } in all valid input cases (200).
//          { ok: false, error: ... } only on malformed input or upstream
//          failure (4xx / 5xx). The "not on allowlist" case returns ok:true
//          on purpose.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Floor delay so the no-op path takes at least as long as the send path.
// The allowlisted path naturally takes 1–3s (SMTP round-trip); the no-op
// path would otherwise return in ~50ms and leak membership via timing.
// We pad both paths to this floor so a timing attacker can't distinguish.
// Pitched at 2000ms — comfortably above the no-op DB round-trip, and
// usually below or close to the allowlisted SMTP round-trip so the
// allowlisted path rarely gets padded further.
const RESPONSE_FLOOR_MS = 2000

async function withFloor<T>(start: number, value: T): Promise<T> {
  const elapsed = Date.now() - start
  if (elapsed < RESPONSE_FLOOR_MS) {
    await new Promise(r => setTimeout(r, RESPONSE_FLOOR_MS - elapsed))
  }
  return value
}

export async function POST(req: NextRequest) {
  const start = Date.now()

  let body: any
  try {
    body = await req.json()
  } catch {
    // Malformed input — return immediately. No timing leak here because
    // the caller never got past parsing; no membership inferred.
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawEmail = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!rawEmail) {
    return NextResponse.json({ ok: false, error: 'Email required' }, { status: 400 })
  }
  const email = rawEmail.toLowerCase()

  // Very light syntactic check — Supabase would reject malformed emails
  // anyway, but failing fast here saves a service-role round-trip. We
  // pad to the floor on this path too so an attacker can't distinguish
  // "syntactically invalid" from "not on allowlist" by timing.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return withFloor(start, NextResponse.json({ ok: true }))
  }

  let svc
  try {
    svc = getServiceClient()
  } catch (err: any) {
    console.error('[send-team-otp] service client init failed:', err?.message)
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 })
  }

  // Allowlist check — service role bypasses RLS on team_members.
  const { data: row, error: lookupErr } = await svc
    .from('team_members')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error('[send-team-otp] team_members lookup error:', lookupErr.message)
    // Don't leak that we even tried — return the no-op shape (post-floor) and log.
    return withFloor(start, NextResponse.json({ ok: true }))
  }

  if (!row) {
    // Email not on allowlist. Quietly do nothing — but pad to the floor
    // so the response timing matches the allowlisted path.
    return withFloor(start, NextResponse.json({ ok: true }))
  }

  // Allowlisted — send the OTP via the service client (same email pipe as
  // any other Supabase auth send). shouldCreateUser=true so brand-new
  // team_members rows (added before the user has any auth.users presence)
  // can sign in for the first time.
  const { error: otpErr } = await svc.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })

  if (otpErr) {
    console.error('[send-team-otp] signInWithOtp failed:', otpErr.message)
    // Real upstream failure — surface as 5xx so the UI can show a retry hint.
    // No floor padding: this is a legitimate error, not a covert no-op.
    return NextResponse.json({ ok: false, error: 'Failed to send code. Try again in a moment.' }, { status: 502 })
  }

  return withFloor(start, NextResponse.json({ ok: true }))
}
