'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import {
  fetchFeedbackEvent, fetchMyFeedback, submitFeedback, getAuthEmail,
  type FeedbackEventInfo, type FeedbackQuestion, type MyFeedbackSubmission,
} from '@/lib/hub-api'

// ---------------------------------------------------------------------------
// /my/events/[id]/feedback — post-event feedback form, served from the hub.
// Login-gated. If no session, bumps to /my/sign-in?next=<this-url>.
// On success, the row is upserted to event_feedback (RLS keeps it scoped).
// Re-visiting this page after submission shows their answers + lets them
// edit (within the natural lifecycle of the event — no hard cutoff yet).
// ---------------------------------------------------------------------------

type AnswerState = {
  ratings: Record<string, number>
  answers: Record<string, string>
  postable_quote: string
  consent: 'name' | 'first_name' | 'anon' | 'no' | ''
}

function emptyState(): AnswerState {
  return { ratings: {}, answers: {}, postable_quote: '', consent: '' }
}

function normaliseOptions(q: FeedbackQuestion): { value: string; label: string }[] {
  if (!q.options) return []
  return q.options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
}

export default function FeedbackFormPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const eventId = params?.id as string

  const [authReady, setAuthReady] = useState(false)
  const [event, setEvent] = useState<FeedbackEventInfo | null>(null)
  const [existing, setExisting] = useState<MyFeedbackSubmission | null>(null)
  const [state, setState] = useState<AnswerState>(emptyState())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Auth gate — bounce to sign-in with `next` so they come back here.
  useEffect(() => {
    let cancelled = false
    async function run() {
      // Retry briefly while localStorage hydrates the supabase session
      // (matches the pattern in /my page.tsx).
      const start = Date.now()
      while (!cancelled && Date.now() - start < 5000) {
        const email = await getAuthEmail()
        if (email) { setAuthReady(true); return }
        await new Promise(r => setTimeout(r, 200))
      }
      if (cancelled) return
      const next = encodeURIComponent(`/my/events/${eventId}/feedback`)
      router.replace(`/my/sign-in?next=${next}`)
    }
    run()
    return () => { cancelled = true }
  }, [eventId, router])

  // Load event + existing submission once authed.
  useEffect(() => {
    if (!authReady || !eventId) return
    let cancelled = false
    setLoading(true)
    Promise.all([fetchFeedbackEvent(eventId), fetchMyFeedback(eventId)])
      .then(([ev, mine]) => {
        if (cancelled) return
        setEvent(ev)
        if (mine) {
          setExisting(mine)
          setState({
            ratings: mine.ratings ?? {},
            answers: Object.fromEntries(
              Object.entries(mine.answers ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v as string)])
            ),
            postable_quote: mine.postable_quote ?? '',
            consent: mine.consent ?? '',
          })
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authReady, eventId])

  const questions = event?.feedback_config?.questions ?? []
  const intro = event?.feedback_config?.intro

  const showForm = !submitted && (!existing || editing)
  const showThanks = submitted || (existing && !editing)

  function setRating(id: string, value: number) {
    setState(s => ({ ...s, ratings: { ...s.ratings, [id]: value } }))
  }
  function setAnswer(id: string, value: string) {
    setState(s => ({ ...s, answers: { ...s.answers, [id]: value } }))
  }
  function setConsent(value: AnswerState['consent']) {
    setState(s => ({ ...s, consent: value }))
  }

  function validate(): string | null {
    for (const q of questions) {
      if (!q.required) continue
      if (q.type === 'scale') {
        if (state.ratings[q.id] === undefined) return `Please answer: "${q.label}"`
      } else if (q.type === 'single_choice') {
        if (!state.answers[q.id]) return `Please answer: "${q.label}"`
      } else if (q.type === 'long_text') {
        if (!state.answers[q.id] || !state.answers[q.id].trim()) return `Please answer: "${q.label}"`
      } else if (q.type === 'consent') {
        if (!state.consent) return `Please tell us how we can credit you.`
      }
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const v = validate()
    if (v) { setValidationError(v); return }
    setValidationError(null)
    setSubmitting(true)
    // Pull postable_quote off answers for storage in its own column.
    const postableId = questions.find(q => q.id === 'postable_quote')?.id
    const postable = postableId ? (state.answers[postableId] ?? state.postable_quote) : state.postable_quote
    const answersForStorage: Record<string, string> = { ...state.answers }
    if (postableId) delete answersForStorage[postableId]
    const consentValue = (state.consent || 'no') as 'name' | 'first_name' | 'anon' | 'no'
    const { error: err } = await submitFeedback(eventId, {
      ratings: state.ratings,
      answers: answersForStorage,
      postable_quote: postable?.trim() ? postable.trim() : null,
      consent: consentValue,
    })
    setSubmitting(false)
    if (err) { setError(err); return }
    setSubmitted(true)
    setEditing(false)
    // Refresh the existing snapshot so the thank-you view shows their submission
    const fresh = await fetchMyFeedback(eventId)
    setExisting(fresh)
  }

  // ---------------- render ----------------

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 animate-pulse">Loading…</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <TopNav />
        <main className="max-w-2xl mx-auto px-4 py-10">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 animate-pulse">
            <div className="h-6 w-1/3 bg-slate-200 rounded mb-4" />
            <div className="h-4 w-2/3 bg-slate-200 rounded" />
          </div>
        </main>
      </div>
    )
  }

  if (!event || !event.feedback_config) {
    return (
      <div className="min-h-screen bg-slate-50">
        <TopNav />
        <main className="max-w-2xl mx-auto px-4 py-10">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <h1 className="text-2xl font-bold text-steps-dark mb-2">Feedback isn&apos;t open for this event</h1>
            <p className="text-slate-600 mb-6">
              {event ? `${event.name} doesn't have a feedback form available right now.` : 'We couldn\'t find this event.'}
            </p>
            <Link href="/my" className="text-steps-blue-600 hover:underline">Back to your hub</Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav />
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href={`/my/events/${eventId}`} className="text-sm text-steps-blue-600 hover:underline">← Back to {event.name}</Link>
        </div>

        <header className="mb-6">
          <h1 className="font-display text-3xl font-black text-steps-dark tracking-tight">Your feedback on {event.name}</h1>
          {intro && <p className="mt-3 text-slate-700 leading-relaxed">{intro}</p>}
        </header>

        {showThanks && existing && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">✓</div>
              <div>
                <h2 className="text-lg font-semibold text-steps-dark">Thanks — your feedback is in</h2>
                <p className="text-sm text-slate-600 mt-0.5">
                  Submitted {new Date(existing.submitted_at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}.
                  {existing.updated_at !== existing.submitted_at && ' (Most recently edited.)'}
                </p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4 space-y-3 text-sm">
              {questions.map(q => {
                if (q.type === 'scale') {
                  const v = existing.ratings?.[q.id]
                  if (v === undefined) return null
                  return (
                    <div key={q.id}>
                      <div className="text-slate-500 text-xs">{q.label}</div>
                      <div className="text-slate-900 font-medium">{v} / {q.scale?.max ?? '?'}</div>
                    </div>
                  )
                }
                if (q.type === 'consent') {
                  const v = existing.consent
                  if (!v) return null
                  const opts = normaliseOptions(q)
                  const label = opts.find(o => o.value === v)?.label ?? v
                  return (
                    <div key={q.id}>
                      <div className="text-slate-500 text-xs">{q.label}</div>
                      <div className="text-slate-900">{label}</div>
                    </div>
                  )
                }
                const a = q.id === 'postable_quote' ? existing.postable_quote : (existing.answers?.[q.id] as string | undefined)
                if (!a) return null
                return (
                  <div key={q.id}>
                    <div className="text-slate-500 text-xs">{q.label}</div>
                    <div className="text-slate-900 whitespace-pre-wrap">{a}</div>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setEditing(true); setSubmitted(false) }}
                className="text-sm text-steps-blue-600 hover:underline"
              >
                Edit my feedback
              </button>
              <Link href="/my" className="text-sm text-slate-500 hover:text-slate-700">Done</Link>
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 space-y-7">
            {questions.map(q => (
              <QuestionField
                key={q.id}
                question={q}
                ratings={state.ratings}
                answers={state.answers}
                consent={state.consent}
                setRating={setRating}
                setAnswer={setAnswer}
                setConsent={setConsent}
              />
            ))}

            {validationError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {validationError}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 pt-5">
              <p className="text-xs text-slate-500">Your responses are tied to your hub account.</p>
              <PressableButton type="submit" disabled={submitting} className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50">
                {submitting ? 'Saving…' : (existing ? 'Update feedback' : 'Submit feedback')}
              </PressableButton>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuestionField — renders one question based on its type.
// ---------------------------------------------------------------------------

function QuestionField({
  question, ratings, answers, consent, setRating, setAnswer, setConsent,
}: {
  question: FeedbackQuestion
  ratings: Record<string, number>
  answers: Record<string, string>
  consent: 'name' | 'first_name' | 'anon' | 'no' | ''
  setRating: (id: string, v: number) => void
  setAnswer: (id: string, v: string) => void
  setConsent: (v: 'name' | 'first_name' | 'anon' | 'no' | '') => void
}) {
  const labelEl = (
    <label className="block text-sm font-semibold text-steps-dark mb-2">
      {question.label}
      {question.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )

  if (question.type === 'scale' && question.scale) {
    const { min, max, minLabel, maxLabel } = question.scale
    const buttons: number[] = (() => {
      const out: number[] = []
      for (let i = min; i <= max; i++) out.push(i)
      return out
    })()
    const selected = ratings[question.id]
    return (
      <div>
        {labelEl}
        <div className="flex flex-wrap gap-2">
          {buttons.map(n => {
            const active = selected === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRating(question.id, n)}
                className={`min-w-[40px] h-10 px-2 rounded-lg border text-sm font-medium transition-colors ${
                  active
                    ? 'bg-steps-blue-600 text-white border-steps-blue-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:border-steps-blue-400'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>
        {(minLabel || maxLabel) && (
          <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        )}
        {question.caption && <p className="text-xs text-slate-400 mt-1">{question.caption}</p>}
      </div>
    )
  }

  if (question.type === 'single_choice') {
    const opts = normaliseOptions(question)
    const selected = answers[question.id] ?? ''
    return (
      <div>
        {labelEl}
        <div className="space-y-2">
          {opts.map(o => {
            const active = selected === o.value
            return (
              <label key={o.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                active ? 'border-steps-blue-500 bg-steps-blue-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name={question.id}
                  value={o.value}
                  checked={active}
                  onChange={() => setAnswer(question.id, o.value)}
                  className="w-4 h-4 text-steps-blue-600 focus:ring-steps-blue-500"
                />
                <span className="text-sm text-slate-800">{o.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  if (question.type === 'long_text') {
    return (
      <div>
        {labelEl}
        <textarea
          value={answers[question.id] ?? ''}
          onChange={e => setAnswer(question.id, e.target.value)}
          rows={3}
          placeholder={question.placeholder}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white placeholder:text-slate-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-steps-blue-500 outline-none transition-shadow"
        />
      </div>
    )
  }

  if (question.type === 'consent') {
    const opts = normaliseOptions(question)
    return (
      <div>
        {labelEl}
        <div className="space-y-2">
          {opts.map(o => {
            const active = consent === o.value
            return (
              <label key={o.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                active ? 'border-steps-blue-500 bg-steps-blue-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="consent"
                  value={o.value}
                  checked={active}
                  onChange={() => setConsent(o.value as 'name' | 'first_name' | 'anon' | 'no')}
                  className="w-4 h-4 text-steps-blue-600 focus:ring-steps-blue-500"
                />
                <span className="text-sm text-slate-800">{o.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  return null
}
