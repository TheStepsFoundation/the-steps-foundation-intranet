'use client'

// ---------------------------------------------------------------------------
// StudentHubPreview
//
// Reusable read-only render of /my for an arbitrary profile + applications.
// Used in two places:
//   1. /students/[id] — pass in the real student's loaded profile + apps,
//      so the admin can see what THAT specific student sees.
//   2. /students — pass in a synthetic profile + simulated application
//      statuses, so the admin can sanity-check eligibility logic and
//      visibility for hypothetical year groups, school types, etc.
//
// This intentionally does NOT iframe /my. It renders a simplified mock
// of the hub layout from the data passed in — no Supabase fetches, no
// student auth, no session juggling. The trade-off is that the preview
// is a snapshot of the *current* hub UI, not a 1:1 live render — when
// /my changes meaningfully, this preview component needs a tweak too.
//
// Scope: hero + Apply now + My applications (with journey timeline) +
// Past events. Profile-edit form, withdraw modal, set-password upsell
// are intentionally omitted — they're not the kinds of things admin
// needs to debug visually.
// ---------------------------------------------------------------------------

import Link from 'next/link'
import { useMemo } from 'react'
import type { HubApplication, HubEvent } from '@/lib/hub-api'
import { isEligibleForYearGroup as isEligibleForYG } from '@/lib/eligibility'
import { getJourneyAwareLabel, normalizeStatus, type ApplicationStatusCode, type StatusHistoryRow } from '@/lib/application-status'
import { getDisplayLocation } from '@/lib/event-display'
import { stripToText } from '@/lib/sanitize-html'

export type PreviewProfile = {
  first_name: string | null
  last_name?: string | null
  personal_email?: string | null
  year_group: number | null
  school_name_raw?: string | null
  school_type: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  first_generation_uni: boolean | null
  gcse_results?: string | null
  additional_context?: string | null
}

function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

