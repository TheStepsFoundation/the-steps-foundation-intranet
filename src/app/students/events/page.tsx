'use client'

import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  EventWithStats,
  fetchEventsWithStats,
  createDraftEvent,
  archiveEvent,
  unarchiveEvent,
  deleteEvent,
  computeEventEffectiveStatus,
  cloneEventFrom,
  CLONE_FIELD_LABELS,
  type CloneFieldKey,
  EFFECTIVE_STATUS_META,
  type EffectiveStatus,
} from '@/lib/events-api'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// /students/events — events overview / management entry point.
//
// Major refactor (Apr 2026):
//   - Effective status (Draft / Scheduled / Live / Closed / Completed) derived
//     from date timestamps, replaces the raw admin-set status.
//   - Time-based segmentation: Upcoming & live | Past events.
//   - "Needs decisions" hero band surfaces events with pending applications.
//   - Search + sort controls. URL-encoded filter state.
//   - List/table view toggle. Bulk-archive in table view.
//   - Lead-organiser badge per card. Decision-deadline highlight.
//   - KPI strip scoped to current/active focus, all-time numbers in a footer.
//   - Decision-window timeline on each card.
// ---------------------------------------------------------------------------

type SortKey = 'date_desc' | 'date_asc' | 'pending_desc' | 'apps_desc' | 'name_asc'
type ViewMode = 'cards' | 'table'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc',    label: 'Newest first' },
  { value: 'date_asc',     label: 'Soonest first' },
  { value: 'pending_desc', label: 'Most pending decisions' },
  { value: 'apps_desc',    label: 'Most applicants' },
  { value: 'name_asc',     label: 'Alphabetical' },
]

type TeamMember = { auth_uuid: string | null; name: string | null }

// Read URL state so refreshes preserve filter / sort / search / view.
function useUrlState(): {
  q: string; setQ: (v: string) => void
  status: EffectiveStatus | 'all'; setStatus: (v: EffectiveStatus | 'all') => void
  sort: SortKey; setSort: (v: SortKey) => void
  view: ViewMode; setView: (v: ViewMode) => void
  showArchived: boolean; setShowArchived: (v: boolean) => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [q, setQRaw] = useState(sp?.get('q') ?? '')
  const [status, setStatusRaw] = useState<EffectiveStatus | 'all'>(((): EffectiveStatus | 'all' => {
    const v = sp?.get('status') ?? 'all'
    return ['all', 'draft', 'scheduled', 'live', 'closed', 'completed'].includes(v) ? (v as EffectiveStatus | 'all') : 'all'
  })())
  const [sort, setSortRaw] = useState<SortKey>(((): SortKey => {
    const v = sp?.get('sort') ?? 'date_desc'
    return SORT_OPTIONS.some(o => o.value === v) ? (v as SortKey) : 'date_desc'
  })())
  const [view, setViewRaw] = useState<ViewMode>(((): ViewMode => {
    const v = sp?.get('view') ?? 'cards'
    return v === 'table' ? 'table' : 'cards'
  })())
  const [showArchived, setShowArchivedRaw] = useState<boolean>(sp?.get('archived') === '1')

  const writeUrl = (next: Record<string, string | null>) => {
    if (!pathname) return
    const params = new URLSearchParams(sp?.toString() ?? '')
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '' || v === 'all' || v === 'date_desc' || v === 'cards' || v === '0') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return {
    q, setQ: (v) => { setQRaw(v); writeUrl({ q: v || null }) },
    status, setStatus: (v) => { setStatusRaw(v); writeUrl({ status: v }) },
    sort, setSort: (v) => { setSortRaw(v); writeUrl({ sort: v }) },
    view, setView: (v) => { setViewRaw(v); writeUrl({ view: v }) },
    showArchived,
    setShowArchived: (v) => { setShowArchivedRaw(v); writeUrl({ archived: v ? '1' : null }) },
  }
}

