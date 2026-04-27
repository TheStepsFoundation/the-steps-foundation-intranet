'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import DynamicFormField, { type FieldValue } from '@/components/DynamicFormField'
import {
  fetchFeedbackEvent, fetchMyFeedback, submitFeedback, getAuthEmail,
  type FeedbackEventInfo, type MyFeedbackSubmission,
} from '@/lib/hub-api'
import { getFeedbackFields, type FormFieldConfig } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// /my/events/[id]/feedback — post-event feedback form, served from the hub.
// Login-gated. If no session, bumps to /my/sign-in?next=<this-url>.
// On submit, the row is upserted to event_feedback (RLS keeps it scoped).
// Re-visiting this page after submission shows their answers + lets them
// edit (within the natural lifecycle of the event — no hard cutoff yet).
//
// The schema reuses FormFieldConfig (same as apply forms). On submit we
// split values into the dedicated event_feedback columns by reserved
// id / type:
//   - field type 'scale'        → ratings jsonb[id]
//   - field id 'consent'        → consent column
//   - field id 'postable_quote' → postable_quote column
//   - everything else           → answers jsonb[id]
// ---------------------------------------------------------------------------

const CONSENT_VALUES = new Set(['name', 'first_name', 'anon', 'no'])
type ConsentValue = 'name' | 'first_name' | 'anon' | 'no'

/**
 * Translate the existing event_feedback row back into FieldValue keyed by
 * field.id, so DynamicFormField can render the prefilled state when an
 * admin edits a previously-submitted form.
 */
function hydrateValues(
  fields: FormFieldConfig[],
  mine: MyFeedbackSubmission | null,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  if (!mine) return out
  for (const f of fields) {
    if (f.type === 'scale') {
      const v = mine.ratings?.[f.id]
      if (typeof v === 'number') out[f.id] = String(v)
      continue
    }
    if (f.id === 'consent') {
      if (mine.consent) out[f.id] = mine.consent
      continue
    }
    if (f.id === 'postable_quote') {
      if (mine.postable_quote) out[f.id] = mine.postable_quote
      continue
    }
    const a = mine.answers?.[f.id]
    if (a !== undefined && a !== null) {
      if (Array.isArray(a)) out[f.id] = a as string[]
      else if (typeof a === 'string') out[f.id] = a
      else out[f.id] = JSON.stringify(a)
    }
  }
  return out
}

/** Required-field validator for our limited subset of FormFieldConfig types. */
function findValidationError(fields: FormFieldConfig[], values: Record<string, FieldValue>): string | null {
  for (const f of fields) {
    if (!f.required) continue
    if (f.type === 'section_heading' || f.type === 'media') continue
    const v = values[f.id]
    if (v === undefined || v === null) return `Please answer: "${f.label}"`
    if (typeof v === 'string' && !v.trim()) return `Please answer: "${f.label}"`
    if (Array.isArray(v) && v.length === 0) return `Please answer: "${f.label}"`
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0) {
      return `Please answer: "${f.label}"`
    }
  }
  return null
}

/**
 * Split values into ratings / answers / consent / postable_quote per the
 * reserved-id / reserved-type rules above.
 */
function splitForStorage(fields: FormFieldConfig[], values: Record<string, FieldValue>): {
  ratings: Record<string, number>
  answers: Record<string, string | string[]>
  consent: ConsentValue
  postable_quote: string | null
} {
  const ratings: Record<string, number> = {}
  const answers: Record<string, string | string[]> = {}
  let consent: ConsentValue = 'no'
  let postable: string | null = null

  for (const f of fields) {
    if (f.type === 'section_heading' || f.type === 'media') continue
    const v = values[f.id]
    if (v === undefined || v === null) continue

    if (f.type === 'scale') {
      // Scale stores either a string ("4") or a Record (paired). For our
      // single-question scale FormBuilder uses a string value.
      const num = typeof v === 'string' ? Number(v) : NaN
      if (Number.isFinite(num)) ratings[f.id] = num
      continue
    }

    if (f.id === 'consent') {
      const s = typeof v === 'string' ? v : ''
      consent = (CONSENT_VALUES.has(s) ? s : 'no') as ConsentValue
      continue
    }

    if (f.id === 'postable_quote') {
      const s = typeof v === 'string' ? v.trim() : ''
      postable = s.length > 0 ? s : null
      continue
    }

    // Everything else → answers jsonb. DynamicFormField yields strings for
    // most types and string[] for checkbox_list. Other shapes (matrix,
    // ranked, paired, repeatable) get JSON-stringified so the row still
    // captures the data even if we don't have a renderer for it on the
    // admin side yet.
    if (typeof v === 'string') answers[f.id] = v
    else if (Array.isArray(v) && v.every(x => typeof x === 'string')) answers[f.id] = v as string[]
    else answers[f.id] = JSON.stringify(v)
  }
  return { ratings, answers, consent, postable_quote: postable }
}