export function StudentHubPreview({ profile, applications, openEvents }: {
  profile: PreviewProfile
  applications: HubApplication[]
  openEvents: HubEvent[]
}) {
  const yg = profile.year_group
  const eligibleOpen = openEvents.filter(e => isEligibleForYG(e, yg))
  const ineligibleOpen = openEvents.filter(e => !isEligibleForYG(e, yg))

  // Sort + segment applications same way /my does.
  const todayMs = Date.now()
  const eventTime = (a: HubApplication) => a.event.event_date
    ? new Date(a.event.event_date + 'T00:00:00').getTime()
    : Number.POSITIVE_INFINITY
  const sortedApps = useMemo(() => [...applications].sort((a, b) => eventTime(b) - eventTime(a)), [applications])
  const activeApps = sortedApps.filter(a => !a.event.event_date || new Date(a.event.event_date).getTime() >= todayMs)
  const pastApps   = sortedApps.filter(a =>  a.event.event_date && new Date(a.event.event_date).getTime() <  todayMs)

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white rounded-2xl">
      {/* Sticky banner: this is a preview */}
      <div className="rounded-t-2xl bg-violet-600 text-white text-xs font-semibold px-4 py-2 text-center">
        Read-only hub preview · {profile.first_name ?? 'Student'}{yg ? ` · Year ${yg}` : ''}
      </div>

      <div className="px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero */}
        <header className="mb-6">
          <div className="inline-flex items-center gap-2 bg-steps-blue-100 text-steps-blue-700 text-xs font-semibold tracking-[0.15em] uppercase px-3 py-1 rounded-full mb-2">Student Hub</div>
          <h1 className="font-display-tight text-3xl sm:text-4xl font-black text-steps-dark">
            {profile.first_name ? `Hey, ${profile.first_name}.` : 'Welcome back.'}
          </h1>
        </header>

        {/* Next-up hero — most actionable item for this student. Same priority
            order as /my: accepted in next 14 days > closing-soon eligible
            event > nothing. */}
        {(() => {
          const upcomingAccepted = applications
            .filter(a => a.status === 'accepted' && a.event.event_date)
            .map(a => ({ a, days: daysUntil(a.event.event_date) }))
            .filter(x => x.days != null && x.days >= 0 && x.days <= 14)
            .sort((p, q) => (p.days ?? 0) - (q.days ?? 0))[0]

          const closingSoon = !upcomingAccepted ? eligibleOpen
            .filter(e => e.applications_close_at)
            .map(e => ({ e, days: daysUntil(e.applications_close_at) }))
            .filter(x => x.days != null && x.days >= 0 && x.days <= 14)
            .sort((p, q) => (p.days ?? 0) - (q.days ?? 0))[0] : null

          if (!upcomingAccepted && !closingSoon) return null
          const event = upcomingAccepted ? upcomingAccepted.a.event : closingSoon!.e
          const days = upcomingAccepted ? upcomingAccepted.days! : closingSoon!.days!
          const eyebrow = upcomingAccepted
            ? (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`)
            : (days === 0 ? 'Closes today' : days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`)
          const line = upcomingAccepted ? 'You\'re in. Tap to see joining details.' : 'Don\'t miss it — applications are open now.'
          return (
            <div className="mb-6 rounded-3xl bg-gradient-to-br from-steps-dark via-steps-blue-800 to-steps-blue-700 text-white p-5 sm:p-6 relative overflow-hidden">
              <div aria-hidden className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-steps-sunrise/30 blur-3xl pointer-events-none" />
              <div className="relative flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steps-mist font-semibold">Next up · {eyebrow}</p>
                  <h2 className="font-display-tight text-xl sm:text-2xl font-black mt-1.5">{event.name}</h2>
                  <p className="text-xs text-white/80 mt-2">{line}</p>
                </div>
                <div className="hidden sm:flex flex-col items-center justify-center bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-3 py-2 text-center min-w-[68px]">
                  <span className="text-[10px] uppercase tracking-wider text-steps-mist font-semibold">{event.event_date ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) : '—'}</span>
                  <span className="text-2xl font-display font-black text-white leading-none mt-0.5">{event.event_date ? new Date(event.event_date + 'T00:00:00').getDate() : '—'}</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Apply now */}
        {eligibleOpen.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-bold text-steps-dark mb-3">Apply now</h2>
            <div className="space-y-3">
              {eligibleOpen.map(e => (
                <PreviewEventCard key={e.id} event={e} highlight />
              ))}
            </div>
          </section>
        )}

        {/* Other upcoming (greyed) */}
        {ineligibleOpen.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-bold text-steps-dark mb-1">Other upcoming events</h2>
            <p className="text-sm text-slate-500 mb-3">Not open to this year group.</p>
            <div className="space-y-3">
              {ineligibleOpen.map(e => <PreviewEventCard key={e.id} event={e} muted />)}
            </div>
          </section>
        )}

        {/* My applications */}
        <section className="mb-8">
          <h2 className="font-display text-lg font-bold text-steps-dark mb-3">My applications</h2>
          {sortedApps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
              <p className="text-sm text-slate-600">No applications yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {activeApps.length > 0 && (
                <div>
                  {pastApps.length > 0 && (
                    <h3 className="font-display text-xs font-bold text-steps-dark uppercase tracking-wider mb-2">Current &amp; upcoming</h3>
                  )}
                  <div className="space-y-3">
                    {activeApps.map(a => <PreviewAppCard key={a.id} app={a} />)}
                  </div>
                </div>
              )}
              {pastApps.length > 0 && (
                <div>
                  <h3 className="font-display text-xs font-bold text-steps-dark uppercase tracking-wider mb-2">Past events</h3>
                  <div className="space-y-3">
                    {pastApps.map(a => <PreviewAppCard key={a.id} app={a} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* My details — mock of the read-only mode of /my My details card */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-bold text-steps-dark">My details</h2>
            <span className="text-xs text-slate-400">read-only preview</span>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <DetailRow label="Name" value={[profile.first_name, profile.last_name].filter(Boolean).join(' ') || '—'} />
              <DetailRow label="Email" value={profile.personal_email ?? '—'} />
              <DetailRow label="Year group" value={profile.year_group ? (profile.year_group === 14 ? 'Gap year' : `Year ${profile.year_group}`) : '—'} />
              <DetailRow label="School" value={profile.school_name_raw ?? '—'} className="col-span-1" />
              <DetailRow label="School type" value={schoolTypeLabel(profile.school_type)} />
              <DetailRow label="Free school meals" value={profile.free_school_meals === true ? 'Yes' : profile.free_school_meals === false ? 'No' : '—'} />
              <DetailRow label="Household income" value={incomeBandLabel(profile.parental_income_band)} />
              <DetailRow label="First-gen university" value={profile.first_generation_uni === true ? 'No' : profile.first_generation_uni === false ? 'Yes' : '—'} />
              {profile.gcse_results && <DetailRow label="GCSE results" value={profile.gcse_results} className="col-span-2" />}
              {profile.additional_context && <DetailRow label="Additional context" value={profile.additional_context} className="col-span-2" />}
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}

function DetailRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5 truncate">{value}</dd>
    </div>
  )
}

function schoolTypeLabel(t: string | null): string {
  if (!t) return '—'
  const map: Record<string, string> = {
    state: 'State non-selective',
    grammar: 'State selective / grammar',
    independent: 'Independent (fee-paying)',
    independent_bursary: 'Independent with 90%+ bursary',
  }
  return map[t] ?? t
}

function incomeBandLabel(b: string | null | undefined): string {
  if (!b) return '—'
  const map: Record<string, string> = {
    under_40k: 'Yes — under £40k',
    over_40k: 'No — £40k or more',
    prefer_na: 'Prefer not to say',
  }
  return map[b] ?? b
}

// ---------------------------------------------------------------------------

function PreviewEventCard({ event, highlight, muted }: { event: HubEvent; highlight?: boolean; muted?: boolean }) {
  const closeDays = daysUntil(event.applications_close_at)
  const closingSoon = closeDays !== null && closeDays <= 7
  return (
    <div className={`relative bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${muted ? 'opacity-60' : ''}`}>
      <div className="flex items-stretch min-h-[140px]">
        <div className="flex-1 min-w-0 p-4 flex flex-col">
          <h3 className="font-display text-base sm:text-lg font-bold text-steps-dark">{event.name}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
            {event.event_date && <span>{formatDate(event.event_date)}</span>}
            {event.time_start && <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>}
            {event.location && <span>{getDisplayLocation(event, false)}</span>}
          </div>
          {event.description && (
            <p className="text-xs text-slate-500 mt-2 line-clamp-2">{stripToText(event.description)}</p>
          )}
          <div className="mt-auto pt-3 flex items-center justify-between gap-2 flex-wrap">
            {event.applications_close_at ? (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${closingSoon ? 'bg-steps-berry/10 text-steps-berry' : 'bg-steps-blue-50 text-steps-blue-700'}`}>
                {closeDays === 0 ? 'Closes today' : closeDays === 1 ? 'Closes tomorrow' : closeDays !== null && closeDays > 0 ? `Closes in ${closeDays} days` : 'Closed'}
              </span>
            ) : <span />}
            {highlight && <span className="text-xs font-semibold text-steps-blue-700">View &amp; apply →</span>}
          </div>
        </div>
        {event.hub_image_url && (
          <div className="flex-shrink-0 w-24 sm:w-44 self-stretch bg-slate-100 relative border-l border-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.hub_image_url} alt="" className={`absolute inset-0 w-full h-full object-cover ${muted ? 'grayscale' : ''}`}
              style={{ objectPosition: `${event.hub_focal_x ?? 50}% ${event.hub_focal_y ?? 50}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

// Inline mini-version of the JourneyTimeline used on /my. Same tone semantics.
function PreviewJourneyTimeline({ status, history, eventDate }: {
  status: string
  history: StatusHistoryRow[]
  eventDate: string | null
}) {
  const code: ApplicationStatusCode | null = normalizeStatus(status)
  if (!code) return null
  const isPast = !!(eventDate && new Date(eventDate) < new Date())
  type Tone = 'accepted' | 'waitlist' | 'shortlisted' | 'pending' | 'neutral'
  const TONE_BAR: Record<Tone, string> = {
    accepted:    'bg-emerald-500',
    waitlist:    'bg-steps-sunrise',
    shortlisted: 'bg-violet-500',
    pending:     'bg-steps-blue-600',
    neutral:     'bg-slate-400',
  }
  let tone: Tone = 'pending'
  let fill = 15
  if (code === 'accepted') { tone = 'accepted'; fill = 100 }
  else if (code === 'rejected') {
    const everShortlisted = history?.some(h => normalizeStatus(h.status) === 'shortlisted')
    const everWaitlisted = history?.some(h => normalizeStatus(h.status) === 'waitlist')
    if (everShortlisted) { tone = 'shortlisted'; fill = 50 }
    else if (everWaitlisted) { tone = 'waitlist'; fill = 75 }
    else { tone = 'neutral'; fill = 30 }
  }
  else if (code === 'waitlist') { tone = 'waitlist'; fill = 75; void isPast }
  else if (code === 'shortlisted') { tone = 'shortlisted'; fill = 50 }
  else if (code === 'withdrew') { tone = 'neutral'; fill = 50 }
  else if (code === 'ineligible') { tone = 'neutral'; fill = 30 }

  return (
    <div className="mt-2">
      <div className="block h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  )
}

function PreviewAppCard({ app }: { app: HubApplication }) {
  const journey = getJourneyAwareLabel(app.status, app.status_history, app.event.event_date)
  const isPast = app.event.event_date && new Date(app.event.event_date) < new Date()
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="flex items-stretch min-h-[140px]">
        <div className="flex-1 min-w-0 p-4 flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-base font-bold text-steps-dark">{app.event.name}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${journey.badgeClasses}`}>
              {journey.prefix && <span className="opacity-70 mr-1">{journey.prefix} ·</span>}
              {journey.primary}
            </span>
            {isPast && <span className="text-[10px] font-medium text-slate-500">Past event</span>}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {app.event.event_date && formatDate(app.event.event_date)}
          </div>
          <PreviewJourneyTimeline status={app.status} history={app.status_history} eventDate={app.event.event_date} />
          <p className="text-[10px] text-slate-400 mt-auto pt-2">
            Applied {new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        {app.event.hub_image_url && (
          <div className="flex-shrink-0 w-24 sm:w-44 self-stretch bg-slate-100 relative border-l border-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={app.event.hub_image_url} alt="" className={`absolute inset-0 w-full h-full object-cover ${isPast ? 'grayscale' : ''}`}
              style={{ objectPosition: `${app.event.hub_focal_x ?? 50}% ${app.event.hub_focal_y ?? 50}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

export default StudentHubPreview
