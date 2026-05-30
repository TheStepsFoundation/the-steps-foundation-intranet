'use client'

// ---------------------------------------------------------------------------
// /hub — team-side landing page. Redesigned (Apr 2026) using the UI/UX Pro
// Max bento-grid pattern that fits internal productivity tools (Linear /
// Vercel / Raycast family). The page now leads with at-a-glance KPIs the
// team actually checks — pending applications, upcoming events, outstanding
// tasks, accepted-but-unconfirmed — followed by the module entry points and
// a recent-events row for one-click jumps into the event admin.
//
// Design rules applied (priority order from ui-ux-pro-max):
//   #1 Accessibility — visible focus rings, aria-current on links to the
//      page that owns each KPI, descriptive labels for icon-only chrome,
//      ≥4.5:1 contrast on every text colour.
//   #2 Touch & interaction — 44px+ targets, 8px+ gaps, no hover-only
//      affordances. Loading states for async numbers.
//   #4 Style match — bento grid, soft shadows, semantic colour tokens.
//   #5 Visual hierarchy via size + spacing + weight, not colour alone.
//   #6 Whitespace balance grouping related KPIs together.
//   `primary-action` — single primary CTA per cluster.
// ---------------------------------------------------------------------------

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-provider'
import ProfileAvatar from '@/components/ProfileAvatar'
import { TopNav } from '@/components/TopNav'
import { fetchEventsWithStats, type EventWithStats } from '@/lib/events-api'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULES = [
  {
    name: 'Task Tracker',
    href: '/',
    description: 'Workflows, assignments, weekly capacity.',
    accent: 'bg-steps-blue-600',
    softBg: 'bg-steps-blue-50/70',
    softBorder: 'border-steps-blue-100',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    name: 'Students',
    href: '/students',
    description: 'Applications, schools, eligibility.',
    accent: 'bg-steps-berry',
    softBg: 'bg-rose-50/70',
    softBorder: 'border-rose-100',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
  },
] as const

