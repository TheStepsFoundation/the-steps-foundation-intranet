import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/admin/create-test-student
//
// Creates a dummy/test student admins can use for end-to-end testing of
// dashboards, applicant flows, invite emails, etc.
//
// Two modes:
//   - password provided: also provisions a real auth.users row
//     (email_confirm: true) so the admin can sign in as the dummy and
//     exercise the student hub.
//   - password blank:    creates only the students row, no auth account.
//     Mirrors the many students we migrated from Google Sheets who haven't
//     signed in yet — lets us rehearse their first-sign-in experience.
//
// Also optionally creates:
//   - one applications row per entry in the `applications` array (event
//     history — used by invite/dashboards).
//   - one progression row if any academic field is provided.
//
// Gating:
//   1. Caller must present a valid Supabase access token (Authorization:
//      Bearer <token>) for a user whose email is in team_members.
//   2. Uses the service role key server-side to create the auth user and
//      insert domain rows (bypasses RLS).
// ---------------------------------------------------------------------------

type AppStatus = 'submitted' | 'accepted' | 'attended' | 'no_show' | 'rejected' | 'waitlist'
const APP_STATUSES = new Set<AppStatus>(['submitted', 'accepted', 'attended', 'no_show', 'rejected', 'waitlist'])
const SCHOOL_TYPES = new Set(['state', 'grammar', 'independent', 'independent_bursary'])
const INCOME_BANDS = new Set(['under_40k', 'over_40k', 'prefer_na'])
const STAGE_CODES = new Set([
  'y10', 'y11', 'y12', 'y13', 'gap', 'uni_y1', 'uni_y2', 'uni_y3', 'uni_y4', 'alum',
])
const A_LEVEL_GRADES = new Set(['A*', 'A', 'B', 'C', 'D', 'E', 'U'])

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

