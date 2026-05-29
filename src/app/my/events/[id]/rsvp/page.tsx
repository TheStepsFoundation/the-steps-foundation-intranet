'use client'

// ---------------------------------------------------------------------------
// /my/events/[id]/rsvp
//
// Lands here from:
//   - the {{rsvp_link}} in the acceptance / waitlist email (with ?token=...,
//     no auth session required — the HMAC token is the auth)
//   - the hub event card "Change my answer" link (authed session)
//
// Shows the event hero + three big buttons (Yes / Not sure / Can't make it
// this time). Highlights the current choice if there is one. On submit,
// POSTs to /api/rsvp and shows a confirmation state with a link back to
// the hub.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'

type Choice = 'yes' | 'maybe' | 'no'

const CHOICES: { value: Choice; label: string; description: string; tone: string }[] = [
  {
    value: 'yes',
    label: "Yes — I'll be there",
    description: 'See you on the day. We may follow up with logistics closer to the event.',
    tone: 'border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 text-emerald-900',
  },
  {
    value: 'maybe',
    label: 'Not sure yet',
    description: "We'll send you a quick reminder closer to the event so you can confirm.",
    tone: 'border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-900',
  },
  {
    value: 'no',
    label: "Can't make it this time",
    description: "We'll free up your seat so a waitlisted student can take your place. Your application stays in good standing.",
    tone: 'border-rose-300 hover:border-rose-500 hover:bg-rose-50 text-rose-900',
  },
]

const SELECTED_TONE: Record<Choice, string> = {
  yes:   'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200',
  maybe: 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-200',
  no:    'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-200',
}

export default function RsvpPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const eventId = params?.id as string | undefined
  const token = searchParams?.get('token') ?? null

  const [submitting, setSubmitting] = useState<Choice | null>(null)
  const [currentChoice, setCurrentChoice] = useState<Choice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // If no token in the URL, this page is being visited from an authed
  // session via the hub. We don't currently have a session-auth fallback
  // wired in this MVP — every email link carries a token. Show a friendly
  // nudge that points back to /my so they can re-grab the link from the
  // hub card (which will also pass a token once we wire that in).
  const hasToken = !!token

  useEffect(() => {
    // Reset state on remount.
    setError(null)
    setDone(false)
    setSubmitting(null)
  }, [eventId, token])

  const submit = async (choice: Choice) => {
    if (!token) {
      setError('This page needs a token to record your RSVP. Try clicking the RSVP link in your acceptance email again.')
      return
    }
    setSubmitting(choice)
    setError(null)
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, choice }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong. Please try again.')
        setSubmitting(null)
        return
      }
      setCurrentChoice(choice)
      setDone(true)
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Network error. Please try again.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav />
      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
        <header className="mb-6">
          <h1 className="font-display text-2xl sm:text-3xl font-black text-steps-dark tracking-tight">
            {done ? "Thanks — we've got your answer" : 'RSVP'}
          </h1>
          {!done && (
            <p className="mt-2 text-slate-600">
              Can you make it? Let us know so we can plan around your seat.
            </p>
          )}
        </header>

        {!hasToken && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-6">
            <p className="text-sm text-amber-900">
              This RSVP page needs the link from your acceptance email — it carries
              a verification token that signs you in automatically.{' '}
              <Link href="/my" className="font-semibold underline">Back to your hub</Link>
            </p>
          </div>
        )}

        {done && currentChoice && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">✓</div>
              <div>
                <p className="text-sm font-semibold text-steps-dark">
                  {currentChoice === 'yes' && "You're confirmed — see you there."}
                  {currentChoice === 'maybe' && "Marked as 'Not sure'. We'll nudge you closer to the date."}
                  {currentChoice === 'no' && "Got it — we've freed up your seat. Your application stays in good standing for future events."}
                </p>
                <p className="text-xs text-slate-500 mt-1">You can change your answer below if circumstances change.</p>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <Link href={eventId ? `/my/events/${eventId}` : '/my'} className="text-sm text-steps-blue-600 hover:underline">
                Back to {eventId ? 'event details' : 'your hub'}
              </Link>
            </div>
          </div>
        )}

        {hasToken && (
          <div className="space-y-3">
            {CHOICES.map(opt => {
              const isSelected = currentChoice === opt.value
              const isBusy = submitting === opt.value
              const tone = isSelected ? SELECTED_TONE[opt.value] : opt.tone
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => submit(opt.value)}
                  disabled={submitting !== null}
                  className={`w-full text-left p-5 rounded-2xl border-2 bg-white transition disabled:opacity-60 ${tone} min-h-[80px]`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">{opt.label}</p>
                      <p className="text-sm opacity-80 mt-1">{opt.description}</p>
                    </div>
                    {isBusy && <span className="text-xs font-medium opacity-70">Saving…</span>}
                    {isSelected && !isBusy && <span className="text-xs font-semibold uppercase tracking-wider opacity-70">Current</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </main>
    </div>
  )
}
