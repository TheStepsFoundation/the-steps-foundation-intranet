'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import {
  fetchEventOverview, signOut, withdrawApplication,
  type EventOverview,
} from '@/lib/hub-api'
import { clearAllDrafts } from '@/lib/apply-draft'
import { getJourneyAwareLabel } from '@/lib/application-status'
import { getDisplayLocation, canSeeFullAddress } from '@/lib/event-display'
import { sanitizeRichHtml, stripToText } from '@/lib/sanitize-html'
import { formatOpenTo } from '@/lib/events-api'
import { isEligibleForYearGroup } from '@/lib/eligibility'
import { supabase } from '@/lib/supabase-student'
import { supabase as adminSupabase } from '@/lib/supabase'
import QRCode from 'qrcode'

// ---------------------------------------------------------------------------
// /my/events/[id] — student-side event detail.
//
// Wave 1 redesign (Apr 2026):
//  - Editorial banner hero: image bleeds into a steps-dark overlay carrying
//    the title, status pill, date, and a small countdown chip.
//  - Side rail "key info" replaces the inline grid — quicker to scan.
//  - Sticky bottom action bar on mobile (Apply / Edit / Withdraw) so the
//    primary CTA isn't hidden below the fold for first-gen students on
//    smaller phones.
//  - Application answers card uses the same Field grid as before but with
//    refined typography and lighter dividers.
//  - Loading and not-found states match the new visual language.
//
// Underlying data fetch + state machine (load, confirmWithdraw, etc.) and
// the CheckinQrCard component are preserved verbatim.
// ---------------------------------------------------------------------------

function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formConfigCustomFields(formConfig: Record<string, unknown> | null | undefined): Array<{ id: string; label: string; type: string }> {
  if (!formConfig) return []
  const fc = formConfig as { fields?: unknown; custom_fields?: unknown }
  const arr = Array.isArray(fc.fields)
    ? fc.fields
    : Array.isArray(fc.custom_fields) ? fc.custom_fields : []
  return arr.filter((f): f is { id: string; label: string; type: string } =>
    !!f && typeof f === 'object' && 'id' in (f as object) && 'label' in (f as object) && 'type' in (f as object))
}

const QUAL_TYPE_LABEL: Record<string, string> = {
  a_level: 'A-Level',
  ib: 'IB',
  pre_u: 'Pre-U',
  btec: 'BTEC',
  scottish: 'Scottish Higher',
  other: 'Other',
}

type QualEntry = { qualType: string; subject: string; level?: string | null; grade: string }

function isQualEntry(v: unknown): v is QualEntry {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.qualType === 'string' &&
    typeof o.subject === 'string' &&
    typeof o.grade === 'string'
  )
}

function formatQualEntry(q: QualEntry): string {
  const typeLabel = q.qualType ? (QUAL_TYPE_LABEL[q.qualType] ?? q.qualType.replace(/_/g, ' ')) : ''
  const level = q.level ? ` ${q.level}` : ''
  const subject = q.subject || ''
  const grade = q.grade || ''
  const left = [typeLabel + level, subject].filter(Boolean).join(' ')
  if (!left) return ''
  if (!grade) return left
  return `${left} — ${grade}`
}

function stringifyAnswer(val: unknown): string {
  if (val == null) return '—'
  if (Array.isArray(val)) {
    if (val.length === 0) return '—'
    const parts = val.map(item => {
      if (item == null) return ''
      if (typeof item === 'object') {
        const o = item as Record<string, unknown>
        return typeof o.value === 'string' ? o.value : JSON.stringify(o)
      }
      return String(item)
    }).filter(Boolean)
    return parts.length ? parts.join(', ') : '—'
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    if (typeof o.value === 'string') return o.value
    return JSON.stringify(o)
  }
  const str = String(val).trim()
  return str.length ? str : '—'
}

const YES_NO_NA_LABEL: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'Prefer not to say',
}

const INCOME_BAND_TO_RAW: Record<string, string> = {
  under_40k: 'yes',
  over_40k: 'no',
  prefer_na: 'na',
}

function formatYesNoAnswer(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  const s = String(val).trim().toLowerCase()
  if (!s) return null
  return YES_NO_NA_LABEL[s] ?? String(val)
}

function isEmptyAnswer(val: unknown): boolean {
  if (val == null) return true
  if (typeof val === 'string') return val.trim().length === 0
  if (Array.isArray(val)) return val.length === 0
  if (typeof val === 'object') return Object.keys(val as object).length === 0
  return false
}

