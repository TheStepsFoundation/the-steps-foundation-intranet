'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EVENTS, EnrichedStudent, Eligibility, SchoolType, fetchAllStudentsEnriched } from '@/lib/students-api'
import { supabase } from '@/lib/supabase'

type SortKey =
  | 'engagement' | 'attended' | 'accepted' | 'no_show' | 'submitted'
  | 'rejected' | 'bonus' | 'last_name' | 'first_name' | 'recent' | 'year'
type SortDir = 'asc' | 'desc'
type TriBool = 'any' | 'yes' | 'no' | 'unknown'
type EventStatus = 'any' | 'attended' | 'accepted' | 'no_show' | 'submitted' | 'rejected' | 'none'

const SORT_OPTIONS: { value: SortKey; label: string; defaultDir: SortDir }[] = [
  { value: 'engagement', label: 'Engagement score', defaultDir: 'desc' },
  { value: 'attended', label: 'Events attended', defaultDir: 'desc' },
  { value: 'accepted', label: 'Events accepted', defaultDir: 'desc' },
  { value: 'no_show', label: 'No-shows', defaultDir: 'desc' },
  { value: 'submitted', label: 'Submitted apps', defaultDir: 'desc' },
  { value: 'rejected', label: 'Rejections', defaultDir: 'desc' },
  { value: 'bonus', label: 'Bonus points', defaultDir: 'desc' },
  { value: 'recent', label: 'Most recent activity', defaultDir: 'desc' },
  { value: 'last_name', label: 'Last name', defaultDir: 'asc' },
  { value: 'first_name', label: 'First name', defaultDir: 'asc' },
  { value: 'year', label: 'Year group', defaultDir: 'asc' },
]

const INCOME_BANDS: { value: string; label: string }[] = [
  { value: 'under_40k', label: 'Under £40k' },
  { value: 'over_40k',  label: '£40k or more' },
  { value: 'prefer_na', label: 'Prefer not to say' },
]

type SmiMin = 0 | 1 | 2 | 3
function smiCount(s: { free_school_meals: boolean | null; parental_income_band: string | null }): number {
  let n = 0
  if (s.free_school_meals === true) n++
  if (s.parental_income_band === 'under_40k') n++
  return n
}

const SCHOOL_TYPES: { value: SchoolType; label: string }[] = [
  { value: 'state', label: 'State' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'private', label: 'Private' },
]

const ELIGIBILITY_OPTIONS: { value: Eligibility; label: string }[] = [
  { value: 'eligible', label: 'Eligible' },
  { value: 'ineligible', label: 'Ineligible' },
  { value: 'unknown', label: 'Unknown' },
]

type Filters = {
  search: string
  yearGroups: string[]
  fsm: TriBool
  incomeBands: string[]
  smiMin: SmiMin
  schoolTypes: SchoolType[]
  eligibility: Eligibility[]
  eventStatus: Record<string, EventStatus>
  minAttended: number
  minEngagement: number
}

const defaultFilters = (): Filters => ({
  search: '',
  yearGroups: [],
  fsm: 'any',
  incomeBands: [],
  smiMin: 0,
  schoolTypes: [],
  eligibility: [],
  eventStatus: Object.fromEntries(EVENTS.map(e => [e.id, 'any' as EventStatus])),
  minAttended: 0,
  minEngagement: 0,
})

