/**
 * Server-side helpers for the timed selection test (/api/test/*).
 *
 * SECURITY MODEL — read before editing:
 *  - The test tables have NO student-readable RLS policies. Students interact
 *    exclusively through these service-role routes, which means
 *    `correct_index` / `explanation` for LIVE questions, and other students'
 *    attempts, can never reach a browser. Never add a code path that returns
 *    a live question's correct answer to a non-team caller.
 *  - Timing is server-authoritative: `deadline_at` is fixed at start; the
 *    answer route refuses writes past it (+ a small grace) and any route that
 *    touches an overdue attempt finalises it as 'expired'.
 *  - One attempt per student per test, enforced by a partial unique index
 *    (voided attempts excluded — voiding is the admin-only retake mechanism,
 *    done from the admin client via RLS, not through these routes).
 *  - Team members (any team_members row) can take practice attempts
 *    (kind='team') regardless of test status; these are never linked to
 *    students/applications.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const ANSWER_GRACE_MS = 3000

export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
export type ServiceClient = ReturnType<typeof getServiceClient>

export type TestRow = {
  id: string
  event_id: string
  title: string
  status: 'draft' | 'open' | 'closed'
  duration_seconds: number
  opens_at: string | null
  closes_at: string | null
  video_url: string | null
  instructions: string | null
}

export type AttemptRow = {
  id: string
  test_id: string
  kind: 'student' | 'team'
  student_id: string | null
  team_email: string | null
  started_at: string
  deadline_at: string
  submitted_at: string | null
  status: 'in_progress' | 'submitted' | 'expired' | 'voided'
  question_order: string[]
  current_index: number
  answered_count: number
  correct_count: number | null
  score: number | null
}

export type QuestionRow = {
  id: string
  position: number
  difficulty: number
  category: string
  prompt: string
  options: string[]
  correct_index: number
  explanation: string | null
  is_practice: boolean
  active: boolean
}

/** Identify the caller from their Supabase access token. */
export async function getBearerEmail(req: NextRequest, svc: ServiceClient): Promise<string | null> {
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!h || !h.startsWith('Bearer ')) return null
  const token = h.slice('Bearer '.length).trim()
  if (!token) return null
  const { data, error } = await svc.auth.getUser(token)
  if (error || !data?.user?.email) return null
  return data.user.email.toLowerCase()
}

export async function resolveStudentId(svc: ServiceClient, email: string): Promise<string | null> {
  const { data } = await svc
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export async function isTeamMember(svc: ServiceClient, email: string): Promise<boolean> {
  const { data } = await svc.from('team_members').select('id').eq('email', email).maybeSingle()
  return !!data
}

export async function fetchTestBySlug(svc: ServiceClient, slug: string): Promise<{ test: TestRow; eventName: string; eventSlug: string } | null> {
  const { data: ev } = await svc
    .from('events')
    .select('id, name, slug')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ev) return null
  const { data: test } = await svc
    .from('tests')
    .select('id, event_id, title, status, duration_seconds, opens_at, closes_at, video_url, instructions')
    .eq('event_id', ev.id)
    .maybeSingle()
  if (!test) return null
  return { test: test as TestRow, eventName: ev.name, eventSlug: ev.slug }
}

/** Is the test currently open to invited students? */
export function testOpenNow(test: TestRow, now = Date.now()): boolean {
  if (test.status !== 'open') return false
  if (test.opens_at && now < new Date(test.opens_at).getTime()) return false
  if (test.closes_at && now > new Date(test.closes_at).getTime()) return false
  return true
}

export async function isInvited(svc: ServiceClient, testId: string, studentId: string): Promise<boolean> {
  const { data } = await svc
    .from('test_invitations')
    .select('student_id')
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .maybeSingle()
  return !!data
}

/** The caller's live (non-voided) attempt, if any. Students have at most one;
 *  for team members we take the most recent. */
export async function findAttempt(
  svc: ServiceClient, testId: string,
  who: { studentId: string } | { teamEmail: string },
): Promise<AttemptRow | null> {
  let q = svc
    .from('test_attempts')
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .eq('test_id', testId)
    .neq('status', 'voided')
    .order('started_at', { ascending: false })
    .limit(1)
  q = 'studentId' in who
    ? q.eq('kind', 'student').eq('student_id', who.studentId)
    : q.eq('kind', 'team').eq('team_email', who.teamEmail)
  const { data } = await q.maybeSingle()
  return (data as AttemptRow | null) ?? null
}

