'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  testApi, videoEmbedUrl, formatClock,
  type TestMode, type InfoResponse, type AttemptState, type LiveQuestion, type PracticeQuestion,
} from '@/lib/test-client'

// ---------------------------------------------------------------------------
// Nonverbal questions: a prompt/option string may carry an inline SVG figure
// (contains '<svg'). Text before the SVG renders as the label. These strings
// are admin-seeded via migrations — never student input — so injection here
// is trusted content, same trust level as the prompt itself.
// ---------------------------------------------------------------------------
export function PromptContent({ text, className }: { text: string; className?: string }) {
  const i = text.indexOf('<svg')
  if (i === -1) return <p className={className}>{text}</p>
  const label = text.slice(0, i).trim()
  const svg = text.slice(i)
  return (
    <div className={className}>
      {label && <p className="mb-3">{label}</p>}
      <div className="overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
export function OptionContent({ opt }: { opt: string }) {
  if (!opt.includes('<svg')) return <>{opt}</>
  return <span className="inline-block align-middle [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: opt.slice(opt.indexOf('<svg')) }} />
}


// ---------------------------------------------------------------------------
// TestRunner — the complete take-the-test experience, shared by the student
// page (/my/test/[slug]) and the team practice page (/hub/test).
//
// Phases: loading → blocked (not invited / not open / error)
//                 → intro (instructions + video + practice + Start)
//                 → running (one question at a time, server-owned clock)
//                 → done (confirmation; team mode also shows the score)
//
// Instant progression: the server sends a small buffer of upcoming questions
// (answers stripped). Answering shifts the buffer and shows the next question
// IMMEDIATELY; the answer itself posts in the background through a strictly
// sequential queue (the server only accepts the current question, in order).
// If the buffer ever starves (very fast answers on a slow connection) a brief
// shimmer shows until the in-flight response replenishes it.
//
// Students never see question totals or any score; team practice sees both.
// The timer is server-authoritative — every response carries secondsLeft,
// from which we rebase a local deadline so clock skew never accumulates.
// ---------------------------------------------------------------------------

type Phase = 'loading' | 'blocked' | 'intro' | 'running' | 'done'
type TeamResult = { score: number | null; correct: number | null; answered: number; reached: number; total: number }

export default function TestRunner({ slug, mode, getToken, studentView = false }: {
  slug: string
  mode: TestMode
  /** Returns the caller's Supabase access token (student or admin session). */
  getToken: () => Promise<string | null>
  /** Admin preview: run as mode='team' but DISPLAY exactly what a student
   *  sees — no totals, no score, student done-screen copy. */
  studentView?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [blockedMsg, setBlockedMsg] = useState('')
  const [info, setInfo] = useState<InfoResponse | null>(null)
  const [attempt, setAttempt] = useState<AttemptState | null>(null)
  const [buf, setBuf] = useState<LiveQuestion[]>([])
  const [result, setResult] = useState<TeamResult | null>(null)
  const [starting, setStarting] = useState(false)
  const [armed, setArmed] = useState(false) // two-step Start confirmation
  const [finishArmed, setFinishArmed] = useState(false) // two-step Finish now
  const [secondsLeft, setSecondsLeft] = useState(0)
  const deadlineRef = useRef<number>(0)
  const finishedRef = useRef(false)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const minNumberRef = useRef(1) // the question number the user should currently see
  const lastAnsweredRef = useRef<string | null>(null) // double-click guard
  const attemptIdRef = useRef<string | null>(null)

  const rebase = useCallback((a: AttemptState) => {
    deadlineRef.current = Date.now() + a.secondsLeft * 1000
    setSecondsLeft(a.secondsLeft)
  }, [])

  /** Merge a server buffer into ours: dedupe by id, drop anything the user
   *  has already moved past, keep ascending order. */
  const mergeBuf = useCallback((incoming: LiveQuestion[]) => {
    setBuf(cur => {
      const have = new Set(cur.map(q => q.id))
      const merged = [...cur]
      for (const q of incoming) {
        if (q.number < minNumberRef.current) continue
        if (have.has(q.id)) continue
        merged.push(q); have.add(q.id)
      }
      merged.sort((a, b) => a.number - b.number)
      return merged
    })
  }, [])

  const finish = useCallback(async (viaTimer: boolean) => {
    if (finishedRef.current) return
    finishedRef.current = true
    // Let any queued answers land first so they count, then submit.
    try { await chainRef.current } catch { /* ignore */ }
    try {
      const token = await getToken()
      const id = attemptIdRef.current
      if (token && id) {
        const res = await testApi.submit(token, id)
        setAttempt(res.attempt)
        if (res.result) setResult(res.result)
      }
    } catch { /* server expires overdue attempts independently */ }
    void viaTimer
    setPhase('done')
  }, [getToken])

  // Initial load / resume.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) { if (!cancelled) { setBlockedMsg('Please sign in to continue.'); setPhase('blocked') } ; return }
        const res = await testApi.info(token, slug, mode)
        if (cancelled) return
        setInfo(res)
        if (!res.invited) {
          setBlockedMsg('This test is invitation-only and your account is not on the invite list. If you think this is a mistake, reply to the email that sent you here.')
          setPhase('blocked'); return
        }
        if (res.attempt && res.attempt.status !== 'in_progress') {
          setAttempt(res.attempt); attemptIdRef.current = res.attempt.id; setPhase('done'); return
        }
        if (res.attempt && res.questions.length > 0) {
          setAttempt(res.attempt)
          attemptIdRef.current = res.attempt.id
          minNumberRef.current = res.questions[0].number
          mergeBuf(res.questions)
          rebase(res.attempt)
          setPhase('running'); return
        }
        if (!res.test.openNow) {
          setBlockedMsg(res.test.status === 'closed'
            ? 'This test has closed.'
            : 'This test is not open yet — check back soon.')
          setPhase('blocked'); return
        }
        setPhase('intro')
      } catch (e) {
        if (!cancelled) { setBlockedMsg(e instanceof Error ? e.message : 'Something went wrong.'); setPhase('blocked') }
      }
    })()
    return () => { cancelled = true }
  }, [slug, mode, getToken, rebase, mergeBuf])

  // Countdown tick + auto-submit at zero.
  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0) void finish(true)
    }, 250)
    return () => clearInterval(t)
  }, [phase, finish])

  const start = useCallback(async () => {
    if (starting) return
    setStarting(true)
    try {
      const token = await getToken()
      if (!token) { setBlockedMsg('Please sign in to continue.'); setPhase('blocked'); return }
      const res = await testApi.start(token, slug, mode)
      setAttempt(res.attempt)
      attemptIdRef.current = res.attempt.id
      if (res.alreadyAttempted || res.questions.length === 0) { setPhase('done'); return }
      finishedRef.current = false
      setFinishArmed(false)
      lastAnsweredRef.current = null
      minNumberRef.current = res.questions[0].number
      setBuf([])
      mergeBuf(res.questions)
      rebase(res.attempt)
      setPhase('running')
    } catch (e) {
      setBlockedMsg(e instanceof Error ? e.message : 'Could not start the test.')
      setPhase('blocked')
    } finally {
      setStarting(false)
    }
  }, [starting, getToken, slug, mode, rebase, mergeBuf])

  /** Resync the buffer from the server (used after a failed POST). */
  const resync = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await testApi.info(token, slug, mode)
      if (res.attempt) {
        setAttempt(res.attempt)
        rebase(res.attempt)
        if (res.attempt.status !== 'in_progress') { setPhase('done'); return }
        minNumberRef.current = res.attempt.questionNumber
        lastAnsweredRef.current = null
        setBuf([])
        mergeBuf(res.questions)
      }
    } catch { /* next interaction retries */ }
  }, [getToken, slug, mode, rebase, mergeBuf])

  /** Answer (or skip) the on-screen question: advance INSTANTLY from the
   *  prefetch buffer, post in the background on a sequential queue. */
  const answer = useCallback((selectedIndex: number | null) => {
    if (finishedRef.current) return
    const q = buf[0]
    if (!q || q.id === lastAnsweredRef.current) return
    lastAnsweredRef.current = q.id
    // Optimistic advance.
    minNumberRef.current = q.number + 1
    setBuf(cur => cur.slice(1))
    chainRef.current = chainRef.current.then(async () => {
      if (finishedRef.current) return
      try {
        const token = await getToken()
        const id = attemptIdRef.current
        if (!token || !id) return
        const res = await testApi.answer(token, id, q.id, selectedIndex)
        setAttempt(res.attempt)
        rebase(res.attempt)
        if (res.done) {
          if (!finishedRef.current) {
            finishedRef.current = true
            if (mode === 'team') {
              const fin = await testApi.submit(token, id)
              setAttempt(fin.attempt)
              if (fin.result) setResult(fin.result)
            }
            setPhase('done')
          }
          return
        }
        mergeBuf(res.questions)
      } catch {
        // Lost answer (network blip) — resync so the user continues from the
        // server's idea of "current" rather than drifting.
        await resync()
      }
    })
  }, [buf, getToken, mode, rebase, mergeBuf, resync])

  // ----------------------------------------------------------------- render
  if (phase === 'loading') {
    return (
      <div className="max-w-2xl mx-auto skeleton-fade" role="status">
        <span className="sr-only">Loading test…</span>
        <div className="flex items-center justify-between mb-4">
          <div className="skeleton h-4 w-28 rounded" />
          <div className="skeleton h-7 w-20 rounded-full" />
        </div>
        <Card>
          <div className="skeleton h-5 w-3/4 rounded mb-5" />
          <div className="grid gap-2.5">
            <div className="skeleton h-12 w-full rounded-xl" />
            <div className="skeleton h-12 w-full rounded-xl" />
            <div className="skeleton h-12 w-full rounded-xl" />
            <div className="skeleton h-12 w-full rounded-xl" />
          </div>
        </Card>
      </div>
    )
  }

  if (phase === 'blocked') {
    return (
      <Card>
        <h2 className="font-display text-xl font-bold text-steps-dark mb-2">{info?.test.title ?? 'Selection test'}</h2>
        <p className="text-slate-600">{blockedMsg}</p>
      </Card>
    )
  }

  if (phase === 'done') {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="font-display text-xl font-bold text-steps-dark mb-2">
            {mode === 'team' && !studentView ? 'Practice run complete' : 'Your test is complete'}
          </h2>
          {mode === 'team' && result && !studentView ? (
            <div className="mt-4 inline-grid grid-cols-3 gap-6 text-center">
              <Stat label="Score" value={String(result.score ?? 0)} />
              <Stat label="Answered" value={`${result.answered}/${result.total}`} />
              <Stat label="Accuracy" value={result.answered > 0 ? `${Math.round(((result.correct ?? 0) / result.answered) * 100)}%` : '—'} />
            </div>
          ) : (
            <p className="text-slate-600 max-w-md mx-auto">
              Your answers have been recorded against your Steps Foundation account.
              You don&apos;t need to do anything else — we&apos;ll be in touch about next steps.
            </p>
          )}
          {mode === 'team' && (
            <button
              type="button"
              onClick={() => { setArmed(false); setFinishArmed(false); setResult(null); setPhase('intro') }}
              className="mt-6 inline-flex items-center px-4 py-2 rounded-lg bg-steps-blue-600 text-white text-sm font-medium hover:bg-steps-blue-700 transition-colors"
            >
              {studentView ? 'Run the preview again' : 'Run it again'}
            </button>
          )}
        </div>
      </Card>
    )
  }

  if (phase === 'running') {
    const q = buf[0] ?? null
    const urgent = secondsLeft <= 60
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-slate-500">
            Question {q ? q.number : minNumberRef.current}
            {q?.total != null && !studentView && <span className="text-slate-400"> of {q.total}</span>}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold tabular-nums ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}
            aria-live={urgent ? 'polite' : 'off'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0" /></svg>
            {formatClock(secondsLeft)}
          </span>
        </div>
        {q ? (
          <Card>
            <PromptContent text={q.prompt} className="text-lg font-medium text-steps-dark leading-snug mb-5" />
            <div className="grid gap-2.5">
              {q.options.map((opt, i) => (
                <button
                  key={`${q.id}-${i}`}
                  type="button"
                  onClick={() => answer(i)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-steps-blue-400 hover:bg-steps-blue-50/50 active:bg-steps-blue-50 transition-colors text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500"
                >
                  <span className="inline-block w-6 font-semibold text-slate-400">{String.fromCharCode(65 + i)}</span>
                  <OptionContent opt={opt} />
                </button>
              ))}
            </div>
            <div className="mt-4 text-right">
              <button
                type="button"
                onClick={() => answer(null)}
                className="text-sm text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline"
              >
                Skip this question →
              </button>
            </div>
          </Card>
        ) : (
          /* Buffer starved (rare): brief shimmer until the in-flight response lands. */
          <Card>
            <div className="skeleton-fade" role="status">
              <span className="sr-only">Loading the next question…</span>
              <div className="skeleton h-5 w-2/3 rounded mb-5" />
              <div className="grid gap-2.5">
                <div className="skeleton h-12 w-full rounded-xl" />
                <div className="skeleton h-12 w-full rounded-xl" />
                <div className="skeleton h-12 w-full rounded-xl" />
                <div className="skeleton h-12 w-full rounded-xl" />
              </div>
            </div>
          </Card>
        )}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-400">You can&apos;t go back to a question once you move on.</p>
          {!finishArmed ? (
            <button
              type="button"
              onClick={() => setFinishArmed(true)}
              className="text-sm font-medium text-slate-500 hover:text-steps-dark border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              Finish now
            </button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-slate-500">Finish and submit your answers?</span>
              <button
                type="button"
                onClick={() => void finish(false)}
                className="text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 transition-colors"
              >
                Yes, finish
              </button>
              <button
                type="button"
                onClick={() => setFinishArmed(false)}
                className="text-sm text-slate-500 hover:text-slate-700 px-2 py-1.5"
              >
                Keep going
              </button>
            </span>
          )}
        </div>
      </div>
    )
  }

  // intro
  const test = info!.test
  const embed = test.videoUrl ? videoEmbedUrl(test.videoUrl) : null
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-steps-blue-600 mb-1">{test.eventName}</p>
        <h1 className="font-display text-2xl font-bold text-steps-dark mb-3">{test.title}</h1>
        <div className="flex flex-wrap gap-2 mb-4">
          <Chip>⏱ {Math.round(test.durationSeconds / 60)} minutes</Chip>
          <Chip>One attempt only</Chip>
          <Chip>Finish early any time</Chip>
          <Chip>Calculators allowed</Chip>
        </div>
        {test.instructions && (
          <p className="text-slate-600 leading-relaxed whitespace-pre-line">{test.instructions}</p>
        )}
      </Card>

      {test.videoUrl && (
        <Card>
          <h2 className="font-semibold text-steps-dark mb-3">Watch before you start</h2>
          {embed ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-slate-100">
              <iframe src={embed} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Test briefing video" />
            </div>
          ) : (
            <a href={test.videoUrl} target="_blank" rel="noopener noreferrer" className="text-steps-blue-600 font-medium hover:underline">
              Watch the briefing video →
            </a>
          )}
        </Card>
      )}

      {info!.practice.length > 0 && <PracticeBlock questions={info!.practice} />}

      <Card>
        <h2 className="font-semibold text-steps-dark mb-1">Ready?</h2>
        <p className="text-sm text-slate-500 mb-4">
          The {Math.round(test.durationSeconds / 60)}-minute timer starts the moment you press the button and cannot be paused.
          You can finish early once you&apos;ve done as much as you can.
          {mode === 'student' ? ' You get one attempt.' : studentView ? ' Students get one attempt; this preview can be rerun.' : ' (Practice mode — you can rerun this as often as you like.)'}
        </p>
        {!armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
          >
            I&apos;m ready to start
          </button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={starting}
              onClick={() => void start()}
              className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {starting ? 'Starting…' : 'Start the test now'}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
            >
              Not yet
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}

