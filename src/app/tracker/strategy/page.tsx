'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-provider'
import { useData } from '@/lib/data-provider'
import {
  fetchPlans,
  fetchPillars,
  createPlan,
  updatePlan,
  setPlanStatus,
  setPlanArchived,
  deletePlan,
  addMilestone,
  toggleMilestone,
  deleteMilestone,
  STATUS_META,
  STATUS_ORDER,
  HORIZON_META,
  type StrategicPlan,
  type StrategicPillar,
  type PlanStatus,
  type PlanHorizon,
  type PlanInput,
} from '@/lib/strategy-api'

const HORIZONS: PlanHorizon[] = ['1_year', '3_year', '5_year', 'ongoing']

function formatDate(d: string | null): string {
  if (!d) return ''
  const date = new Date(d + 'T00:00:00')
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function targetCountdown(target: string | null): { label: string; tone: string } | null {
  if (!target) return null
  const t = new Date(target + 'T00:00:00')
  if (isNaN(t.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((t.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'text-red-600 dark:text-red-400' }
  if (days === 0) return { label: 'Due today', tone: 'text-amber-600 dark:text-amber-400' }
  if (days <= 90) return { label: `${days}d left`, tone: 'text-amber-600 dark:text-amber-400' }
  return { label: formatDate(target), tone: 'text-gray-500 dark:text-gray-400' }
}

function OwnerAvatar({ initials, name }: { initials: string; name: string }) {
  return (
    <span
      title={name}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/40 dark:text-steps-blue-200 text-[11px] font-semibold ring-1 ring-steps-blue-200 dark:ring-steps-blue-800"
    >
      {initials}
    </span>
  )
}

export default function StrategyPage() {
  const { user, loading: authLoading, signOut, teamMember } = useAuth()
  const { teamMembers, workflows, tasks, isDemo } = useData()
  const router = useRouter()

  const [plans, setPlans] = useState<StrategicPlan[]>([])
  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [pillarFilter, setPillarFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [showArchived, setShowArchived] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<StrategicPlan | null>(null)

  // Auth guard — once `user` is set we trust it (matches /students layout).
  useEffect(() => {
    if (authLoading) return
    if (!user) router.push('/login')
  }, [user, authLoading, router])

  const reload = useCallback(async () => {
    try {
      const [p, pl] = await Promise.all([fetchPlans(), fetchPillars()])
      setPlans(p)
      setPillars(pl)
      setLoadError(null)
    } catch (err: any) {
      console.error('Failed to load strategic plans:', err)
      setLoadError(err?.message || 'Failed to load strategic plans.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isDemo) {
      setLoading(false)
      return
    }
    if (!user) return
    reload()
  }, [user, isDemo, reload])

  const memberById = useMemo(() => {
    const m: Record<number, { name: string; avatar: string }> = {}
    for (const tm of teamMembers) m[tm.id] = { name: tm.name, avatar: tm.avatar }
    return m
  }, [teamMembers])

  const pillarByCode = useMemo(() => {
    const m: Record<string, StrategicPillar> = {}
    for (const p of pillars) m[p.code] = p
    return m
  }, [pillars])

  const workflowById = useMemo(() => {
    const m: Record<string, { name: string; color: string }> = {}
    for (const w of workflows) m[w.id] = { name: w.name, color: w.color }
    return m
  }, [workflows])

  const openTaskCountByWorkflow = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tasks) {
      if (!t.workflow || t.archived || t.status === 'done') continue
      m[t.workflow] = (m[t.workflow] || 0) + 1
    }
    return m
  }, [tasks])

  const visiblePlans = useMemo(() => {
    return plans.filter((p) => {
      if (!showArchived && p.archived) return false
      if (showArchived && !p.archived) return false
      if (pillarFilter !== 'all' && p.pillar !== pillarFilter) return false
      if (statusFilter === 'active' && p.status === 'achieved') return false
      if (statusFilter !== 'all' && statusFilter !== 'active' && p.status !== statusFilter) return false
      return true
    })
  }, [plans, showArchived, pillarFilter, statusFilter])

  // Group visible plans by pillar (preserving pillar sort order; "Uncategorised" last)
  const grouped = useMemo(() => {
    const groups: { key: string; label: string; color: string; plans: StrategicPlan[] }[] = []
    const order = [...pillars].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const pl of order) {
      const ps = visiblePlans.filter((p) => p.pillar === pl.code)
      if (ps.length) groups.push({ key: pl.code, label: pl.label, color: pl.color, plans: ps })
    }
    const uncategorised = visiblePlans.filter((p) => !p.pillar || !pillarByCode[p.pillar])
    if (uncategorised.length)
      groups.push({ key: '__none', label: 'Uncategorised', color: 'bg-gray-400', plans: uncategorised })
    return groups
  }, [visiblePlans, pillars, pillarByCode])

  const stats = useMemo(() => {
    const live = plans.filter((p) => !p.archived)
    const count = (s: PlanStatus) => live.filter((p) => p.status === s).length
    return {
      total: live.length,
      on_track: count('on_track'),
      at_risk: count('at_risk'),
      off_track: count('off_track'),
      achieved: count('achieved'),
    }
  }, [plans])

  const handleSave = async (input: PlanInput) => {
    if (editingPlan) {
      await updatePlan(editingPlan.id, input)
    } else {
      await createPlan(input, user?.email || null)
    }
    setModalOpen(false)
    setEditingPlan(null)
    await reload()
  }

  const handleStatusChange = async (plan: StrategicPlan, status: PlanStatus) => {
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, status } : p)))
    try {
      await setPlanStatus(plan.id, status)
    } catch (e) {
      await reload()
    }
  }

  const handleArchive = async (plan: StrategicPlan) => {
    await setPlanArchived(plan.id, !plan.archived)
    await reload()
  }

  const handleDelete = async (plan: StrategicPlan) => {
    if (!confirm(`Delete the strategic plan "${plan.title}"? This also removes its milestones and cannot be undone.`)) return
    await deletePlan(plan.id)
    await reload()
  }

  const handleAddMilestone = async (plan: StrategicPlan, title: string, dueDate: string | null) => {
    await addMilestone(plan.id, title, dueDate, plan.milestones.length)
    await reload()
  }

  const handleToggleMilestone = async (plan: StrategicPlan, id: string, completed: boolean) => {
    setPlans((prev) =>
      prev.map((p) =>
        p.id === plan.id
          ? { ...p, milestones: p.milestones.map((m) => (m.id === id ? { ...m, completed } : m)) }
          : p,
      ),
    )
    try {
      await toggleMilestone(id, completed)
    } catch {
      await reload()
    }
  }

  const handleDeleteMilestone = async (id: string) => {
    await deleteMilestone(id)
    await reload()
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-500 dark:text-gray-400">Loading…</div>
      </div>
    )
  }

  const displayName = teamMember?.name || user.email?.split('@')[0] || 'Unknown'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Nav Header — matches Task Tracker / Students */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/hub" aria-label="Steps Foundation — Hub" className="inline-flex items-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue focus-visible:ring-offset-2">
              <img src="/tsf-logo-dark.png" alt="The Steps Foundation" className="h-10 w-auto dark:hidden" />
              <img src="/tsf-logo-white.png" alt="The Steps Foundation" className="h-10 w-auto hidden dark:block" />
            </Link>
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-steps-blue-50 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-300">
              Strategy
            </span>
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <Link href="/hub" className="px-3 py-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Hub</Link>
              <NavDropdown label="Task Tracker" active items={[
                { href: '/tracker', label: 'Task Tracker' },
                { href: '/tracker/strategy', label: 'Strategy' },
              ]} />
              <NavDropdown label="Students" items={[
                { href: '/students', label: 'Dashboard' },
                { href: '/students/events', label: 'Events' },
              ]} />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400">{displayName}</span>
            <button
              onClick={() => signOut().then(() => router.push('/login'))}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        {/* Page heading */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase text-steps-blue-600 dark:text-steps-blue-400 font-medium italic">Virtus non origo</p>
            <h1 className="text-2xl font-display font-bold text-gray-900 dark:text-white">Long-Term Strategic Plans</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Where Steps is heading — owned, time-boxed, and tracked against milestones.</p>
          </div>
          <button
            onClick={() => { setEditingPlan(null); setModalOpen(true) }}
            className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition flex items-center gap-1.5 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New plan
          </button>
        </div>

        {isDemo && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-sm">
            <strong>Demo mode:</strong> connect Supabase to create and save strategic plans.
          </div>
        )}
        {loadError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
            {loadError}
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mb-5">
          <StatCard label="Active plans" value={stats.total} dot="bg-steps-blue-500" />
          <StatCard label="On track" value={stats.on_track} dot={STATUS_META.on_track.dot} />
          <StatCard label="At risk" value={stats.at_risk} dot={STATUS_META.at_risk.dot} />
          <StatCard label="Off track" value={stats.off_track} dot={STATUS_META.off_track.dot} />
          <StatCard label="Achieved" value={stats.achieved} dot={STATUS_META.achieved.dot} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <select
            value={pillarFilter}
            onChange={(e) => setPillarFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-steps-blue-500 outline-none"
          >
            <option value="all">All pillars</option>
            {pillars.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-steps-blue-500 outline-none"
          >
            <option value="active">Active (excl. achieved)</option>
            <option value="all">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none ml-1">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-gray-300 text-steps-blue-600 focus:ring-steps-blue-500" />
            Archived
          </label>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-steps-blue-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">Loading strategic plans…</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-gray-700 dark:text-gray-300 font-medium">No strategic plans {showArchived ? 'archived' : 'yet'}.</p>
            {!showArchived && (
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Click <span className="font-medium">New plan</span> to set out where Steps is heading.</p>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <section key={group.key}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${group.color}`} />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">{group.label}</h2>
                  <span className="text-xs text-gray-400">{group.plans.length}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {group.plans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      owner={plan.ownerId != null ? memberById[plan.ownerId] : undefined}
                      pillar={plan.pillar ? pillarByCode[plan.pillar] : undefined}
                      workflow={plan.workflowId ? workflowById[plan.workflowId] : undefined}
                      relatedTasks={plan.workflowId ? openTaskCountByWorkflow[plan.workflowId] || 0 : 0}
                      expanded={!!expanded[plan.id]}
                      onToggleExpand={() => setExpanded((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                      onEdit={() => { setEditingPlan(plan); setModalOpen(true) }}
                      onArchive={() => handleArchive(plan)}
                      onDelete={() => handleDelete(plan)}
                      onStatusChange={(s) => handleStatusChange(plan, s)}
                      onAddMilestone={(t, d) => handleAddMilestone(plan, t, d)}
                      onToggleMilestone={(id, c) => handleToggleMilestone(plan, id, c)}
                      onDeleteMilestone={handleDeleteMilestone}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {modalOpen && (
        <PlanModal
          plan={editingPlan}
          pillars={pillars}
          teamMembers={teamMembers}
          workflows={workflows.filter((w) => !w.archived)}
          onClose={() => { setModalOpen(false); setEditingPlan(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{value}</div>
    </div>
  )
}

function PlanCard({
  plan, owner, pillar, workflow, relatedTasks, expanded,
  onToggleExpand, onEdit, onArchive, onDelete, onStatusChange,
  onAddMilestone, onToggleMilestone, onDeleteMilestone,
}: {
  plan: StrategicPlan
  owner?: { name: string; avatar: string }
  pillar?: StrategicPillar
  workflow?: { name: string; color: string }
  relatedTasks: number
  expanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  onStatusChange: (s: PlanStatus) => void
  onAddMilestone: (title: string, dueDate: string | null) => void
  onToggleMilestone: (id: string, completed: boolean) => void
  onDeleteMilestone: (id: string) => void
}) {
  const [newMilestone, setNewMilestone] = useState('')
  const [newDue, setNewDue] = useState('')
  const doneCount = plan.milestones.filter((m) => m.completed).length
  const countdown = targetCountdown(plan.targetDate)
  const sm = STATUS_META[plan.status]

  return (
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3 ${plan.archived ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white leading-snug">{plan.title}</h3>
          {plan.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{plan.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} title="Edit" className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={onArchive} title={plan.archived ? 'Unarchive' : 'Archive'} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
          </button>
          <button onClick={onDelete} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pillar && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-white ${pillar.color}`}>{pillar.label}</span>}
        {plan.horizon && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{HORIZON_META[plan.horizon]}</span>}
        {countdown && <span className={`inline-flex items-center gap-1 ${countdown.tone}`}><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>{countdown.label}</span>}
        {owner && <span className="inline-flex items-center gap-1.5 ml-auto"><OwnerAvatar initials={owner.avatar} name={owner.name} /></span>}
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>Progress</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{plan.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full ${sm.dot} transition-all`} style={{ width: `${plan.progress}%` }} />
        </div>
      </div>

      {/* Status + milestone toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="relative">
          <select
            value={plan.status}
            onChange={(e) => onStatusChange(e.target.value as PlanStatus)}
            className={`appearance-none cursor-pointer pl-2.5 pr-7 py-1 rounded-full text-xs font-medium border-0 outline-none focus:ring-2 focus:ring-steps-blue-400 ${sm.badge}`}
          >
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <svg className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
        <button onClick={onToggleExpand} className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          {doneCount}/{plan.milestones.length} milestones
        </button>
      </div>

      {/* Workflow link */}
      {workflow && (
        <Link href="/tracker" className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-steps-blue-600 dark:hover:text-steps-blue-300">
          <span className={`inline-block w-2 h-2 rounded-full ${workflow.color}`} />
          {workflow.name}
          <span className="text-gray-400">· {relatedTasks} open task{relatedTasks === 1 ? '' : 's'}</span>
        </Link>
      )}

      {/* Expanded milestones */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1.5">
          {plan.milestones.length === 0 && (
            <p className="text-xs text-gray-400">No milestones yet.</p>
          )}
          {plan.milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-2 group">
              <input
                type="checkbox"
                checked={m.completed}
                onChange={(e) => onToggleMilestone(m.id, e.target.checked)}
                className="rounded border-gray-300 text-steps-blue-600 focus:ring-steps-blue-500 cursor-pointer"
              />
              <span className={`text-sm flex-1 ${m.completed ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>{m.title}</span>
              {m.dueDate && <span className="text-[11px] text-gray-400">{formatDate(m.dueDate)}</span>}
              <button onClick={() => onDeleteMilestone(m.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition" title="Remove milestone">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newMilestone}
              onChange={(e) => setNewMilestone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newMilestone.trim()) { onAddMilestone(newMilestone, newDue || null); setNewMilestone(''); setNewDue('') } }}
              placeholder="Add a milestone…"
              className="flex-1 px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-steps-blue-500 outline-none"
            />
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-steps-blue-500 outline-none"
            />
            <button
              onClick={() => { if (newMilestone.trim()) { onAddMilestone(newMilestone, newDue || null); setNewMilestone(''); setNewDue('') } }}
              className="px-2.5 py-1.5 bg-steps-blue-600 text-white text-sm rounded-md hover:bg-steps-blue-700 disabled:opacity-50"
              disabled={!newMilestone.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanModal({
  plan, pillars, teamMembers, workflows, onClose, onSave,
}: {
  plan: StrategicPlan | null
  pillars: StrategicPillar[]
  teamMembers: { id: number; name: string; avatar: string }[]
  workflows: { id: string; name: string }[]
  onClose: () => void
  onSave: (input: PlanInput) => Promise<void>
}) {
  const [title, setTitle] = useState(plan?.title || '')
  const [description, setDescription] = useState(plan?.description || '')
  const [ownerId, setOwnerId] = useState<string>(plan?.ownerId != null ? String(plan.ownerId) : '')
  const [pillar, setPillar] = useState<string>(plan?.pillar || '')
  const [horizon, setHorizon] = useState<string>(plan?.horizon || '')
  const [startDate, setStartDate] = useState(plan?.startDate || '')
  const [targetDate, setTargetDate] = useState(plan?.targetDate || '')
  const [status, setStatus] = useState<PlanStatus>(plan?.status || 'not_started')
  const [progress, setProgress] = useState<number>(plan?.progress ?? 0)
  const [workflowId, setWorkflowId] = useState<string>(plan?.workflowId || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) { setErr('Give the plan a title.'); return }
    setSaving(true)
    setErr(null)
    try {
      await onSave({
        title,
        description,
        ownerId: ownerId ? Number(ownerId) : null,
        pillar: pillar || null,
        horizon: (horizon || null) as PlanHorizon | null,
        startDate: startDate || null,
        targetDate: targetDate || null,
        status,
        progress,
        workflowId: workflowId || null,
      })
    } catch (e: any) {
      setErr(e?.message || 'Could not save. Check you have admin access.')
      setSaving(false)
    }
  }

  const field = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-steps-blue-500 outline-none'
  const label = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 rounded-t-xl">
          <h2 className="font-semibold text-gray-900 dark:text-white">{plan ? 'Edit strategic plan' : 'New strategic plan'}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={label}>Title</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reach 1,000 students supported by 2028" className={field} />
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What does success look like, and why does it matter?" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Owner</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
                <option value="">Unassigned</option>
                {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Pillar</label>
              <select value={pillar} onChange={(e) => setPillar(e.target.value)} className={field}>
                <option value="">Uncategorised</option>
                {pillars.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Horizon</label>
              <select value={horizon} onChange={(e) => setHorizon(e.target.value)} className={field}>
                <option value="">—</option>
                {HORIZONS.map((h) => <option key={h} value={h}>{HORIZON_META[h]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Start</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Target</label>
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} className={field}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Progress — {progress}%</label>
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-steps-blue-600 mt-2.5" />
            </div>
          </div>
          <div>
            <label className={label}>Linked workflow <span className="text-gray-400 font-normal">(surfaces related tracker tasks)</span></label>
            <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} className={field}>
              <option value="">None</option>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-800 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-steps-blue-600 text-white font-medium hover:bg-steps-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
          </button>
        </div>
      </div>
    </div>
  )
}


function NavDropdown({ label, active = false, items }: {
  label: string
  active?: boolean
  items: { href: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1.5 rounded-md flex items-center gap-1 ${active ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
      >
        {label}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-40 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-50">
          {items.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="block px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">{item.label}</a>
          ))}
        </div>
      )}
    </div>
  )
}