/** Filters a grade map down to {subject: grade} where both are strings from the allowed grade set. */
function sanitiseGrades(input: any): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== 'string' || !k.trim()) continue
    if (typeof v !== 'string') continue
    if (!A_LEVEL_GRADES.has(v)) continue
    out[k.trim()] = v
  }
  return Object.keys(out).length ? out : null
}

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const passwordRaw = typeof body?.password === 'string' ? body.password : ''
  const firstName = typeof body?.first_name === 'string' ? body.first_name.trim() : ''
  const lastName = typeof body?.last_name === 'string' ? body.last_name.trim() : ''

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  // Password is optional. If provided, it must be >= 6 chars (Supabase min).
  const hasPassword = passwordRaw.length > 0
  if (hasPassword && passwordRaw.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters (or leave blank to skip the auth account)' }, { status: 400 })
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
  }

  const svc = getServiceClient()
  let authUserId: string | null = null

  // Step 1: (optional) create auth user.
  if (hasPassword) {
    const { data: authData, error: authErr } = await svc.auth.admin.createUser({
      email,
      password: passwordRaw,
      email_confirm: true,
      user_metadata: { test_student: true, created_by: gate.email },
    })
    if (authErr || !authData?.user) {
      // Surface a friendlier error if this email is already in use.
      const msg = authErr?.message ?? 'unknown'
      const friendlier = /already|exists|registered|duplicate/i.test(msg)
        ? `An auth account with email ${email} already exists. Use a different email, or leave password blank to create just a student row.`
        : `Auth user create failed: ${msg}`
      return NextResponse.json({ error: friendlier }, { status: 400 })
    }
    authUserId = authData.user.id
  }

  // Step 2: Insert the students row.
  const schoolType = SCHOOL_TYPES.has(body?.school_type) ? body.school_type : null
  const incomeBand = INCOME_BANDS.has(body?.parental_income_band) ? body.parental_income_band : null
  const schoolId = typeof body?.school_id === 'string' && body.school_id ? body.school_id : null
  const yearGroup = Number.isFinite(body?.year_group) ? Math.floor(body.year_group) : null

  const studentPayload: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
    personal_email: email,
    school_id: schoolId,
    school_name_raw: typeof body?.school_name_raw === 'string' && body.school_name_raw.trim() ? body.school_name_raw.trim() : null,
    school_type: schoolType,
    year_group: yearGroup,
    free_school_meals: typeof body?.free_school_meals === 'boolean' ? body.free_school_meals : null,
    parental_income_band: incomeBand,
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
    if (authUserId) await svc.auth.admin.deleteUser(authUserId).catch(() => { /* noop */ })
    return NextResponse.json({ error: `Student insert failed: ${stuErr?.message ?? 'unknown'}` }, { status: 500 })
  }
  const studentId = stuData.id

  // Step 3: (optional) applications rows for past event attendance.
  const appsInput: any[] = Array.isArray(body?.applications) ? body.applications : []
  const appsRows = appsInput
    .map(a => {
      if (!a || typeof a !== 'object') return null
      const event_id = typeof a.event_id === 'string' && a.event_id ? a.event_id : null
      const status = APP_STATUSES.has(a.status) ? (a.status as AppStatus) : null
      if (!event_id || !status) return null
      return {
        student_id: studentId,
        event_id,
        status,
        attended: typeof a.attended === 'boolean' ? a.attended : (status === 'attended'),
        submitted_at: new Date().toISOString(),
        channel: 'admin_test',
        attribution_source: 'admin_test',
        raw_response: { test_student: true },
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  let applicationsCreated = 0
  if (appsRows.length > 0) {
    const { error: appErr, count } = await svc
      .from('applications')
      .insert(appsRows, { count: 'exact' })
    if (appErr) {
      // Soft-fail — student already exists; report but don't roll back.
      return NextResponse.json({
        student_id: studentId,
        auth_user_id: authUserId,
        applications_created: 0,
        warning: `Applications insert failed: ${appErr.message}`,
      }, { status: 201 })
    }
    applicationsCreated = count ?? appsRows.length
  }

  // Step 4: (optional) progression row for academic info.
  const prog = body?.progression
  let progressionCreated = false
  if (prog && typeof prog === 'object') {
    const current_stage = typeof prog.current_stage === 'string' && STAGE_CODES.has(prog.current_stage) ? prog.current_stage : null
    const a_level_subjects = Array.isArray(prog.a_level_subjects)
      ? prog.a_level_subjects.map((s: any) => typeof s === 'string' ? s.trim() : '').filter((s: string) => s)
      : []
    const predicted_grades = sanitiseGrades(prog.predicted_grades)
    const actual_grades = sanitiseGrades(prog.actual_grades)

    const hasAny = current_stage || a_level_subjects.length > 0 || predicted_grades || actual_grades
    if (hasAny) {
      const { error: progErr } = await svc.from('progression').insert({
        student_id: studentId,
        as_of_date: new Date().toISOString().slice(0, 10),
        current_stage,
        a_level_subjects: a_level_subjects.length > 0 ? a_level_subjects : null,
        predicted_grades,
        actual_grades,
      })
      if (progErr) {
        return NextResponse.json({
          student_id: studentId,
          auth_user_id: authUserId,
          applications_created: applicationsCreated,
          warning: `Progression insert failed: ${progErr.message}`,
        }, { status: 201 })
      }
      progressionCreated = true
    }
  }

  // Step 5: Generate a one-click magic-link URL so the admin can sign in as
  // the dummy without receiving the OTP email. generateLink will also create
  // the auth user if we skipped createUser above (password was blank), which
  // matches the real "migrated student clicks their first magic link" flow.
  let magicLink: string | null = null
  try {
    const redirectTo = req.nextUrl.origin + '/my'
    const { data: linkData, error: linkErr } = await (svc.auth.admin as any).generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })
    if (!linkErr) {
      magicLink = linkData?.properties?.action_link ?? linkData?.action_link ?? null
    }
  } catch { /* noop — magic link is best-effort, not required */ }

  return NextResponse.json({
    student_id: studentId,
    auth_user_id: authUserId,
    applications_created: applicationsCreated,
    progression_created: progressionCreated,
    magic_link: magicLink,
  }, { status: 201 })
}