// ----------------------------------------------------------------- bits

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6">{children}</div>
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">{children}</span>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-steps-dark tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

/** Practice questions with instant feedback — answers/explanations for these
 *  arrive from the API (practice-only; live questions never include them). */
function PracticeBlock({ questions }: { questions: PracticeQuestion[] }) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const q = questions[idx]
  if (!q) return null
  const isLast = idx >= questions.length - 1
  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold text-steps-dark">Warm-up questions <span className="text-slate-400 font-normal">(not scored)</span></h2>
        <span className="text-xs text-slate-400">{idx + 1} / {questions.length}</span>
      </div>
      <PromptContent text={q.prompt} className="font-medium text-steps-dark mb-4" />
      <div className="grid gap-2">
        {q.options.map((opt, i) => {
          const revealed = picked !== null
          const isCorrect = i === q.correctIndex
          const isPicked = i === picked
          let cls = 'border-slate-200 bg-white hover:border-steps-blue-400'
          if (revealed && isCorrect) cls = 'border-emerald-400 bg-emerald-50'
          else if (revealed && isPicked) cls = 'border-red-300 bg-red-50'
          else if (revealed) cls = 'border-slate-200 bg-white opacity-60'
          return (
            <button
              key={i}
              type="button"
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              className={`w-full text-left px-4 py-2.5 rounded-xl border transition-colors text-slate-800 ${cls}`}
            >
              <span className="inline-block w-6 font-semibold text-slate-400">{String.fromCharCode(65 + i)}</span>
              <OptionContent opt={opt} />
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className="mt-4">
          <p className={`text-sm font-medium ${picked === q.correctIndex ? 'text-emerald-700' : 'text-red-600'}`}>
            {picked === q.correctIndex ? 'Correct!' : `Not quite — the answer is ${String.fromCharCode(65 + q.correctIndex)}.`}
          </p>
          {q.explanation && <p className="text-sm text-slate-500 mt-1">{q.explanation}</p>}
          <button
            type="button"
            onClick={() => { setPicked(null); setIdx(isLast ? 0 : idx + 1) }}
            className="mt-3 text-sm font-medium text-steps-blue-600 hover:text-steps-blue-700"
          >
            {isLast ? 'Start warm-up again' : 'Next warm-up question →'}
          </button>
        </div>
      )}
    </Card>
  )
}
