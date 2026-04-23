'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import {
  fetchEventOverview, signOut, withdrawApplication,
  type EventOverview,
} from '@/lib/hub-api'
import { clearAllDrafts } from '@/lib/apply-draft'
import { getStatusMeta } from '@/lib/application-status'
import { getDisplayLocation, canSeeFullAddress } from '@/lib/event-display'
import { sanitizeRichHtml, stripToText } from '@/lib/sanitize-html'

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------



function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Map form_config field keys to their labels so we can render the student's
// responses nicely. The source of truth for the shape is `form_config.fields`
// (set by the admin form-builder in `students/events/[id]/page.tsx`). An older
// version of this helper looked at `custom_fields`, which is the wrong key and
// meant no answers ever rendered in the hub. We read both keys defensively in
// case any event was ever stored with the older shape.
function formConfigCustomFields(formConfig: Record<string, unknown> | null | undefined): Array<{ id: string; label: string; type: string }> {
  if (!formConfig) return []
  const fc = formConfig as { fields?: unknown; custom_fields?: unknown }
  const arr = Array.isArray(fc.fields)
    ? fc.fields
    : Array.isArray(fc.custom_fields) ? fc.custom_fields : []
  return arr.filter((f): f is { id: string; label: string; type: string } =>
    typeof f === 'object' && f !== null && typeof (f as { id?: unknown }).id === 'string' &&
    typeof (f as { label?: unknown }).label === 'string' && typeof (f as { type?: unknown }).type === 'string'
  )
}

const QUAL_TYPE_LABEL: Record<string, string> = {
  a_level: 'A-Level',
  ib: 'IB',
  btec: 'BTEC',
  t_level: 'T-Level',
  pre_u: 'Pre-U',
}

type QualEntry = { qualType?: string; subject?: string; grade?: string; level?: string }

function isQualEntry(v: unknown): v is QualEntry {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    (typeof o.subject === 'string' || o.subject === undefined) &&
    (typeof o.grade === 'string' || o.grade === undefined) &&
    (typeof o.qualType === 'string' || o.qualType === undefined)
  )
}

function formatQualEntry(q: QualEntry): string {
  const typeLabel = q.qualType ? (QUAL_TYPE_LABEL[q.qualType] ?? q.qualType.replace(/_/g, ' ')) : ''
  const level = q.level ? ` ${q.level}` : ''
  const subject = q.subject || ''
  const grade = q.grade || ''
  const left = [typeLabel + level, subject].filter(Boolean).join(' ')
  if (!left && !grade) return ''
  if (!grade) return left
  if (!left) return grade
  return `${left} — ${grade}`
}

// Coerce any answer value to a display string. Never returns "[object Object]".
function stringifyAnswer(val: unknown): string {
  if (val == null) return '—'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (Array.isArray(val)) {
    if (!val.length) return '—'
    const parts = val.map(item => {
      if (item == null) return ''
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item)
      if (isQualEntry(item)) return formatQualEntry(item)
      // Unknown object shape — best-effort JSON fallback instead of "[object Object]"
      try { return JSON.stringify(item) } catch { return '' }
    }).map(s => s.trim()).filter(Boolean)
    return parts.length ? parts.join(', ') : '—'
  }
  if (typeof val === 'object') {
    // Single object — best-effort JSON fallback
    try { const s = JSON.stringify(val); return s === '{}' ? '—' : s } catch { return '—' }
  }
  const str = String(val).trim()
  return str.length ? str : '—'
}

// --- Profile-fallback helpers -------------------------------------------------
// Old applications didn't always capture FSM / household income in their raw
// snapshot. If the snapshot is blank but the student's current profile has
// a value, show the profile value with a subtle "from your profile" hint so
// the student isn't left staring at an empty field.

const YES_NO_NA_LABEL: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  prefer_not_to_say: 'Prefer not to say',
  prefer_na: 'Prefer not to say',
}

const INCOME_BAND_TO_RAW: Record<string, string> = {
  under_40k: 'yes',
  over_40k: 'no',
  prefer_na: 'prefer_not_to_say',
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

type FallbackFieldProps = {
  label: string
  appValue: unknown
  /** Rendered profile value, or null if the profile has nothing to offer. */
  profileValue: string | null
  /** Formatter applied to appValue when it's present. Defaults to stringifyAnswer. */
  format?: (v: unknown) => string
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
        <span>{profileValue}</span>
        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide text-steps-blue-700 bg-steps-blue-50 border border-steps-blue-100 align-middle">
          From your profile
        </span>
      </Field>
    )
  }
  return <Field label={label} className={className}>—</Field>
}

