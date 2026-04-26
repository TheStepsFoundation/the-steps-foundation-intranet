'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { eventFeedbackByEventId } from '@/data/event-feedback'
import type {
  CuratedQuote,
  EventFeedbackDataset,
  FeedbackKpi,
  FreeTextResponse,
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
        <span className="font-medium text-gray-700 dark:text-gray-300">— {quote.author}</span>
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
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 dark:text-gray-300">{row.name}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <span className="tabular-nums">{row.timestamp}</span>
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

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------
type Tab = 'curated' | 'appendix'

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
      const haystack = (row.name + ' ' + Object.values(row.fields).join(' ')).toLowerCase()
      return haystack.includes(q)
    })
  }, [dataset, appendixFilter, consentFilter])

  useEffect(() => {
    if (dataset) document.title = `${dataset.eventName} feedback — Steps Intranet`
  }, [dataset])

  if (!dataset) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          href={`/students/events/${id}`}
          className="text-sm text-steps-blue-600 dark:text-steps-blue-400 hover:underline"
        >
          ← Back to event
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          No feedback data yet
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          This event doesn&apos;t have a curated feedback dataset wired in. Datasets live in{' '}
          <code className="font-mono text-xs">src/data/event-feedback/</code> and are keyed by event UUID.
        </p>
      </div>
    )
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
        {(['curated', 'appendix'] as Tab[]).map((t) => (
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
              <AppendixRow key={row.timestamp + row.name} row={row} />
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
