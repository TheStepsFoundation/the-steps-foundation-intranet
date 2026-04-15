'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EVENTS, EnrichedStudent, enrich, fetchAllStudentsAndApps } from '@/lib/students-api'

type ViewKey = 'all' | 'attended3' | 'noshow2' | 'byevent' | 'subscribed'

export default function StudentsDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [students, setStudents] = useState<EnrichedStudent[]>([])
  const [view, setView] = useState<ViewKey>('all')
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState<string>(EVENTS[EVENTS.length - 1].id)
  const [eventStatus, setEventStatus] = useState<'all' | 'accepted' | 'attended' | 'rejected' | 'no_show'>('all')
  const [sortBy, setSortBy] = useState<'engagement' | 'attended' | 'last_name' | 'recent'>('engagement')

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchAllStudentsAndApps()
      .then(({ students: sList, applications }) => {
        if (!active) return
        const enriched = sList.map(s => enrich(s, applications))
        setStudents(enriched)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message ?? 'Failed to load')
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const totals = useMemo(() => {
    const total = students.length
    const attended1plus = students.filter(s => s.attended_count >= 1).length
    const attended3plus = students.filter(s => s.attended_count >= 3).length
    const noshow2plus = students.filter(s => s.no_show_count >= 2).length
    const subscribed = students.filter(s => s.subscribed_to_mailing).length
    return { total, attended1plus, attended3plus, noshow2plus, subscribed }
  }, [students])

  const filtered = useMemo(() => {
    let list = students
    if (view === 'attended3') list = list.filter(s => s.attended_count >= 3)
    else if (view === 'noshow2') list = list.filter(s => s.no_show_count >= 2)
    else if (view === 'subscribed') list = list.filter(s => s.subscribed_to_mailing)
    else if (view === 'byevent') {
      list = list.filter(s => {
        const app = s.applications.find(a => a.event_id === eventFilter)
        if (!app) return false
        if (eventStatus === 'all') return true
        if (eventStatus === 'attended') return !!app.attended
        if (eventStatus === 'no_show') return app.status === 'accepted' && !app.attended
        return app.status === eventStatus
      })
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(s =>
        (s.first_name || '').toLowerCase().includes(q) ||
        (s.last_name || '').toLowerCase().includes(q) ||
        (s.personal_email || '').toLowerCase().includes(q) ||
        (s.school_name_raw || '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sortBy === 'engagement') return b.engagement_score - a.engagement_score
      if (sortBy === 'attended') return b.attended_count - a.attended_count
      if (sortBy === 'last_name') return (a.last_name || '').localeCompare(b.last_name || '')
      if (sortBy === 'recent') {
        const aMax = Math.max(0, ...a.applications.map(x => x.submitted_at ? Date.parse(x.submitted_at) : 0))
        const bMax = Math.max(0, ...b.applications.map(x => x.submitted_at ? Date.parse(x.submitted_at) : 0))
        return bMax - aMax
      }
      return 0
    })
    return sorted
  }, [students, view, search, eventFilter, eventStatus, sortBy])

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Student Database</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Engagement across every Steps event.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, school…"
            className="w-72 px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label="Total students" value={totals.total} />
        <Kpi label="Attended 1+" value={totals.attended1plus} />
        <Kpi label="Attended 3+" value={totals.attended3plus} accent />
        <Kpi label="No-shows 2+" value={totals.noshow2plus} warn />
        <Kpi label="Mailing list" value={totals.subscribed} />
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Tab active={view === 'all'} onClick={() => setView('all')}>All</Tab>
        <Tab active={view === 'attended3'} onClick={() => setView('attended3')}>Attended 3+</Tab>
        <Tab active={view === 'noshow2'} onClick={() => setView('noshow2')}>No-shows 2+</Tab>
        <Tab active={view === 'byevent'} onClick={() => setView('byevent')}>By event</Tab>
        <Tab active={view === 'subscribed'} onClick={() => setView('subscribed')}>Mailing list</Tab>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="text-gray-500 dark:text-gray-400">Sort</label>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="engagement">Engagement score</option>
            <option value="attended">Events attended</option>
            <option value="last_name">Last name</option>
            <option value="recent">Most recent app</option>
          </select>
        </div>
      </div>

      {view === 'byevent' && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          <label className="text-sm text-gray-500 dark:text-gray-400">Event</label>
          <select
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            {EVENTS.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <label className="ml-4 text-sm text-gray-500 dark:text-gray-400">Status</label>
          <select
            value={eventStatus}
            onChange={e => setEventStatus(e.target.value as typeof eventStatus)}
            className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            <option value="all">All</option>
            <option value="attended">Attended</option>
            <option value="accepted">Accepted</option>
            <option value="no_show">No-show</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">Loading students…</div>
        ) : error ? (
          <div className="p-10 text-center text-red-600 dark:text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">No students match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400">
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>School</Th>
                  <Th>Year</Th>
                  {EVENTS.map(e => <Th key={e.id} className="text-center">{e.short}</Th>)}
                  <Th className="text-right">Att.</Th>
                  <Th className="text-right">No-show</Th>
                  <Th className="text-right">Score</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.slice(0, 500).map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2">
                      <Link href={`/students/${s.id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                        {s.first_name || ''} {s.last_name || ''}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{s.personal_email}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{s.school_name_raw}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{s.year_group}</td>
                    {EVENTS.map(e => {
                      const app = s.applications.find(a => a.event_id === e.id)
                      return <td key={e.id} className="px-3 py-2 text-center">{renderEventCell(app)}</td>
                    })}
                    <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{s.attended_count}</td>
                    <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{s.no_show_count || ''}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{s.engagement_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-800">
                Showing first 500 of {filtered.length} — refine the search to narrow.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function renderEventCell(app: { status: string; attended: boolean | null } | undefined) {
  if (!app) return <span className="text-gray-300 dark:text-gray-700">—</span>
  if (app.attended) return <span title="Attended" className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
  if (app.status === 'accepted') return <span title="Accepted / no-show" className="inline-block w-2 h-2 rounded-full bg-amber-400" />
  if (app.status === 'rejected') return <span title="Rejected" className="inline-block w-2 h-2 rounded-full bg-gray-400" />
  if (app.status === 'submitted') return <span title="Submitted" className="inline-block w-2 h-2 rounded-full bg-sky-400" />
  return <span className="text-gray-300 dark:text-gray-700">·</span>
}

function Kpi({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-indigo-600 dark:text-indigo-400' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm border ${active
        ? 'bg-indigo-600 text-white border-indigo-600'
        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
    >
      {children}
    </button>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide ${className}`}>{children}</th>
}
