import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { verifyRsvpToken } from '@/lib/rsvp-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// RSVP write endpoint.
//
//   POST /api/rsvp
//   Body: { token: string, choice: 'yes' | 'maybe' | 'no' }
//
// Token is an HMAC-signed application_id (see lib/rsvp-token.ts) so the
// caller doesn't need an auth session — the email link works for the
// student in any browser, on any device.
//
// Side effect on `choice === 'no'` (and only when transitioning into 'no',
// not when reaffirming): we look up the oldest waitlisted application for
// the same event and flip it to 'accepted'. The DB trigger added in
// 0037_application_rsvp.sql stamps that promoted row to rsvp='pending'.
// We deliberately DO NOT auto-email the promoted student here — admins
// see them in the applicants table via the row colours and send the
// Accept & Notify template manually so they can review who landed.
// ---------------------------------------------------------------------------

const CHOICES = ['yes', 'maybe', 'no'] as const
type Choice = (typeof CHOICES)[number]

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type ApplicationRow = {
  id: string
  event_id: string
  status: string
  rsvp: string | null
  deleted_at: string | null
}

async function promoteNextWaitlister(sb: SupabaseClient, eventId: string): Promise<{ promotedId: string | null }> {
  const { data: next } = await sb
    .from('applications')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'waitlist')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!next) return { promotedId: null }

  const { error: upErr } = await sb
    .from('applications')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', (next as { id: string }).id)
  if (upErr) {
    // eslint-disable-next-line no-console
    console.error('[rsvp] failed to promote waitlister', upErr.message)
    return { promotedId: null }
  }
  return { promotedId: (next as { id: string }).id }
}

export async function POST(req: NextRequest) {
  let body: { token?: string; choice?: string } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const verified = verifyRsvpToken(body.token)
  if (!verified.ok) return NextResponse.json({ error: `Invalid link: ${verified.reason}` }, { status: 400 })

  const choice = body.choice as Choice | undefined
  if (!choice || !CHOICES.includes(choice)) {
    return NextResponse.json({ error: `choice must be one of ${CHOICES.join(', ')}` }, { status: 400 })
  }

  const sb = getServiceClient()

  const { data: appRow, error: readErr } = await sb
    .from('applications')
    .select('id, event_id, status, rsvp, deleted_at')
    .eq('id', verified.applicationId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  const app = appRow as ApplicationRow | null
  if (!app || app.deleted_at) {
    return NextResponse.json({ error: 'This application is no longer active.' }, { status: 410 })
  }
  if (app.status !== 'accepted') {
    return NextResponse.json({ error: 'Only accepted applicants can RSVP.' }, { status: 409 })
  }

  const previousChoice = app.rsvp
  const { error: upErr } = await sb
    .from('applications')
    .update({ rsvp: choice })
    .eq('id', app.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  let promotedId: string | null = null
  if (choice === 'no' && previousChoice !== 'no') {
    const result = await promoteNextWaitlister(sb, app.event_id)
    promotedId = result.promotedId
  }

  return NextResponse.json({ ok: true, choice, promotedWaitlister: promotedId })
}
