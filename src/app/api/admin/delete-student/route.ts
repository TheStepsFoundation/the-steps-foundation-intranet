import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/admin/delete-student
//
// Hard-deletes one or more students AND their matching auth.users rows.
//
// Historically /students page did the hard-delete via the anon client:
//     DELETE FROM applications WHERE student_id IN (...)
//     DELETE FROM students WHERE id IN (...)
// That left every auth.users row behind as an orphan, because the RLS-bound
// anon client can't touch auth.users at all. Orphans are invisible to admins
// (can't search them, can't see them) but still block email re-use and still
// answer to sign-in attempts — so whenever an admin later re-created a
// student with the same personal_email, the old ghost row would answer
// instead and typically 500 on the GoTrue NULL-string bug.
//
// This route fixes both sides:
//   1. Look up each student's personal_email in public.students.
//   2. For each, find and delete the matching auth.users row
//      (best-effort — missing = already clean, not an error).
//   3. Hard-delete the applications rows.
//   4. Hard-delete the students rows.
//
// If the student's email happens to match a team_members row, we REFUSE to
// touch auth.users for that one (team members sign in with the same email)
// but still allow the student row to be deleted. The caller should only hit
// this path after confirming the admin-delete confirmation on the UI.
//
// Gating: same team_members check as the other admin routes.
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

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const rawIds = Array.isArray(body?.student_ids) ? body.student_ids : []
  const ids: string[] = rawIds.filter((v: unknown) => typeof v === 'string' && v.length > 0)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'student_ids is required (non-empty string array)' }, { status: 400 })
  }

  const svc = getServiceClient()

  // --- Pull emails so we know which auth rows to delete.
  const { data: rows, error: selErr } = await svc
    .from('students')
    .select('id, personal_email')
    .in('id', ids)
  if (selErr) return NextResponse.json({ error: `Student lookup failed: ${selErr.message}` }, { status: 500 })
  const emailByStudent = new Map<string, string | null>()
  ;(rows ?? []).forEach(r => emailByStudent.set(r.id, (r.personal_email ?? '').toLowerCase().trim() || null))

  // --- Collect emails we want to delete from auth, excluding team_members emails.
  const emails = [...emailByStudent.values()].filter((e): e is string => !!e)
  const uniqEmails = [...new Set(emails)]

  let protectedTeamEmails = new Set<string>()
  if (uniqEmails.length > 0) {
    const { data: tmRows, error: tmErr } = await svc
      .from('team_members')
      .select('email')
      .in('email', uniqEmails)
    if (tmErr) return NextResponse.json({ error: `Team-member guard failed: ${tmErr.message}` }, { status: 500 })
    protectedTeamEmails = new Set((tmRows ?? []).map(r => (r.email ?? '').toLowerCase()))
  }

  // --- Snapshot auth.users so we can find rows by email without listUsers
  //     pagination on every row. One call is cheaper and bounded.
  const { data: listData, error: listErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) return NextResponse.json({ error: `auth.users listing failed: ${listErr.message}` }, { status: 500 })
  const authByEmail = new Map<string, string>() // email (lower) -> user_id
  ;(listData?.users ?? []).forEach(u => {
    const e = (u.email ?? '').toLowerCase()
    if (e) authByEmail.set(e, u.id)
  })

  // --- Delete matching auth.users rows (best-effort; skip team emails).
  const authDeleteFailures: Array<{ email: string; error: string }> = []
  const authDeleted: string[] = []
  for (const email of uniqEmails) {
    if (protectedTeamEmails.has(email)) continue // don't nuke a team member's auth
    const uid = authByEmail.get(email)
    if (!uid) continue // already clean
    const { error: delAuthErr } = await svc.auth.admin.deleteUser(uid)
    if (delAuthErr) {
      authDeleteFailures.push({ email, error: delAuthErr.message })
    } else {
      authDeleted.push(email)
    }
  }

  // --- Delete applications, then students. Order matters — apps FK into students.
  const { error: appErr } = await svc.from('applications').delete().in('student_id', ids)
  if (appErr) {
    return NextResponse.json({
      error: `applications delete failed: ${appErr.message}`,
      auth_deleted: authDeleted,
      auth_delete_failures: authDeleteFailures,
    }, { status: 500 })
  }

  const { error: stuErr } = await svc.from('students').delete().in('id', ids)
  if (stuErr) {
    return NextResponse.json({
      error: `students delete failed: ${stuErr.message}`,
      auth_deleted: authDeleted,
      auth_delete_failures: authDeleteFailures,
    }, { status: 500 })
  }

  return NextResponse.json({
    students_deleted: ids.length,
    auth_deleted_count: authDeleted.length,
    auth_deleted_emails: authDeleted,
    auth_delete_failures: authDeleteFailures,
    team_emails_skipped: [...protectedTeamEmails],
  }, { status: 200 })
}
