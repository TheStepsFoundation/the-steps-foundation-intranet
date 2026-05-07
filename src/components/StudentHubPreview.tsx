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
  year_group: number | null
  school_type: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  first_generation_uni: boolean | null
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
      </div>
    </div>
  )
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
      <div className="p-4">
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
      </div>
    </div>
  )
}

export default StudentHubPreview
