import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/admin/create-test-student
//
// Creates a dummy/test student admins can use for end-to-end testing of
// dashboards, applicant flows, invite emails, etc. Also provisions a real
// auth.users row with the supplied email + password (email pre-confirmed) so
// the admin can sign in as the dummy to exercise the student hub.
//
// Gating:
//   1. Caller must present a valid Supabase access token (Authorization:
//      Bearer <token>) for a user whose email is in team_members.
//   2. Uses the service role key server-side to create the auth user and
//      insert the students row (bypassing any RLS on auth/students).
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

/** Verify the caller is a team member. Returns the caller's email on success. */
async function requireTeamMember(req: NextRequest): Promise<{ email: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header', status: 401 }
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return { error: 'Empty access token', status: 401 }

  const svc = getServiceClient()
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

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const firstName = typeof body?.first_name === 'string' ? body.first_name.trim() : ''
  const lastName = typeof body?.last_name === 'string' ? body.last_name.trim() : ''

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
  }

  const svc = getServiceClient()

  // Step 1: Create auth user. email_confirm: true so the dummy can sign in
  // immediately without having to click a magic link.
  const { data: authData, error: authErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { test_student: true, created_by: gate.email },
  })
  if (authErr || !authData?.user) {
    return NextResponse.json({ error: `Auth user create failed: ${authErr?.message ?? 'unknown'}` }, { status: 400 })
  }
  const authUserId = authData.user.id

  // Step 2: Insert the students row. Permissive about school/year fields so
  // the admin can leave them blank and fill them in later if desired.
  const schoolType = body?.school_type ?? null
  const studentPayload: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
    personal_email: email,
    school_name_raw: body?.school_name_raw ?? null,
    school_type: schoolType,
    year_group: typeof body?.year_group === 'number' ? body.year_group : null,
    free_school_meals: typeof body?.free_school_meals === 'boolean' ? body.free_school_meals : null,
    parental_income_band: body?.parental_income_band ?? null,
    bursary_90plus: typeof body?.bursary_90plus === 'boolean'
      ? body.bursary_90plus
      : (schoolType === 'independent_bursary' ? true : null),
    subscribed_to_mailing: typeof body?.subscribed_to_mailing === 'boolean' ? body.subscribed_to_mailing : true,
    notes: typeof body?.notes === 'string' ? body.notes : '[admin-created test student]',
  }

  const { data: stuData, error: stuErr } = await svc
    .from('students')
    .insert(studentPayload)
    .select('id')
    .single()
  if (stuErr || !stuData) {
    // Best-effort rollback so we don't leave an orphan auth user.
    await svc.auth.admin.deleteUser(authUserId).catch(() => { /* noop */ })
    return NextResponse.json({ error: `Student insert failed: ${stuErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  return NextResponse.json({ student_id: stuData.id, auth_user_id: authUserId }, { status: 201 })
}
