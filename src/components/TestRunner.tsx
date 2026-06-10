'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  testApi, videoEmbedUrl, formatClock,
  type TestMode, type InfoResponse, type AttemptState, type LiveQuestion, type PracticeQuestion,
} from '@/lib/test-client'

// ---------------------------------------------------------------------------
// TestRunner — the complete take-the-test experience, shared by the student
// page (/my/test/[slug]) and the team practice page (/hub/test).
//
// Phases: loading → blocked (not invited / not open / error)
//                 → intro (instructions + video + practice + Start)
//                 → running (one question at a time, server-owned clock)
//                 → done (confirmation; team mode also shows the score)
//
// The timer is server-authoritative: every API response carries secondsLeft,
// from which we rebase a local deadline so clock skew never accumulates.
// ---------------------------------------------------------------------------

type Phase = 'loading' | 'blocked' | 'intro' | 'running' | 'done'

export default function TestRunner({ slug, mode, getToken }: {
  slug: string
  mode: TestMode
  /** Returns the caller's Supabase access token (student or admin session). */
  getToken: () => Promise<string | null>
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [blockedMsg, setBlockedMsg] = useState('')
  const [info, setInfo] = useState<InfoResponse | null>(null)
  const [attempt, setAttempt] = useState<AttemptState | null>(null)
  const [question, setQuestion] = useState<LiveQuestion | null>(null)
  const [result, setResult] = useState<{ score: number | null; correct: number | null; answered: number; reached: number; total: number } | null>(null)
  const [posting, setPosting] = useState(false)
  const [armed, setArmed] = useState(false) // two-step Start confirmation
  const [secondsLeft, setSecondsLeft] = useState(0)
  const deadlineRef = useRef<number>(0)
  const submittedRef = useRef(false)

  const rebase = useCallback((a: AttemptState) => {
    deadlineRef.current = Date.now() + a.secondsLeft * 1000
    setSecondsLeft(a.secondsLeft)
  }, [])

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
          setAttempt(res.attempt); setPhase('done'); return
        }
        if (res.attempt && res.question) {
          setAttempt(res.attempt); setQuestion(res.question); rebase(res.attempt); setPhase('running'); return
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
  }, [slug, mode, getToken, rebase])

  // Countdown tick + auto-submit at zero.
  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true
        void (async () => {
          try {
            const token = await getToken()
            if (token && attempt) {
              const res = await testApi.submit(token, attempt.id)
              setAttempt(res.attempt)
              if (res.result) setResult(res.result)
            }
          } catch { /* server expires it independently */ }
          setPhase('done')
        })()
      }
    }, 250)
    return () => clearInterval(t)
  }, [phase, attempt, getToken])

  const start = useCallback(async () => {
    if (posting) return
    setPosting(true)
    try {
      const token = await getToken()
      if (!token) { setBlockedMsg('Please sign in to continue.'); setPhase('blocked'); return }
      const res = await testApi.start(token, slug, mode)
      setAttempt(res.attempt)
      if (res.alreadyAttempted || !res.question) { setPhase('done'); return }
      setQuestion(res.question)
      rebase(res.attempt)
      submittedRef.current = false
      setPhase('running')
    } catch (e) {
      setBlockedMsg(e instanceof Error ? e.message : 'Could not start the test.')
      setPhase('blocked')
    } finally {
      setPosting(false)
    }
  }, [posting, getToken, slug, mode, rebase])

  const answer = useCallback(async (selectedIndex: number | null) => {
    if (posting || !attempt || !question || submittedRef.current) return
    setPosting(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await testApi.answer(token, attempt.id, question.id, selectedIndex)
      setAttempt(res.attempt)
      rebase(res.attempt)
      if (res.done || !res.question) {
        if (!submittedRef.current) {
          submittedRef.current = true
          const fin = await testApi.submit(token, attempt.id)
          setAttempt(fin.attempt)
          if (fin.result) setResult(fin.result)
        }
        setPhase('done')
      } else {
        setQuestion(res.question)
      }
    } catch { /* transient network blip — the same question stays on screen */ }
    finally { setPosting(false) }
  }, [posting, attempt, question, getToken, rebase])

  // ----------------------------------------------------------------- render
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-steps-blue-600" />
        <span className="sr-only">Loading test…</span>
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
            {mode === 'team' ? 'Practice run complete' : 'Your test is complete'}
          </h2>
          {mode === 'team' && result ? (
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
              onClick={() => { setArmed(false); setResult(null); setPhase('intro') }}
              className="mt-6 inline-flex items-center px-4 py-2 rounded-lg bg-steps-blue-600 text-white text-sm font-medium hover:bg-steps-blue-700 transition-colors"
            >
              Run it again
            </button>
          )}
        </div>
      </Card>
    )
  }

  if (phase === 'running' && question && attempt) {
    const urgent = secondsLeft <= 60
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-slate-500">
            Question {question.number} <span className="text-slate-400">of {question.total}</span>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold tabular-nums ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}
            aria-live={urgent ? 'polite' : 'off'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0" /></svg>
            {formatClock(secondsLeft)}
          </span>
        </div>
        <Card>
          <p className="text-lg font-medium text-steps-dark leading-snug mb-5">{question.prompt}</p>
          <div className="grid gap-2.5">
            {question.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                disabled={posting}
                onClick={() => void answer(i)}
                className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-steps-blue-400 hover:bg-steps-blue-50/50 active:bg-steps-blue-50 transition-colors text-slate-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500"
              >
                <span className="inline-block w-6 font-semibold text-slate-400">{String.fromCharCode(65 + i)}</span>
                {opt}
              </button>
            ))}
          </div>
          <div className="mt-4 text-right">
            <button
              type="button"
              disabled={posting}
              onClick={() => void answer(null)}
              className="text-sm text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline disabled:opacity-60"
            >
              Skip this question →
            </button>
          </div>
        </Card>
        <p className="text-xs text-slate-400 mt-3 text-center">You can&apos;t go back to a question once you move on.</p>
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
          <Chip>No calculators</Chip>
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
          {mode === 'student' ? ' You get one attempt.' : ' (Practice mode — you can rerun this as often as you like.)'}
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
              disabled={posting}
              onClick={() => void start()}
              className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {posting ? 'Starting…' : 'Start the test now'}
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
      <p className="font-medium text-steps-dark mb-4">{q.prompt}</p>
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
              {opt}
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
