import { NextRequest, NextResponse } from 'next/server'
import {
  getServiceClient, getBearerEmail, resolveStudentId, isTeamMember,
  fetchTestBySlug, testOpenNow, isInvited, findAttempt, expireIfOverdue,
  currentQuestion, attemptStatePayload, jsonError,
} from '@/lib/test-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/test/info  { slug, mode: 'student' | 'team' }
//
// Pre-flight + resume endpoint for the test page. Returns the test metadata,
// whether the caller may take it, their attempt state (resuming the current
// question if one is in flight), and the practice questions (these DO include
// the answer + explanation — they are practice-only by definition).
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
  const { test, eventName } = found

  let who: { studentId: string } | { teamEmail: string }
  let invited = false
  if (mode === 'team') {
    if (!(await isTeamMember(svc, email))) return jsonError('Not a team member', 403)
    who = { teamEmail: email }
    invited = true // team practice bypasses the invite list and the open window
  } else {
    const studentId = await resolveStudentId(svc, email)
    if (!studentId) return jsonError('No Steps Foundation account found for this email', 403)
    who = { studentId }
    invited = await isInvited(svc, test.id, studentId)
  }

  const openNow = mode === 'team' ? true : testOpenNow(test)

  let attempt = await findAttempt(svc, test.id, who)
  if (attempt) attempt = await expireIfOverdue(svc, attempt)

  // Practice questions are only revealed to people who could actually sit the
  // test (or any team member).
  let practice: Array<{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string | null }> = []
  if (invited) {
    const { data: pq } = await svc
      .from('test_questions')
      .select('id, prompt, options, correct_index, explanation, position')
      .eq('test_id', test.id)
      .eq('is_practice', true)
      .eq('active', true)
      .order('position')
    practice = (pq ?? []).map(q => ({
      id: q.id, prompt: q.prompt, options: q.options as string[],
      correctIndex: q.correct_index, explanation: q.explanation,
    }))
  }

  const inProgress = attempt && attempt.status === 'in_progress'
  return NextResponse.json({
    test: {
      title: test.title,
      eventName,
      instructions: test.instructions,
      videoUrl: test.video_url,
      durationSeconds: test.duration_seconds,
      openNow,
      status: mode === 'team' ? 'open' : test.status,
    },
    invited,
    attempt: attempt ? attemptStatePayload(attempt) : null,
    question: inProgress && attempt ? await currentQuestion(svc, attempt) : null,
    practice,
  })
}