interface FallbackFieldProps {
  label: string
  appValue: unknown
  profileValue: string | null
  format?: (val: unknown) => string
  className?: string
}

function FallbackField({ label, appValue, profileValue, format, className }: FallbackFieldProps) {
  const appIsEmpty = isEmptyAnswer(appValue)
  if (!appIsEmpty) {
    return <Field label={label} className={className}>{(format ?? stringifyAnswer)(appValue)}</Field>
  }
  if (profileValue) {
    return (
      <Field label={label} className={className}>
        {profileValue}
        <span className="text-xs text-slate-400 ml-2">(from profile)</span>
      </Field>
    )
  }
  return <Field label={label} className={className}>—</Field>
}

function renderQualifications(val: unknown): React.ReactNode {
  if (!Array.isArray(val) || val.length === 0) return '—'
  const entries = val.filter(isQualEntry).map(formatQualEntry).filter(Boolean)
  if (entries.length === 0) return '—'
  return (
    <ul className="list-disc pl-5 space-y-0.5">
      {entries.map((e, i) => <li key={i}>{e}</li>)}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function EventOverviewPageInner({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const searchParams = useSearchParams()
  const adminPreviewParam = searchParams?.get('_admin_preview') ?? null
  const adminPreviewPayload = searchParams?.get('_payload') ?? null
  const adminPreviewKey = searchParams?.get('_key') ?? null
  const adminPreviewMode: 'real' | 'synthetic' | null =
    adminPreviewParam === 'synthetic' ? 'synthetic' : adminPreviewParam ? 'real' : null

  // Carry the admin-preview state through any internal nav so card clicks /
  // back link inside the iframe stay in preview mode.
  const previewQuerystring = adminPreviewMode === 'synthetic'
    ? (adminPreviewKey
        ? `?_admin_preview=synthetic&_key=${encodeURIComponent(adminPreviewKey)}`
        : adminPreviewPayload
        ? `?_admin_preview=synthetic&_payload=${encodeURIComponent(adminPreviewPayload)}`
        : '?_admin_preview=synthetic')
    : adminPreviewMode === 'real' && adminPreviewParam
    ? `?_admin_preview=${adminPreviewParam}`
    : ''

  const [overview, setOverview] = useState<EventOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Admin-preview short-circuit: bypass student auth, build the
      // EventOverview shape from the admin API or the synthetic payload.
      if (adminPreviewMode) {
        const { data: { session } } = await adminSupabase.auth.getSession()
        const adminToken = session?.access_token
        if (!adminToken) { setErr('Sign in as a team member to use admin preview.'); return }

        if (adminPreviewMode === 'synthetic' && (adminPreviewKey || adminPreviewPayload)) {
          let decoded: {
            profile?: Record<string, unknown>
            applications?: Array<{ id: string; event_id: string; status: string; created_at: string; event: Record<string, unknown>; status_history: Array<{ status: string; changed_at: string }> }>
            openEvents?: Array<Record<string, unknown>>
          } = {}
          if (adminPreviewKey) {
            const raw = typeof window !== 'undefined' ? localStorage.getItem(adminPreviewKey) : null
            if (raw) decoded = JSON.parse(raw)
          } else if (adminPreviewPayload) {
            try { decoded = JSON.parse(atob(adminPreviewPayload)) }
            catch { try { decoded = JSON.parse(decodeURIComponent(adminPreviewPayload)) } catch {} }
          }
          decoded.applications = decoded.applications ?? []
          decoded.openEvents = decoded.openEvents ?? []
          const matchedApp = decoded.applications.find(a => a.event_id === id)
          const matchedEvent = matchedApp?.event ?? decoded.openEvents.find(e => (e as { id?: string }).id === id)
          if (!matchedEvent) { setErr('Event not in synthetic payload'); return }
          setOverview({
            event: matchedEvent as EventOverview['event'],
            application: matchedApp ? ({
              id: matchedApp.id,
              event_id: matchedApp.event_id,
              status: matchedApp.status,
              created_at: matchedApp.created_at,
              updated_at: null,
              raw_response: null,
              status_history: matchedApp.status_history,
            } as unknown as EventOverview['application']) : null,
            profile: decoded.profile as unknown as EventOverview['profile'],
          })
          return
        }

        // Real-student preview — reuse the same /api/admin/preview-student-data
        // endpoint and find the matching event/application in its response.
        const r = await fetch(`/api/admin/preview-student-data?student_id=${encodeURIComponent(adminPreviewParam!)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        const d = await r.json()
        if (!r.ok) { setErr(d?.error ?? 'Failed to load preview'); return }
        const matchedApp = (d.applications as Array<{ id: string; event_id: string; status: string; created_at: string; event: Record<string, unknown>; status_history: Array<{ status: string; changed_at: string }> }>).find(a => a.event_id === id)
        const matchedEvent = matchedApp?.event ?? (d.openEvents as Array<Record<string, unknown>>).find((e) => e.id === id)
        if (!matchedEvent) { setErr('Event not visible to this student'); return }
        setOverview({
          event: matchedEvent as EventOverview['event'],
          application: matchedApp ? ({
            id: matchedApp.id,
            event_id: matchedApp.event_id,
            status: matchedApp.status,
            created_at: matchedApp.created_at,
            updated_at: null,
            raw_response: null,
            status_history: matchedApp.status_history,
          } as unknown as EventOverview['application']) : null,
          profile: d.profile as unknown as EventOverview['profile'],
        })
        return
      }

      const data = await fetchEventOverview(id)
      setOverview(data)
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }, [id, adminPreviewMode, adminPreviewParam, adminPreviewPayload])

  useEffect(() => { load() }, [load])

  const handleSignOut = async () => { clearAllDrafts(); await signOut(); router.push('/my/sign-in') }

  const confirmWithdraw = async () => {
    if (!overview?.application) return
    setWithdrawing(true)
    setWithdrawErr(null)
    const { error } = await withdrawApplication(overview.application.id)
    setWithdrawing(false)
    if (error) { setWithdrawErr(error); return }
    setShowWithdrawModal(false)
    await load()
  }

  const renderTopNav = () => (
    <TopNav variant="light" homeHref={adminPreviewMode ? `/my${previewQuerystring}` : "/my"}>
      <button
        onClick={handleSignOut}
        className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
      >
        Sign out
      </button>
    </TopNav>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        {renderTopNav()}
      {adminPreviewMode && (
        <div className="bg-violet-600 text-white text-xs font-semibold px-4 py-1.5 text-center">
          Admin preview · Read-only · Apply opens test mode
        </div>
      )}
        <div role="status" aria-live="polite" aria-label="Loading event details" className="max-w-4xl mx-auto px-4 sm:px-6 py-16 flex flex-col items-center gap-3">
          <div aria-hidden="true" className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full" />
          <p className="text-sm text-slate-500">Loading event details…</p>
        </div>
      </div>
    )
  }

  if (err || !overview?.event) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        {renderTopNav()}
      {adminPreviewMode && (
        <div className="bg-violet-600 text-white text-xs font-semibold px-4 py-1.5 text-center">
          Admin preview · Read-only · Apply opens test mode
        </div>
      )}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center animate-tsf-fade-up">
          <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-4" aria-hidden>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="font-display text-xl font-bold text-steps-dark">We couldn’t find that event</p>
          <p className="text-slate-500 text-sm mt-1">{err ?? 'It may have been removed or is no longer visible.'}</p>
          <Link href={`/my${previewQuerystring}`} className="inline-flex items-center gap-1 mt-6 text-steps-blue-600 hover:text-steps-blue-800 font-medium">← Back to Student Hub</Link>
        </div>
      </div>
    )
  }

  const { event, application, profile } = overview
  const journey = application ? getJourneyAwareLabel(application.status, application.status_history, event.event_date) : null
  const isPast = event.event_date && new Date(event.event_date) < new Date()
  const privileged = canSeeFullAddress(application?.status ?? null, false)
  const displayLocation = getDisplayLocation(event, privileged)
  const customFields = formConfigCustomFields(event.form_config)
  const raw = (application?.raw_response ?? {}) as Record<string, unknown>
  const customResponses = (raw.custom_fields ?? {}) as Record<string, unknown>
  const daysUntil = event.event_date ? Math.ceil((new Date(event.event_date).getTime() - Date.now()) / 86400000) : null

  // Eligibility for the no-application path
  const eligibleForApply = !application && isEligibleForYearGroup(event, profile?.year_group)
  const ineligibleOpenToLabel = !application && !eligibleForApply
    ? formatOpenTo(event.eligible_year_groups, !!event.open_to_gap_year)
    : null

  // Whether to show the action bar (mobile sticky + inline button row)
  const showActionsApply = !application && eligibleForApply
  const showActionsEdit = application && !isPast && application.status === 'submitted'
  const showActionsWithdraw = application && !isPast && application.status !== 'withdrew' && application.status !== 'rejected'
  const hasActions = showActionsApply || showActionsEdit || showActionsWithdraw

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-24 sm:pb-12">
      {renderTopNav()}
      {adminPreviewMode && (
        <div className="bg-violet-600 text-white text-xs font-semibold px-4 py-1.5 text-center">
          Admin preview · Read-only · Apply opens test mode
        </div>
      )}

      {/* === Page wrapper — single max-width for banner + content so they
          line up. Padding stays generous so the page fills the screen
          on big monitors without sprawling all the way to the edges. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        <Link
          href="/my"
          className="inline-flex items-center gap-1 text-sm text-steps-blue-700 hover:text-steps-blue-900 mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 rounded"
        >
          <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          Back to Student Hub
        </Link>

        {/* Banner image — constrained to the same width as the rest of the
            content (no edge-to-edge bleed) so source resolution stays
            meaningful. Aspect 4/1 across all desktop sizes. */}
        {event.banner_image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={event.banner_image_url}
            alt={event.name}
            className="w-full aspect-[4/1] object-cover rounded-2xl shadow-sm animate-tsf-fade-up"
            style={{ objectPosition: `${event.banner_focal_x ?? 50}% ${event.banner_focal_y ?? 50}%` }}
          />
        )}

        {/* Title / status / metadata — clean treatment, no dark strip.
            Larger display typography on desktop, scales down for mobile. */}
        <header className="mt-5 sm:mt-7 animate-tsf-fade-up-1">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {journey && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${journey.badgeClasses}`}>
                {journey.prefix ? (
                  <>
                    <span className="opacity-70 mr-1">{journey.prefix}</span>
                    <span aria-hidden className="opacity-50 mr-1">·</span>
                  </>
                ) : null}
                {journey.primary}
              </span>
            )}
            {isPast && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">Past event</span>
            )}
            {event.format && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                {event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : event.format}
              </span>
            )}
          </div>

          <h1 className="font-display-tight text-3xl sm:text-5xl font-black text-steps-dark">{event.name}</h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600 mt-4">
            {event.event_date && <span className="inline-flex items-center gap-1.5"><CalIcon /> {formatDate(event.event_date)}</span>}
            {event.time_start && (
              <span className="inline-flex items-center gap-1.5"><ClockIcon /> {event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>
            )}
            {displayLocation && (
              <span className="inline-flex items-center gap-1.5"><PinIcon /> {displayLocation}</span>
            )}
            {daysUntil !== null && daysUntil >= 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200 text-xs font-semibold">
                {daysUntil === 0 ? 'Today!' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days to go`}
              </span>
            )}
          </div>
        </header>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid lg:grid-cols-[1fr_18rem] gap-6">
          {/* === Main column === */}
          <div className="space-y-6 min-w-0">
            {/* About */}
            {event.description && (
              <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 animate-tsf-fade-up-2" aria-labelledby="about-heading">
                <h2 id="about-heading" className="font-display text-lg font-bold text-steps-dark">About this event</h2>
                <div
                  className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed rich-html mt-3"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(event.description) }}
                />

                {/* Inline action row (also mirrored in mobile sticky bar) */}
                {hasActions && (
                  <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap gap-3">
                    {showActionsApply && (
                      <PressableButton href={`/apply/${event.slug}`} variant="primary">
                        Apply for this event
                      </PressableButton>
                    )}
                    {showActionsEdit && (
                      <Link
                        href={adminPreviewMode ? `/apply/${event.slug}?test=1` : `/apply/${event.slug}?edit=1`}
                        target={adminPreviewMode ? '_blank' : undefined}
                        className="px-4 py-2 text-sm text-steps-blue-700 hover:text-steps-blue-900 font-semibold border border-steps-blue-200 rounded-xl hover:bg-steps-blue-50 transition"
                      >
                        {adminPreviewMode ? 'Apply (test mode)' : 'Edit application'}
                      </Link>
                    )}
                    {showActionsWithdraw && !adminPreviewMode && (
                      <button
                        type="button"
                        onClick={() => { setShowWithdrawModal(true); setWithdrawErr(null) }}
                        className="px-4 py-2 text-sm text-steps-berry hover:text-white font-semibold border border-steps-berry/40 rounded-xl hover:bg-steps-berry transition"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                )}

                {/* Year-group ineligibility chip */}
                {ineligibleOpenToLabel && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-600 border border-slate-300">
                        Not available for your year group
                      </div>
                      <p className="text-sm text-slate-600">
                        This event is open to {ineligibleOpenToLabel.toLowerCase()}.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Check-in QR (accepted only) */}
            {application?.status === 'accepted' && !isPast && (
              <section className="bg-gradient-to-br from-steps-blue-50 to-white rounded-2xl border border-steps-blue-200 p-6 sm:p-8 animate-tsf-fade-up-3">
                <CheckinQrCard eventId={event.id} eventDate={event.event_date} />
              </section>
            )}

            {/* My application answers */}
            {application && (
              <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 animate-tsf-fade-up-3" aria-labelledby="answers-heading">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <h2 id="answers-heading" className="font-display text-lg font-bold text-steps-dark">Your application</h2>
                  <p className="text-xs text-slate-500">
                    Submitted {new Date(application.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {application.updated_at && application.updated_at !== application.created_at && (
                      <> · last updated {new Date(application.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</>
                    )}
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 mt-5">
                  <Field label="GCSE results">{stringifyAnswer(overview.profile?.gcse_results ?? raw.gcse_results)}</Field>
                  <Field label="Current / predicted qualifications">{renderQualifications(overview.profile?.qualifications ?? raw.qualifications)}</Field>
                  <FallbackField
                    label="Household income (under £40k)"
                    appValue={raw.household_income_under_40k}
                    profileValue={
                      overview.profile?.parental_income_band
                        ? (YES_NO_NA_LABEL[INCOME_BAND_TO_RAW[overview.profile.parental_income_band] ?? ''] ?? null)
                        : null
                    }
                  />
                  <FallbackField
                    label="Free school meals"
                    appValue={raw.free_school_meals_raw}
                    profileValue={formatYesNoAnswer(overview.profile?.free_school_meals)}
                  />
                  {overview.profile?.first_generation_uni != null ? (
                    <Field label="Parent went to university">
                      {overview.profile.first_generation_uni ? 'No' : 'Yes'}
                    </Field>
                  ) : null}
                  {(overview.profile?.additional_context || raw.additional_context) ? (
                    <Field label="Additional contextual information" className="sm:col-span-2">
                      {stringifyAnswer(overview.profile?.additional_context ?? raw.additional_context)}
                    </Field>
                  ) : null}
                  {customFields
                    .filter(f => f.type !== 'section_heading' && f.type !== 'media')
                    .map(f => (
                      <Field key={f.id} label={stripToText(f.label)} className="sm:col-span-2">
                        {stringifyAnswer(customResponses[f.id])}
                      </Field>
                    ))}
                </div>
              </section>
            )}
          </div>

          {/* === Side rail (desktop) — key info === */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start animate-tsf-fade-up-2">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <h2 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">Key info</h2>
              <dl className="mt-3 divide-y divide-slate-100">
                {event.event_date && (
                  <KeyInfo label="Date" value={formatDate(event.event_date)} />
                )}
                {event.time_start && (
                  <KeyInfo label="Time" value={`${event.time_start}${event.time_end ? ` – ${event.time_end}` : ''}`} />
                )}
                {displayLocation && (
                  <KeyInfo label="Location" value={displayLocation} hint={!privileged && event.location_full ? 'Full address shared once you’re accepted.' : null} />
                )}
                {event.dress_code && (
                  <KeyInfo label="Dress code" value={event.dress_code} />
                )}
                {event.format && (
                  <KeyInfo label="Format" value={event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : event.format} />
                )}
                {event.capacity != null && (
                  <KeyInfo label="Capacity" value={`${event.capacity} places`} />
                )}
                {daysUntil !== null && daysUntil >= 0 && (
                  <KeyInfo label="Countdown" value={daysUntil === 0 ? 'Today!' : `${daysUntil} day${daysUntil === 1 ? '' : 's'} to go`} />
                )}
              </dl>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky action bar — only when there's an action to take. */}
      {hasActions && (
        <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 flex gap-2 animate-tsf-fade-up">
          {showActionsApply && (
            <PressableButton href={adminPreviewMode ? `/apply/${event.slug}?test=1` : `/apply/${event.slug}`} variant="primary" fullWidth size="sm" target={adminPreviewMode ? '_blank' : undefined}>
              {adminPreviewMode ? 'Apply (test)' : 'Apply'}
            </PressableButton>
          )}
          {showActionsEdit && (
            <Link
              href={adminPreviewMode ? `/apply/${event.slug}?test=1` : `/apply/${event.slug}?edit=1`}
              target={adminPreviewMode ? '_blank' : undefined}
              className="flex-1 px-3 py-2 text-sm text-center text-steps-blue-700 font-semibold border border-steps-blue-300 rounded-xl bg-white"
            >
              {adminPreviewMode ? 'Apply (test)' : 'Edit'}
            </Link>
          )}
          {showActionsWithdraw && !adminPreviewMode && (
            <button
              type="button"
              onClick={() => { setShowWithdrawModal(true); setWithdrawErr(null) }}
              className="flex-1 px-3 py-2 text-sm text-steps-berry font-semibold border border-steps-berry/40 rounded-xl bg-white"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      {/* Withdraw confirmation modal */}
      {showWithdrawModal && application && (
        <div role="dialog" aria-modal="true" aria-labelledby="withdraw-title" aria-describedby="withdraw-desc" className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-tsf-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-tsf-fade-up">
            <h3 id="withdraw-title" className="font-display text-xl font-bold text-steps-dark">Withdraw your application?</h3>
            <p id="withdraw-desc" className="text-sm text-slate-600 mt-2">
              You can re-apply while applications are still open — but once the deadline passes, you won’t be able to submit again.
            </p>
            {withdrawErr && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{withdrawErr}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowWithdrawModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition">
                Keep my application
              </button>
              <button type="button" disabled={withdrawing} onClick={confirmWithdraw} className="px-4 py-2 text-sm text-white font-semibold bg-steps-berry hover:bg-steps-berry/90 rounded-xl disabled:opacity-60 transition">
                {withdrawing ? 'Withdrawing…' : 'Yes, withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KeyInfo({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <dt className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5">{value}</dd>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">{children}</div>
    </div>
  )
}

function CalIcon() {
  return <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
}
function ClockIcon() {
  return <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
}
function PinIcon() {
  return <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
}

// ---------------------------------------------------------------------------
// CheckinQrCard
//
// Renders the student's per-event QR code that the admin scans at the door.
// Pulls a freshly-minted HMAC token from /api/events/[id]/checkin-token and
// rasterises it as an SVG via the qrcode library.
//
// We render the *raw* token in the QR rather than a URL: if a student
// accidentally scans their own code with a phone camera, they'll just see
// a base64url string that doesn't link anywhere — a URL would expose the
// token to URL history / password manager autofill, which we'd rather avoid.
// ---------------------------------------------------------------------------

function CheckinQrCard({ eventId, eventDate }: { eventId: string; eventDate: string | null }) {
  const [qrSvg, setQrSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadToken = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) throw new Error('Your session has expired — sign in again')
      const res = await fetch(`/api/events/${eventId}/checkin-token`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error ?? `Couldn't generate QR (HTTP ${res.status})`)
      const svg = await QRCode.toString(payload.token as string, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      })
      setQrSvg(svg)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load QR code')
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => { void loadToken() }, [loadToken])

  const dateHint = eventDate
    ? `Show this on the day (${new Date(eventDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}).`
    : 'Show this on the day of the event.'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-display text-lg font-bold text-steps-dark">Your check-in code</h2>
        <span className="text-xs uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Accepted</span>
      </div>
      <p className="text-sm text-slate-600 mt-1">{dateHint} A team member will scan it at the door — no need to print it.</p>

      <div className="mt-5 flex flex-col sm:flex-row items-center sm:items-start gap-5">
        <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-3 w-44 h-44 flex items-center justify-center shadow-sm">
          {loading && <span className="text-xs text-slate-400 animate-pulse">Loading…</span>}
          {!loading && error && <span className="text-xs text-rose-600 text-center px-2">{error}</span>}
          {!loading && !error && qrSvg && (
            <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          )}
        </div>

        <div className="text-sm text-slate-600 max-w-md flex-1 self-center">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Bring your phone fully charged — you won&apos;t be able to attend without showing your code.</li>
            <li>If your screen is hard to read, turn brightness up before queuing at the door.</li>
            <li>Lost your phone? Speak to a team member — they can check you in manually.</li>
          </ul>
          {error && (
            <button
              type="button"
              onClick={() => { void loadToken() }}
              className="mt-3 text-xs font-medium text-steps-blue-700 hover:underline"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EventOverviewPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div aria-hidden className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full" />
      </div>
    }>
      <EventOverviewPageInner params={params} />
    </Suspense>
  )
}
