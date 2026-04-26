'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EventWithStats, fetchEventsWithStats } from '@/lib/events-api'

type StatusFilter = 'all' | 'open' | 'closed' | 'completed' | 'draft'

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  draft:     { label: 'Draft',     classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  open:      { label: 'Open',      classes: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  closed:    { label: 'Closed',    classes: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Completed', classes: 'bg-steps-blue-50 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400' },
}

export default function EventsOverview() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventWithStats[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

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
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Events</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage applications and communications for every Steps event.</p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label="Total events" value={totals.events} />
        <Kpi label="Open now" value={totals.openEvents} accent />
        <Kpi label="All applications" value={totals.totalApps} />
        <Kpi label="Accepted" value={totals.totalAccepted} />
        <Kpi label="Rejected" value={totals.totalRejected} warn />
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4">
        {(['all', 'open', 'closed', 'completed', 'draft'] as StatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              statusFilter === s
                ? 'bg-steps-blue-600 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 text-xs opacity-70">{statusCounts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Events list */}
      {loading ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-gray-500 dark:text-gray-400">
          Loading events…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-10 text-center text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-gray-500 dark:text-gray-400">
          No events match this filter.
        </div>
      ) : (
        <div className="grid gap-4">
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
      className="block rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-steps-blue-300 dark:hover:border-steps-blue-700 hover:shadow-sm transition-all"
    >
      <div className="p-5">
        {/* Top row: name + status badge */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
              {event.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{formattedDate}</span>
              {timeStr && <span>{timeStr}</span>}
              {event.location && <span className="truncate max-w-[280px]">{event.location}</span>}
              {event.capacity != null && (
                <span>
                  Cap: {event.capacity}
                  {event.total_applicants > 0 && (
                    <> · {event.total_applicants}:{event.capacity} apps:places ({(event.total_applicants / event.capacity).toFixed(1)}×)</>
                  )}
                </span>
              )}
            </div>
          </div>
          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.classes}`}>
            {badge.label}
          </span>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 text-sm">
          <Stat label="Applicants" value={event.total_applicants} />
          <Stat label="Pending review" value={event.submitted_count} color="text-sky-600 dark:text-sky-400" />
          <Stat label="Accepted" value={event.accepted_count} color="text-emerald-600 dark:text-emerald-400" />
          <Stat label="Rejected" value={event.rejected_count} color="text-gray-500 dark:text-gray-400" />
          <Stat label="Waitlisted" value={event.waitlisted_count} color="text-amber-600 dark:text-amber-400" />
          <Stat label="Attended" value={event.attended_count} color="text-steps-blue-600 dark:text-steps-blue-400" />
          {event.capacity != null && event.total_applicants > 0 && (
            <div className="ml-auto hidden sm:block">
              <FillBar attended={event.attended_count} capacity={event.capacity} />
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-semibold ${color ?? 'text-gray-900 dark:text-gray-100'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}

function FillBar({ attended, capacity }: { attended: number; capacity: number }) {
  const pct = Math.min(100, Math.round((attended / capacity) * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">{pct}% filled</span>
    </div>
  )
}

function Kpi({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${
        accent ? 'text-steps-blue-600 dark:text-steps-blue-400'
          : warn ? 'text-amber-600 dark:text-amber-400'
          : 'text-gray-900 dark:text-gray-100'
      }`}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
