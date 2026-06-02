import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/profile/update-phone
//
// Lets a signed-in team member set or clear their OWN contact phone number
// from the /profile page. Non-admin ('wider') members are RLS-blocked from
// client-side team_members writes (team_members_admin_all only permits writes
// when is_admin()), so this runs server-side with the service role. The write
// is scoped strictly to the caller's own row, matched by the email on their
// verified Supabase access token — a member can never edit anyone else's row.
// Admins go through the same path for consistency.
//
// Gating mirrors /api/admin/update-student-email: a valid Supabase access
// token whose user.email is present in team_members.
// ---------------------------------------------------------------------------

const MAX_PHONE_LEN = 32

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

async function requireTeamMember(
  req: NextRequest,
  svc: ReturnType<typeof getServiceClient>,
): Promise<{ email: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header', status: 401 }
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return { error: 'Empty access token', status: 401 }

  const { data: userData, error: userErr } = await svc.auth.getUser(token)
  if (userErr || !userData?.user?.email) {
    return { error: 'Invalid access token', status: 401 }
  }
  const email = userData.user.email.toLowerCase()
  const { data: tm, error: tmErr } = await svc
    .from('team_members')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (tmErr) return { error: 'Membership lookup failed', status: 500 }
  if (!tm) return { error: 'Not authorised', status: 403 }
  return { email }
}

// Normalise the phone input: trim, collapse runs of whitespace. Empty -> null
// (clears the field). Lenient on format so international numbers work.
function normalisePhone(raw: unknown): { value: string | null } | { error: string } {
  if (raw === null || raw === undefined) return { value: null }
  if (typeof raw !== 'string') return { error: 'phone must be a string or null' }
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return { value: null }
  if (trimmed.length > MAX_PHONE_LEN) {
    return { error: `Phone must be ${MAX_PHONE_LEN} characters or fewer` }
  }
  if (!/^\+?[0-9 ()./-]+$/.test(trimmed)) {
    return { error: 'Phone can only contain digits, spaces and + ( ) - . /' }
  }
  return { value: trimmed }
}

export async function POST(req: NextRequest) {
  const svc = getServiceClient()

  const gate = await requireTeamMember(req, svc)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const norm = normalisePhone((body as { phone?: unknown } | null)?.phone)
  if ('error' in norm) return NextResponse.json({ error: norm.error }, { status: 400 })

  const { error: updErr } = await svc
    .from('team_members')
    .update({ phone: norm.value })
    .eq('email', gate.email)
  if (updErr) return NextResponse.json({ error: `Update failed: ${updErr.message}` }, { status: 500 })

  return NextResponse.json({ phone: norm.value }, { status: 200 })
}