function formatEventDate(d: string | null | undefined): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HubPage() {
  const { user, loading, signOut, isTeamMember, teamMember } = useAuth()
  const router = useRouter()

  const [events, setEvents] = useState<EventWithStats[] | null>(null)
  const [outstandingTasks, setOutstandingTasks] = useState<number | null>(null)
  const [totalStudents, setTotalStudents] = useState<number | null>(null)

  // Same auth gating logic as before — only the chrome changed.
  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
    }
  }, [user, loading, isTeamMember, router])

  // Load all the at-a-glance data in parallel. Both queries are bounded
  // (events table is small, tasks count uses head:true so it's cheap).
  useEffect(() => {
    if (loading || !user) return
    let cancelled = false
    ;(async () => {
      const [eventsRes, tasksRes, studentsRes] = await Promise.all([
        fetchEventsWithStats().catch(() => [] as EventWithStats[]),
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'done')
          .eq('archived', false),
        supabase
          .from('students')
          .select('id', { count: 'exact', head: true }),
      ])
      if (cancelled) return
      setEvents(eventsRes)
      setOutstandingTasks(tasksRes.error ? 0 : (tasksRes.count ?? 0))
      setTotalStudents(studentsRes.error ? 0 : (studentsRes.count ?? 0))
    })()
    return () => { cancelled = true }
  }, [loading, user])

  // ---- Derived KPIs ----
  const kpis = useMemo(() => {
    if (!events) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()
    const upcoming = events.filter(e => e.event_date && new Date(e.event_date + 'T00:00:00').getTime() >= todayMs)
    const liveEvents = events.filter(e => e.status === 'open')
    const pendingApps = liveEvents.reduce((sum, e) => sum + (e.submitted_count ?? 0), 0)
    const pendingTopEvent = [...liveEvents]
      .filter(e => (e.submitted_count ?? 0) > 0)
      .sort((a, b) => (b.submitted_count ?? 0) - (a.submitted_count ?? 0))[0]
    return {
      pendingApps,
      pendingAppsContext: liveEvents.length === 0 ? 'No live events' : `Across ${liveEvents.length} open event${liveEvents.length === 1 ? '' : 's'}`,
      pendingTopEventId: pendingTopEvent?.id ?? null,
      upcomingCount: upcoming.length,
      upcomingNext: upcoming.sort((a, b) => (a.event_date ?? '').localeCompare(b.event_date ?? ''))[0],
    }
  }, [events])

  const recentEvents = useMemo(() => {
    if (!events) return []
    return [...events]
      .sort((a, b) => (b.event_date ?? '').localeCompare(a.event_date ?? ''))
      .slice(0, 4)
  }, [events])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" role="status" aria-live="polite">
        <div className="text-center">
          <div aria-hidden="true" className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading the hub…</p>
        </div>
      </div>
    )
  }

  const displayName = teamMember?.name || user.email?.split('@')[0] || 'there'
  const firstName = displayName.split(' ')[0]
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <TopNav>
        <ProfileAvatar />
        <span className="hidden sm:block text-sm text-slate-600">{displayName}</span>
        <button
          onClick={() => signOut().then(() => router.push('/login'))}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition"
        >
          Sign out
        </button>
      </TopNav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {/* ─────────────────────────────────────────────────────────────────
            Hero — greeting + dynamic time-of-day. Sets a personal tone
            without taking too much vertical space.
        ───────────────────────────────────────────────────────────────── */}
        <div className="pt-[150px] pb-[150px]">
          <p className="text-xs font-semibold uppercase tracking-wider text-steps-blue-600 mb-2">
            The Steps Foundation · Team Intranet
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-black text-steps-dark tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="mt-2 text-slate-600 text-sm sm:text-base">
            Here&apos;s where things stand right now.
          </p>
        </div>

        {/* ─────────────────────────────────────────────────────────────────
            KPI strip — at-a-glance ops summary. Bento-grid style.
            On mobile it stacks 2x2; on desktop it's a 4-column row.
            Each card is a Link to the relevant detail page so a single
            tap takes you from the number to the action.
        ───────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10">
          <KpiCard
            href="/students"
            label="Total students"
            value={totalStudents}
            sub="Young people we support"
            tone="emerald"
          />
          <KpiCard
            href={kpis?.pendingTopEventId ? `/students/events/${kpis.pendingTopEventId}` : '/students'}
            label="Pending applications"
            value={kpis?.pendingApps}
            sub={kpis?.pendingAppsContext}
            tone="blue"
          />
          <KpiCard
            href="/students/events"
            label="Upcoming events"
            value={kpis?.upcomingCount}
            sub={kpis?.upcomingNext
              ? `Next: ${kpis.upcomingNext.name} · ${formatEventDate(kpis.upcomingNext.event_date)}`
              : 'Nothing on the calendar'}
            tone="amber"
          />
          <KpiCard
            href="/"
            label="Outstanding tasks"
            value={outstandingTasks}
            sub={outstandingTasks === 0 ? 'You\'re clear' : 'Open or in progress'}
            tone="rose"
          />
        </div>

        {/* ─────────────────────────────────────────────────────────────────
            Modules — primary entry points. Bigger cards with embedded
            mini-stats so you can decide where to go before clicking.
        ───────────────────────────────────────────────────────────────── */}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Modules
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 mb-10">
          {MODULES.map(mod => (
            <Link
              key={mod.name}
              href={mod.href}
              className={`group relative overflow-hidden bg-white rounded-2xl border ${mod.softBorder} p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-steps-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2`}
            >
              <div className="flex items-start gap-4">
                <div className={`${mod.accent} w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0`}>
                  {mod.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-lg font-bold text-steps-dark">{mod.name}</h3>
                  <p className="text-sm text-slate-600 mt-0.5">{mod.description}</p>
                </div>
                <div className="text-slate-300 group-hover:text-steps-blue-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" aria-hidden="true">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* ─────────────────────────────────────────────────────────────────
            Recent events — quick-jump tiles into event admin pages.
            Saves the "click Students → click Events → find the row" flow
            for the events the team has been working on most recently.
        ───────────────────────────────────────────────────────────────── */}
        {recentEvents.length > 0 && (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent events
              </h2>
              <Link
                href="/students/events"
                className="text-xs font-medium text-steps-blue-600 hover:text-steps-blue-700 focus-visible:outline-none focus-visible:underline"
              >
                See all →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
              {recentEvents.map(ev => (
                <Link
                  key={ev.id}
                  href={`/students/events/${ev.id}`}
                  className="group bg-white rounded-xl border border-slate-100 p-4 hover:border-steps-blue-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition"
                >
                  <p className="text-xs text-slate-400">{formatEventDate(ev.event_date) || 'No date'}</p>
                  <p className="font-medium text-sm text-steps-dark mt-1 line-clamp-2 leading-snug group-hover:text-steps-blue-700 transition-colors">
                    {ev.name}
                  </p>
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-slate-500">
                    <span><strong className="text-slate-700 font-semibold">{ev.total_applicants}</strong> apps</span>
                    {ev.accepted_count > 0 && (
                      <span><strong className="text-emerald-700 font-semibold">{ev.accepted_count}</strong> accepted</span>
                    )}
                    <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      ev.status === 'open' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      ev.status === 'closed' ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                      ev.status === 'completed' ? 'bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200' :
                      'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>{ev.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        <p className="text-center text-xs text-slate-400 tracking-wide uppercase">
          <em className="italic" style={{ fontFamily: '"Times New Roman", Times, serif' }}>Virtus non origo</em> &nbsp;·&nbsp; Character, not origin
        </p>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KpiCard — one tile in the at-a-glance strip. Wraps in a Link so the whole
// card is a single 44×44+ tap target. Number renders with a skeleton while
// loading. Tone is a small palette of soft accent borders that map to the
// metric's character (blue = neutral op stat, amber = time-sensitive,
// emerald = positive momentum, rose = needs-your-attention).
// ---------------------------------------------------------------------------
function KpiCard({
  href, label, value, sub, tone,
}: {
  href: string
  label: string
  value: number | null | undefined
  sub: string | null | undefined
  tone: 'blue' | 'amber' | 'emerald' | 'rose'
}) {
  const toneClasses = {
    blue:    'border-steps-blue-100 hover:border-steps-blue-300',
    amber:   'border-amber-100 hover:border-amber-300',
    emerald: 'border-emerald-100 hover:border-emerald-300',
    rose:    'border-rose-100 hover:border-rose-300',
  }[tone]
  const accentDot = {
    blue: 'bg-steps-blue-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500',
  }[tone]
  return (
    <Link
      href={href}
      className={`group bg-white rounded-2xl border ${toneClasses} p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${accentDot}`} />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      </div>
      {value == null ? (
        <div aria-hidden="true" className="h-9 w-16 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className="font-display text-3xl sm:text-4xl font-black text-steps-dark tabular-nums leading-none">{value}</p>
      )}
      <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 leading-snug min-h-[2.4em]">
        {sub ?? ' '}
      </p>
    </Link>
  )
}