/** Score an attempt from its recorded answers and close it out. Idempotent. */
export async function finalizeAttempt(
  svc: ServiceClient, attempt: AttemptRow, finalStatus: 'submitted' | 'expired',
): Promise<AttemptRow> {
  if (attempt.status !== 'in_progress') return attempt
  const { count: correct } = await svc
    .from('test_answers')
    .select('question_id', { count: 'exact', head: true })
    .eq('attempt_id', attempt.id)
    .eq('is_correct', true)
  const { count: answered } = await svc
    .from('test_answers')
    .select('question_id', { count: 'exact', head: true })
    .eq('attempt_id', attempt.id)
    .not('selected_index', 'is', null)
  const patch = {
    status: finalStatus,
    submitted_at: new Date().toISOString(),
    correct_count: correct ?? 0,
    answered_count: answered ?? 0,
    score: correct ?? 0,
  }
  const { data } = await svc
    .from('test_attempts')
    .update(patch)
    .eq('id', attempt.id)
    .eq('status', 'in_progress')
    .select('id, test_id, kind, student_id, team_email, started_at, deadline_at, submitted_at, status, question_order, current_index, answered_count, correct_count, score')
    .maybeSingle()
  return (data as AttemptRow | null) ?? { ...attempt, ...patch }
}

/** Finalise an attempt whose clock has run out. Returns the (possibly updated) attempt. */
export async function expireIfOverdue(svc: ServiceClient, attempt: AttemptRow): Promise<AttemptRow> {
  if (attempt.status !== 'in_progress') return attempt
  if (Date.now() <= new Date(attempt.deadline_at).getTime() + ANSWER_GRACE_MS) return attempt
  return finalizeAttempt(svc, attempt, 'expired')
}

/** What the test-taker's browser is allowed to know about a live question.
 *  `total` is null for students — they never learn the size of the bank
 *  (or anything that lets them infer a score). Team practice sees totals. */
export function publicQuestion(q: Pick<QuestionRow, 'id' | 'prompt' | 'options'>, number: number, total: number | null) {
  return { id: q.id, prompt: q.prompt, options: q.options, number, total }
}

/** The next `count` questions from the attempt's current position (answers
 *  stripped). Used to keep a small client-side buffer so advancing to the
 *  next question is instant — the lookahead never includes correct_index. */
export async function upcomingQuestions(
  svc: ServiceClient, attempt: AttemptRow, count: number, includeTotals: boolean,
) {
  const total = attempt.question_order.length
  const ids = attempt.question_order.slice(attempt.current_index, attempt.current_index + count)
  if (ids.length === 0) return []
  const { data } = await svc
    .from('test_questions')
    .select('id, prompt, options')
    .in('id', ids)
  const byId = new Map((data ?? []).map((q: { id: string }) => [q.id, q]))
  const out: ReturnType<typeof publicQuestion>[] = []
  ids.forEach((qid, i) => {
    const q = byId.get(qid)
    if (q) out.push(publicQuestion(q as Pick<QuestionRow, 'id' | 'prompt' | 'options'>, attempt.current_index + i + 1, includeTotals ? total : null))
  })
  return out
}

/** Curved order: questions trend easy → hard as the attempt progresses, but
 *  with random jitter (key = difficulty + U(0, 1.2)) so adjacent difficulty
 *  bands blend into a smooth ramp rather than abrupt steps, and no two
 *  candidates share an order (so answer keys can't be passed around). */
export function curvedOrder(questions: Array<Pick<QuestionRow, 'id' | 'difficulty'>>): string[] {
  return questions
    .map(q => ({ id: q.id, key: q.difficulty + Math.random() * 1.2 }))
    .sort((a, b) => a.key - b.key)
    .map(q => q.id)
}

/** Attempt state for the browser. Students never receive totals, scores or
 *  correct-counts — only team practice mode does (and only via /submit). */
export function attemptStatePayload(attempt: AttemptRow, includeTotals: boolean) {
  const deadlineMs = new Date(attempt.deadline_at).getTime()
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.started_at,
    deadlineAt: attempt.deadline_at,
    secondsLeft: attempt.status === 'in_progress' ? Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000)) : 0,
    questionNumber: Math.min(attempt.current_index + 1, attempt.question_order.length),
    totalQuestions: includeTotals ? attempt.question_order.length : null,
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}
