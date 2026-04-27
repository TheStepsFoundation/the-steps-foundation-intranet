'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { fetchEvent } from '@/lib/events-api'
import { countFeedbackSubmissions } from '@/lib/events-api'
import type { EventRow } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Admin QR display — fullscreen page projected onto a screen at the end of
// an event. Big QR linking to /my/events/[id]/feedback, event metadata,
// and a live counter that polls submissions every 4s.
// ---------------------------------------------------------------------------

const POLL_MS = 4000

export default function FeedbackQrPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const eventId = params?.id as string

  const [event, setEvent] = useState<EventRow | null>(null)
  const [count, setCount] = useState<number>(0)
  const [qrSvg, setQrSvg] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Compute the URL the QR encodes. window.location.origin is the safest
  // production-vs-preview-aware source.
  const targetUrl = useMemo(() => {
    if (!eventId) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/my/events/${eventId}/feedback`
  }, [eventId])

  // Generate the QR SVG.
  useEffect(() => {
    if (!targetUrl) return
    QRCode.toString(targetUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(svg => setQrSvg(svg))
      .catch(err => setError(err.message ?? 'Failed to generate QR code'))
  }, [targetUrl])

  // Load event details once.
  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    fetchEvent(eventId)
      .then(ev => { if (!cancelled) { setEvent(ev); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message ?? 'Failed to load event'); setLoading(false) } })
    return () => { cancelled = true }
  }, [eventId])

  // Poll the live submission count.
  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    const tick = () => {
      countFeedbackSubmissions(eventId).then(n => { if (!cancelled) setCount(n) }).catch(() => {})
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [eventId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-slate-500 animate-pulse text-xl">Loading…</p>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white p-8 text-center">
        <p className="text-red-600 text-lg mb-4">{error ?? 'Event not found'}</p>
        <button onClick={() => router.back()} className="text-steps-blue-600 hover:underline">Back</button>
      </div>
    )
  }

  if (!event.feedback_config) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white p-8 text-center">
        <p className="text-slate-700 text-lg mb-2">No feedback form configured for this event yet.</p>
        <p className="text-slate-500 text-sm mb-6">Add a feedback config in the event settings, then come back.</p>
        <button onClick={() => router.back()} className="text-steps-blue-600 hover:underline">Back</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-steps-blue-50 via-white to-steps-blue-100/40 flex flex-col">
      {/* Top bar with close */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => router.back()}
          className="px-3 py-1.5 text-sm bg-white/70 backdrop-blur rounded-full border border-slate-200 text-slate-600 hover:bg-white hover:text-slate-900 transition-colors"
          title="Close fullscreen"
        >
          ✕  Close
        </button>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        {/* Headline */}
        <div className="text-center mb-8 max-w-3xl">
          <p className="uppercase tracking-[0.3em] text-xs font-semibold text-steps-blue-600 mb-3">
            How was today?
          </p>
          <h1 className="font-display text-5xl sm:text-6xl font-black text-steps-dark tracking-tight mb-4">
            Tell us what you thought
          </h1>
          <p className="text-xl text-slate-600">
            Scan the QR with your phone to leave feedback on <span className="font-semibold text-steps-dark">{event.name}</span>.
          </p>
        </div>

        {/* QR card */}
        <div className="bg-white rounded-3xl shadow-2xl border border-white p-8 sm:p-10">
          <div
            className="w-[420px] h-[420px] sm:w-[520px] sm:h-[520px] flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: qrSvg.replace('<svg', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"') }}
          />
        </div>

        {/* URL fallback (in case QR fails or someone wants to type it) */}
        <p className="mt-5 text-sm text-slate-500 text-center">
          Or open: <span className="font-mono text-slate-700">{targetUrl}</span>
        </p>

        {/* Live counter */}
        <div className="mt-10 flex items-center gap-3 px-5 py-3 rounded-full bg-white shadow-sm border border-slate-200">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-slate-700">
            {count === 0 ? 'Waiting for first response…' : `${count} response${count === 1 ? '' : 's'} in`}
          </span>
        </div>
      </main>
    </div>
  )
}
