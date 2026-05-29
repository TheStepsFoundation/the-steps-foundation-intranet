import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildRsvpUrl } from '@/lib/rsvp-token'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// /api/rsvp/start?application_id=<uuid>
//
// Authed-session entry point to the RSVP flow. Used by the hub event card
// ("Manage RSVP" link). Verifies the caller owns the application via their
// auth cookie, then 302s to /my/events/<eventId>/rsvp?token=<sig>. The
// token-based flow on the page is identical to the email flow, so the
// write side has one code path.
// ---------------------------------------------------------------------------

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function userClientFromCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const store = cookies()
  const tokenCookie = store.getAll().find(c => /sb-.*-auth-token/.test(c.name))?.value
  if (!tokenCookie) return null
  let access: string | null = null
  try {
    const parsed = JSON.parse(tokenCookie)
    access = parsed?.access_token ?? null
  } catch { access = tokenCookie }
  if (!access) return null
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${access}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const appId = url.searchParams.get('application_id')
  if (!appId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
    return NextResponse.json({ error: 'missing or malformed application_id' }, { status: 400 })
  }

  const userClient = userClientFromCookies()
  if (!userClient) return NextResponse.json({ error: 'sign in required' }, { status: 401 })

  const { data: who } = await userClient.auth.getUser()
  const email = who?.user?.email
  if (!email) return NextResponse.json({ error: 'sign in required' }, { status: 401 })

  const sb = serviceClient()
  const { data: app, error } = await sb
    .from('applications')
    .select('id, event_id, deleted_at, student:students(personal_email)')
    .eq('id', appId)
    .maybeSingle()
  if (error || !app || (app as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const ownerEmail = (app as { student?: { personal_email?: string } }).student?.personal_email?.toLowerCase()
  if (ownerEmail !== email.toLowerCase()) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const redirect = buildRsvpUrl(appId, (app as { event_id: string }).event_id)
  return NextResponse.redirect(redirect, { status: 302 })
}
