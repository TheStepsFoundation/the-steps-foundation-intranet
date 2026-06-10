import { NextRequest, NextResponse } from 'next/server'
import {
  getServiceClient, getBearerEmail, resolveStudentId, isTeamMember,
  fetchTestBySlug, testOpenNow, isInvited, findAttempt, expireIfOverdue,
  currentQuestion, attemptStatePayload, bandedShuffle, jsonError,
} from '@/lib/test-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/test/start  { slug, mode: 'student' | 'team' }
//
// Starts the caller's single attempt: fixes the server-side deadline
// (started_at + duration) and the per-attempt question order (banded
// shuffle), then returns the first question. Students: one attempt, ever —
// if one exists (even expired) this returns it rather than creating another.
// Team members: starting again retires any previous practice attempt.
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

  let who: { studentId: string } | { teamEmail: string }
  if (mode === 'team') {
    if (!(await isTeamMember(svc, email))) return jsonError('Not a team member', 403)
    who = { teamEmail: email }
  } else {
    const studentId = await resolveStudentId(svc, email)
    if (!studentId) return jsonError('No Steps Foundation account found for this email', 403)
    if (!(await isInvited(svc, test.id, studentId))) return jsonError('You have not been invited to this test', 403)
    if (!testOpenNow(test)) return jsonError('The test is not currently open', 403)
    who = { studentId }
  }

  // Existing attempt? Students never get a second one; team members retire
  // the old practice run and start fresh.
  let attempt = await findAttempt(svc, test.id, who)
  if (attempt) attempt = await expireIfOverdue(svc, attempt)
  if (attempt) {
    if (mode === 'student') {
      const inProgress = attempt.status === 'in_progress'
      return NextResponse.json({
        attempt: attemptStatePayload(attempt),
        question: inProgress ? await currentQuestion(svc, attempt) : null,
        alreadyAttempted: !inProgress,
      })
    }
    if (attempt.status === 'in_progress') {
      await svc.from('test_attempts').update({ status: 'voided', voided_at: new Date().toISOString() }).eq('id', attempt.id)
    } else {
      // keep past team scores; just start a new run by voiding nothing
    }
  }

  const { data: qs } = await svc
    .from('test_questions')
    .select('id, difficulty')
    .eq('test_id', test.id)
    .eq('is_practice', false)
    .eq('active', true)
  if (!qs || qs.length === 0) return jsonError('This test has no questions yet', 409)
  const order = bandedShuffle(qs)

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
  if (error) {
    // Unique-index race (double-click): fall back to the existing attempt.
    const existing = await findAttempt(svc, test.id, who)
    if (existing) {
      return NextResponse.json({
        attempt: attemptStatePayload(existing),
        question: existing.status === 'in_progress' ? await currentQuestion(svc, existing) : null,
        alreadyAttempted: existing.status !== 'in_progress',
      })
    }
    return jsonError('Could not start the test', 500)
  }

  return NextResponse.json({
    attempt: attemptStatePayload(created as never),
    question: await currentQuestion(svc, created as never),
    alreadyAttempted: false,
  })
}
