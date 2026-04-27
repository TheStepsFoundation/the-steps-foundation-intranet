'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { eventFeedbackByEventId } from '@/data/event-feedback'
import { fetchFeedbackConfig, fetchFeedbackSubmissions, getFeedbackFields, type EventFeedbackConfig, type EventFeedbackRow } from '@/lib/events-api'
import type {
  Consent,
  CuratedQuote,
  EventFeedbackDataset,
  FeedbackKpi,
  FreeTextResponse,
  PostableQuote,
  RatingBreakdown,
} from '@/data/event-feedback/types'

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function formatEventDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function consentBadge(c: CuratedQuote['consent']): { label: string; className: string } {
  if (c === 'name' || c === 'first_name')
    return {
      label: 'Shareable',
      className:
        'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    }
  if (c === 'anon')
    return {
      label: 'Anon OK',
      className:
        'bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200 dark:bg-steps-blue-900/20 dark:text-steps-blue-400 dark:border-steps-blue-800',
    }
  return {
    label: 'Internal',
    className:
      'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  }
}

/**
 * Internal byline — always shows the staffer the FULL name, with the
 * external display string they consented to in parentheses. For 'name'
 * consent the two are the same, so we hide the parenthetical.
 */
function InternalByline({ author, fullName, consent }: { author: string; fullName: string; consent: Consent }) {
  const same = author === fullName
  return (
    <span className="font-medium text-gray-700 dark:text-gray-300">
      {fullName}
      {!same && (
        <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">
          (shares as &ldquo;{author}&rdquo;{consent === 'no' ? ' — internal only' : ''})
        </span>
      )}
    </span>
  )
}

function maxOf(counts: Record<string, number>): number {
  return Math.max(1, ...Object.values(counts))
}

function sumOf(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------
function KpiCard({ kpi }: { kpi: FeedbackKpi }) {
  const tone =
    kpi.tone === 'positive'
      ? 'border-emerald-200 dark:border-emerald-900/60'
      : kpi.tone === 'caution'
      ? 'border-amber-200 dark:border-amber-900/60'
      : 'border-gray-200 dark:border-gray-800'
  const valueTone =
    kpi.tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-400'
      : kpi.tone === 'caution'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-gray-900 dark:text-gray-100'
  return (
    <div className={`rounded-lg border ${tone} bg-white dark:bg-gray-900 p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {kpi.label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{kpi.value}</div>
      {kpi.detail && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{kpi.detail}</div>
      )}
    </div>
  )
}

function RatingChart({ rating }: { rating: RatingBreakdown }) {
  const max = maxOf(rating.counts)
  const total = sumOf(rating.counts)
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {rating.question}
        </h3>
        <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {rating.caption}
          {rating.mean !== undefined && ` · mean ${rating.mean}`}
          {` · n=${total}`}
        </div>
      </div>
      <div className="space-y-1.5">
        {rating.scale.map((label) => {
          const count = rating.counts[label] ?? 0
          const pctOfMax = (count / max) * 100
          const pctOfTotal = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div className="w-44 shrink-0 truncate text-gray-700 dark:text-gray-300" title={label}>
                {label}
              </div>
              <div className="flex-1 h-5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-steps-blue-500 dark:bg-steps-blue-600 transition-all"
                  style={{ width: `${pctOfMax}%` }}
                />
              </div>
              <div className="w-20 shrink-0 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                {count} · {pctOfTotal}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuoteCard({ quote }: { quote: CuratedQuote }) {
  const badge = consentBadge(quote.consent)
  return (
    <figure className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <blockquote className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>— </span>
        <InternalByline author={quote.author} fullName={quote.fullName} consent={quote.consent} />
        {quote.context && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {quote.context}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      </figcaption>
    </figure>
  )
}

function AppendixRow({ row }: { row: FreeTextResponse }) {
  const badge = consentBadge(row.consent)
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <InternalByline author={row.name} fullName={row.fullName || row.name} consent={row.consent} />
          {row.email && (
            <span className="truncate text-gray-400 dark:text-gray-500" title={row.email}>
              · {row.email}
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <span className="tabular-nums shrink-0">{row.timestamp}</span>
      </div>
      <dl className="space-y-1.5">
        {Object.entries(row.fields).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {k}
            </dt>
            <dd className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function CopyableQuote({ quote }: { quote: CuratedQuote }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`"${quote.text}" — ${quote.author}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="relative group">
      <QuoteCard quote={quote} />
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-[10px] font-medium rounded bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300"
        title="Copy quote"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function PostableCard({ quote }: { quote: PostableQuote }) {
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const badge = consentBadge(quote.consent)
  const onCopy = async () => {
    try {
      const tag = quote.audienceTag ? `, ${quote.audienceTag}` : ''
      await navigator.clipboard.writeText(`"${quote.text}" — ${quote.author}${tag}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* ignore */
    }
  }
  return (
    <figure className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-white to-steps-blue-50/30 dark:from-gray-900 dark:to-steps-blue-950/20 p-5 relative group">
      <blockquote className="font-serif italic text-base sm:text-lg leading-relaxed text-gray-800 dark:text-gray-100">
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>— </span>
        <InternalByline author={quote.author} fullName={quote.fullName} consent={quote.consent} />
        {quote.audienceTag && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {quote.audienceTag}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      </figcaption>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-steps-blue-600 hover:bg-steps-blue-700 text-white"
          title="Copy paste-ready quote (external attribution only)"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {showSource ? 'Hide original ▴' : 'Show original ▾'}
        </button>
        {quote.sourceTimestamp && (
          <span className="text-[11px] text-gray-400 dark:text-gray-600 ml-auto tabular-nums">{quote.sourceTimestamp}</span>
        )}
      </div>
      {showSource && (
        <div className="mt-3 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">
          {quote.originalText}
        </div>
      )}
    </figure>
  )
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------
type Tab = 'curated' | 'postable' | 'appendix'

export default function EventFeedbackPage() {
  const params = useParams<{ id: string }>()
  const id = (params?.id ?? '').toString()
  const dataset: EventFeedbackDataset | undefined = id ? eventFeedbackByEventId[id] : undefined

  const [tab, setTab] = useState<Tab>('curated')
  const [appendixFilter, setAppendixFilter] = useState('')
  const [consentFilter, setConsentFilter] = useState<'all' | 'shareable' | 'anon' | 'internal'>('all')

  const filteredAppendix = useMemo(() => {
    if (!dataset) return []
    const q = appendixFilter.trim().toLowerCase()
    return dataset.appendix.filter((row) => {
      if (consentFilter === 'shareable' && !(row.consent === 'name' || row.consent === 'first_name'))
        return false
      if (consentFilter === 'anon' && row.consent !== 'anon') return false
      if (consentFilter === 'internal' && row.consent !== 'no') return false
      if (!q) return true
      const haystack = (
        row.name + ' ' + (row.fullName || '') + ' ' + (row.email || '') + ' ' + Object.values(row.fields).join(' ')
      ).toLowerCase()
      return haystack.includes(q)
    })
  }, [dataset, appendixFilter, consentFilter])

  useEffect(() => {
    if (dataset) document.title = `${dataset.eventName} feedback — Steps Intranet`
  }, [dataset])

  if (!dataset) {
    // No curated static dataset — try the live feedback table.
    return <LiveFeedbackView eventId={id} />
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <Link
          href={`/students/events/${dataset.eventId}`}
          className="text-sm text-steps-blue-600 dark:text-steps-blue-400 hover:underline"
        >
          ← Back to event
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {dataset.eventName} — feedback
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {formatEventDate(dataset.eventDate)} · {dataset.responseCount} responses
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={dataset.sourceSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors"
              title="Open the raw response sheet"
            >
              Source sheet ↗
            </a>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {dataset.kpis.map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>
      </section>

      {/* Ratings */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
          Ratings
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {dataset.ratings.map((r) => (
            <RatingChart key={r.question} rating={r} />
          ))}
        </div>
      </section>

      {/* Tab switcher */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800">
        {(['curated', 'postable', 'appendix'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-steps-blue-500 text-steps-blue-700 dark:text-steps-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {t === 'curated'
              ? `Curated quotes (${dataset.testimonials.length + dataset.constructive.length + dataset.growth.length})`
              : t === 'postable'
                ? `Postable quotes (${dataset.postableQuotes?.length ?? 0})`
                : `Full appendix (${dataset.appendix.length})`}
          </button>
        ))}
      </div>

      {tab === 'curated' && (
        <div className="space-y-8">
          {/* Testimonials */}
          {dataset.testimonials.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                Testimonials ({dataset.testimonials.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dataset.testimonials.map((q) => (
                  <CopyableQuote key={q.text.slice(0, 40)} quote={q} />
                ))}
              </div>
            </section>
          )}

          {/* Growth */}
          {dataset.growth.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                Transformation &amp; growth ({dataset.growth.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dataset.growth.map((q) => (
                  <CopyableQuote key={q.text.slice(0, 40)} quote={q} />
                ))}
              </div>
            </section>
          )}

          {/* Constructive */}
          {dataset.constructive.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                Constructive feedback ({dataset.constructive.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dataset.constructive.map((q) => (
                  <CopyableQuote key={q.text.slice(0, 40)} quote={q} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'postable' && (
        <div className="space-y-4">
          <div className="rounded-md border border-steps-blue-200 dark:border-steps-blue-900/40 bg-steps-blue-50/50 dark:bg-steps-blue-950/20 p-3 text-xs text-steps-blue-900 dark:text-steps-blue-200">
            Tightly-cropped 1–2 sentence pulls from longer responses, ready to drop into pitch
            decks and socials. Word choices are verbatim; <code className="font-mono">[brackets]</code>
            mark editorial clarifications. Copy uses the external attribution only — the full name
            shown here is staff-only.
          </div>
          {dataset.postableQuotes && dataset.postableQuotes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dataset.postableQuotes.map((q) => (
                <PostableCard key={q.text.slice(0, 40)} quote={q} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              No postable quotes curated yet for this event.
            </div>
          )}
        </div>
      )}

      {tab === 'appendix' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={appendixFilter}
              onChange={(e) => setAppendixFilter(e.target.value)}
              placeholder="Search responses…"
              className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-steps-blue-500"
            />
            <select
              value={consentFilter}
              onChange={(e) => setConsentFilter(e.target.value as typeof consentFilter)}
              className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="all">All consent levels</option>
              <option value="shareable">Shareable (named)</option>
              <option value="anon">Anonymous OK</option>
              <option value="internal">Internal only</option>
            </select>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {filteredAppendix.length} of {dataset.appendix.length}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredAppendix.map((row) => (
              <AppendixRow key={row.timestamp + (row.fullName || row.name)} row={row} />
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 dark:text-gray-600 pt-4 border-t border-gray-100 dark:border-gray-900">
        Curated quotes are picked algorithmically (longest substantive responses, weighted toward
        higher consent). Refine in <code className="font-mono">/dev/shm/feedback/aggregate.py</code>{' '}
        and re-emit if the picks need tuning.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveFeedbackView — renders post-event feedback that comes from the live
// event_feedback table (rather than the static curated TS files). Used when
// no curated dataset exists for an event but the event has feedback_config.
// ---------------------------------------------------------------------------
function LiveFeedbackView({ eventId }: { eventId: string }) {
  const [config, setConfig] = useState<EventFeedbackConfig | null>(null)
  const [rows, setRows] = useState<EventFeedbackRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    setLoading(true)
    Promise.all([fetchFeedbackConfig(eventId), fetchFeedbackSubmissions(eventId)])
      .then(([c, r]) => { if (!cancelled) { setConfig(c); setRows(r) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-sm text-gray-500 animate-pulse">Loading feedback…</p>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href={`/students/events/${eventId}`} className="text-sm text-steps-blue-600 hover:underline">← Back to event</Link>
        <h1 className="mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">No feedback form for this event</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">This event doesn’t have a feedback form configured. Add one in Supabase by setting <code className="font-mono text-xs">events.feedback_config</code>.</p>
      </div>
    )
  }

  const fields = getFeedbackFields(config)
  const responseCount = rows.length

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href={`/students/events/${eventId}`} className="text-sm text-steps-blue-600 hover:underline">← Back to event</Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">Live feedback</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {responseCount === 0
            ? 'No submissions yet — once attendees scan the QR and submit, their responses will appear here.'
            : `${responseCount} response${responseCount === 1 ? '' : 's'} from the student hub.`}
        </p>
      </div>

      {responseCount > 0 && (
        <div className="space-y-6">
          {fields.map(q => {
            if (q.type === 'scale') {
              const min = q.config?.scaleMin ?? 1
              const max = q.config?.scaleMax ?? 5
              const vals = rows.map(r => r.ratings?.[q.id]).filter((v): v is number => typeof v === 'number')
              if (vals.length === 0) return null
              const mean = vals.reduce((a, b) => a + b, 0) / vals.length
              const buckets: Record<number, number> = {}
              for (let i = min; i <= max; i++) buckets[i] = 0
              for (const v of vals) if (buckets[v] !== undefined) buckets[v]++
              const peak = Math.max(1, ...Object.values(buckets))
              return (
                <div key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{q.label}</h3>
                    <span className="text-sm font-semibold text-steps-blue-600">{mean.toFixed(2)} avg</span>
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(buckets).sort(([a], [b]) => Number(a) - Number(b)).map(([k, count]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="w-6 tabular-nums text-gray-500">{k}</span>
                        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                          <div className="h-full bg-steps-blue-500" style={{ width: `${(count / peak) * 100}%` }} />
                        </div>
                        <span className="w-8 tabular-nums text-gray-500 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }
            // Single-pick choices: radio, dropdown, yes_no
            if (q.type === 'radio' || q.type === 'dropdown' || q.type === 'yes_no') {
              const labelByVal = new Map<string, string>()
              if (q.options) for (const o of q.options) labelByVal.set(o.value, o.label)
              if (q.type === 'yes_no') { labelByVal.set('yes', 'Yes'); labelByVal.set('no', 'No') }
              const counts: Record<string, number> = {}
              for (const r of rows) {
                const v = r.answers?.[q.id]
                if (typeof v === 'string' && v.length > 0) counts[v] = (counts[v] ?? 0) + 1
              }
              const total = Object.values(counts).reduce((a, b) => a + b, 0)
              if (total === 0) return null
              return (
                <div key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{q.label}</h3>
                  <div className="space-y-1.5">
                    {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, count]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-gray-700 dark:text-gray-300">{labelByVal.get(k) ?? k}</span>
                        <span className="tabular-nums text-gray-500">{count} ({Math.round((count / total) * 100)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }
            // Multi-pick choices: checkbox_list
            if (q.type === 'checkbox_list') {
              const labelByVal = new Map<string, string>()
              if (q.options) for (const o of q.options) labelByVal.set(o.value, o.label)
              const counts: Record<string, number> = {}
              let respondents = 0
              for (const r of rows) {
                const v = r.answers?.[q.id]
                if (Array.isArray(v) && v.length > 0) {
                  respondents++
                  for (const item of v) {
                    if (typeof item === 'string') counts[item] = (counts[item] ?? 0) + 1
                  }
                }
              }
              if (respondents === 0) return null
              return (
                <div key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{q.label} <span className="text-gray-400 font-normal">({respondents} respondent{respondents === 1 ? '' : 's'})</span></h3>
                  <div className="space-y-1.5">
                    {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, count]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-gray-700 dark:text-gray-300">{labelByVal.get(k) ?? k}</span>
                        <span className="tabular-nums text-gray-500">{count} ({Math.round((count / respondents) * 100)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }
            // Free text: text, textarea, email, phone, url, number, date
            if (q.type === 'text' || q.type === 'textarea' || q.type === 'email' || q.type === 'phone' || q.type === 'url' || q.type === 'number' || q.type === 'date') {
              const responses = rows
                .map(r => ({ r, v: r.answers?.[q.id] }))
                .filter((x): x is { r: EventFeedbackRow; v: string } =>
                  typeof x.v === 'string' && x.v.trim().length > 0
                )
              if (responses.length === 0) return null
              return (
                <div key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{q.label} <span className="text-gray-400 font-normal">({responses.length})</span></h3>
                  <ul className="space-y-2">
                    {responses.map(({ r, v }) => (
                      <li key={r.id} className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                        “{v}”
                        <div className="text-[11px] text-gray-400 mt-0.5">{r.student?.first_name} {r.student?.last_name} · {new Date(r.submitted_at).toLocaleDateString('en-GB')}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            }
            // Skip non-aggregable types: section_heading, media, matrix, ranked_dropdown,
            // paired_dropdown, repeatable_group. (Their raw values still surface on the
            // student profile via the per-submission view.)
            return null
          })}

          {/* Postable quotes */}
          {(() => {
            const pq = rows.filter(r => r.postable_quote && r.postable_quote.trim().length > 0)
            if (pq.length === 0) return null
            return (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Postable quotes <span className="text-gray-400 font-normal">({pq.length})</span></h3>
                <ul className="space-y-3">
                  {pq.map(r => (
                    <li key={r.id} className="text-sm">
                      <p className="italic text-gray-800 dark:text-gray-200">“{r.postable_quote}”</p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {r.consent === 'name' ? `${r.student?.first_name} ${r.student?.last_name}` :
                          r.consent === 'first_name' ? r.student?.first_name :
                          r.consent === 'anon' ? 'Anonymous' : 'Internal only'}
                        {' · consent: '}{r.consent}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