function Inner() {
  const router = useRouter()
  const url = useUrlState()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<EventWithStats[]>([])
  const [members, setMembers] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const handleCreate = async () => {
    setShowCreateMenu(false)
    setCreating(true); setCreateErr(null)
    try {
      const fresh = await createDraftEvent()
      router.push(`/students/events/${fresh.id}?new=1`)
    } catch (e: any) {
      setCreateErr(e?.message ?? 'Could not create event')
      setCreating(false)
    }
  }

  // Close the New-event split menu on outside click.
  const createMenuRef = useRef<HTMLDivElement | null>(null)
  void createMenuRef // (placed near top so we can use it in markup; ref attached below)

  const handleClone = async (sourceId: string, fields: CloneFieldKey[]) => {
    setShowCloneModal(false); setCreating(true); setCreateErr(null)
    try {
      const fresh = await cloneEventFrom(sourceId, fields)
      router.push(`/students/events/${fresh.id}?new=1&cloned=1`)
    } catch (e: any) {
      setCreateErr(e?.message ?? 'Could not clone event')
      setCreating(false)
    }
  }

  // Load events + team-member name map. Members are tiny + we already gate
  // this whole page on team-member auth, so a single fetch is fine.
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      fetchEventsWithStats({ includeArchived: url.showArchived }),
      supabase.from('team_members').select('auth_uuid, name').is('deleted_at', null),
    ])
      .then(([data, membersResult]) => {
        if (!active) return
        setEvents(data)
        const map: Record<string, string> = {}
        for (const m of (membersResult.data ?? []) as TeamMember[]) {
          if (m.auth_uuid && m.name) map[m.auth_uuid] = m.name
        }
        setMembers(map)
        setLoading(false)
      })
      .catch(err => { if (active) { setError(err?.message ?? 'Failed to load events'); setLoading(false) } })
    return () => { active = false }
  }, [url.showArchived])

  const reload = async () => {
    try {
      const fresh = await fetchEventsWithStats({ includeArchived: url.showArchived })
      setEvents(fresh)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to refresh events')
    }
  }

  const handleArchive = async (id: string, currentlyArchived: boolean) => {
    setBusyId(id); setActionErr(null)
    try {
      if (currentlyArchived) await unarchiveEvent(id)
      else await archiveEvent(id)
      await reload()
    } catch (e: any) {
      setActionErr(e?.message ?? 'Action failed')
    } finally { setBusyId(null) }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? It'll be hidden everywhere — applications stay in the database for audit, and you can restore it from Supabase if needed.`)) return
    setBusyId(id); setActionErr(null)
    try { await deleteEvent(id); await reload() }
    catch (e: any) { setActionErr(e?.message ?? 'Delete failed') }
    finally { setBusyId(null) }
  }

  const handleBulkArchive = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Archive ${selected.size} event${selected.size === 1 ? '' : 's'}? They'll be hidden from the default list. Reversible from each card.`)) return
    setActionErr(null)
    try {
      await Promise.all([...selected].map(id => archiveEvent(id)))
      setSelected(new Set())
      await reload()
    } catch (e: any) {
      setActionErr(e?.message ?? 'Bulk archive failed')
    }
  }

  // Decorate events with effective status + flags used everywhere below.
  const decorated = useMemo(() => {
    const todayMs = Date.now()
    return events.map(e => {
      const effective = computeEventEffectiveStatus(e)
      const eventMs = e.event_date ? new Date(e.event_date + 'T00:00:00').getTime() : null
      const closeMs = e.applications_close_at ? new Date(e.applications_close_at).getTime() : null
      const isPastEvent = eventMs != null && eventMs < todayMs
      const decisionsUrgent = !!closeMs && closeMs >= todayMs && (closeMs - todayMs) < 7 * 86400000 && e.submitted_count > 0
      const decisionsOverdue = !!closeMs && closeMs < todayMs && e.submitted_count > 0
      const owner = e.lead_team_member_id ? (members[e.lead_team_member_id] ?? null) : null
      return { ...e, effective, isPastEvent, decisionsUrgent, decisionsOverdue, owner }
    })
  }, [events, members])

  // Filter + search + sort.
  const filtered = useMemo(() => {
    const q = url.q.trim().toLowerCase()
    let out = decorated
    if (url.status !== 'all') out = out.filter(e => e.effective === url.status)
    if (q) out = out.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.location ?? '').toLowerCase().includes(q) ||
      (e.owner ?? '').toLowerCase().includes(q)
    )
    out = [...out].sort((a, b) => {
      const ad = a.event_date ? new Date(a.event_date + 'T00:00:00').getTime() : 0
      const bd = b.event_date ? new Date(b.event_date + 'T00:00:00').getTime() : 0
      switch (url.sort) {
        case 'date_asc':     return ad - bd
        case 'pending_desc': return (b.submitted_count ?? 0) - (a.submitted_count ?? 0)
        case 'apps_desc':    return (b.total_applicants ?? 0) - (a.total_applicants ?? 0)
        case 'name_asc':     return a.name.localeCompare(b.name)
        case 'date_desc':
        default:             return bd - ad
      }
    })
    return out
  }, [decorated, url.status, url.q, url.sort])

  // Time-based segmentation.
  const upcoming = useMemo(() => filtered.filter(e => !e.isPastEvent), [filtered])
  const past = useMemo(() => filtered.filter(e => e.isPastEvent), [filtered])

  // Effective-status counts (for the filter chips).
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: decorated.length, draft: 0, scheduled: 0, live: 0, closed: 0, completed: 0 }
    for (const e of decorated) c[e.effective] = (c[e.effective] ?? 0) + 1
    return c
  }, [decorated])

  // KPIs scoped to current/active focus.
  const kpis = useMemo(() => {
    const live = decorated.filter(e => e.effective === 'live')
    const upcomingDecisions = decorated.reduce((acc, e) => acc + ((e.effective === 'live' || e.effective === 'closed') && !e.isPastEvent ? e.submitted_count : 0), 0)
    const acceptedUpcoming = decorated.reduce((acc, e) => acc + (!e.isPastEvent ? e.accepted_count : 0), 0)
    return {
      liveCount: live.length,
      pendingDecisions: upcomingDecisions,
      acceptedUpcoming,
      // All-time footer numbers
      totalEvents: events.length,
      totalApps: decorated.reduce((a, e) => a + e.total_applicants, 0),
      totalAttended: decorated.reduce((a, e) => a + e.attended_count, 0),
    }
  }, [decorated, events])

  // Events that need decisions soonest — used for the hero band at the top.
  const needsDecisions = useMemo(() => {
    return decorated
      .filter(e => e.submitted_count > 0 && (e.effective === 'live' || e.effective === 'closed'))
      .sort((a, b) => {
        const ac = a.applications_close_at ? new Date(a.applications_close_at).getTime() : Infinity
        const bc = b.applications_close_at ? new Date(b.applications_close_at).getTime() : Infinity
        return ac - bc
      })
      .slice(0, 5)
  }, [decorated])

  const archivedHidden = useMemo(() => {
    if (url.showArchived) return 0
    // We didn't fetch archived ones, so this is just a hint — assume there's
    // some if previously known (we don't track it without the toggle on).
    return null
  }, [url.showArchived])

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (ids: string[]) => {
    setSelected(prev => {
      const allOn = ids.every(id => prev.has(id))
      if (allOn) {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
  }

  // Render
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
          <div className="relative">
            <div className="inline-flex rounded-xl shadow-press-blue overflow-hidden">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2.5 text-sm bg-steps-blue-600 text-white font-semibold border-t border-white/20 hover:bg-steps-blue-700 active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
              >
                <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                {creating ? 'Creating…' : 'New event'}
              </button>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={showCreateMenu}
                aria-label="More create options"
                onClick={() => setShowCreateMenu(o => !o)}
                disabled={creating}
                className="px-2.5 py-2.5 text-sm bg-steps-blue-700 text-white border-t border-l border-white/20 hover:bg-steps-blue-800 transition disabled:opacity-60"
              >
                <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
              </button>
            </div>
            {showCreateMenu && (
              <div role="menu" className="absolute right-0 top-12 z-30 min-w-[260px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-sm">
                <button role="menuitem" onClick={handleCreate} className="block w-full text-left px-3.5 py-2 hover:bg-slate-50">
                  <span className="font-semibold text-steps-dark">Blank event</span>
                  <span className="block text-xs text-slate-500">Start from scratch.</span>
                </button>
                <button role="menuitem" onClick={() => { setShowCreateMenu(false); setShowCloneModal(true) }} className="block w-full text-left px-3.5 py-2 hover:bg-slate-50 border-t border-slate-100">
                  <span className="font-semibold text-steps-dark">Clone from previous event…</span>
                  <span className="block text-xs text-slate-500">Pick fields to copy from a past event.</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {createErr && (<div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t create event: {createErr}</div>)}
      {actionErr && (<div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionErr}</div>)}

      {/* === Needs decisions hero band === */}
      {!loading && needsDecisions.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 sm:p-6 animate-tsf-fade-up-1">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] font-bold text-amber-800">Needs your attention</p>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-steps-dark mt-0.5">Decisions waiting on {needsDecisions.length} event{needsDecisions.length === 1 ? '' : 's'}</h2>
            </div>
            <p className="text-sm text-slate-600">{needsDecisions.reduce((a, e) => a + e.submitted_count, 0)} applications across them</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {needsDecisions.map(e => {
              const days = e.applications_close_at ? Math.ceil((new Date(e.applications_close_at).getTime() - Date.now()) / 86400000) : null
              return (
                <Link key={e.id} href={`/students/events/${e.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 hover:border-amber-400 hover:shadow-sm transition">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-steps-dark truncate">{e.name}</p>
                    <p className="text-xs text-slate-500">
                      {e.submitted_count} pending
                      {days != null && (
                        <span className={`ml-1.5 ${days < 0 ? 'text-rose-700 font-semibold' : days <= 2 ? 'text-amber-700 font-semibold' : ''}`}>
                          · {days < 0 ? `closed ${Math.abs(days)}d ago` : days === 0 ? 'closes today' : `closes in ${days}d`}
                        </span>
                      )}
                    </p>
                  </div>
                  <svg aria-hidden className="w-4 h-4 text-amber-600 shrink-0 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* === KPI strip — current / active focus === */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 animate-tsf-fade-up-1">
        <Kpi label="Live now" value={kpis.liveCount} accent />
        <Kpi label="Decisions waiting" value={kpis.pendingDecisions} warn />
        <Kpi label="Accepted upcoming" value={kpis.acceptedUpcoming} good />
      </div>
      <p className="text-xs text-slate-400 mb-6">All-time: {kpis.totalEvents} events · {kpis.totalApps.toLocaleString()} applications · {kpis.totalAttended.toLocaleString()} attended</p>

      {/* === Toolbar: search · status · sort · view · archive === */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 sm:flex-none sm:w-72">
          <svg aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="search"
            value={url.q}
            onChange={e => url.setQ(e.target.value)}
            placeholder="Search events, location, owner…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 placeholder:text-slate-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'draft', 'scheduled', 'live', 'closed', 'completed'] as const).map(s => (
            <button
              key={s}
              onClick={() => url.setStatus(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                url.status === s
                  ? 'bg-steps-dark text-white'
                  : 'text-slate-600 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700'
              }`}
            >
              {s === 'all' ? 'All' : EFFECTIVE_STATUS_META[s as EffectiveStatus]?.label ?? s}
              <span className="ml-1.5 opacity-70">{statusCounts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <select
          value={url.sort}
          onChange={e => url.setSort(e.target.value as SortKey)}
          className="ml-auto px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer focus:ring-2 focus:ring-steps-blue-500 outline-none"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="inline-flex rounded-xl border border-slate-300 dark:border-gray-700 overflow-hidden text-sm font-semibold">
          <button onClick={() => url.setView('cards')} className={`px-3 py-2 ${url.view === 'cards' ? 'bg-steps-dark text-white' : 'bg-white dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'}`} title="Card view">Cards</button>
          <button onClick={() => url.setView('table')} className={`px-3 py-2 border-l border-slate-300 dark:border-gray-700 ${url.view === 'table' ? 'bg-steps-dark text-white' : 'bg-white dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700'}`} title="Table view">Table</button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={url.showArchived}
            onChange={e => url.setShowArchived(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500"
          />
          Show archived
        </label>
      </div>

      {/* Bulk action bar — visible whenever something is selected, regardless
          of view mode (cards or table). */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 rounded-xl bg-steps-blue-50 border border-steps-blue-200 text-sm">
          <span className="font-semibold text-steps-blue-800">{selected.size} selected</span>
          <button onClick={handleBulkArchive} className="px-3 py-1 rounded-lg bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition">Archive selected</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-steps-blue-700 hover:underline text-xs">Clear selection</button>
        </div>
      )}

      {/* === List === */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div aria-hidden className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading events…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center"><p className="font-semibold text-red-700">{error}</p></div>
      ) : decorated.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-white text-steps-blue-600 border border-slate-200 flex items-center justify-center mb-3">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <p className="font-display text-lg font-bold text-steps-dark">No events yet</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">Create your first event to start collecting applications.</p>
          <button onClick={handleCreate} className="px-4 py-2 text-sm rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition">Create your first event</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <p className="font-semibold text-steps-dark">No events match this filter.</p>
          <button onClick={() => { url.setStatus('all'); url.setQ('') }} className="mt-2 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium">Clear filters</button>
        </div>
      ) : url.view === 'table' ? (
        <TableView
          rowsByBucket={[
            { title: upcoming.length > 0 && past.length > 0 ? 'Upcoming & live' : null, rows: upcoming },
            { title: upcoming.length > 0 && past.length > 0 ? 'Past events' : null, rows: past },
          ]}
          selected={selected}
          onToggle={toggleSelected}
          onToggleAll={toggleSelectAll}
          onArchive={handleArchive}
          onDelete={handleDelete}
          busyId={busyId}
        />
      ) : (
        <CardsView
          buckets={[
            { title: upcoming.length > 0 && past.length > 0 ? 'Upcoming & live' : null, rows: upcoming },
            { title: upcoming.length > 0 && past.length > 0 ? 'Past events' : null, rows: past },
          ]}
          selected={selected}
          onToggle={toggleSelected}
          onToggleAll={toggleSelectAll}
          onArchive={handleArchive}
          onDelete={handleDelete}
          busyId={busyId}
        />
      )}

      {!loading && !url.showArchived && (
        <p className="text-xs text-slate-400 mt-6 text-center">
          Archived events are hidden — tick &quot;Show archived&quot; above to include them.
        </p>
      )}

      {showCloneModal && (
        <CloneModal
          events={events}
          onClose={() => setShowCloneModal(false)}
          onClone={handleClone}
        />
      )}
    </main>
  )
}

type DecoratedEvent = EventWithStats & {
  effective: EffectiveStatus
  isPastEvent: boolean
  decisionsUrgent: boolean
  decisionsOverdue: boolean
  owner: string | null
}

// ---------------------------------------------------------------------------
// CardsView
// ---------------------------------------------------------------------------
function CardsView({ buckets, selected, onToggle, onToggleAll, onArchive, onDelete, busyId }: {
  buckets: { title: string | null; rows: DecoratedEvent[] }[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[]) => void
  onArchive: (id: string, currentlyArchived: boolean) => void
  onDelete: (id: string, name: string) => void
  busyId: string | null
}) {
  return (
    <div className="space-y-8 animate-tsf-fade-up-2">
      {buckets.map((b, i) => b.rows.length === 0 ? null : (
        <div key={i}>
          {b.title && (
            <div className="flex items-baseline justify-between mb-3">
              <div className="inline-flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={b.rows.length > 0 && b.rows.every(r => selected.has(r.id))}
                  onChange={() => onToggleAll(b.rows.map(r => r.id))}
                  className="w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500"
                  aria-label={`Select all ${b.title}`}
                />
                <h3 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">{b.title}</h3>
              </div>
              <span className="text-xs text-slate-400">{b.rows.length}</span>
            </div>
          )}
          <div className="grid gap-3">
            {b.rows.map(event => (
              <EventCard
                key={event.id}
                event={event}
                busy={busyId === event.id}
                isSelected={selected.has(event.id)}
                onToggleSelected={() => onToggle(event.id)}
                onArchive={() => onArchive(event.id, !!event.archived_at)}
                onDelete={() => onDelete(event.id, event.name)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EventCard({ event, busy, isSelected, onToggleSelected, onArchive, onDelete }: { event: DecoratedEvent; busy: boolean; isSelected: boolean; onToggleSelected: () => void; onArchive: () => void; onDelete: () => void }) {
  const meta = EFFECTIVE_STATUS_META[event.effective]
  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date TBC'
  const timeStr = [event.time_start, event.time_end].filter(Boolean).join(' – ')
  const isArchived = !!event.archived_at

  // Kebab menu
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [menuOpen])

  // Decision rim — left border accent for events where decisions are urgent or overdue
  const rimClass = event.decisionsOverdue
    ? 'before:bg-rose-500 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l-2xl'
    : event.decisionsUrgent
    ? 'before:bg-amber-500 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:rounded-l-2xl'
    : ''

  return (
    <div className={`relative group rounded-2xl border ${isSelected ? 'ring-2 ring-steps-blue-400 border-steps-blue-300' : isArchived ? 'border-slate-200 bg-slate-50 opacity-80' : 'border-slate-200 bg-white'} hover:border-steps-blue-300 hover:shadow-md transition-all ${rimClass}`}>
      {/* Selection checkbox — top-left, always visible. stopPropagation so
          clicking it doesn't navigate into the card. */}
      <label
        className="absolute top-3 left-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer hover:bg-slate-100 transition"
        onClick={e => e.stopPropagation()}
        aria-label={`Select ${event.name}`}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          className="w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500"
        />
      </label>
      <Link href={`/students/events/${event.id}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 rounded-2xl">
        <div className="p-5 pl-14 pr-12">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-steps-dark truncate group-hover:text-steps-blue-700 transition-colors">{event.name}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <svg aria-hidden className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  {formattedDate}
                </span>
                {timeStr && <span>{timeStr}</span>}
                {event.location && <span className="truncate max-w-[280px]">{event.location}</span>}
                {event.capacity != null && <span>Cap: {event.capacity}</span>}
                {event.owner && <span className="inline-flex items-center gap-1 text-slate-600"><span className="w-1 h-1 rounded-full bg-slate-300" aria-hidden />Led by {event.owner}</span>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${meta.classes}`}>{meta.label}</span>
              {event.decisionsOverdue && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700">{event.submitted_count} overdue</span>}
              {!event.decisionsOverdue && event.decisionsUrgent && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">decisions due soon</span>}
            </div>
          </div>

          {/* Stats row — past events get attended-only treatment */}
          {event.isPastEvent ? (
            <div className="flex items-center gap-x-5 gap-y-2 text-sm flex-wrap pt-3 border-t border-slate-100">
              <Stat label="Attended" value={event.attended_count} color="text-violet-700 font-bold" />
              <Stat label="Accepted" value={event.accepted_count} color="text-slate-500" />
              <Stat label="Applicants" value={event.total_applicants} color="text-slate-500" />
              {event.capacity != null && event.attended_count > 0 && (
                <div className="ml-auto hidden sm:block">
                  <FillBar attended={event.attended_count} applicants={event.total_applicants} capacity={event.capacity} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-x-5 gap-y-2 text-sm flex-wrap pt-3 border-t border-slate-100">
              <Stat label="Applicants" value={event.total_applicants} />
              <Stat label="Pending" value={event.submitted_count} color={event.submitted_count > 0 ? 'text-sky-700 font-bold' : 'text-slate-500'} />
              <Stat label="Accepted" value={event.accepted_count} color="text-emerald-600" />
              <Stat label="Waitlist" value={event.waitlisted_count} color="text-amber-600" />
              <Stat label="Rejected" value={event.rejected_count} color="text-slate-500" />
              {event.capacity != null && event.total_applicants > 0 && (
                <div className="ml-auto hidden sm:block">
                  <FillBar attended={event.attended_count} applicants={event.total_applicants} capacity={event.capacity} />
                </div>
              )}
            </div>
          )}

          {/* Lifecycle timeline */}
          <LifecycleTimeline e={event} />
        </div>
      </Link>

      <div ref={menuRef} className="absolute top-3 right-3">
        <button type="button" aria-label="Event actions" aria-expanded={menuOpen} aria-haspopup="menu" disabled={busy}
          onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(o => !o) }}
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500"
        >
          <svg aria-hidden className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-9 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-30 text-sm">
            <button role="menuitem" onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onArchive() }} className="block w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-100">{isArchived ? 'Unarchive' : 'Archive'}</button>
            <button role="menuitem" onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onDelete() }} className="block w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50">Delete</button>
          </div>
        )}
      </div>

      {isArchived && <span className="absolute top-3 left-14 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 border border-slate-300">Archived</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lifecycle timeline — 5 steps mirroring the effective-status ladder.
//   Draft → Scheduled → Live → Closed → Completed
// Each segment is fully filled if reached, with the current step highlighted.
// ---------------------------------------------------------------------------
const LIFECYCLE_STEPS: { key: EffectiveStatus; label: string }[] = [
  { key: 'draft',     label: 'Draft' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'live',      label: 'Live' },
  { key: 'closed',    label: 'Closed' },
  { key: 'completed', label: 'Done' },
]

function LifecycleTimeline({ e }: { e: DecoratedEvent }) {
  const idx = LIFECYCLE_STEPS.findIndex(s => s.key === e.effective)
  const tone = EFFECTIVE_STATUS_META[e.effective].tone
  const fillClass = tone === 'emerald' ? 'bg-emerald-500'
    : tone === 'blue' ? 'bg-steps-blue-600'
    : tone === 'amber' ? 'bg-amber-500'
    : tone === 'violet' ? 'bg-violet-500'
    : 'bg-slate-400'
  return (
    <div className="mt-3" aria-hidden>
      <div className="flex items-center gap-1">
        {LIFECYCLE_STEPS.map((s, i) => (
          <div key={s.key} className="flex-1 flex items-center gap-1">
            <span className={`block h-1.5 flex-1 rounded-full ${i <= idx ? fillClass : 'bg-slate-200'}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TableView — compact, scannable, supports bulk select
// ---------------------------------------------------------------------------
function TableView({ rowsByBucket, selected, onToggle, onToggleAll, onArchive, onDelete, busyId }: {
  rowsByBucket: { title: string | null; rows: DecoratedEvent[] }[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[]) => void
  onArchive: (id: string, currentlyArchived: boolean) => void
  onDelete: (id: string, name: string) => void
  busyId: string | null
}) {
  return (
    <div className="space-y-8 animate-tsf-fade-up-2">
      {rowsByBucket.map((b, i) => b.rows.length === 0 ? null : (
        <div key={i}>
          {b.title && (
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">{b.title}</h3>
              <span className="text-xs text-slate-400">{b.rows.length}</span>
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              {/* table-fixed + colgroup pins column widths so the two
                  bucketed tables (Upcoming & Past) line up vertically.
                  Without this they'd auto-size to their own widest cell
                  and the columns would drift between sections. */}
              <table className="w-full text-sm table-fixed min-w-[820px]">
                <colgroup>
                  <col className="w-10" />          {/* checkbox */}
                  <col />                            {/* event (flex) */}
                  <col className="w-28" />          {/* date */}
                  <col className="w-32" />          {/* status */}
                  <col className="w-20" />          {/* pending */}
                  <col className="w-20" />          {/* accepted */}
                  <col className="w-20" />          {/* total */}
                  <col className="w-28" />          {/* owner */}
                  <col className="w-12" />          {/* actions */}
                </colgroup>
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={b.rows.every(r => selected.has(r.id))}
                        onChange={() => onToggleAll(b.rows.map(r => r.id))}
                        className="w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500"
                        aria-label="Select all in this group"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left">Event</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-right">Pending</th>
                    <th className="px-3 py-2.5 text-right">Accepted</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-left">Owner</th>
                    <th className="px-3 py-2.5 text-right">Act</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.rows.map(e => {
                    const meta = EFFECTIVE_STATUS_META[e.effective]
                    const date = e.event_date ? new Date(e.event_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
                    const isSelected = selected.has(e.id)
                    return (
                      <tr key={e.id} className={`${isSelected ? 'bg-steps-blue-50' : ''} ${e.archived_at ? 'opacity-70' : ''} hover:bg-slate-50 transition-colors`}>
                        <td className="px-3 py-2.5"><input type="checkbox" checked={isSelected} onChange={() => onToggle(e.id)} className="w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500" aria-label={`Select ${e.name}`} /></td>
                        <td className="px-3 py-2.5 truncate">
                          <Link href={`/students/events/${e.id}`} className="font-semibold text-steps-dark hover:text-steps-blue-700 transition-colors truncate inline-block max-w-full align-middle" title={e.name}>{e.name}</Link>
                          {e.archived_at && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-200 text-slate-600">Archived</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{date}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${meta.classes}`}>{meta.label}</span>
                          {e.decisionsOverdue && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-700">overdue</span>}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${e.submitted_count > 0 ? 'text-sky-700 font-bold' : 'text-slate-400'}`}>{e.submitted_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{e.accepted_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{e.total_applicants}</td>
                        <td className="px-3 py-2.5 text-slate-600 truncate" title={e.owner ?? ''}>{e.owner ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right">
                          <RowActions busy={busyId === e.id} archived={!!e.archived_at} onArchive={() => onArchive(e.id, !!e.archived_at)} onDelete={() => onDelete(e.id, e.name)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RowActions({ busy, archived, onArchive, onDelete }: { busy: boolean; archived: boolean; onArchive: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" disabled={busy} aria-label="Row actions" aria-haspopup="menu" aria-expanded={open}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50">
        <svg aria-hidden className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-30 text-xs">
          <button role="menuitem" onClick={() => { setOpen(false); onArchive() }} className="block w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-100">{archived ? 'Unarchive' : 'Archive'}</button>
          <button role="menuitem" onClick={() => { setOpen(false); onDelete() }} className="block w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50">Delete</button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</span>
      <span className={`text-sm tabular-nums ${color ?? 'text-steps-dark'}`}>{value.toLocaleString()}</span>
    </div>
  )
}

function FillBar({ attended, applicants, capacity }: { attended: number; applicants: number; capacity: number }) {
  const pct = Math.min(100, Math.round((attended / capacity) * 100))
  const ratio = (applicants / capacity).toFixed(1)
  return (
    <div className="flex flex-col items-end gap-0.5 leading-tight">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500" title={`${applicants} applicants for ${capacity} places`}>{ratio}:1</span>
      <div className="flex items-center gap-2">
        <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-medium text-slate-500 tabular-nums" title={`${attended} attended / ${capacity} places available`}>{pct}%</span>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent, good, warn }: { label: string; value: number; accent?: boolean; good?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 hover:border-slate-300 transition-colors">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-display font-black tabular-nums ${
        accent ? 'text-steps-blue-600'
          : good ? 'text-emerald-600'
          : warn ? 'text-amber-600'
          : 'text-steps-dark'
      }`}>{value.toLocaleString()}</div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// CloneModal — pick a source event + which fields to clone into a new draft.
// Date / time-window / status / slug are always reset; everything else is
// opt-in. Defaults selected: description, banner, hub_image, format,
// eligibility, form_config, feedback_config, dashboard_columns, interest_options
// (essentially "everything reusable" — admin can untick what they don't want).
// ---------------------------------------------------------------------------
function CloneModal({ events, onClose, onClone }: {
  events: EventWithStats[]
  onClose: () => void
  onClone: (sourceId: string, fields: CloneFieldKey[]) => void
}) {
  const [sourceId, setSourceId] = useState<string>(() => events[0]?.id ?? '')
  // Most-reusable defaults pre-checked. Admin unticks if they don't want them.
  const [fields, setFields] = useState<Set<CloneFieldKey>>(new Set([
    'description', 'banner', 'hub_image', 'format', 'eligibility',
    'form_config', 'feedback_config', 'dashboard_columns', 'interest_options',
    'capacity', 'time_window', 'dress_code',
  ]))
  const FIELDS: CloneFieldKey[] = [
    'description', 'banner', 'hub_image', 'capacity', 'format', 'location',
    'time_window', 'dress_code', 'eligibility', 'form_config', 'feedback_config',
    'dashboard_columns', 'interest_options',
  ]
  const toggle = (k: CloneFieldKey) => setFields(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="clone-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-tsf-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-2xl w-full p-6 sm:p-7 animate-tsf-fade-up" onClick={e => e.stopPropagation()}>
        <h2 id="clone-title" className="font-display text-xl font-bold text-steps-dark mb-1">Clone from previous event</h2>
        <p className="text-sm text-slate-500 mb-4">Pick a source event and which bits to copy. Dates and the URL slug are always reset — you'll set new ones in the editor.</p>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Source event</label>
          <select value={sourceId} onChange={e => setSourceId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none">
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}{ev.event_date ? ` — ${new Date(ev.event_date).getFullYear()}` : ''}</option>)}
          </select>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Fields to copy</label>
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto pr-1">
            {FIELDS.map(k => {
              const meta = CLONE_FIELD_LABELS[k]
              const checked = fields.has(k)
              return (
                <label key={k} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggle(k)} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-steps-blue-600 focus:ring-steps-blue-500" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-steps-dark">{meta.label}</span>
                    <span className="block text-xs text-slate-500">{meta.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition">Cancel</button>
          <button type="button" disabled={!sourceId} onClick={() => onClone(sourceId, [...fields])} className="px-4 py-2 text-sm rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 disabled:opacity-50 transition">
            Clone &amp; open editor
          </button>
        </div>
      </div>
    </div>
  )
}

export default function EventsOverviewPage() {
  return (
    <Suspense fallback={
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div aria-hidden className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading events…</p>
        </div>
      </main>
    }>
      <Inner />
    </Suspense>
  )
}
