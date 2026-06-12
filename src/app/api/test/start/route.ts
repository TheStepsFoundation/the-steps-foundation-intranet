import { NextRequest, NextResponse } from 'next/server'
import {
  getServiceClient, getBearerEmail, resolveStudentId, isTeamMember,
  fetchTestBySlug, testOpenNow, isInvited, findAttempt, expireIfOverdue,
  upcomingQuestions, attemptStatePayload, blockOrder, jsonError, type AttemptRow,
} from '@/lib/test-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/test/start  { slug, mode: 'student' | 'team' }
//
// Starts the caller's single attempt: fixes the server-side deadline
// (started_at + duration) and the per-attempt question order (curved
// easy→hard with jitter), then returns the first few questions (a small
// prefetch buffer so the runner advances instantly). Students: one attempt,
// ever — if one exists (even expired) this returns it rather than creating
// another. Team members: starting again retires any in-flight practice run.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const svc = getServiceClient()
  const email = await getBearerEmail(req, svc)
  if (!email) return jsonError('Not signed in', 401)

  let body: { slug?: string; mode?: string }
  try { body = await req.json() } catch { return jsonError('Bad request', 400) }
  const slug = typeof body.slug === 'string' ? body.slug : ''
  const mode = body.mode === 'team' ? 'team' : 'student'
  if (!slug) return jsonError('Missing slug', 400)

  const found = await fetchTestBySlug(svc, slug)
  if (!found) return jsonError('No test for this event', 404)
  const { test } = found
  const includeTotals = mode === 'team'

  let who: { studentId: string } | { teamEmail: string }
  if (mode === 'team') {
    if (!(await isTeamMember(svc, email))) return jsonError('Not a team member', 403)
    who = { teamEmail: email }
  } else {
    const studentId = await resolveStudentId(svc, email)
    if (!studentId) return jsonError('No Steps Foundation account found for this email', 403)
    if (!(await isInvited(svc, test.id, studentId))) return jsonError('You have not been invited to this test', 403)
    if (!testOpenNow(test)) return jsonError('The test is not currently open', 403)
    // A withdrawn application revokes test access even if the invitation row
    // still exists (invites are usually sent before anyone withdraws).
    // (withdrawal soft-deletes the row, so read the latest row incl. deleted)
    const { data: appRows } = await svc
      .from('applications')
      .select('status, created_at')
      .eq('event_id', test.event_id)
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (appRows?.[0]?.status === 'withdrew') return jsonError('You have withdrawn your application for this event', 403)
    who = { studentId }
  }

  // Existing attempt? Students never get a second one; team members retire
  // the old in-flight practice run and start fresh.
  let attempt = await findAttempt(svc, test.id, who)
  if (attempt) attempt = await expireIfOverdue(svc, attempt)
  if (attempt) {
    if (mode === 'student') {
      const inProgress = attempt.status === 'in_progress'
      return NextResponse.json({
        attempt: attemptStatePayload(attempt, includeTotals),
        questions: inProgress ? await upcomingQuestions(svc, attempt, 3, includeTotals) : [],
        alreadyAttempted: !inProgress,
      })
    }
    if (attempt.status === 'in_progress') {
      await svc.from('test_attempts').update({ status: 'voided', voided_at: new Date().toISOString() }).eq('id', attempt.id)
    }
  }

  const { data: qs } = await svc
    .from('test_questions')
    .select('id, difficulty')
    .eq('test_id', test.id)
    .eq('is_practice', false)
    .eq('active', true)
  if (!qs || qs.length === 0) return jsonError('This test has no questions yet', 409)
  const order = blockOrder(qs)

  const startedAt = new Date()
  const deadline = new Date(startedAt.getTime() + test.duration_seconds * 1000)
  const insert = {
    test_id: test.id,
    kind: mode,
    student_id: mode === 'student' && 'studentId' in who ? who.studentId : null,
    team_email: mode === 'team' ? email : null,
    started_at: startedAt.toISOString(),
    deadline_at: deadline.toISOString(),
    question_order: order,
  }
  const { data: created, error } = await svc
    .from('test_attempts')
    .insert(insert)
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .single()
  if (error || !created) {
    // Unique-index race (double-click): fall back to the existing attempt.
    const existing = await findAttempt(svc, test.id, who)
    if (existing) {
      return NextResponse.json({
        attempt: attemptStatePayload(existing, includeTotals),
        questions: existing.status === 'in_progress' ? await upcomingQuestions(svc, existing, 3, includeTotals) : [],
        alreadyAttempted: existing.status !== 'in_progress',
      })
    }
    return jsonError('Could not start the test', 500)
  }

  const createdAttempt = created as AttemptRow
  return NextResponse.json({
    attempt: attemptStatePayload(createdAttempt, includeTotals),
    questions: await upcomingQuestions(svc, createdAttempt, 3, includeTotals),
    alreadyAttempted: false,
  })
}
