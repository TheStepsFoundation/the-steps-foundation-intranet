import { NextRequest, NextResponse } from 'next/server'
import {
  getServiceClient, getBearerEmail, resolveStudentId, isTeamMember,
  expireIfOverdue, finalizeAttempt, currentQuestion,
  attemptStatePayload, jsonError, ANSWER_GRACE_MS, type AttemptRow,
} from '@/lib/test-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/test/answer  { attemptId, questionId, selectedIndex | null }
//
// Records the answer to the CURRENT question only (no going back, no skipping
// ahead) and returns the next question. selectedIndex null = explicit skip.
// Server-side timing: past deadline (+3s network grace) nothing is recorded
// and the attempt is finalised as expired. Answering the final question
// auto-submits.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const svc = getServiceClient()
  const email = await getBearerEmail(req, svc)
  if (!email) return jsonError('Not signed in', 401)

  let body: { attemptId?: string; questionId?: string; selectedIndex?: number | null }
  try { body = await req.json() } catch { return jsonError('Bad request', 400) }
  const { attemptId, questionId } = body
  const selectedIndex = typeof body.selectedIndex === 'number' ? body.selectedIndex : null
  if (!attemptId || !questionId) return jsonError('Missing attemptId/questionId', 400)

  const { data: attemptRaw } = await svc
    .from('test_attempts')
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .eq('id', attemptId)
    .maybeSingle()
  if (!attemptRaw) return jsonError('Attempt not found', 404)
  let attempt = attemptRaw as AttemptRow

  // Ownership — the attempt must belong to the caller.
  if (attempt.kind === 'student') {
    const sid = await resolveStudentId(svc, email)
    if (!sid || sid !== attempt.student_id) return jsonError('Not your attempt', 403)
  } else {
    if (attempt.team_email !== email || !(await isTeamMember(svc, email))) return jsonError('Not your attempt', 403)
  }

  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ attempt: attemptStatePayload(attempt), question: null, done: true })
  }
  attempt = await expireIfOverdue(svc, attempt)
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ attempt: attemptStatePayload(attempt), question: null, done: true })
  }

  // Only the current question is answerable.
  const expectedQid = attempt.question_order[attempt.current_index]
  if (questionId !== expectedQid) {
    // Stale/duplicate click — serve the real current question instead.
    return NextResponse.json({
      attempt: attemptStatePayload(attempt),
      question: await currentQuestion(svc, attempt),
      done: false,
    })
  }

  const { data: q } = await svc
    .from('test_questions')
    .select('id, options, correct_index')
    .eq('id', questionId)
    .maybeSingle()
  if (!q) return jsonError('Question not found', 404)
  const optionCount = Array.isArray(q.options) ? (q.options as string[]).length : 0
  const sel = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < optionCount ? selectedIndex : null
  const isCorrect = sel === null ? false : sel === q.correct_index

  // Server-derived time on question: since the previous answer (or start).
  const { data: lastAns } = await svc
    .from('test_answers')
    .select('answered_at')
    .eq('attempt_id', attempt.id)
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sinceMs = Date.now() - new Date(lastAns?.answered_at ?? attempt.started_at).getTime()

  const { error: insErr } = await svc.from('test_answers').insert({
    attempt_id: attempt.id,
    question_id: questionId,
    selected_index: sel,
    is_correct: isCorrect,
    time_ms: Math.max(0, Math.min(sinceMs, 1000 * 60 * 60)),
  })
  if (insErr) {
    // Duplicate (double-submit of same question): advance gracefully.
    if (!String(insErr.code).startsWith('23')) return jsonError('Could not record answer', 500)
  }

  const nextIndex = attempt.current_index + 1
  const { data: updated } = await svc
    .from('test_attempts')
    .update({ current_index: nextIndex, answered_count: attempt.answered_count + (sel !== null ? 1 : 0) })
    .eq('id', attempt.id)
    .eq('status', 'in_progress')
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .maybeSingle()
  attempt = (updated as AttemptRow | null) ?? { ...attempt, current_index: nextIndex }

  // Finished the whole bank — auto-submit.
  if (attempt.current_index >= attempt.question_order.length) {
    attempt = await finalizeAttempt(svc, attempt, 'submitted')
    return NextResponse.json({ attempt: attemptStatePayload(attempt), question: null, done: true })
  }

  return NextResponse.json({
    attempt: attemptStatePayload(attempt),
    question: await currentQuestion(svc, attempt),
    done: false,
  })
}