export default function FeedbackFormPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const eventId = params?.id as string

  const [authReady, setAuthReady] = useState(false)
  const [event, setEvent] = useState<FeedbackEventInfo | null>(null)
  const [existing, setExisting] = useState<MyFeedbackSubmission | null>(null)
  const [values, setValues] = useState<Record<string, FieldValue>>({})
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
      const start = Date.now()
      while (!cancelled && Date.now() - start < 5000) {
        const email = await getAuthEmail()
        if (email) { setAuthReady(true); return }
        await new Promise(r => setTimeout(r, 200))
      }
      if (cancelled) return
      const here = window.location.pathname + window.location.search
      const next = encodeURIComponent(here)
      const method = new URLSearchParams(window.location.search).get('method')
      const methodQs = method ? `&method=${encodeURIComponent(method)}` : ''
      router.replace(`/my/sign-in?next=${next}${methodQs}`)
    }
    run()
    return () => { cancelled = true }
  }, [eventId, router])

  const fields = useMemo(() => getFeedbackFields(event?.feedback_config ?? null), [event])
  const intro = event?.feedback_config?.intro

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
          const fs = getFeedbackFields(ev?.feedback_config ?? null)
          setValues(hydrateValues(fs, mine))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authReady, eventId])

  const showForm = !submitted && (!existing || editing)
  const showThanks = submitted || (existing && !editing)

  const setValue = (fieldId: string, value: FieldValue) => {
    setValues(v => ({ ...v, [fieldId]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const v = findValidationError(fields, values)
    if (v) { setValidationError(v); return }
    setValidationError(null)
    setSubmitting(true)
    const split = splitForStorage(fields, values)
    const { error: err } = await submitFeedback(eventId, split)
    setSubmitting(false)
    if (err) { setError(err); return }
    setSubmitted(true)
    setEditing(false)
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
            <SubmissionSummary fields={fields} mine={existing} />
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
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 space-y-6">
            {fields.map(field => (
              <DynamicFormField
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={setValue}
                allValues={values}
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
// SubmissionSummary — read-only recap shown on the thanks screen.
// ---------------------------------------------------------------------------

function SubmissionSummary({ fields, mine }: { fields: FormFieldConfig[]; mine: MyFeedbackSubmission }) {
  return (
    <div className="border-t border-slate-100 pt-4 space-y-3 text-sm">
      {fields.map(f => {
        if (f.type === 'section_heading' || f.type === 'media') return null
        let display: string | null = null

        if (f.type === 'scale') {
          const v = mine.ratings?.[f.id]
          if (v === undefined) return null
          const max = f.config?.scaleMax
          display = max ? `${v} / ${max}` : String(v)
        } else if (f.id === 'consent') {
          if (!mine.consent) return null
          const opt = f.options?.find(o => o.value === mine.consent)
          display = opt?.label ?? mine.consent
        } else if (f.id === 'postable_quote') {
          if (!mine.postable_quote) return null
          display = mine.postable_quote
        } else {
          const a = mine.answers?.[f.id]
          if (a === undefined || a === null) return null
          display = Array.isArray(a) ? a.join(', ') : String(a)
        }

        if (!display) return null
        return (
          <div key={f.id}>
            <div className="text-slate-500 text-xs">{f.label}</div>
            <div className="text-slate-900 whitespace-pre-wrap">{display}</div>
          </div>
        )
      })}
    </div>
  )
}