// Render qualifications as a typed, readable list rather than a comma-joined blob.
function renderQualifications(val: unknown): React.ReactNode {
  if (!Array.isArray(val) || val.length === 0) return '—'
  const entries = val.filter(isQualEntry).map(formatQualEntry).filter(Boolean)
  if (entries.length === 0) return '—'
  return (
    <ul className="space-y-0.5">
      {entries.map((line, i) => <li key={i}>{line}</li>)}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EventOverviewPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const [overview, setOverview] = useState<EventOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchEventOverview(id)
      setOverview(data)
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }, [id])

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <TopNav variant="light" homeHref="/my">
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            Sign out
          </button>
        </TopNav>
        <div className="max-w-4xl mx-auto px-4 py-16 text-center text-gray-500">Loading…</div>
      </div>
    )
  }

  if (err || !overview?.event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <TopNav variant="light" homeHref="/my">
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            Sign out
          </button>
        </TopNav>
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-700 font-semibold">We couldn&apos;t find that event.</p>
          <p className="text-gray-500 text-sm mt-1">{err ?? 'It may have been removed or is no longer visible.'}</p>
          <Link href="/my" className="inline-block mt-6 text-steps-blue-600 hover:text-steps-blue-800 font-medium">← Back to Student Hub</Link>
        </div>
      </div>
    )
  }

  const { event, application } = overview
  const statusMeta = application ? getStatusMeta(application.status) : null
  const isPast = event.event_date && new Date(event.event_date) < new Date()
  const privileged = canSeeFullAddress(application?.status ?? null, false) // team-side has its own routes
  const displayLocation = getDisplayLocation(event, privileged)
  const customFields = formConfigCustomFields(event.form_config)
  const raw = (application?.raw_response ?? {}) as Record<string, unknown>
  const customResponses = (raw.custom_fields ?? {}) as Record<string, unknown>
  const daysUntil = event.event_date ? Math.ceil((new Date(event.event_date).getTime() - Date.now()) / 86400000) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav variant="light" homeHref="/my">
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
          >
            Sign out
          </button>
        </TopNav>

      {/* Banner */}
      {event.banner_image_url && (
        <div className="w-full bg-white">
          <div className="max-w-5xl mx-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.banner_image_url}
              alt={event.name}
              className="w-full aspect-[4/1] object-cover"
              style={{ objectPosition: `${event.banner_focal_x ?? 50}% ${event.banner_focal_y ?? 50}%` }}
            />
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <Link href="/my" className="text-sm text-steps-blue-600 hover:text-steps-blue-800 inline-flex items-center gap-1 mb-4">
          ← Back to Student Hub
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-3xl sm:text-4xl text-steps-dark">{event.name}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 mt-2">
                {event.event_date && <span>{formatDate(event.event_date)}</span>}
                {event.time_start && (
                  <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>
                )}
                {event.format && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : event.format}
                  </span>
                )}
              </div>
            </div>
            {statusMeta && (
              <div className="flex flex-col items-end gap-1">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusMeta.badgeClasses}`}>
                  {statusMeta.studentLabel}
                </span>
                {isPast && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400">Past event</span>
                )}
              </div>
            )}
          </div>

          {/* Key info */}
          <div className="grid sm:grid-cols-2 gap-4 mt-6">
            {displayLocation && (
              <InfoRow label="Location">
                <div className="text-sm text-gray-700">{displayLocation}</div>
                {!privileged && event.location_full && (
                  <p className="text-xs text-gray-400 mt-0.5">Full address shared once you&apos;re accepted.</p>
                )}
              </InfoRow>
            )}
            {event.dress_code && (
              <InfoRow label="Dress code">
                <div className="text-sm text-gray-700">{event.dress_code}</div>
              </InfoRow>
            )}
            {daysUntil !== null && daysUntil >= 0 && (
              <InfoRow label="Countdown">
                <div className="text-sm text-gray-700">{daysUntil === 0 ? 'Today!' : `${daysUntil} day${daysUntil === 1 ? '' : 's'} to go`}</div>
              </InfoRow>
            )}
            {event.capacity != null && (
              <InfoRow label="Capacity">
                <div className="text-sm text-gray-700">{event.capacity} places</div>
              </InfoRow>
            )}
          </div>

          {event.description && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">About this event</h2>
              <p
                className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed rich-html"
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(event.description) }}
              />
            </div>
          )}

          {/* Actions */}
          {!application && (
            <div className="mt-6 pt-6 border-t border-gray-100 flex flex-wrap gap-3">
              <PressableButton href={`/apply/${event.slug}`} variant="primary">
                Apply for this event
              </PressableButton>
            </div>
          )}

          {application && !isPast && application.status !== 'withdrew' && application.status !== 'rejected' && (
            <div className="mt-6 pt-6 border-t border-gray-100 flex flex-wrap gap-2">
              {application.status === 'submitted' && (
                <Link
                  href={`/apply/${event.slug}?edit=1`}
                  className="px-4 py-2 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium border border-steps-blue-200 rounded-xl hover:bg-steps-blue-50 transition"
                >
                  Edit application
                </Link>
              )}
              <button
                type="button"
                onClick={() => { setShowWithdrawModal(true); setWithdrawErr(null) }}
                className="px-4 py-2 text-sm text-steps-berry hover:text-white font-medium border border-steps-berry/40 rounded-xl hover:bg-steps-berry transition"
              >
                Withdraw
              </button>
            </div>
          )}
        </div>

        {/* My application answers */}
        {application && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mt-6">
            <h2 className="text-lg font-semibold text-gray-900">Your application</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Submitted {new Date(application.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              {application.updated_at && application.updated_at !== application.created_at && (
                <> · last updated {new Date(application.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</>
              )}
            </p>

            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-5">
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
          </div>
        )}
      </div>

      {/* Withdraw confirmation modal */}
      {showWithdrawModal && application && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Withdraw your application?</h3>
            <p className="text-sm text-gray-600 mt-2">
              You can always re-apply while applications are open. Once the deadline passes, you won&apos;t be able to re-submit.
            </p>
            {withdrawErr && <p className="text-sm text-red-600 mt-3">{withdrawErr}</p>}
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setShowWithdrawModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
                Never mind
              </button>
              <button type="button" disabled={withdrawing} onClick={confirmWithdraw} className="px-4 py-2 text-sm text-white font-medium bg-steps-berry hover:bg-steps-berry/90 rounded-xl disabled:opacity-60">
                {withdrawing ? 'Withdrawing…' : 'Withdraw application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{children}</div>
    </div>
  )
}
