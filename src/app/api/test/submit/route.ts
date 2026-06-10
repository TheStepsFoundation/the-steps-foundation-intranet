import { NextRequest, NextResponse } from 'next/server'
import {
  getServiceClient, getBearerEmail, resolveStudentId, isTeamMember,
  finalizeAttempt, attemptStatePayload, jsonError, type AttemptRow,
} from '@/lib/test-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/test/submit  { attemptId }
//
// Explicit finish (the timer hitting zero also lands here from the client,
// and the server independently expires overdue attempts on any touch).
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const svc = getServiceClient()
  const email = await getBearerEmail(req, svc)
  if (!email) return jsonError('Not signed in', 401)

  let body: { attemptId?: string }
  try { body = await req.json() } catch { return jsonError('Bad request', 400) }
  if (!body.attemptId) return jsonError('Missing attemptId', 400)

  const { data: attemptRaw } = await svc
    .from('test_attempts')
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .eq('id', body.attemptId)
    .maybeSingle()
  if (!attemptRaw) return jsonError('Attempt not found', 404)
  let attempt = attemptRaw as AttemptRow

  if (attempt.kind === 'student') {
    const sid = await resolveStudentId(svc, email)
    if (!sid || sid !== attempt.student_id) return jsonError('Not your attempt', 403)
  } else {
    if (attempt.team_email !== email || !(await isTeamMember(svc, email))) return jsonError('Not your attempt', 403)
  }

  if (attempt.status === 'in_progress') {
    const overdue = Date.now() > new Date(attempt.deadline_at).getTime()
    attempt = await finalizeAttempt(svc, attempt, overdue ? 'expired' : 'submitted')
  }

  // Team practice gets its result back; students just get confirmation.
  const payload: Record<string, unknown> = { attempt: attemptStatePayload(attempt), done: true }
  if (attempt.kind === 'team') {
    payload.result = {
      score: attempt.score,
      correct: attempt.correct_count,
      answered: attempt.answered_count,
      reached: attempt.current_index,
      total: attempt.question_order.length,
    }
  }
  return NextResponse.json(payload)
}