export default function StudentsDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [students, setStudents] = useState<EnrichedStudent[]>([])
  const [sortBy, setSortBy] = useState<SortKey>('engagement')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filters, setFilters] = useState<Filters>(defaultFilters())
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchAllStudentsEnriched()
      .then(enriched => { if (active) { setStudents(enriched); setLoading(false) } })
      .catch(err => { if (active) { setError(err?.message ?? 'Failed to load'); setLoading(false) } })
    return () => { active = false }
  }, [])

  const yearGroupOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of students) if (s.year_group) set.add(s.year_group)
    return Array.from(set).sort()
  }, [students])

  const totals = useMemo(() => ({
    total: students.length,
    attended1plus: students.filter(s => s.attended_count >= 1).length,
    attended3plus: students.filter(s => s.attended_count >= 3).length,
    noshow2plus: students.filter(s => s.no_show_count >= 2).length,
    smi2plus: students.filter(s => smiCount(s) >= 2).length,
    eligible: students.filter(s => s.eligibility === 'eligible').length,
  }), [students])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filters.search.trim()) n++
    if (filters.yearGroups.length) n++
    if (filters.fsm !== 'any') n++
    if (filters.incomeBands.length) n++
    if (filters.smiMin > 0) n++
    if (filters.schoolTypes.length) n++
    if (filters.eligibility.length) n++
    for (const id of Object.keys(filters.eventStatus)) if (filters.eventStatus[id] !== 'any') n++
    if (filters.minAttended > 0) n++
    if (filters.minEngagement > 0) n++
    return n
  }, [filters])

  const filtered = useMemo(() => {
    const f = filters
    const q = f.search.trim().toLowerCase()
    let list = students.filter(s => {
      if (q) {
        const hay = `${s.first_name || ''} ${s.last_name || ''} ${s.personal_email || ''} ${s.school_name_raw || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (f.yearGroups.length && (!s.year_group || !f.yearGroups.includes(s.year_group))) return false
      if (!matchTri(f.fsm, s.free_school_meals)) return false
      if (f.incomeBands.length && (!s.parental_income_band || !f.incomeBands.includes(s.parental_income_band))) return false
      if (f.smiMin > 0 && smiCount(s) < f.smiMin) return false
      if (f.schoolTypes.length && (!s.school_type || !f.schoolTypes.includes(s.school_type))) return false
      if (f.eligibility.length && !f.eligibility.includes(s.eligibility)) return false
      for (const ev of EVENTS) {
        const want = f.eventStatus[ev.id]
        if (!want || want === 'any') continue
        const app = s.applications.find(a => a.event_id === ev.id)
        if (want === 'none') { if (app) return false; continue }
        if (!app) return false
        if (want === 'attended' && !app.attended) return false
        if (want === 'no_show' && !(app.status === 'accepted' && !app.attended)) return false
        if (want === 'accepted' && app.status !== 'accepted') return false
        if (want === 'submitted' && app.status !== 'submitted') return false
        if (want === 'rejected' && app.status !== 'rejected') return false
      }
      if (f.minAttended > 0 && s.attended_count < f.minAttended) return false
      if (f.minEngagement > 0 && s.engagement_score < f.minEngagement) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...list].sort((a, b) => {
      const v = compareBy(sortBy, a, b)
      return v * dir
    })
    return sorted
  }, [students, filters, sortBy, sortDir])

  const setEventStatus = (id: string, v: EventStatus) =>
    setFilters(f => ({ ...f, eventStatus: { ...f.eventStatus, [id]: v } }))
  const toggleArr = (key: 'yearGroups' | 'incomeBands', v: string) =>
    setFilters(f => ({ ...f, [key]: f[key].includes(v) ? f[key].filter(x => x !== v) : [...f[key], v] }))
  const toggleSchoolType = (v: SchoolType) =>
    setFilters(f => ({ ...f, schoolTypes: f.schoolTypes.includes(v) ? f.schoolTypes.filter(x => x !== v) : [...f.schoolTypes, v] }))
  const toggleEligibility = (v: Eligibility) =>
    setFilters(f => ({ ...f, eligibility: f.eligibility.includes(v) ? f.eligibility.filter(x => x !== v) : [...f.eligibility, v] }))

  // --- Selection helpers ---
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const visibleIds = useMemo(() => filtered.slice(0, 500).map(s => s.id), [filtered])

  const toggleSelectAll = () => {
    const allSelected = visibleIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); visibleIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); visibleIds.forEach(id => n.add(id)); return n })
    }
  }

  const handleDeleteStudents = async (mode: 'soft' | 'hard') => {
    if (selected.size === 0) return
    setDeleteLoading(true)
    const ids = [...selected]

    if (mode === 'soft') {
      const now = new Date().toISOString()
      await supabase.from('students').update({ deleted_at: now }).in('id', ids)
      await supabase.from('applications').update({ deleted_at: now }).in('student_id', ids)
    } else {
      await supabase.from('applications').delete().in('student_id', ids)
      await supabase.from('students').delete().in('id', ids)
    }

    setStudents(prev => prev.filter(s => !selected.has(s.id)))
    setSelected(new Set())
    setDeleteLoading(false)
    setDeleteModal(false)
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Student Database</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Engagement across every Steps event.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/students/review-schools"
            className="px-3 py-2 text-sm rounded-md border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            title="Review students whose school name didn't auto-link to GIAS."
          >
            Review schools
          </Link>
          <input
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Search name, email, school…"
            className="w-72 px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => setPanelOpen(o => !o)}
            className={`px-3 py-2 text-sm rounded-md border flex items-center gap-2 ${panelOpen || activeFilterCount > 0
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            Sort &amp; Filter
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/90 text-indigo-700 text-[11px] font-semibold">{activeFilterCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Kpi label="Total students" value={totals.total} />
        <Kpi label="Attended 1+" value={totals.attended1plus} />
        <Kpi label="Attended 3+" value={totals.attended3plus} accent />
        <Kpi label="No-shows 2+" value={totals.noshow2plus} warn />
        <Kpi label="SMI 2+" value={totals.smi2plus} accent />
        <Kpi label="Eligible" value={totals.eligible} accent />
      </div>

      {panelOpen && (
        <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-5">
          <Segment title="Sort">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sortBy}
                onChange={e => {
                  const v = e.target.value as SortKey
                  setSortBy(v)
                  const def = SORT_OPTIONS.find(o => o.value === v)?.defaultDir ?? 'desc'
                  setSortDir(def)
                }}
                className="px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button onClick={() => setSortDir('desc')} className={`px-3 py-1.5 text-sm ${sortDir === 'desc' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'}`}>Descending</button>
                <button onClick={() => setSortDir('asc')} className={`px-3 py-1.5 text-sm border-l border-gray-200 dark:border-gray-700 ${sortDir === 'asc' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'}`}>Ascending</button>
              </div>
            </div>
          </Segment>

          <Segment title="By event">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {EVENTS.map(ev => (
                <div key={ev.id} className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400 w-44 truncate" title={ev.name}>{ev.name}</span>
                  <select
                    value={filters.eventStatus[ev.id] || 'any'}
                    onChange={e => setEventStatus(ev.id, e.target.value as EventStatus)}
                    className="flex-1 px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  >
                    <option value="any">Any / no filter</option>
                    <option value="attended">Attended</option>
                    <option value="no_show">Accepted but no-show</option>
                    <option value="accepted">Accepted</option>
                    <option value="submitted">Submitted (pending)</option>
                    <option value="rejected">Rejected</option>
                    <option value="none">Didn't apply</option>
                  </select>
                </div>
              ))}
            </div>
          </Segment>

          <Segment title="Demographics">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Year group</Label>
                <ChipList
                  options={yearGroupOptions.map(y => ({ value: y, label: y }))}
                  selected={filters.yearGroups}
                  onToggle={v => toggleArr('yearGroups', v)}
                />
              </div>
              <div>
                <Label>Parental income</Label>
                <ChipList
                  options={INCOME_BANDS}
                  selected={filters.incomeBands}
                  onToggle={v => toggleArr('incomeBands', v)}
                />
              </div>
              <div>
                <Label>Free school meals</Label>
                <TriToggle value={filters.fsm} onChange={v => setFilters(f => ({ ...f, fsm: v }))} />
              </div>

              <div>
                <Label>School type</Label>
                <ChipList
                  options={SCHOOL_TYPES.map(t => ({ value: t.value, label: t.label }))}
                  selected={filters.schoolTypes}
                  onToggle={v => toggleSchoolType(v as SchoolType)}
                />
              </div>
              <div>
                <Label>Eligibility</Label>
                <ChipList
                  options={ELIGIBILITY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                  selected={filters.eligibility}
                  onToggle={v => toggleEligibility(v as Eligibility)}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Social mobility indicators (FSM + first-gen + low income)</Label>
                <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {([0, 1, 2, 3] as SmiMin[]).map((n, i) => (
                    <button
                      key={n}
                      onClick={() => setFilters(f => ({ ...f, smiMin: n }))}
                      className={`px-2.5 py-1 text-xs ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${filters.smiMin === n ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'}`}
                    >{n === 0 ? 'Any' : `At least ${n}`}</button>
                  ))}
                </div>
              </div>
            </div>
          </Segment>

          <Segment title="Thresholds">
            <div className="grid grid-cols-2 gap-2 max-w-md">
              <div>
                <Label>Min attended</Label>
                <input
                  type="number" min={0}
                  value={filters.minAttended}
                  onChange={e => setFilters(f => ({ ...f, minAttended: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              <div>
                <Label>Min engagement</Label>
                <input
                  type="number"
                  value={filters.minEngagement}
                  onChange={e => setFilters(f => ({ ...f, minEngagement: Number(e.target.value) || 0 }))}
                  className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
            </div>
          </Segment>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {filtered.length.toLocaleString()} of {students.length.toLocaleString()} students match
            </div>
            <button
              onClick={() => setFilters(defaultFilters())}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Legend</span>
        <LegendDot className="bg-emerald-500" label="Attended" />
        <LegendDot className="bg-amber-400" label="Accepted (awaiting event / no-show if past)" />
        <LegendDot className="bg-sky-400" label="Submitted (pending review)" />
        <LegendDot className="bg-gray-400" label="Rejected" />
        <span className="inline-flex items-center gap-1"><span className="text-gray-300 dark:text-gray-700">—</span> Didn't apply</span>
        <span className="inline-flex items-center gap-1"><span className="text-amber-500">★</span> +1 bonus</span>
        <span className="inline-flex items-center gap-1"><span className="text-red-500">▼</span> -1 bonus</span>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="text-gray-600 dark:text-gray-400 font-medium">{selected.size} selected</span>
          <button
            onClick={() => setDeleteModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {loading ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">Loading students…</div>
        ) : error ? (
          <div className="p-10 text-center text-red-600 dark:text-red-400">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400">No students match.</div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-260px)] rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/80 backdrop-blur text-gray-600 dark:text-gray-400 sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
                <tr>
                  <th className="px-2 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={visibleIds.length > 0 && visibleIds.every(id => selected.has(id))}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 dark:border-gray-600 accent-indigo-600"
                    />
                  </th>
                  <Th>Name</Th>
                  <Th>School</Th>
                  <Th>Year</Th>
                  {EVENTS.map(e => <Th key={e.id} className="text-center">{e.short}</Th>)}
                  <Th className="text-right">Score</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.slice(0, 500).map(s => (
                  <tr key={s.id} className={`${selected.has(s.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : s.eligibility === 'ineligible' ? 'bg-red-50/70 dark:bg-red-900/10 hover:bg-red-100/70 dark:hover:bg-red-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="rounded border-gray-300 dark:border-gray-600 accent-indigo-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/students/${s.id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                        {s.first_name || ''} {s.last_name || ''}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 truncate max-w-[240px]">{s.school_name_raw}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{s.year_group}</td>
                    {EVENTS.map(e => {
                      const app = s.applications.find(a => a.event_id === e.id)
                      return <td key={e.id} className="px-3 py-2 text-center">{renderEventCell(app)}</td>
                    })}
                    <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{s.engagement_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-800">
                Showing first 500 of {filtered.length} — refine filters to narrow.
              </div>
            )}
          </div>
        )}
      </div>
      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Delete {selected.size} student{selected.size !== 1 ? 's' : ''}?
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              This will remove the student record{selected.size !== 1 ? 's' : ''} and all associated applications.
            </p>
            <div className="space-y-3 mb-6">
              <button
                onClick={() => handleDeleteStudents('soft')}
                disabled={deleteLoading}
                className="w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition group disabled:opacity-50"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100 text-sm group-hover:text-amber-700 dark:group-hover:text-amber-400">
                  {deleteLoading ? 'Deleting\u2026' : 'Archive (soft delete)'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Hides the student and their applications from view. Data is preserved and can be restored.
                </div>
              </button>
              <button
                onClick={() => handleDeleteStudents('hard')}
                disabled={deleteLoading}
                className="w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/10 transition group disabled:opacity-50"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100 text-sm group-hover:text-red-700 dark:group-hover:text-red-400">
                  {deleteLoading ? 'Deleting\u2026' : 'Permanently delete'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Removes the student and all their applications permanently. This cannot be undone.
                </div>
              </button>
            </div>
            <button
              onClick={() => setDeleteModal(false)}
              disabled={deleteLoading}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function matchTri(mode: TriBool, v: boolean | null): boolean {
  if (mode === 'any') return true
  if (mode === 'unknown') return v === null || v === undefined
  if (mode === 'yes') return v === true
  return v === false
}

function compareBy(key: SortKey, a: EnrichedStudent, b: EnrichedStudent): number {
  switch (key) {
    case 'engagement': return a.engagement_score - b.engagement_score
    case 'attended': return a.attended_count - b.attended_count
    case 'accepted': return a.accepted_count - b.accepted_count
    case 'no_show': return a.no_show_count - b.no_show_count
    case 'submitted': return a.submitted_count - b.submitted_count
    case 'rejected': return a.rejected_count - b.rejected_count
    case 'bonus': return a.bonus_total - b.bonus_total
    case 'last_name': return (a.last_name || '').localeCompare(b.last_name || '')
    case 'first_name': return (a.first_name || '').localeCompare(b.first_name || '')
    case 'year': return (a.year_group || '').localeCompare(b.year_group || '')
    case 'recent': {
      const aMax = Math.max(0, ...a.applications.map(x => x.submitted_at ? Date.parse(x.submitted_at) : 0))
      const bMax = Math.max(0, ...b.applications.map(x => x.submitted_at ? Date.parse(x.submitted_at) : 0))
      return aMax - bMax
    }
  }
}

function renderEventCell(app: { status: string; attended: boolean | null; bonus_points?: number | null; bonus_reason?: string | null } | undefined) {
  if (!app) return <span className="text-gray-300 dark:text-gray-700">—</span>
  let dot: JSX.Element
  if (app.attended) dot = <span title="Attended" className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
  else if (app.status === 'accepted') dot = <span title="Accepted / no-show" className="inline-block w-2 h-2 rounded-full bg-amber-400" />
  else if (app.status === 'rejected') dot = <span title="Rejected" className="inline-block w-2 h-2 rounded-full bg-gray-400" />
  else if (app.status === 'submitted') dot = <span title="Submitted" className="inline-block w-2 h-2 rounded-full bg-sky-400" />
  else dot = <span className="text-gray-300 dark:text-gray-700">·</span>
  const bp = app.bonus_points || 0
  if (bp === 0) return dot
  const tip = app.bonus_reason || (bp > 0 ? '+1 bonus' : '-1 bonus')
  const mark = bp > 0
    ? <span title={tip} className="ml-0.5 text-[10px] leading-none text-amber-500">★</span>
    : <span title={tip} className="ml-0.5 text-[10px] leading-none text-red-500">▼</span>
  return <span className="inline-flex items-center">{dot}{mark}</span>
}

function EligibilityPill({ v }: { v: Eligibility }) {
  const map: Record<Eligibility, string> = {
    eligible: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    ineligible: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${map[v]}`}>{v}</span>
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

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide ${className}`}>{children}</th>
}

function Segment({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{children}</div>
}

function TriToggle({ value, onChange }: { value: TriBool; onChange: (v: TriBool) => void }) {
  const opts: { v: TriBool; label: string }[] = [
    { v: 'any', label: 'Any' },
    { v: 'yes', label: 'Yes' },
    { v: 'no', label: 'No' },
    { v: 'unknown', label: 'Unknown' },
  ]
  return (
    <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      {opts.map((o, i) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-xs ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${value === o.v ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

function ChipList({ options, selected, onToggle }: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  if (options.length === 0) return <div className="text-xs text-gray-400">No options</div>
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const active = selected.includes(o.value)
        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={`px-2 py-1 rounded-full text-xs border ${active
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
          >{o.label}</button>
        )
      })}
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${className}`} />
      {label}
    </span>
  )
}
