import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/admin/update-student-email
//
// When an admin changes a student's personal_email in the intranet, their
// `public.students` row updates fine via RLS — but their `auth.users` row
// (which is what GoTrue looks at when they sign in to the hub) does NOT.
// That mismatch meant a student could "keep" their old sign-in while the
// intranet showed them under a new email. Worse, if the old email was also
// used by a dangling orphan auth row from a past hard-delete, the student
// would 500 on sign-in.
//
// This endpoint keeps the two in sync. Given a student_id and a new email,
// it:
//   1. Reads the current personal_email from public.students.
//   2. If an auth.users row exists for the OLD email, renames it to the
//      new email (auth.admin.updateUserById with email_confirm: true so the
//      student isn't forced to re-verify).
//   3. If no auth row existed for the old email (pre-hub user), it no-ops
//      the auth step — the student will get one the first time they OTP.
//   4. Updates public.students.personal_email.
//   5. Returns a summary of what was changed so the UI can surface it.
//
// Gating: same as /api/admin/create-test-student — valid Supabase access
// token whose user.email is in team_members.
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

/**
 * Look up an auth.users row by email (case-insensitive). Uses listUsers +
 * filter rather than a direct `eq('email', ...)` because the SDK exposes
 * no public method for that, and `auth.admin.listUsers` with a `filter`
 * param is the documented shortcut. We paginate defensively — the team
 * instance has far fewer than 1000 users so page 1 at perPage 1000 is
 * always enough.
 */
async function findAuthUserByEmail(svc: ReturnType<typeof getServiceClient>, email: string) {
  const target = email.toLowerCase().trim()
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const hit = data?.users?.find(u => (u.email ?? '').toLowerCase() === target)
  return hit ?? null
}

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const studentId = typeof body?.student_id === 'string' ? body.student_id.trim() : ''
  const newEmailRaw = typeof body?.new_email === 'string' ? body.new_email.trim() : ''
  const newEmail = newEmailRaw.toLowerCase()

  if (!studentId) return NextResponse.json({ error: 'student_id is required' }, { status: 400 })
  if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
    return NextResponse.json({ error: 'A valid new_email is required' }, { status: 400 })
  }

  const svc = getServiceClient()

  // --- Read the current personal_email so we know what to rename from.
  const { data: stu, error: stuErr } = await svc
    .from('students')
    .select('id, personal_email')
    .eq('id', studentId)
    .maybeSingle()
  if (stuErr) return NextResponse.json({ error: `Student lookup failed: ${stuErr.message}` }, { status: 500 })
  if (!stu) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const oldEmail = (stu.personal_email ?? '').toLowerCase().trim()
  const emailChanged = oldEmail !== newEmail

  // --- Safety: refuse if a DIFFERENT student already owns the new email.
  if (emailChanged) {
    const { data: collide, error: collErr } = await svc
      .from('students')
      .select('id')
      .ilike('personal_email', newEmail)
      .neq('id', studentId)
      .maybeSingle()
    if (collErr) return NextResponse.json({ error: `Duplicate check failed: ${collErr.message}` }, { status: 500 })
    if (collide) {
      return NextResponse.json({ error: `Another student already uses ${newEmail}. Merge or delete that record first.` }, { status: 409 })
    }
  }

  // --- Step 1: sync auth.users (if an auth row exists for either email).
  //   * old row exists + new row doesn't → rename old to new.
  //   * old row exists + new row also exists → conflict; admin must resolve.
  //   * old row doesn't exist (pre-hub student) → nothing to do.
  let authAction: 'renamed' | 'skipped_no_old_row' | 'skipped_same_email' | 'conflict_new_in_use' = 'skipped_same_email'
  let authUserId: string | null = null

  if (emailChanged && oldEmail) {
    try {
      const oldRow = await findAuthUserByEmail(svc, oldEmail)
      if (!oldRow) {
        authAction = 'skipped_no_old_row'
      } else {
        const newRow = await findAuthUserByEmail(svc, newEmail)
        if (newRow && newRow.id !== oldRow.id) {
          return NextResponse.json({
            error: `An auth user with ${newEmail} already exists (id ${newRow.id}). Delete or merge that account before renaming.`,
          }, { status: 409 })
        }
        const { error: updErr } = await svc.auth.admin.updateUserById(oldRow.id, {
          email: newEmail,
          email_confirm: true, // don't force re-verification — the admin vouches for the change
        })
        if (updErr) {
          return NextResponse.json({ error: `auth.users update failed: ${updErr.message}` }, { status: 500 })
        }
        authAction = 'renamed'
        authUserId = oldRow.id
      }
    } catch (e: any) {
      return NextResponse.json({ error: `auth.users lookup failed: ${e?.message ?? 'unknown'}` }, { status: 500 })
    }
  } else if (!emailChanged) {
    authAction = 'skipped_same_email'
  }

  // --- Step 2: update public.students.personal_email.
  const { error: updStuErr } = await svc
    .from('students')
    .update({ personal_email: newEmail })
    .eq('id', studentId)
  if (updStuErr) {
    // If we already renamed the auth row, try to roll it back so we don't
    // leave the two tables in a split-brain state.
    if (authAction === 'renamed' && authUserId) {
      await svc.auth.admin.updateUserById(authUserId, { email: oldEmail, email_confirm: true }).catch(() => { /* noop */ })
    }
    return NextResponse.json({ error: `students update failed: ${updStuErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    student_id: studentId,
    old_email: oldEmail || null,
    new_email: newEmail,
    auth_action: authAction,
    auth_user_id: authUserId,
  }, { status: 200 })
}
