'use client'

import { useCallback, useEffect, useState } from 'react'
import { PressableButton } from '@/components/PressableButton'

// ---------------------------------------------------------------------------
// Public booking page — /book  (no login required)
//
// Wider-team members and external guests book a 30-min call with the TSF core
// team. The page talks ONLY to our own server proxy (/api/booking*), which
// holds the Apps Script URL + token server-side. The browser never touches
// script.google.com, so it is immune to Google's multi-account
// "unable to open the file" bug.
//
// UX ported from the standalone Apps Script reference, restyled with the
// intranet design system (steps-blue / steps-dark / League Spartan).
// ---------------------------------------------------------------------------

type Meta = {
  pageTitle: string
  blurb: string
  withLabel: string
  timezone: string
  slotMinutes: number
  bookers: { id: string; name: string }[]
}
type Slot = { startIso: string; label: string }
type Day = { date: string; weekday: string; nice: string; slots: Slot[] }
type CalInfo = { title: string; startIso: string; endIso: string; details: string; location?: string }
type BookResult = {
  ok: boolean
  when?: string
  emailed?: boolean
  meetLink?: string
  cal?: CalInfo
  error?: string
}

// ---- add-to-calendar helpers (client-side, built from the returned cal) ----
const fmtG = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function gcalUrl(c: CalInfo) {
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(c.title)}` +
    `&dates=${fmtG(c.startIso)}/${fmtG(c.endIso)}` +
    `&details=${encodeURIComponent(c.details)}` +
    (c.location ? `&location=${encodeURIComponent(c.location)}` : '')
  )
}
function outlookUrl(c: CalInfo) {
  return (
    'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent' +
    `&subject=${encodeURIComponent(c.title)}` +
    `&startdt=${encodeURIComponent(c.startIso)}` +
    `&enddt=${encodeURIComponent(c.endIso)}` +
    `&body=${encodeURIComponent(c.details)}` +
    (c.location ? `&location=${encodeURIComponent(c.location)}` : '')
  )
}
function icsHref(c: CalInfo) {
  const body = String(c.details || '').split('\n').join(' — ')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Steps Foundation//Booking//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}@steps`, `DTSTAMP:${fmtG(new Date().toISOString())}`,
    `DTSTART:${fmtG(c.startIso)}`, `DTEND:${fmtG(c.endIso)}`,
    `SUMMARY:${c.title}`, `DESCRIPTION:${body}`,
  ]
  if (c.location) lines.push(`LOCATION:${c.location}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'))
}

// ---- tiny inline icons ----
const iconProps = {
  width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}
const ClockIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
const GlobeIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
)
const VideoIcon = () => (
  <svg {...iconProps}><path d="M15 10l4.5-2.3A1 1 0 0 1 21 8.6v6.8a1 1 0 0 1-1.5.9L15 14M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /></svg>
)

const SELECT_CLASSES =
  'w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 ' +
  'outline-none transition focus:border-steps-blue-500 focus:ring-2 focus:ring-steps-blue-500/30 ' +
  "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236b7390' stroke-width='2' viewBox='0 0 24 24'><path d='M6 9l6 6 6-6'/></svg>\")] " +
  'bg-[right_0.9rem_center] bg-no-repeat pr-10'
const INPUT_CLASSES =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 ' +
  'outline-none transition focus:border-steps-blue-500 focus:ring-2 focus:ring-steps-blue-500/30'

export default function BookPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [view, setView] = useState<'days' | 'slots' | 'form' | 'done'>('days')
  const [dayIdx, setDayIdx] = useState<number | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [bookerId, setBookerId] = useState('')
  const [otherName, setOtherName] = useState('')
  const [otherEmail, setOtherEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [result, setResult] = useState<BookResult | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch('/api/booking/config', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load availability.')
      setMeta(data.meta)
      setDays(data.days || [])
      setStatus('ready')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load availability.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function goDays() {
    setView('days')
    setDayIdx(null)
    setSlot(null)
  }
  function pickDay(i: number) {
    setDayIdx(i)
    setView('slots')
  }
  function pickSlot(s: Slot) {
    setSlot(s)
    setBookerId('')
    setOtherName('')
    setOtherEmail('')
    setFormError('')
    setView('form')
  }

  async function submit() {
    setFormError('')
    if (!bookerId) {
      setFormError('Please pick your name.')
      return
    }
    const payload: { bookerId: string; startIso?: string; name?: string; email?: string } = {
      bookerId,
      startIso: slot?.startIso,
    }
    if (bookerId === 'other') {
      if (!otherName.trim()) {
        setFormError('Please enter your name.')
        return
      }
      payload.name = otherName.trim()
      if (otherEmail.trim()) payload.email = otherEmail.trim()
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: BookResult = await res.json()
      if (!data.ok) throw new Error(data.error || 'Something went wrong — please try again.')
      setResult(data)
      setView('done')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function bookAnother() {
    setResult(null)
    goDays()
    await load()
  }

  const day = dayIdx != null ? days[dayIdx] : null

  return (
    <main className="flex min-h-screen w-full items-start justify-center px-4 py-8 sm:py-12">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-[320px_1fr]">
        {/* Intro panel */}
        <aside className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white p-7 md:border-b-0 md:border-r">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-steps-dark font-display text-lg font-bold tracking-wide text-white">
            SF
          </div>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            The Steps Foundation
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-extrabold text-steps-blue-900">
            {meta?.pageTitle || 'Book a call with the core team'}
          </h1>
          {meta?.blurb ? (
            <p className="mt-3.5 text-[14.5px] leading-relaxed text-slate-600">{meta.blurb}</p>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 text-sm text-slate-700">
            <div className="flex items-center gap-2.5">
              <span className="text-slate-400">
                <ClockIcon />
              </span>
              <span>{meta ? `${meta.slotMinutes} min meeting` : '30 min meeting'}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-slate-400">
                <GlobeIcon />
              </span>
              <span>{meta?.timezone || 'Europe/London'} (times shown in this zone)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-slate-400">
                <VideoIcon />
              </span>
              <span>Includes a Google Meet link</span>
            </div>
          </div>
          <p className="mt-6 font-display text-sm font-semibold italic text-steps-sunrise">
            Virtus non origo
          </p>
        </aside>

        {/* Main panel */}
        <section className="min-h-[440px] p-7 sm:p-8">
          {status === 'loading' ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-slate-500">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-steps-blue" />
              <span>Loading availability…</span>
            </div>
          ) : status === 'error' ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center text-slate-500">
              <div className="text-3xl">⚠️</div>
              <p className="max-w-sm text-sm">{errorMsg}</p>
              <PressableButton variant="white" size="sm" onClick={() => void load()}>
                Try again
              </PressableButton>
            </div>
          ) : view === 'done' && result ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="font-display text-2xl font-extrabold text-steps-blue-900">You&apos;re booked in</h2>
              <p className="max-w-sm text-[15px] text-slate-600">
                <strong className="text-slate-800">{result.when}</strong> with {meta?.withLabel || 'the core team'}.
                {result.emailed ? ' A calendar invite is also on its way to your inbox.' : ''}
              </p>

              {result.cal ? (
                <div className="mt-2 w-full">
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-400">
                    Add to your calendar
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-steps-blue-900 transition hover:border-steps-blue-300 hover:bg-slate-50" target="_blank" rel="noopener noreferrer" href={gcalUrl(result.cal)}>
                      Google
                    </a>
                    <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-steps-blue-900 transition hover:border-steps-blue-300 hover:bg-slate-50" target="_blank" rel="noopener noreferrer" href={outlookUrl(result.cal)}>
                      Outlook
                    </a>
                    <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-steps-blue-900 transition hover:border-steps-blue-300 hover:bg-slate-50" download="steps-call.ics" href={icsHref(result.cal)}>
                      Apple / .ics
                    </a>
                  </div>
                </div>
              ) : null}

              {result.meetLink ? (
                <div className="mt-3">
                  <PressableButton href={result.meetLink} target="_blank" rel="noopener noreferrer" variant="primary">
                    Join with Google Meet
                  </PressableButton>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void bookAnother()}
                className="mt-4 text-sm font-semibold text-steps-blue-700 hover:underline"
              >
                Book another time
              </button>
            </div>
          ) : days.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-slate-500">
              <div className="text-3xl">📭</div>
              <p>
                No open times right now.
                <br />
                Check back soon.
              </p>
            </div>
          ) : view === 'days' ? (
            <div>
              <h2 className="font-display text-lg font-bold text-steps-blue-900">Pick a day</h2>
              <p className="mb-5 mt-1 text-sm text-slate-500">Choose a date, then a time that works for you.</p>
              <div className="flex flex-col gap-2.5">
                {days.map((d, i) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => pickDay(i)}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-steps-blue-300 hover:shadow-md"
                  >
                    <span>
                      <span className="block font-semibold text-slate-800">
                        {d.weekday}, {d.nice}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-slate-500">
                        {d.slots.length} slot{d.slots.length === 1 ? '' : 's'} available
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                        {d.slots.length}
                      </span>
                      <span className="text-slate-400">›</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : view === 'slots' && day ? (
            <div>
              <button type="button" onClick={goDays} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-steps-blue-700 hover:underline">
                ‹ All days
              </button>
              <h2 className="font-display text-lg font-bold text-steps-blue-900">
                {day.weekday}, {day.nice}
              </h2>
              <p className="mb-5 mt-1 text-sm text-slate-500">Pick a start time ({meta?.timezone}).</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
                {day.slots.map((s) => (
                  <button
                    key={s.startIso}
                    type="button"
                    onClick={() => pickSlot(s)}
                    className="rounded-xl border-[1.5px] border-slate-200 bg-white py-3 text-center font-semibold tabular-nums text-steps-blue-900 transition hover:border-steps-blue hover:bg-slate-50"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : view === 'form' && day && slot ? (
            <div>
              <button type="button" onClick={() => setView('slots')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-steps-blue-700 hover:underline">
                ‹ Times
              </button>
              <h2 className="font-display text-lg font-bold text-steps-blue-900">Who&apos;s booking?</h2>
              <p className="mb-4 mt-1 text-sm text-slate-500">Pick your name and confirm.</p>

              <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {day.weekday}, {day.nice} · {slot.label} — {meta?.slotMinutes} min
              </div>

              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">Your name *</label>
              <select
                value={bookerId}
                onChange={(e) => setBookerId(e.target.value)}
                className={SELECT_CLASSES}
              >
                <option value="" disabled>
                  Select your name…
                </option>
                {(meta?.bookers || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="other">Someone else…</option>
              </select>

              {bookerId === 'other' ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    className={INPUT_CLASSES}
                    placeholder="Your name"
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                  />
                  <input
                    className={INPUT_CLASSES}
                    type="email"
                    placeholder="you@example.com (optional)"
                    value={otherEmail}
                    onChange={(e) => setOtherEmail(e.target.value)}
                  />
                </div>
              ) : null}

              <div className="mt-5">
                <PressableButton onClick={() => void submit()} disabled={submitting} fullWidth>
                  {submitting ? 'Booking…' : 'Confirm booking'}
                </PressableButton>
              </div>

              {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
