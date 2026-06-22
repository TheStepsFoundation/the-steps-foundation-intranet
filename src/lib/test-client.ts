/**
 * Client helpers for the timed selection test. Used by the student page
 * (/my/test/[slug], student auth session) and the hub practice page
 * (/hub/test, admin/team auth session) — the caller supplies the access
 * token, everything else is identical.
 */

export type TestMode = 'student' | 'team'

export type TestInfo = {
  title: string
  eventName: string
  instructions: string | null
  videoUrl: string | null
  durationSeconds: number
  openNow: boolean
  opensAt: string | null
  closesAt: string | null
  status: 'draft' | 'open' | 'closed'
  /** Date-aware status: a 'draft' test whose opens_at has passed reads
   *  'open'; a draft with a future opens_at reads 'scheduled'. Mirrors the
   *  server gate (testOpenNow) so UI never contradicts access. */
  effectiveStatus: EffectiveTestStatus
}

export type AttemptState = {
  id: string
  status: 'in_progress' | 'submitted' | 'expired' | 'voided'
  startedAt: string
  deadlineAt: string
  secondsLeft: number
  questionNumber: number
  /** null for students — they never learn the size of the bank. */
  totalQuestions: number | null
}

export type LiveQuestion = {
  id: string
  prompt: string
  options: string[]
  number: number
  /** null for students. */
  total: number | null
}

export type PracticeQuestion = {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string | null
}

export type InfoResponse = {
  test: TestInfo
  invited: boolean
  attempt: AttemptState | null
  /** Prefetch buffer: the current question plus a couple of lookaheads. */
  questions: LiveQuestion[]
  practice: PracticeQuestion[]
}

export type StepResponse = {
  attempt: AttemptState
  /** Refreshed prefetch buffer from the server's current position. */
  questions: LiveQuestion[]
  done?: boolean
  alreadyAttempted?: boolean
  result?: { score: number | null; correct: number | null; answered: number; reached: number; total: number }
}

async function post<T>(path: string, token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

export const testApi = {
  info: (token: string, slug: string, mode: TestMode) =>
    post<InfoResponse>('/api/test/info', token, { slug, mode }),
  start: (token: string, slug: string, mode: TestMode) =>
    post<StepResponse>('/api/test/start', token, { slug, mode }),
  answer: (token: string, attemptId: string, questionId: string, selectedIndex: number | null) =>
    post<StepResponse>('/api/test/answer', token, { attemptId, questionId, selectedIndex }),
  submit: (token: string, attemptId: string) =>
    post<StepResponse>('/api/test/submit', token, { attemptId }),
}

/** Best-effort embed URL for a YouTube/Vimeo link; null = not embeddable. */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/embed/${v}`
      if (u.pathname.startsWith('/embed/')) return url
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`
    }
    return null
  } catch { return null }
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}


// ---------------------------------------------------------------------------
// Effective (date-aware) test status — the single source of truth shared by
// the access gate (testOpenNow, server) and every status badge (admin + my).
//
// A test's raw `status` column is admin intent; the value students actually
// experience also depends on opens_at / closes_at. This mirrors the events
// pattern (computeEventEffectiveStatus): we DERIVE the live status rather than
// mutating the column on a schedule.
//
//   closed      — status='closed', or closes_at has passed
//   open        — status='open', OR status='draft' and opens_at has passed
//   scheduled   — status='draft' and opens_at is set but still in the future
//                 (invited students see a locked preview until then)
//   draft       — status='draft' with no opens_at set (not yet scheduled)
//
// testOpenNow(...) === (effectiveTestStatus(...) === 'open').
// ---------------------------------------------------------------------------
export type EffectiveTestStatus = 'draft' | 'scheduled' | 'open' | 'closed'

export function effectiveTestStatus(
  status: 'draft' | 'open' | 'closed',
  opensAt: string | null,
  closesAt: string | null,
  now: number = Date.now(),
): EffectiveTestStatus {
  if (status === 'closed') return 'closed'
  if (closesAt && now > new Date(closesAt).getTime()) return 'closed'
  if (status === 'open') return 'open'
  // status === 'draft' from here
  if (opensAt && now >= new Date(opensAt).getTime()) return 'open'
  if (opensAt) return 'scheduled'
  return 'draft'
}

/** Convenience for the snake_cased TestRow shape used server-side / in the
 *  admin client (which read `opens_at` / `closes_at` straight from the DB). */
export function effectiveTestStatusRow(
  t: { status: 'draft' | 'open' | 'closed'; opens_at: string | null; closes_at: string | null },
  now: number = Date.now(),
): EffectiveTestStatus {
  return effectiveTestStatus(t.status, t.opens_at, t.closes_at, now)
}
