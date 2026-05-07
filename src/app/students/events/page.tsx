'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { EventWithStats, fetchEventsWithStats, createDraftEvent } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// /students/events — events overview / management entry point.
//
// Wave 3 redesign (Apr 2026):
//  - Editorial header: League Spartan title, breadcrumb to /hub, "New event"
//    CTA aligned right (links to existing creation route).
//  - 5-tile bento KPI strip uses display-tight typography matching /hub.
//  - Event cards: clearer visual hierarchy (heading → meta → status pill on
//    its own column → filled-bar on right when capacity is set), refined
//    pill colour, tightened spacing.
//  - Loading / error / empty states get distinct friendlier treatments.
//
// Data fetch and filter logic preserved verbatim.
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | 'open' | 'closed' | 'completed' | 'draft'

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  draft:     { label: 'Draft',     classes: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300' },
  open:      { label: 'Open',      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300' },
  closed:    { label: 'Closed',    classes: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' },
  completed: { label: 'Completed', classes: 'bg-steps-blue-50 text-steps-blue-700 border-steps-blue-200 dark:bg-steps-blue-900/30 dark:text-steps-blue-300' },
}

export default function EventsOverview() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventWithStats[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const handleCreate = async () => {
    setCreating(true); setCreateErr(null)
    try {
      const fresh = await createDraftEvent()
      // Land in the editor in edit mode so the admin can immediately
      // rename + fill in the rest. ?new=1 triggers editing-on-mount.
      router.push(`/students/events/${fresh.id}?new=1`)
    } catch (e: any) {
      setCreateErr(e?.message ?? 'Could not create event')
      setCreating(false)
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchEventsWithStats()
      .then(data => { if (active) { setEvents(data); setLoading(false) } })
      .catch(err => { if (active) { setError(err?.message ?? 'Failed to load events'); setLoading(false) } })
    return () => { active = false }
  }, [])

  const totals = useMemo(() => {
    let totalApps = 0, totalAccepted = 0, totalRejected = 0, totalAttended = 0
    for (const e of events) {
      totalApps += e.total_applicants
      totalAccepted += e.accepted_count
      totalRejected += e.rejected_count
      totalAttended += e.attended_count
    }
    return {
      events: events.length,
      totalApps,
      totalAccepted,
      totalRejected,
      totalAttended,
      openEvents: events.filter(e => e.status === 'open').length,
    }
  }, [events])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return events
    return events.filter(e => e.status === statusFilter)
  }, [events, statusFilter])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) c[e.status] = (c[e.status] || 0) + 1
    return c
  }, [events])

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* === Header === */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6 animate-tsf-fade-up">
        <div>
          <Link href="/hub" className="text-sm text-steps-blue-600 hover:text-steps-blue-700 inline-flex items-center gap-1 mb-2">
            <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
            Hub
          </Link>
          <h1 className="font-display text-3xl font-black text-steps-dark dark:text-gray-100 tracking-tight">Events</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Manage applications and communications for every Steps event.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/students/emails/templates"
            className="px-4 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 font-semibold hover:bg-slate-50 dark:hover:bg-gray-800 transition inline-flex items-center gap-2"
          >
            <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Email templates
          </Link>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2.5 text-sm rounded-xl bg-steps-blue-600 text-white font-semibold border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
          >
            <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            {creating ? 'Creating…' : 'New event'}
          </button>
        </div>
      </div>

      {createErr && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t create event: {createErr}
        </div>
      )}

      {/* === KPI tiles === */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 animate-tsf-fade-up-1">
        <Kpi label="Total events" value={totals.events} />
        <Kpi label="Open now" value={totals.openEvents} accent />
        <Kpi label="All applications" value={totals.totalApps} />
        <Kpi label="Accepted" value={totals.totalAccepted} good />
        <Kpi label="Attended" value={totals.totalAttended} accent />
      </div>

      {/* === Status filter tabs === */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {(['all', 'open', 'closed', 'completed', 'draft'] as StatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              statusFilter === s
                ? 'bg-steps-dark text-white'
                : 'text-slate-600 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700'
            }`}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 text-xs opacity-70">{statusCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* === List === */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <div aria-hidden className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-gray-400">Loading events…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-10 text-center">
          <p className="font-semibold text-red-700 dark:text-red-300">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900/50 p-12 text-center">
          <p className="font-semibold text-steps-dark dark:text-gray-100">No events match this filter.</p>
          {statusFilter !== 'all' && (
            <button onClick={() => setStatusFilter('all')} className="mt-2 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium">
              Show all events
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 animate-tsf-fade-up-2">
          {filtered.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  )
}

function EventCard({ event }: { event: EventWithStats }) {
  const badge = STATUS_BADGE[event.status] ?? STATUS_BADGE.draft
  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      })
    : 'Date TBC'

  const timeStr = [event.time_start, event.time_end].filter(Boolean).join(' – ')

  return (
    <Link
      href={`/students/events/${event.id}`}
      className="group block rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-steps-blue-300 dark:hover:border-steps-blue-700 hover:shadow-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-steps-dark dark:text-gray-100 truncate group-hover:text-steps-blue-700 transition-colors">
              {event.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-slate-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <svg aria-hidden className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                {formattedDate}
              </span>
              {timeStr && <span>{timeStr}</span>}
              {event.location && <span className="truncate max-w-[280px]">{event.location}</span>}
              {event.capacity != null && <span>Cap: {event.capacity}</span>}
            </div>
          </div>
          <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${badge.classes}`}>
            {badge.label}
          </span>
        </div>

        <div className="flex items-center gap-x-5 gap-y-2 text-sm flex-wrap pt-3 border-t border-slate-100 dark:border-gray-800">
          <Stat label="Applicants" value={event.total_applicants} />
          <Stat label="Pending" value={event.submitted_count} color="text-sky-600 dark:text-sky-400" />
          <Stat label="Accepted" value={event.accepted_count} color="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Rejected" value={event.rejected_count} color="text-slate-500 dark:text-gray-400" />
          <Stat label="Waitlist" value={event.waitlisted_count} color="text-amber-600 dark:text-amber-400" />
          <Stat label="Attended" value={event.attended_count} color="text-steps-blue-600 dark:text-steps-blue-400" />
          {event.capacity != null && event.total_applicants > 0 && (
            <div className="ml-auto hidden sm:block">
              <FillBar attended={event.attended_count} applicants={event.total_applicants} capacity={event.capacity} />
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color ?? 'text-steps-dark dark:text-gray-100'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}

function FillBar({ attended, applicants, capacity }: { attended: number; applicants: number; capacity: number }) {
  const pct = Math.min(100, Math.round((attended / capacity) * 100))
  const ratio = (applicants / capacity).toFixed(1)
  return (
    <div className="flex flex-col items-end gap-0.5 leading-tight">
      <span
        className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-gray-400"
        title={`${applicants} applicants for ${capacity} places`}
      >
        {ratio}:1
      </span>
      <div className="flex items-center gap-2">
        <div className="w-24 h-1.5 rounded-full bg-slate-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="text-xs font-medium text-slate-500 dark:text-gray-400 tabular-nums"
          title={`${attended} attended / ${capacity} places available`}
        >
          {pct}%
        </span>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent, good, warn }: { label: string; value: number; accent?: boolean; good?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 p-4 hover:border-slate-300 dark:hover:border-gray-700 transition-colors">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-3xl font-display font-black tabular-nums ${
        accent ? 'text-steps-blue-600 dark:text-steps-blue-400'
          : good ? 'text-emerald-600 dark:text-emerald-400'
          : warn ? 'text-amber-600 dark:text-amber-400'
          : 'text-steps-dark dark:text-gray-100'
      }`}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
