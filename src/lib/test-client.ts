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
  status: 'draft' | 'open' | 'closed'
}

export type AttemptState = {
  id: string
  status: 'in_progress' | 'submitted' | 'expired' | 'voided'
  startedAt: string
  deadlineAt: string
  secondsLeft: number
  questionNumber: number
  totalQuestions: number
}

export type LiveQuestion = {
  id: string
  prompt: string
  options: string[]
  number: number
  total: number
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
  question: LiveQuestion | null
  practice: PracticeQuestion[]
}

export type StepResponse = {
  attempt: AttemptState
  question: LiveQuestion | null
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
