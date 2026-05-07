'use client'

import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EventRow, fetchEvent, updateEvent, archiveEvent, unarchiveEvent, deleteEvent, formatOpenTo, validateForPublish, EventPublishValidationError, type PublishValidationError } from '@/lib/events-api'
import { refreshEvents } from '@/lib/events-cache'
import { supabase } from '@/lib/supabase'
import { ADMIN_STATUS_OPTIONS, INTERNAL_REVIEW_STATUSES, INTERNAL_REVIEW_OPTIONS, getInternalReviewMeta, internalReviewSubsumedBy, type InternalReviewStatusCode } from '@/lib/application-status'
import { useAuth } from '@/lib/auth-provider'
import InviteStudentsModal from "@/components/InviteStudentsModal"
import FormBuilder from "@/components/FormBuilder"
import FeedbackConfigEditor from "@/components/FeedbackConfigEditor"
import type { FormFieldConfig, FormPage, StandardOverrides, EventFeedbackConfig } from "@/lib/events-api"
import { sanitizeRichHtml, stripToText } from '@/lib/sanitize-html'
import { eventFeedbackByEventId } from '@/data/event-feedback'
import LinkableInput from '@/components/LinkableInput'
import ColumnPicker, { ColumnPickerItem } from '@/components/ColumnPicker'
import SelectAllBanner from '@/components/SelectAllBanner'
import {
  RichTextEmailEditor,
  type RichTextEmailEditorHandle,
  SingleLineMergeEditor,
  type SingleLineMergeEditorHandle,
  type MergeTag,
  type EmailAttachmentInfo,
  plainTextToHtml as sharedPlainTextToHtml,
  looksLikeHtml as sharedLooksLikeHtml,
} from '@/components/RichTextEmailEditor'
import {
  EmailComposePanel,
  EmailPreviewPanel,
  EmailSendingPanel,
  EmailDonePanel,
  TemplateEditDialog,
  EMAIL_SIGNATURE_HTML as SHARED_EMAIL_SIGNATURE_HTML,
} from '@/components/EmailComposePanels'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QualEntry = { qualType: string; subject: string; grade: string; level?: string }

type Applicant = {
  id: string
  student_id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  personal_email: string | null
  school_name: string | null
  school_type: string | null
  year_group: number | null
  status: string
  /** Admin-only draft decision. Never leaks to students (RLS + explicit column lists). */
  internal_review_status: InternalReviewStatusCode | null
  submitted_at: string
  attended: boolean
  reviewed_by: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  rsvp_confirmed: boolean | null
  rsvp_confirmed_at: string | null
  // Decision-making fields
  bursary_90plus: boolean | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  qualifications: QualEntry[]
  customFields: Record<string, unknown>
  // Standard free-text / attribution questions — these are part of the apply
  // form pool (not custom), but admins can surface them as dashboard columns.
  additionalContext: string | null
  anythingElse: string | null
  attributionSource: string | null
  attributionChannel: string | null
  // Profile fields live on students (not raw_response) as of the two-stage
  // apply refactor. See migrations 0024 + 0025.
  firstGenerationUni: boolean | null
  gcseResults: string | null
  engagementScore: number
  attendedCount: number
  acceptedCount: number
  submittedCount: number
  totalApplications: number
  noShowCount: number
  eligibility: 'eligible' | 'ineligible' | 'unknown'
  gradeScore: number
}

// Grade scoring: A-Level, IB, BTEC on a common 0-12 scale
const GRADE_POINTS: Record<string, number> = {
  // A-Level / T-Level
  'A*': 12, 'A': 10, 'B': 8, 'C': 6, 'D': 4, 'E': 2, 'U': 0,
  // IB (1-7)
  '7': 12, '6': 10, '5': 8, '4': 6, '3': 4, '2': 2, '1': 0,
  // BTEC (stored with full label from apply form)
  'D* (Distinction*)': 12, 'D (Distinction)': 10, 'M (Merit)': 6, 'P (Pass)': 2,
  // Pre-U
  'D1': 12, 'D2': 11, 'D3': 10, 'M1': 8, 'M2': 7, 'M3': 6, 'P1': 4, 'P2': 3, 'P3': 2,
}

function scoreGrades(quals: QualEntry[]): number {
  const post16 = quals.filter(q =>
    /a.?level|ib|btec/i.test(q.qualType) || q.level === 'post-16'
  )
  return post16.reduce((sum, q) => sum + (GRADE_POINTS[q.grade] ?? 0), 0)
}

function computeEligibility(app: {
  school_type: string | null
  bursary_90plus: boolean | null
  free_school_meals: boolean | null
  parental_income_band: string | null
}): 'eligible' | 'ineligible' | 'unknown' {
  const st = app.school_type?.toLowerCase()
  if (!st) return 'unknown'
  // State, grammar, and independent_bursary (fee-paying with 90%+ bursary) all qualify.
  if (st === 'state' || st === 'grammar' || st === 'independent_bursary') return 'eligible'
  // Plain private/independent (no bursary) does not qualify.
  if (st === 'independent') return 'ineligible'
  return 'unknown'
}

// Derived from the shared module so /my, /my/events/[id] and this page all
// agree on labels + badge colours. Shape preserved (code/label/color) so the
// existing call-sites elsewhere in this file keep working without changes.
const STATUSES = ADMIN_STATUS_OPTIONS.map(s => ({ code: s.code, label: s.label, color: s.badgeClasses }))

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.code, s]))

// Notify-able statuses for combined actions.
// Order mirrors the decision funnel — shortlist is the earliest commitment, then accept/waitlist/reject.
const NOTIFY_STATUSES = [
  { code: 'shortlisted', label: 'Shortlist & Notify', templateType: 'shortlist', color: 'bg-violet-600 hover:bg-violet-700' },
  { code: 'accepted',    label: 'Accept & Notify',    templateType: 'acceptance', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { code: 'waitlist',    label: 'Waitlist & Notify',  templateType: 'waitlist',   color: 'bg-amber-600 hover:bg-amber-700' },
  { code: 'rejected',    label: 'Reject & Notify',    templateType: 'rejection',  color: 'bg-red-600 hover:bg-red-700' },
]


// ---------------------------------------------------------------------------
// Email signature — matches the real events@ Gmail signature
// ---------------------------------------------------------------------------

// Email signature — single source of truth in EmailComposePanels.tsx
const EMAIL_SIGNATURE_HTML = SHARED_EMAIL_SIGNATURE_HTML

// Helpers for ranked-choice display
function toTitleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
const ORDINAL: Record<string, string> = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
}

// Available sortable columns
type SortKey = 'name' | 'school_type' | 'year_group' | 'status' | 'gradeScore' | 'submitted_at' | 'engagement' | 'past_events' | 'rsvp' | 'attended'
type SortDir = 'asc' | 'desc'


// Built-in columns for the applicants table. 'name' is a special column
// (always rendered sticky-left when visible) but is still togglable via the
// column picker so admins can run blind / anonymised reviews.
type BuiltInColId = 'name' | 'school_type' | 'status' | 'internal_review' | 'grades' | 'engagement' | 'past_events' | 'rsvp' | 'attended'
// `internal_review` sits right after `status` so admins read "where are we
// actually planning to land" next to "what the student can see".
const DEFAULT_BUILTIN_COLS: BuiltInColId[] = ['name', 'school_type', 'status', 'internal_review', 'grades', 'engagement', 'past_events', 'rsvp', 'attended']
const BUILTIN_COL_LABELS: Record<BuiltInColId, string> = {
  name: 'Name',
  school_type: 'School Type',
  status: 'Status',
  internal_review: 'Internal mark',
  grades: 'Grades (Score)',
  engagement: 'Engagement',
  past_events: 'Past Events',
  rsvp: 'RSVP',
  attended: 'Attended',
}

type StatusFilter = 'all' | string

// Rich-text editor, chip serialisation, and text-conversion helpers now live
// in src/components/RichTextEmailEditor.tsx so both the templates page and
// this compose flow share one implementation.
const RichTextEditor = RichTextEmailEditor
type RichTextEditorHandle = RichTextEmailEditorHandle
const plainTextToHtml = sharedPlainTextToHtml
const looksLikeHtml = sharedLooksLikeHtml


// ---------------------------------------------------------------------------
// EventImageUploader — small reusable upload slot for banner/hub-image
// ---------------------------------------------------------------------------

function EventImageUploader({
  label,
  hint,
  aspect,
  eventId,
  kind,
  value,
  focalX,
  focalY,
  onChange,
  onFocalChange,
}: {
  label: string
  hint: string
  aspect: string  // tailwind aspect class e.g. 'aspect-[4/1]'
  eventId: string
  kind: 'banner' | 'hub'
  value: string | null | undefined
  focalX: number
  focalY: number
  onChange: (url: string | null) => void
  onFocalChange: (x: number, y: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = async (file: File) => {
    setError(null)
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      setError('Use JPG, PNG, WebP or GIF.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Max file size is 5 MB.')
      return
    }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const objectKey = `${kind}/${eventId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase
        .storage
        .from('event-banners')
        .upload(objectKey, file, { cacheControl: '3600', upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('event-banners').getPublicUrl(objectKey)
      if (!pub?.publicUrl) throw new Error('Could not resolve public URL')
      onChange(pub.publicUrl)
      onFocalChange(50, 50)  // reset to centre on new upload
    } catch (err: any) {
      console.error('upload failed', err)
      setError(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const updateFocalFromEvent = (clientX: number, clientY: number) => {
    const el = frameRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))
    onFocalChange(Math.round(x), Math.round(y))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
    updateFocalFromEvent(e.clientX, e.clientY)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    updateFocalFromEvent(e.clientX, e.clientY)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const focalStyle = { objectPosition: `${focalX}% ${focalY}%` } as React.CSSProperties

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
      />
      {value ? (
        <>
          <div
            ref={frameRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`relative w-full ${aspect} rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="w-full h-full object-cover select-none pointer-events-none" style={focalStyle} draggable={false} />
            {/* Focal pin */}
            <div
              className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg border-2 border-steps-blue-600 flex items-center justify-center pointer-events-none transition-transform"
              style={{ left: `${focalX}%`, top: `${focalY}%`, transform: `translate(-50%, -50%) scale(${dragging ? 1.15 : 1})` }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-steps-blue-600" />
            </div>
            <div className="absolute top-2 right-2 flex gap-1.5 pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-white/90 text-gray-700 border border-gray-200 hover:bg-white shadow-sm disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                onClick={() => { onChange(null); onFocalChange(50, 50) }}
                disabled={uploading}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-white/90 text-red-600 border border-red-200 hover:bg-red-50 shadow-sm disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span>Drag the pin to choose what stays in frame.</span>
            <button
              type="button"
              onClick={() => onFocalChange(50, 50)}
              className="underline underline-offset-2 hover:text-steps-blue-700"
            >
              Recentre
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`w-full ${aspect} flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-steps-blue-400 hover:bg-steps-blue-50 dark:hover:bg-steps-blue-950/30 text-gray-500 dark:text-gray-400 hover:text-steps-blue-700 transition-colors disabled:opacity-50`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-medium">{uploading ? 'Uploading…' : 'Click to upload'}</span>
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Collapsible section wrapper for the event edit view. Persists open/closed
// state per section-id in localStorage so admins' preferred layout sticks.
// ---------------------------------------------------------------------------
// Timezone-safe datetime-local conversion.
// <input type="datetime-local"> binds to a naive local-time string like
// "2026-05-01T17:00". JS treats that string as LOCAL time when parsed via
// new Date(), so on save we already correctly produce a UTC timestamp.
// But the inverse — loading a stored UTC ISO string — needs the SAME
// local-projection, or round-trips drift (UTC 2026-04-30T23:00Z was sliced
// to "2026-04-30T23:00" and then re-parsed as LOCAL 23:00 BST = UTC
// 2026-04-30T22:00Z, losing an hour per save; at midnight, losing a day too).
// This helper projects an ISO timestamp into the same local naive format
// datetime-local expects.
// ---------------------------------------------------------------------------
function toLocalDatetimeInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Section({ id, title, subtitle, defaultOpen = false, children }: {
  id: string
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const storageKey = `steps:event-editor-section:${id}`
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen
    const v = window.localStorage.getItem(storageKey)
    if (v === null) return defaultOpen
    return v === '1'
  })
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, open ? '1' : '0') } catch {}
  }, [storageKey, open])
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
      >
        <svg
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        ><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{subtitle}</div>}
        </div>
      </button>
      {open && <div className="p-4 bg-white dark:bg-gray-900">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AutosaveStatusPill — small visual indicator next to the Cancel/Save buttons
// while editing. Shows live save progress so admins can trust their edits are
// landing without having to remember to click Save.
// ---------------------------------------------------------------------------
function AutosaveStatusPill({
  status,
  savedAt,
  error,
  onRetry,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  savedAt: Date | null
  error: string | null
  onRetry: () => void
}) {
  // Re-render every 30s so the "x ago" stays roughly fresh while the pill is
  // mounted. Cheap — only runs while editing.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== 'saved') return
    const i = window.setInterval(() => setTick(t => t + 1), 30_000)
    return () => window.clearInterval(i)
  }, [status])

  if (status === 'idle') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" title="Autosave is on. Edits save 1.5 seconds after you stop typing.">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Autosave on
      </span>
    )
  }
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        Saving…
      </span>
    )
  }
  if (status === 'saved') {
    const label = savedAt ? formatRelativeTime(savedAt) : 'just now'
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" title={savedAt ? `Last saved at ${savedAt.toLocaleTimeString()}` : undefined}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        Saved {label}
      </span>
    )
  }
  // status === 'error'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" title={error ?? 'Autosave failed'}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      Save failed
      <button onClick={onRetry} className="underline decoration-dotted underline-offset-2 hover:text-red-900 dark:hover:text-red-300" type="button">Retry</button>
    </span>
  )
}

// Compact "x ago" formatter for the saved pill. Anything > 1h falls back to a
// timestamp tooltip on the pill, so we just need second/minute precision here.
function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}


// ---------------------------------------------------------------------------
// KpiTile — Wave 2 bento metric tile for the event header.
// Same pattern as the /hub redesign tiles: large display number, small label,
// optional sub-line, optional click-through that filters the applicant table.
// ---------------------------------------------------------------------------
type KpiTone = 'slate' | 'emerald' | 'blue' | 'violet' | 'amber' | 'rose'
const KPI_TONE_RING: Record<KpiTone, string> = {
  slate:   'hover:border-slate-300',
  emerald: 'hover:border-emerald-300',
  blue:    'hover:border-steps-blue-300',
  violet:  'hover:border-violet-300',
  amber:   'hover:border-amber-300',
  rose:    'hover:border-rose-300',
}
const KPI_TONE_NUM: Record<KpiTone, string> = {
  slate:   'text-steps-dark dark:text-gray-100',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  blue:    'text-steps-blue-600 dark:text-steps-blue-400',
  violet:  'text-violet-600 dark:text-violet-400',
  amber:   'text-amber-600 dark:text-amber-400',
  rose:    'text-rose-600 dark:text-rose-400',
}
function KpiTile({ label, value, sub, tone, onClick }: { label: string; value: number; sub?: string; tone: KpiTone; onClick?: () => void }) {
  const Inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-3xl font-display font-black mt-1 ${KPI_TONE_NUM[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    </>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`group relative text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-colors ${KPI_TONE_RING[tone]} focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2`}
      >
        {Inner}
      </button>
    )
  }
  return (
    <div className={`relative rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4`}>
      {Inner}
    </div>
  )
}

export default function EventDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const eventId = params.id as string
  const { teamMember } = useAuth()
  // ?new=1 — set when the admin just created a draft event from /students/events.
  // Auto-enter edit mode so they can rename + fill in details immediately.
  const isNewDraft = searchParams?.get('new') === '1' 

  const [event, setEvent] = useState<EventRow | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [loading, setLoading] = useState(true)
  const [appLoading, setAppLoading] = useState(true)

  // Pagination
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [minGradeScore, setMinGradeScore] = useState(0)

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('submitted_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Column filters
  const [yearGroupFilter, setYearGroupFilter] = useState<string>('all')
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>('all')

  // Filter/sort panel visibility
  const [showFilters, setShowFilters] = useState(false)

  // Column visibility & ordering
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colOrder, setColOrder] = useState<string[]>([])  // empty = default order

  // View state persistence — filters & sort live in localStorage (per-admin),
  // while column config (hidden + order) lives on the event row in the DB
  // (shared across admins). Survives refresh so admins don't have to
  // re-customise every visit.
  const [viewHydrated, setViewHydrated] = useState(false)
  const viewStorageKey = `steps:event-view:v3:${eventId}`
  // Remember the last config we pushed so we don't thrash the DB on every
  // state change that happens to coincide with the shared config.
  const lastPushedColsRef = useRef<string>('')

  useEffect(() => {
    if (!eventId) return
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(viewStorageKey) : null
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          statusFilter: StatusFilter
          yearGroupFilter: string
          schoolTypeFilter: string
          minGradeScore: number
          sortKey: SortKey
          sortDir: SortDir
          hiddenCols: string[]
          colOrder: string[]
          search: string
        }>
        if (typeof v.statusFilter === 'string') setStatusFilter(v.statusFilter)
        if (typeof v.yearGroupFilter === 'string') setYearGroupFilter(v.yearGroupFilter)
        if (typeof v.schoolTypeFilter === 'string') setSchoolTypeFilter(v.schoolTypeFilter)
        if (typeof v.minGradeScore === 'number') setMinGradeScore(v.minGradeScore)
        if (typeof v.sortKey === 'string') setSortKey(v.sortKey)
        if (typeof v.sortDir === 'string') setSortDir(v.sortDir)
        if (typeof v.search === 'string') setSearch(v.search)
      }
    } catch {
      // Corrupt or inaccessible storage — fall through to defaults.
    }
    setViewHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  useEffect(() => {
    if (!viewHydrated || !eventId) return
    try {
      const payload = {
        statusFilter,
        yearGroupFilter,
        schoolTypeFilter,
        minGradeScore,
        sortKey,
        sortDir,
        search,
      }
      window.localStorage.setItem(viewStorageKey, JSON.stringify(payload))
    } catch {
      // Storage full / disabled — view still works for this session.
    }
  }, [viewHydrated, eventId, viewStorageKey, statusFilter, yearGroupFilter, schoolTypeFilter, minGradeScore, sortKey, sortDir, search])

  // Seed column config (hidden + order) from the event row when it loads.
  // Shared across admins: lives in events.dashboard_columns. We only seed once,
  // guarded by a ref so later saves don't clobber local state.
  const colsSeededRef = useRef(false)
  useEffect(() => {
    if (colsSeededRef.current || !event) return
    const cfg = event.dashboard_columns ?? null
    if (cfg) {
      if (Array.isArray(cfg.hidden)) setHiddenCols(new Set(cfg.hidden))
      if (Array.isArray(cfg.order)) setColOrder(cfg.order)
      lastPushedColsRef.current = JSON.stringify({
        hidden: Array.isArray(cfg.hidden) ? cfg.hidden : [],
        order: Array.isArray(cfg.order) ? cfg.order : [],
      })
    }
    colsSeededRef.current = true
  }, [event])

  // Push column config to the event row whenever admins change it. Guarded by
  // lastPushedColsRef so we don't PATCH the DB on every unrelated render.
  const pushDashboardColumns = useCallback(async (hidden: Set<string>, order: string[]) => {
    if (!eventId || !colsSeededRef.current) return
    const payload = { hidden: Array.from(hidden), order }
    const key = JSON.stringify(payload)
    if (key === lastPushedColsRef.current) return
    lastPushedColsRef.current = key
    try {
      const updated = await updateEvent(eventId, { dashboard_columns: payload })
      if (updated) setEvent(updated)
    } catch {
      // Non-fatal: admin's local state is already updated; the next change will
      // retry the push. Avoid blocking the UI on a transient network blip.
    }
  }, [eventId])


  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; mode: 'soft' | 'hard' | null }>({ open: false, mode: null })
  const [deleteLoading, setDeleteLoading] = useState(false)
  // Which bulk-decision dropdown is open (only one at a time)
  const [bulkMenuOpen, setBulkMenuOpen] = useState<string | null>(null)
  // Wave 2: optional one-liner reason persisted to applications.decision_reason
  // when committing accept/waitlist/reject. Admin-only, never returned to the
  // student. Pre-fills with the previous reason (if any) when re-using.
  const [bulkDecisionReason, setBulkDecisionReason] = useState('')
  const bulkMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!bulkMenuOpen) return
    function onDocClick(e: MouseEvent) {
      if (!bulkMenuRef.current) return
      if (!bulkMenuRef.current.contains(e.target as Node)) setBulkMenuOpen(null)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setBulkMenuOpen(null) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [bulkMenuOpen])

  // Inline editing feedback
  const [saving, setSaving] = useState<Set<string>>(new Set())

  // Email compose state
  const [showCompose, setShowCompose] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  // Inline event editing
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [eventActionErr, setEventActionErr] = useState<string | null>(null)
  const [publishErrors, setPublishErrors] = useState<PublishValidationError[] | null>(null)
  void publishErrors
  // Inline preview overlay state. When opened, an iframe loads the apply page
  // in preview mode. We force a save first so the iframe sees the current
  // state. Closes on backdrop click or X.
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const openPreview = async () => {
    // Flush any pending autosave before opening so the iframe loads the
    // latest state from the DB. Sets a fresh key so the iframe re-mounts
    // (forcing a refetch even if a previous overlay was open).
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
    if (autosaveInflightRef.current) { try { await autosaveInflightRef.current } catch { /* swallow */ } }
    await runAutosave()
    setPreviewKey(k => k + 1)
    setPreviewOpen(true)
  }
  // Team members for the Lead organiser picker. Fetched once on mount;
  // tiny list, no need to debounce or paginate.
  const [teamMembers, setTeamMembers] = useState<{ auth_uuid: string; name: string }[]>([])
  useEffect(() => {
    let active = true
    supabase
      .from('team_members')
      .select('auth_uuid, name')
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        setTeamMembers((data ?? [])
          .filter((m: any) => m.auth_uuid && m.name) as { auth_uuid: string; name: string }[])
      })
    return () => { active = false }
  }, [])
  const router = useRouter()

  const handleArchiveEvent = async () => {
    if (!event) return
    setArchiving(true); setEventActionErr(null)
    try {
      const updated = event.archived_at
        ? await unarchiveEvent(event.id)
        : await archiveEvent(event.id)
      setEvent(updated)
    } catch (e: any) {
      setEventActionErr(e?.message ?? 'Could not archive event')
    } finally {
      setArchiving(false)
    }
  }

  const handleDeleteEvent = async () => {
    if (!event) return
    if (!window.confirm(`Delete "${event.name}"? It'll be hidden everywhere — applications stay in the database for audit, and you can restore it from Supabase if needed.`)) return
    setDeleting(true); setEventActionErr(null)
    try {
      await deleteEvent(event.id)
      router.push('/students/events')
    } catch (e: any) {
      setEventActionErr(e?.message ?? 'Delete failed')
      setDeleting(false)
    }
  }

  const [cancelling, setCancelling] = useState(false)
  const handleCancelEvent = async () => {
    if (!event) return
    if (event.status === 'cancelled') {
      // Toggle back to draft if already cancelled (rare but possible)
      if (!window.confirm(`Restore "${event.name}" from cancelled to draft?`)) return
    } else {
      const msg = `Cancel "${event.name}"?\n\n` +
        `Applicants will be able to see the cancelled status on their hub.\n` +
        `You should also notify them by email — after confirming, click "Email applicants" to send a cancellation message.`
      if (!window.confirm(msg)) return
    }
    setCancelling(true); setEventActionErr(null)
    try {
      const newStatus: EventRow['status'] = event.status === 'cancelled' ? 'draft' : 'cancelled'
      const updated = await updateEvent(event.id, { status: newStatus })
      setEvent(updated)
    } catch (e: any) {
      setEventActionErr(e?.message ?? 'Cancel failed')
    } finally {
      setCancelling(false)
    }
  }
  // Effect below flips editing=true once on mount when ?new=1 is present.
  // We don't initialise the state to isNewDraft directly because Suspense
  // hydration can fire searchParams late on first render.
  const [editDraft, setEditDraft] = useState<Partial<EventRow>>({})
  const [editSaving, setEditSaving] = useState(false)
  // Autosave: snapshot of the event row taken at startEditing, used by
  // cancelEditing to revert any autosaved changes back to the user's
  // starting point. Lives in a ref because it never drives render.
  const editOriginalRef = useRef<EventRow | null>(null)
  // Status pill state — surfaces autosave progress in the editor header.
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [autosaveSavedAt, setAutosaveSavedAt] = useState<Date | null>(null)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)
  // Debounce + in-flight tracking. Manual Save flushes both before exiting,
  // and we de-dup overlapping save attempts so user typing during a save
  // gets picked up by the next debounce instead of stacking requests.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveInflightRef = useRef<Promise<'noop' | 'saved' | 'failed'> | null>(null)
  const [signupLinkCopied, setSignupLinkCopied] = useState<string | null>(null)
  const copySignupLink = (slug: string) => {
    const url = `${window.location.origin}/apply/${slug}`
    navigator.clipboard.writeText(url).then(() => {
      setSignupLinkCopied(slug)
      window.setTimeout(() => setSignupLinkCopied(null), 1800)
    }).catch(() => {
      window.prompt('Copy this sign-up link:', url)
    })
  }

  // ---------------------------------------------------------------------------
  // buildEventPatch — pure diff of an editDraft against an EventRow baseline.
  // Shared between manual save, autosave, and the cancel-revert path so all
  // three agree on which fields actually need writing.
  // ---------------------------------------------------------------------------
  // Live publish-readiness checklist. Computed from current draft merged onto
  // the saved event, so each tick/cross flips the moment the admin types.
  const liveChecklist: PublishValidationError[] = (() => {
    if (!event) return []
    const projected = { ...event, ...editDraft } as Partial<EventRow>
    return validateForPublish(projected)
  })()
  const liveChecklistFields = new Set(liveChecklist.map(e => e.field))
  const ALL_PUBLISH_REQUIREMENTS: { field: string; label: string }[] = [
    { field: 'name', label: 'Event name' },
    { field: 'slug', label: 'URL slug' },
    { field: 'event_date', label: 'Event date' },
    { field: 'time_start', label: 'Start time' },
    { field: 'time_end', label: 'End time' },
    { field: 'location', label: 'Rough location' },
    { field: 'format', label: 'Format' },
    { field: 'capacity', label: 'Capacity' },
    { field: 'description', label: 'Description' },
    { field: 'applications_open_at', label: 'Applications open' },
    { field: 'applications_close_at', label: 'Applications close' },
    { field: 'banner_image_url', label: 'Banner image' },
    { field: 'hub_image_url', label: 'Hub card image' },
    { field: 'form_config', label: 'At least three custom questions' },
  ]

  const buildEventPatch = useCallback((draft: Partial<EventRow>, baseline: EventRow): Record<string, any> => {
    const patch: Record<string, any> = {}
    if (draft.name && draft.name !== baseline.name) patch.name = draft.name
    if (draft.slug && draft.slug !== baseline.slug) patch.slug = draft.slug
    if ((draft.event_date ?? '') !== (baseline.event_date ?? '')) patch.event_date = draft.event_date || null
    if ((draft.location ?? '') !== (baseline.location ?? '')) patch.location = draft.location || null
    if ((draft.location_full ?? '') !== (baseline.location_full ?? '')) patch.location_full = draft.location_full || null
    if ((draft.format ?? '') !== (baseline.format ?? '')) patch.format = draft.format || null
    if ((draft.description ?? '') !== (baseline.description ?? '')) patch.description = draft.description || null
    if (draft.capacity !== baseline.capacity) patch.capacity = draft.capacity ?? null
    if ((draft.time_start ?? '') !== (baseline.time_start ?? '')) patch.time_start = draft.time_start || null
    if ((draft.time_end ?? '') !== (baseline.time_end ?? '')) patch.time_end = draft.time_end || null
    if ((draft.dress_code ?? '') !== (baseline.dress_code ?? '')) patch.dress_code = draft.dress_code || null
    if (draft.status && draft.status !== baseline.status) patch.status = draft.status
    const openAt = draft.applications_open_at ? new Date(draft.applications_open_at as string).toISOString() : null
    const closeAt = draft.applications_close_at ? new Date(draft.applications_close_at as string).toISOString() : null
    if (openAt !== (baseline.applications_open_at ?? null)) patch.applications_open_at = openAt
    if (closeAt !== (baseline.applications_close_at ?? null)) patch.applications_close_at = closeAt

    if ((draft.banner_image_url ?? null) !== (baseline.banner_image_url ?? null)) patch.banner_image_url = draft.banner_image_url ?? null
    if ((draft.hub_image_url ?? null) !== (baseline.hub_image_url ?? null)) patch.hub_image_url = draft.hub_image_url ?? null
    if ((draft.banner_focal_x ?? 50) !== (baseline.banner_focal_x ?? 50)) patch.banner_focal_x = draft.banner_focal_x ?? 50
    if ((draft.banner_focal_y ?? 50) !== (baseline.banner_focal_y ?? 50)) patch.banner_focal_y = draft.banner_focal_y ?? 50
    if ((draft.hub_focal_x ?? 50) !== (baseline.hub_focal_x ?? 50)) patch.hub_focal_x = draft.hub_focal_x ?? 50
    if ((draft.hub_focal_y ?? 50) !== (baseline.hub_focal_y ?? 50)) patch.hub_focal_y = draft.hub_focal_y ?? 50

    const eygDraft = Array.isArray(draft.eligible_year_groups) && draft.eligible_year_groups.length > 0
      ? [...draft.eligible_year_groups].sort((a, b) => a - b)
      : null
    const eygBaseline = Array.isArray(baseline.eligible_year_groups) && baseline.eligible_year_groups.length > 0
      ? [...baseline.eligible_year_groups].sort((a, b) => a - b)
      : null
    if (JSON.stringify(eygDraft) !== JSON.stringify(eygBaseline)) patch.eligible_year_groups = eygDraft

    const gapDraft = draft.open_to_gap_year ?? false
    const gapBaseline = baseline.open_to_gap_year ?? false
    if (gapDraft !== gapBaseline) patch.open_to_gap_year = gapDraft

    const currentFormConfig = JSON.stringify(baseline.form_config ?? { fields: [] })
    const draftFormConfig = JSON.stringify(draft.form_config ?? { fields: [] })
    if (draftFormConfig !== currentFormConfig) patch.form_config = draft.form_config

    const currentFeedbackConfig = JSON.stringify(baseline.feedback_config ?? null)
    const draftFeedbackConfig = JSON.stringify((draft as { feedback_config?: EventFeedbackConfig | null }).feedback_config ?? null)
    if (draftFeedbackConfig !== currentFeedbackConfig) patch.feedback_config = (draft as { feedback_config?: EventFeedbackConfig | null }).feedback_config ?? null

    return patch
  }, [])

  const startEditing = () => {
    if (!event) return
    // Snapshot the row state at the moment Edit was clicked so cancelEditing
    // can revert any autosaved changes the user made before clicking Cancel.
    editOriginalRef.current = event
    setEditDraft({
      name: event.name,
      slug: event.slug,
      event_date: event.event_date ?? '',
      location: event.location ?? '',
      location_full: event.location_full ?? '',
      format: event.format ?? '',
      description: event.description ?? '',
      capacity: event.capacity,
      time_start: event.time_start ?? '',
      time_end: event.time_end ?? '',
      dress_code: event.dress_code ?? '',
      status: event.status,
      applications_open_at: toLocalDatetimeInputValue(event.applications_open_at),
      applications_close_at: toLocalDatetimeInputValue(event.applications_close_at),
      form_config: event.form_config ?? { fields: [] },
      banner_image_url: event.banner_image_url,
      hub_image_url: event.hub_image_url,
      banner_focal_x: event.banner_focal_x,
      banner_focal_y: event.banner_focal_y,
      hub_focal_x: event.hub_focal_x,
      hub_focal_y: event.hub_focal_y,
      eligible_year_groups: event.eligible_year_groups ?? null,
      open_to_gap_year: event.open_to_gap_year ?? false,
      feedback_config: event.feedback_config ?? null,
    })
    setAutosaveStatus('idle')
    setAutosaveError(null)
    setAutosaveSavedAt(null)
    setEditing(true)
  }

  const cancelEditing = async () => {
    // Stop any pending or in-flight autosave so we don't fight the revert.
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
    if (autosaveInflightRef.current) { try { await autosaveInflightRef.current } catch { /* swallow */ } }
    const original = editOriginalRef.current
    if (event && original) {
      // Build a draft matching the editDraft shape from the original snapshot,
      // then diff it against the *current* event row (which may include
      // autosaved changes). The resulting patch reverts everything that
      // landed during this edit session.
      const revertDraft: Partial<EventRow> = {
        name: original.name,
        slug: original.slug,
        event_date: original.event_date ?? '',
        location: original.location ?? '',
        location_full: original.location_full ?? '',
        format: original.format ?? '',
        description: original.description ?? '',
        capacity: original.capacity,
        time_start: original.time_start ?? '',
        time_end: original.time_end ?? '',
        dress_code: original.dress_code ?? '',
        status: original.status,
        applications_open_at: toLocalDatetimeInputValue(original.applications_open_at),
        applications_close_at: toLocalDatetimeInputValue(original.applications_close_at),
        form_config: original.form_config ?? { fields: [] },
        banner_image_url: original.banner_image_url,
        hub_image_url: original.hub_image_url,
        banner_focal_x: original.banner_focal_x,
        banner_focal_y: original.banner_focal_y,
        hub_focal_x: original.hub_focal_x,
        hub_focal_y: original.hub_focal_y,
        eligible_year_groups: original.eligible_year_groups ?? null,
        open_to_gap_year: original.open_to_gap_year ?? false,
        feedback_config: original.feedback_config ?? null,
      }
      const revertPatch = buildEventPatch(revertDraft, event)
      if (Object.keys(revertPatch).length > 0) {
        try {
          const reverted = await updateEvent(event.id, revertPatch as any)
          setEvent(reverted)
          if (revertPatch.name !== undefined || revertPatch.event_date !== undefined) {
            void refreshEvents()
          }
        } catch (err) {
          console.error('Failed to revert event:', err)
          alert('Could not revert your changes — they may already be saved. ' + (err && typeof err === 'object' && 'message' in err ? (err as any).message : ''))
        }
      }
    }
    setEditing(false)
    setEditDraft({})
    setAutosaveStatus('idle')
    setAutosaveError(null)
    setAutosaveSavedAt(null)
    editOriginalRef.current = null
  }

  // ---------------------------------------------------------------------------
  // runAutosave — diffs editDraft against the current event row and persists
  // any changes via updateEvent, with up to 3 retry attempts on failure.
  // Returns 'noop' / 'saved' / 'failed' so callers (manual save, retry button)
  // can decide whether it's safe to exit edit mode.
  // ---------------------------------------------------------------------------
  const runAutosave = useCallback(async (): Promise<'noop' | 'saved' | 'failed'> => {
    if (!event) return 'noop'
    // Skip if a save is already in flight — the next debounce tick will
    // pick up any further user changes once this one finishes.
    if (autosaveInflightRef.current) {
      try { return await autosaveInflightRef.current } catch { return 'failed' }
    }
    const patch = buildEventPatch(editDraft, event)
    if (Object.keys(patch).length === 0) {
      // Nothing changed since last save. Don't clobber a 'saved' pill — but if
      // we previously errored, treat a no-op as a recovery and clear.
      setAutosaveStatus(prev => (prev === 'error' ? 'idle' : prev))
      return 'noop'
    }
    // Note: deliberately do NOT flip the pill to 'saving' here. The pill stays
    // on the most recent 'Saved just now' through background autosaves to avoid
    // a distracting flicker. Manual Save has its own button-level saving state.
    setAutosaveError(null)
    const promise = (async (): Promise<'noop' | 'saved' | 'failed'> => {
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const updated = await updateEvent(event.id, patch as any)
          setEvent(updated)
          if (patch.name !== undefined || patch.event_date !== undefined) {
            void refreshEvents()
          }
          setAutosaveStatus('saved')
          setAutosaveSavedAt(new Date())
          setPublishErrors(null)
          return 'saved'
        } catch (err) {
          // Don't retry on validation errors — they won't pass on retry,
          // and the admin needs to see the checklist immediately.
          if (err instanceof EventPublishValidationError) {
            const ev = err as EventPublishValidationError
            setPublishErrors(ev.errors)
            // Revert the status field in the draft so it doesn't keep
            // re-firing the same publish attempt on the next debounce tick.
            setEditDraft(d => ({ ...d, status: 'draft' as const }))
            setAutosaveStatus('error')
            setAutosaveError(`Can't publish — ${ev.errors.length} thing${ev.errors.length === 1 ? '' : 's'} missing. See checklist.`)
            return 'failed'
          }
          lastErr = err
          // eslint-disable-next-line no-console
          console.error(`Autosave attempt ${attempt + 1} failed:`, err)
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)))
          }
        }
      }
      const msg = lastErr && typeof lastErr === 'object' && 'message' in lastErr
        ? (lastErr as { message?: unknown }).message
        : 'Save failed'
      setAutosaveStatus('error')
      setAutosaveError(typeof msg === 'string' ? msg : 'Save failed')
      return 'failed'
    })()
    autosaveInflightRef.current = promise
    try { return await promise } finally { autosaveInflightRef.current = null }
  }, [event, editDraft, buildEventPatch])

  // Debounce: 3s after the last editDraft mutation, fire an autosave.
  // Re-running the effect on every editDraft change cancels the previous
  // timer, so rapid typing only ever triggers one save 3s after the user
  // stops typing — keeps the DB chatter low without losing too much
  // work if the tab crashes.
  useEffect(() => {
    if (!editing) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void runAutosave()
    }, 3000)
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [editDraft, editing, runAutosave])

  // saveEditing — explicit Save changes button. Flushes any pending or
  // in-flight autosave, then exits edit mode if the final state is clean.
  // On persistent failure, stays in edit mode so the user can retry.
  const saveEditing = async () => {
    if (!event) return
    setEditSaving(true)
    try {
      // Cancel pending debounce; we're saving right now.
      if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
      // Wait for any in-flight autosave so we don't race it.
      if (autosaveInflightRef.current) { try { await autosaveInflightRef.current } catch { /* swallow */ } }
      // Final flush — picks up the latest editDraft state.
      const result = await runAutosave()
      if (result === 'failed') {
        // Surface the failure via the pill; don't exit edit mode.
        return
      }
      setEditing(false)
      setEditDraft({})
      setAutosaveStatus('idle')
      setAutosaveError(null)
      setAutosaveSavedAt(null)
      editOriginalRef.current = null
    } finally {
      setEditSaving(false)
    }
  }

  const [templates, setTemplates] = useState<{ id: string; name: string; type: string; subject: string; body_html: string; event_id: string | null }[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  // Per-send attachments. Decision-send enqueues onto email_outbox, so
  // we persist the list alongside each row via the `attachments` JSONB
  // column. Cleared after enqueue.
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachmentInfo[]>([])
  const [emailStep, setEmailStep] = useState<'pick' | 'preview' | 'sending' | 'done'>('pick')
  const [templateDirty, setTemplateDirty] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<{ id: string; name: string; type: string; subject: string; body_html: string; event_id: string | null } | null>(null)
  const [editTemplateError, setEditTemplateError] = useState<string | null>(null)

  // Rich-text editor ref — used to inject merge tags at the caret.
  const bodyEditorRef = useRef<RichTextEditorHandle | null>(null)
  // Single-line subject editor ref — injects pill chips into the subject.
  const subjectEditorRef = useRef<SingleLineMergeEditorHandle | null>(null)
  // HTML snapshot that seeds the editor — captured once per template load so
  // the contenteditable isn't overwritten on every keystroke. When a new
  // template is picked we bump a counter to re-seed with that body.
  const [bodySeedCounter, setBodySeedCounter] = useState(0)
  const bodyEditorSeed = useMemo(() => {
    return looksLikeHtml(emailBody) ? emailBody : plainTextToHtml(emailBody)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate, bodySeedCounter])
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0, total: 0 })

  // Combined action: status to apply after emails are queued
  const [notifyAction, setNotifyAction] = useState<string | null>(null)

  // --------------------------------------------------------------------------
  // Email queue stats — populated from email_outbox, filtered to this event.
  // Poll every 5s while there's in-flight work (queued + sending > 0) so the
  // widget tracks the worker as it drains the queue.
  // --------------------------------------------------------------------------
  const [queueStats, setQueueStats] = useState<{ queued: number; sending: number; sent: number; failed: number }>({
    queued: 0, sending: 0, sent: 0, failed: 0,
  })
  // Admins can dismiss the pill after a batch completes; any new in-flight
  // work (queued/sending) will un-dismiss it so the widget reappears.
  const [queueDismissed, setQueueDismissed] = useState(false)

  const loadQueueStats = useCallback(async () => {
    if (!eventId) return
    try {
      const statuses = ['queued', 'sending', 'sent', 'failed'] as const
      const counts = await Promise.all(statuses.map(async (status) => {
        const { count } = await supabase
          .from('email_outbox')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .eq('status', status)
        return [status, count ?? 0] as const
      }))
      const next = counts.reduce((acc, [status, n]) => ({ ...acc, [status]: n }), {
        queued: 0, sending: 0, sent: 0, failed: 0,
      } as { queued: number; sending: number; sent: number; failed: number })
      setQueueStats(next)
      // New in-flight work → un-dismiss so the pill reappears for the next batch.
      if (next.queued > 0 || next.sending > 0) setQueueDismissed(false)
    } catch (err) {
      console.error('loadQueueStats error:', err)
    }
  }, [eventId])

  // Initial load + poll while queue is active
  useEffect(() => {
    loadQueueStats()
    const active = queueStats.queued > 0 || queueStats.sending > 0
    if (!active) return
    const iv = setInterval(loadQueueStats, 5000)
    return () => clearInterval(iv)
  }, [loadQueueStats, queueStats.queued, queueStats.sending])

  // Fetch event
  useEffect(() => {
    let active = true
    fetchEvent(eventId)
      .then(data => { if (active) { setEvent(data); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [eventId])

  // Fetch applicants (batched to avoid Supabase's 1000-row default limit)
  const loadApplicants = useCallback(async () => {
    setAppLoading(true)

    const BATCH = 1000
    let allRows: any[] = []
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('applications')
        .select(`
          id, student_id, status, internal_review_status, submitted_at, attended, reviewed_by, reviewed_at, raw_response,
          attribution_source, channel,
          students!inner(first_name, last_name, preferred_name, personal_email, year_group, school_id,
            school_type, bursary_90plus, free_school_meals, parental_income_band,
            first_generation_uni, gcse_results, qualifications, additional_context,
            schools(name)
          ),
          application_rsvp(confirmed, confirmed_at)
        `)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false })
        .range(from, from + BATCH - 1)

      if (error) { setAppLoading(false); return }
      allRows = allRows.concat(batch ?? [])
      hasMore = (batch?.length ?? 0) === BATCH
      from += BATCH
    }

    const data = allRows

    // Also fetch reviewer names
    const reviewerIds = [...new Set((data ?? []).map((r: any) => r.reviewed_by).filter(Boolean))]
    let reviewerMap: Record<string, string> = {}
    if (reviewerIds.length > 0) {
      const { data: reviewers } = await supabase
        .from('team_members')
        .select('auth_uuid, name')
        .in('auth_uuid', reviewerIds)
      for (const r of reviewers ?? []) {
        reviewerMap[r.auth_uuid] = r.name
      }
    }

    // Pull engagement metrics from the students_enriched view so we can surface
    // cumulative engagement score and "past events attended" — separate from the
    // academic grade score. Used to spot repeat applicants at a glance.
    const studentIds = [...new Set((data ?? []).map((r: any) => r.student_id).filter(Boolean))] as string[]
    const enrichedMap: Record<string, { engagement_score: number; attended_count: number; accepted_count: number; submitted_count: number; total_applications: number; no_show_count: number }> = {}
    if (studentIds.length > 0) {
      const { data: enriched } = await supabase
        .from('students_enriched')
        .select('id, engagement_score, attended_count, accepted_count, submitted_count, total_applications, no_show_count')
        .in('id', studentIds)
      for (const e of enriched ?? []) {
        enrichedMap[e.id] = {
          engagement_score: e.engagement_score ?? 0,
          attended_count: e.attended_count ?? 0,
          accepted_count: e.accepted_count ?? 0,
          submitted_count: e.submitted_count ?? 0,
          total_applications: e.total_applications ?? 0,
          no_show_count: e.no_show_count ?? 0,
        }
      }
    }

    const mapped: Applicant[] = (data ?? []).map((row: any) => {
      const s = row.students
      const rsvp = row.application_rsvp
      const raw = row.raw_response ?? {}

      // Qualifications now live on students (two-stage refactor). Fall back to
      // raw_response for any legacy row that missed the backfill.
      const qualsSource = Array.isArray(s.qualifications)
        ? s.qualifications
        : (Array.isArray(raw.qualifications) ? raw.qualifications : [])
      const quals: QualEntry[] = qualsSource.map((q: any) => ({
        qualType: q.type ?? q.qualType ?? '',
        subject: q.subject ?? '',
        grade: q.grade ?? '',
        level: q.level,
      }))

      // Parse custom field answers
      const customFields: Record<string, unknown> = {}
      if (raw.custom_fields && typeof raw.custom_fields === 'object') {
        Object.assign(customFields, raw.custom_fields)
      }

      const eligibility = computeEligibility({
        school_type: s.school_type,
        bursary_90plus: s.bursary_90plus,
        free_school_meals: s.free_school_meals,
        parental_income_band: s.parental_income_band,
      })

      return {
        id: row.id,
        student_id: row.student_id,
        first_name: s.first_name,
        last_name: s.last_name,
        preferred_name: s.preferred_name ?? null,
        personal_email: s.personal_email,
        school_name: s.schools?.name ?? null,
        school_type: s.school_type ?? null,
        year_group: s.year_group,
        status: row.status,
        internal_review_status: (row.internal_review_status ?? null) as InternalReviewStatusCode | null,
        submitted_at: row.submitted_at,
        attended: row.attended ?? false,
        reviewed_by: row.reviewed_by,
        reviewer_name: row.reviewed_by ? (reviewerMap[row.reviewed_by] ?? null) : null,
        reviewed_at: row.reviewed_at,
        rsvp_confirmed: rsvp ? rsvp.confirmed : null,
        rsvp_confirmed_at: rsvp?.confirmed_at ?? null,
        bursary_90plus: s.bursary_90plus ?? null,
        free_school_meals: s.free_school_meals ?? null,
        parental_income_band: s.parental_income_band ?? null,
        qualifications: quals,
        customFields,
        additionalContext: typeof s.additional_context === 'string' && s.additional_context.trim()
          ? s.additional_context
          : (typeof raw.additional_context === 'string' ? raw.additional_context : null),
        anythingElse: typeof raw.anything_else === 'string' ? raw.anything_else : null,
        firstGenerationUni: typeof s.first_generation_uni === 'boolean' ? s.first_generation_uni : null,
        gcseResults: typeof s.gcse_results === 'string' ? s.gcse_results : null,
        attributionSource: typeof row.attribution_source === 'string' ? row.attribution_source : null,
        attributionChannel: typeof row.channel === 'string' ? row.channel : null,
        engagementScore: enrichedMap[row.student_id]?.engagement_score ?? 0,
        attendedCount: enrichedMap[row.student_id]?.attended_count ?? 0,
        acceptedCount: enrichedMap[row.student_id]?.accepted_count ?? 0,
        submittedCount: enrichedMap[row.student_id]?.submitted_count ?? 0,
        totalApplications: enrichedMap[row.student_id]?.total_applications ?? 0,
        noShowCount: enrichedMap[row.student_id]?.no_show_count ?? 0,
        eligibility,
        gradeScore: scoreGrades(quals),
      }
    })

    setApplicants(mapped)
    setAppLoading(false)
  }, [eventId])

  useEffect(() => { loadApplicants() }, [loadApplicants])

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let list = applicants
    if (statusFilter !== 'all') {
      list = list.filter(a => a.status === statusFilter)
    }
    if (yearGroupFilter !== 'all') {
      list = list.filter(a => String(a.year_group) === yearGroupFilter)
    }
    if (schoolTypeFilter !== 'all') {
      list = list.filter(a => (a.school_type?.toLowerCase() ?? '') === schoolTypeFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
        (a.personal_email?.toLowerCase().includes(q) ?? false) ||
        (a.school_name?.toLowerCase().includes(q) ?? false)
      )
    }
    if (minGradeScore > 0) {
      list = list.filter(a => a.gradeScore >= minGradeScore)
    }
    // Sort
    const dir = sortDir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
        case 'school_type': return dir * (a.school_type ?? '').localeCompare(b.school_type ?? '')
        case 'year_group': return dir * ((a.year_group ?? 0) - (b.year_group ?? 0))
        case 'status': return dir * a.status.localeCompare(b.status)
        case 'gradeScore': return dir * (a.gradeScore - b.gradeScore)
        case 'submitted_at': return dir * (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '')
        case 'engagement': return dir * (a.engagementScore - b.engagementScore)
        // Past events: rank by attended count (the most meaningful engagement signal), breaking ties by accepted then submitted.
        case 'past_events': {
          const ap = (a.attendedCount ?? 0) - (a.attended ? 1 : 0)
          const bp = (b.attendedCount ?? 0) - (b.attended ? 1 : 0)
          if (ap !== bp) return dir * (ap - bp)
          const aa = Math.max(0, (a.acceptedCount ?? 0) - (a.status === 'accepted' ? 1 : 0))
          const ba = Math.max(0, (b.acceptedCount ?? 0) - (b.status === 'accepted' ? 1 : 0))
          if (aa !== ba) return dir * (aa - ba)
          return dir * (Math.max(0, (a.totalApplications ?? 0) - 1) - Math.max(0, (b.totalApplications ?? 0) - 1))
        }
        // Boolean sort — confirmed/yes first when desc.
        case 'rsvp': return dir * (Number(b.rsvp_confirmed === true) - Number(a.rsvp_confirmed === true))
        case 'attended': return dir * (Number(b.attended ? 1 : 0) - Number(a.attended ? 1 : 0))
        default: return 0
      }
    })
    return list
  }, [applicants, statusFilter, yearGroupFilter, schoolTypeFilter, search, minGradeScore, sortKey, sortDir])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: applicants.length }
    for (const a of applicants) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [applicants])

  // Unique values for filter dropdowns
  const uniqueYearGroups = useMemo(() => {
    const ygs = new Set<number>()
    applicants.forEach(a => { if (a.year_group) ygs.add(a.year_group) })
    return Array.from(ygs).sort()
  }, [applicants])

  const uniqueSchoolTypes = useMemo(() => {
    const sts = new Set<string>()
    applicants.forEach(a => { if (a.school_type) sts.add(a.school_type.toLowerCase()) })
    return Array.from(sts).sort()
  }, [applicants])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [statusFilter, yearGroupFilter, schoolTypeFilter, search, minGradeScore, sortKey, sortDir])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const updateStatus = async (appId: string, newStatus: string) => {
    setSaving(prev => new Set(prev).add(appId))
    const old = applicants.find(a => a.id === appId)
    const now = new Date().toISOString()

    // Auto-clear any internal draft decision that's now subsumed by the committed
    // status — e.g. internal=shortlist + committed→shortlisted, or internal=reject
    // + committed→rejected. Keeps the chip honest without extra admin clicks.
    const shouldClearInternal = old
      ? internalReviewSubsumedBy(old.internal_review_status, newStatus as any)
      : false

    await supabase
      .from('applications')
      .update({
        status: newStatus,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewed_at: now,
        updated_by: teamMember?.auth_uuid ?? null,
        updated_at: now,
        ...(shouldClearInternal ? { internal_review_status: null, internal_review_at: null, internal_review_by: null } : {}),
      } as any)
      .eq('id', appId)

    // Log status change
    if (old) {
      await supabase.from('application_status_history').insert({
        application_id: appId,
        old_status: old.status,
        new_status: newStatus,
        changed_by: teamMember?.auth_uuid ?? null,
      })
    }

    // Optimistic update
    setApplicants(prev => prev.map(a =>
      a.id === appId ? {
        ...a,
        status: newStatus,
        internal_review_status: shouldClearInternal ? null : a.internal_review_status,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewer_name: teamMember?.name ?? null,
        reviewed_at: now,
      } : a
    ))
    setSaving(prev => { const n = new Set(prev); n.delete(appId); return n })
  }

  // ---------------------------------------------------------------------------
  // Internal review (draft decision, never notifies the student)
  // ---------------------------------------------------------------------------

  const updateInternalReviewStatus = async (appId: string, newInternal: InternalReviewStatusCode | null) => {
    setSaving(prev => new Set(prev).add(appId))
    const now = new Date().toISOString()

    await supabase
      .from('applications')
      .update({
        internal_review_status: newInternal,
        internal_review_at: newInternal ? now : null,
        internal_review_by: newInternal ? (teamMember?.auth_uuid ?? null) : null,
        updated_by: teamMember?.auth_uuid ?? null,
        updated_at: now,
      } as any)
      .eq('id', appId)

    setApplicants(prev => prev.map(a =>
      a.id === appId ? { ...a, internal_review_status: newInternal } : a
    ))
    setSaving(prev => { const n = new Set(prev); n.delete(appId); return n })
  }

  const bulkUpdateInternalReviewStatus = async (newInternal: InternalReviewStatusCode | null) => {
    if (selected.size === 0) return
    const ids = [...selected]
    const now = new Date().toISOString()

    await supabase
      .from('applications')
      .update({
        internal_review_status: newInternal,
        internal_review_at: newInternal ? now : null,
        internal_review_by: newInternal ? (teamMember?.auth_uuid ?? null) : null,
        updated_by: teamMember?.auth_uuid ?? null,
        updated_at: now,
      } as any)
      .in('id', ids)

    setApplicants(prev => prev.map(a =>
      ids.includes(a.id) ? { ...a, internal_review_status: newInternal } : a
    ))
  }

  const toggleAttended = async (appId: string) => {
    const app = applicants.find(a => a.id === appId)
    if (!app) return
    const newVal = !app.attended

    setSaving(prev => new Set(prev).add(appId))
    await supabase
      .from('applications')
      .update({ attended: newVal, updated_at: new Date().toISOString() } as any)
      .eq('id', appId)

    setApplicants(prev => prev.map(a =>
      a.id === appId ? { ...a, attended: newVal } : a
    ))
    setSaving(prev => { const n = new Set(prev); n.delete(appId); return n })
  }

  const bulkUpdateStatus = async (newStatus: string, reasonOverride?: string | null) => {
    if (selected.size === 0) return
    const ids = [...selected]
    // Breakdown by current status so the admin sees what's actually changing.
    // Rows already on the target status are dropped from the UPDATE — that avoids
    // pointless writes (and, downstream, any side effects like re-firing emails
    // when a "notify" path is wired up later).
    const selectedApps = applicants.filter(a => selected.has(a.id))
    const changing = selectedApps.filter(a => a.status !== newStatus)
    const alreadyMatching = selectedApps.length - changing.length
    const targetLabel = STATUS_MAP[newStatus]?.label ?? newStatus
    const byCurrent: Record<string, number> = {}
    for (const a of changing) byCurrent[a.status] = (byCurrent[a.status] ?? 0) + 1
    const breakdown = Object.entries(byCurrent)
      .map(([code, n]) => `  • ${n} ${STATUS_MAP[code]?.label ?? code} → ${targetLabel}`)
      .join('\n')
    const summary = changing.length === 0
      ? `All ${selectedApps.length} selected applicants are already "${targetLabel}". Nothing to update.`
      : `Will update ${changing.length} of ${selectedApps.length} selected:\n${breakdown}` +
        (alreadyMatching > 0 ? `\n  • ${alreadyMatching} already ${targetLabel} (no change)` : '')
    if (!window.confirm(summary + '\n\nProceed?')) return
    if (changing.length === 0) return

    const changingIds = changing.map(a => a.id)
    const now = new Date().toISOString()

    // Log history for each row that actually changes.
    for (const a of changing) {
      await supabase.from('application_status_history').insert({
        application_id: a.id,
        old_status: a.status,
        new_status: newStatus,
        changed_by: teamMember?.auth_uuid ?? null,
      })
    }

    // decision_reason — admin-only short note attached to the *current*
    // committed decision. Only write the column when a reason is provided,
    // so existing rows aren't unintentionally cleared.
    const reason = ((reasonOverride !== undefined ? reasonOverride : bulkDecisionReason) ?? '').trim()
    const updates: Record<string, unknown> = {
      status: newStatus,
      reviewed_by: teamMember?.auth_uuid ?? null,
      reviewed_at: now,
      updated_by: teamMember?.auth_uuid ?? null,
      updated_at: now,
    }
    if (reason.length > 0) {
      updates.decision_reason = reason
    }

    await supabase
      .from('applications')
      .update(updates as any)
      .in('id', changingIds)

    setApplicants(prev => prev.map(a =>
      changingIds.includes(a.id) ? {
        ...a,
        status: newStatus,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewer_name: teamMember?.name ?? null,
        reviewed_at: now,
      } : a
    ))
    setSelected(new Set())
    setBulkDecisionReason('')
  }

  // Delete handlers
  const handleDeleteApplications = async (mode: 'soft' | 'hard') => {
    if (selected.size === 0) return
    setDeleteLoading(true)
    const ids = [...selected]

    try {
      if (mode === 'soft') {
        const { error } = await supabase
          .from('applications')
          .update({ deleted_at: new Date().toISOString() })
          .in('id', ids)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('applications')
          .delete()
          .in('id', ids)
        if (error) throw error
      }

      setSelected(new Set())
      setDeleteModal({ open: false, mode: null })
      // Refetch in case RLS / concurrent changes diverged from local state
      await loadApplicants()
    } catch (err: any) {
      alert(`Delete failed: ${err?.message ?? 'Unknown error'}`)
    } finally {
      setDeleteLoading(false)
    }
  }

  // Select helpers
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleSelectAll = () => {
    const pageIds = paged.map(a => a.id)
    const allPageSelected = pageIds.every(id => selected.has(id))
    if (allPageSelected) {
      setSelected(prev => { const n = new Set(prev); pageIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); pageIds.forEach(id => n.add(id)); return n })
    }
  }

  // Select-all-in-filter helpers for the Gmail-style banner. When admins tick
  // the page header checkbox on a 400-row filter, they likely want the full
  // 400, not just the 50 visible ones — but silently selecting all of them
  // would be a footgun for bulk actions, so we require a deliberate second
  // click via the banner.
  const filteredIds = useMemo(() => filtered.map(a => a.id), [filtered])
  const allPageSelected = paged.length > 0 && paged.every(a => selected.has(a.id))
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))
  const selectAllFiltered = () => {
    setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.add(id)); return n })
  }
  const clearSelection = () => setSelected(new Set())

  // Silently clear selection when the set of filtered rows changes — otherwise
  // admins could retain a stale selection that includes rows no longer visible,
  // and end up running a bulk action on a ghost set.
  const filteredSigRef = useRef('')
  useEffect(() => {
    const sig = filteredIds.length === 0 ? '' : `${filteredIds.length}:${filteredIds[0]}:${filteredIds[filteredIds.length - 1]}`
    if (filteredSigRef.current && filteredSigRef.current !== sig) {
      setSelected(new Set())
    }
    filteredSigRef.current = sig
  }, [filteredIds])

  // ---------------------------------------------------------------------------
  // Email compose helpers
  // ---------------------------------------------------------------------------

  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('email_templates')
      .select('id, name, type, subject, body_html, event_id')
      .is('deleted_at', null)
      .order('name')
    setTemplates((data ?? []) as any[])
  }, [])

  const openCompose = (action?: string) => {
    setNotifyAction(action ?? null)
    loadTemplates().then(() => {
      // If this is a combined action, auto-select matching template
      if (action) {
        const matchType = NOTIFY_STATUSES.find(n => n.code === action)?.templateType
        if (matchType) {
          // Will be applied once templates load — see effect below
        }
      }
    })
    setShowCompose(true)
    setEmailStep('pick')
    setSelectedTemplate('')
    setEmailSubject('')
    setEmailBody('')
    setTemplateDirty(false)
    setBodySeedCounter(c => c + 1)
    setSendProgress({ sent: 0, failed: 0, total: 0 })
  }

  // Auto-apply template when templates load for a combined action
  useEffect(() => {
    if (!notifyAction || templates.length === 0) return
    const matchType = NOTIFY_STATUSES.find(n => n.code === notifyAction)?.templateType
    if (!matchType) return
    // Find a matching template (prefer event-specific, fall back to global)
    const eventMatch = templates.find(t => t.type === matchType && t.event_id === eventId)
    const globalMatch = templates.find(t => t.type === matchType && !t.event_id)
    const match = eventMatch ?? globalMatch
    if (match && !selectedTemplate) {
      setSelectedTemplate(match.id)
      setEmailSubject(match.subject)
      setEmailBody(match.body_html)
      setTemplateDirty(false)
      setBodySeedCounter(c => c + 1)
    }
  }, [templates, notifyAction, eventId, selectedTemplate])

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) return
    setSelectedTemplate(templateId)
    setEmailSubject(tpl.subject)
    setEmailBody(tpl.body_html)
    setTemplateDirty(false)
    setBodySeedCounter(c => c + 1)
  }

  // Rename the currently-selected template. Prompts for the new name,
  // updates the row in email_templates, then refreshes the local cache so
  // the dropdown / header strip reflect the change.
  const renameSelectedTemplate = async () => {
    if (!selectedTemplate) return
    const current = templates.find(t => t.id === selectedTemplate)
    if (!current) return
    const next = window.prompt('Rename this template', current.name)
    if (!next || next.trim() === '' || next.trim() === current.name) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        name: next.trim(),
        updated_at: new Date().toISOString(),
        updated_by: teamMember?.auth_uuid ?? null,
      }).eq('id', selectedTemplate)
      const { data } = await supabase
        .from('email_templates')
        .select('id, name, type, subject, body_html, event_id')
        .is('deleted_at', null)
        .order('name')
      setTemplates((data ?? []) as any[])
    } finally {
      setSavingTemplate(false)
    }
  }

  // Soft-delete the selected template via deleted_at. Confirms first, and
  // refuses to delete the last template of a given type so the auto-load
  // effect for Accept/Reject/Waitlist still has something to fall back to.
  const deleteSelectedTemplate = async () => {
    if (!selectedTemplate) return
    const current = templates.find(t => t.id === selectedTemplate)
    if (!current) return
    const remainingOfType = templates.filter(t => t.type === current.type && t.id !== selectedTemplate)
    if (remainingOfType.length === 0) {
      window.alert(`Can't delete — this is the only ${current.type} template. Create a replacement first.`)
      return
    }
    if (!window.confirm(`Delete the template "${current.name}"? You can recreate it later.`)) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        deleted_at: new Date().toISOString(),
      }).eq('id', selectedTemplate)
      // Reset selection and refresh the cache
      setSelectedTemplate('')
      setEmailSubject('')
      setEmailBody('')
      setTemplateDirty(false)
      setBodySeedCounter(c => c + 1)
      const { data } = await supabase
        .from('email_templates')
        .select('id, name, type, subject, body_html, event_id')
        .is('deleted_at', null)
        .order('name')
      setTemplates((data ?? []) as any[])
    } finally {
      setSavingTemplate(false)
    }
  }

  // Save current subject+body as a brand-new template. Typed by the
  // current notifyAction (acceptance / rejection / waitlist) or 'custom',
  // scoped to this event.
  const openTemplateEditor = () => {
    if (!selectedTemplate) return
    const current = templates.find(t => t.id === selectedTemplate)
    if (!current) return
    setEditTemplateError(null)
    setEditingTemplate(current)
  }

  const saveEditedTemplate = async (draft: { name: string; type: string; subject: string; body_html: string }) => {
    if (!editingTemplate) return
    setSavingTemplate(true)
    setEditTemplateError(null)
    try {
      const { error } = await supabase.from('email_templates')
        .update({
          name: draft.name,
          type: draft.type,
          subject: draft.subject,
          body_html: draft.body_html,
          updated_by: (teamMember as any)?.auth_uuid ?? null,
        })
        .eq('id', editingTemplate.id)
      if (error) { setEditTemplateError(error.message); return }
      await loadTemplates()
      if (selectedTemplate === editingTemplate.id) {
        setEmailSubject(draft.subject)
        setEmailBody(draft.body_html)
        setBodySeedCounter(c => c + 1)
        setTemplateDirty(false)
      }
      setEditingTemplate(null)
    } finally {
      setSavingTemplate(false)
    }
  }

  const saveCurrentAsNewTemplate = async () => {
    const name = window.prompt('Name for the new template?')?.trim()
    if (!name) return
    if (!emailSubject.trim() || !emailBody.trim()) {
      alert('Write a subject and body first, then save as a new template.')
      return
    }
    const defaultType = notifyAction
      ? NOTIFY_STATUSES.find(n => n.code === notifyAction)?.templateType ?? 'custom'
      : 'custom'
    setSavingTemplate(true)
    try {
      const { data, error } = await supabase.from('email_templates').insert({
        name,
        type: defaultType,
        subject: emailSubject,
        body_html: emailBody,
        event_id: eventId,
        created_by: teamMember?.auth_uuid ?? null,
        updated_by: teamMember?.auth_uuid ?? null,
      }).select('id').single()
      if (error) throw error
      const { data: refreshed } = await supabase
        .from('email_templates')
        .select('id, name, type, subject, body_html, event_id')
        .is('deleted_at', null)
        .order('name')
      setTemplates((refreshed ?? []) as any[])
      if (data?.id) {
        setSelectedTemplate(data.id)
        setTemplateDirty(false)
      }
    } catch (e: any) {
      alert(`Couldn't save template: ${e?.message ?? e}`)
    } finally {
      setSavingTemplate(false)
    }
  }

  // Persist subject/body edits back to the selected template so the next
  // send for this status starts from the customised version.
  const saveTemplateChanges = async () => {
    if (!selectedTemplate) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        subject: emailSubject,
        body_html: emailBody,
        updated_at: new Date().toISOString(),
        updated_by: teamMember?.auth_uuid ?? null,
      }).eq('id', selectedTemplate)
      setTemplateDirty(false)
      // Refresh local cache so the template list reflects the saved values.
      const { data } = await supabase
        .from('email_templates')
        .select('id, name, type, subject, body_html, event_id')
        .is('deleted_at', null)
        .order('name')
      setTemplates((data ?? []) as any[])
    } finally {
      setSavingTemplate(false)
    }
  }

  const fillMergeFields = (text: string, applicant: Applicant) => {
    const applyLinkUrl = `https://the-steps-foundation-intranet.vercel.app/apply/${event?.slug ?? ''}`
    return text
      .replace(/\{\{first_name\}\}/g, (applicant.preferred_name && applicant.preferred_name.trim()) ? applicant.preferred_name : applicant.first_name)
      .replace(/\{\{last_name\}\}/g, applicant.last_name)
      .replace(/\{\{full_name\}\}/g, `${applicant.first_name} ${applicant.last_name}`)
      .replace(/\{\{email\}\}/g, applicant.personal_email ?? '')
      .replace(/\{\{event_name\}\}/g, event?.name ?? '')
      .replace(/\{\{event_date\}\}/g, event?.event_date
        ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : 'TBC')
      .replace(/\{\{event_location\}\}/g, event?.location ?? 'TBC')
      .replace(/\{\{event_location_full\}\}/g, event?.location_full ?? event?.location ?? 'TBC')
      .replace(/\{\{event_time\}\}/g, [event?.time_start, event?.time_end].filter(Boolean).join(' – ') || 'TBC')
      .replace(/\{\{dress_code\}\}/g, event?.dress_code ?? '')
      .replace(/\{\{event_dress_code\}\}/g, event?.dress_code ?? '')
      .replace(/\{\{apply_link\}\}/g, applyLinkUrl)
      .replace(/\{\{portal_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/my')
      .replace(/\{\{rsvp_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/my')
      .replace(/\{\{application_deadline\}\}/g, event?.applications_close_at
        ? new Date(event.applications_close_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).replace(',', ' at')
        : 'TBC')
      .replace(/\{\{open_to\}\}/g, formatOpenTo(event?.eligible_year_groups, event?.open_to_gap_year ?? false))
      // last_attended_event isn't meaningful in the decision flow (we're
      // emailing about THE event, not a past one). Clear it rather than
      // leaking the raw token.
      .replace(/\{\{last_attended_event\}\}/g, event?.name ?? '')
  }

  const getRecipients = () => {
    return applicants.filter(a => selected.has(a.id) && a.personal_email)
  }

  // Queue all recipients into email_outbox in a single bulk insert. The
  // server-side worker (pg_cron -> /api/process-email-queue) handles the
  // actual Gmail sends at ~50/minute, so this returns in a second or two
  // regardless of recipient count and survives the admin closing the tab.
  const sendEmails = async () => {
    const recipients = getRecipients()
    if (recipients.length === 0) return

    setEmailStep('sending')
    setSendProgress({ sent: 0, failed: 0, total: recipients.length })

    const now = new Date().toISOString()

    // Build all outbox rows — merge tags resolved per recipient, signature
    // appended, body converted to HTML if it was stored as plain text.
    const outboxRows = recipients.map(recipient => {
      const renderedSubject = fillMergeFields(emailSubject, recipient)
      const renderedBody = fillMergeFields(emailBody, recipient)
      const bodyHtml = looksLikeHtml(renderedBody) ? renderedBody : plainTextToHtml(renderedBody)
      const fullBody = bodyHtml + EMAIL_SIGNATURE_HTML
      return {
        queued_by: (teamMember as any)?.auth_uuid ?? null,
        event_id: eventId,
        application_id: recipient.id,
        student_id: recipient.student_id,
        template_id: selectedTemplate || null,
        to_email: recipient.personal_email!,
        from_email: 'events@thestepsfoundation.com',
        subject: renderedSubject,
        body_html: fullBody,
        attachments: emailAttachments,
      }
    })

    try {
      const { error: insertErr } = await supabase.from('email_outbox').insert(outboxRows)
      if (insertErr) {
        console.error('enqueue error:', insertErr)
        setSendProgress({ sent: 0, failed: recipients.length, total: recipients.length })
        setEmailStep('done')
        return
      }
      // All rows queued — treat as "sent" from the admin's POV (they've
      // handed the work off). The queue widget surfaces actual send state.
      setSendProgress({ sent: recipients.length, failed: 0, total: recipients.length })
    } catch (err) {
      console.error('enqueue exception:', err)
      setSendProgress({ sent: 0, failed: recipients.length, total: recipients.length })
      setEmailStep('done')
      return
    }

    // Combined action: apply the status change immediately so the admin
    // sees applicants move to Accepted / Rejected / Waitlisted right away.
    // email_log_id gets linked after send by the worker (nullable here).
    if (notifyAction) {
      const ids = recipients.map(r => r.id)

      // Status history — one row per applicant whose status actually changes
      const historyRows = recipients
        .filter(r => r.status !== notifyAction)
        .map(r => ({
          application_id: r.id,
          old_status: r.status,
          new_status: notifyAction,
          changed_by: teamMember?.auth_uuid ?? null,
        }))
      if (historyRows.length > 0) {
        await supabase.from('application_status_history').insert(historyRows)
      }

      // Bulk update application statuses
      await supabase
        .from('applications')
        .update({
          status: notifyAction,
          reviewed_by: teamMember?.auth_uuid ?? null,
          reviewed_at: now,
          updated_by: teamMember?.auth_uuid ?? null,
          updated_at: now,
        } as any)
        .in('id', ids)

      setApplicants(prev => prev.map(a =>
        ids.includes(a.id) ? {
          ...a,
          status: notifyAction,
          reviewed_by: teamMember?.auth_uuid ?? null,
          reviewer_name: teamMember?.name ?? null,
          reviewed_at: now,
        } : a
      ))
    }

    // Refresh the queue stats widget so the admin sees their new queued items
    loadQueueStats()
    setEmailStep('done')
  }

  // ---------------------------------------------------------------------------
  // RSVP helpers
  // ---------------------------------------------------------------------------

  const rsvpStats = useMemo(() => {
    const accepted = applicants.filter(a => a.status === 'accepted')
    const confirmed = accepted.filter(a => a.rsvp_confirmed === true)
    return { accepted: accepted.length, confirmed: confirmed.length }
  }, [applicants])

  // ---------------------------------------------------------------------------
  // Custom field columns (from event form_config)
  // ---------------------------------------------------------------------------

  const customFieldCols = useMemo(() => {
    if (!event?.form_config) return []
    type Field = { id: string; label: string; type: string }
    const cfg = event.form_config as { fields?: Field[]; pages?: { fields?: Field[] }[] }
    // Form schema may use top-level fields (legacy) or nested pages[].fields (current). Collect from both and de-dupe by id.
    const seen = new Set<string>()
    const all: Field[] = []
    for (const f of [...(cfg.fields ?? []), ...((cfg.pages ?? []).flatMap(p => p.fields ?? []))]) {
      if (f && f.id && !seen.has(f.id))  { seen.add(f.id); all.push(f) }
    }
    return all
      // Exclude display-only fields (no student response to show in a column).
      .filter(f => f.type !== 'section_heading' && f.type !== 'media')
      .map(f => ({ id: f.id, label: stripToText(f.label), type: f.type }))
  }, [event])

  // Standard-question columns (std_additional, std_anything_else, std_attribution).
  // These are part of every apply form unless the admin explicitly hides them via
  // standard_overrides — so we mirror that: if hidden, we don't offer it as a
  // column either, since there'll be no data to show for new applicants.
  // Admins can still rename the question via stdOverrides.label; we mirror that
  // into the column label so the picker matches the apply form.
  const standardCols = useMemo(() => {
    if (!event?.form_config) return []
    const overrides = (event.form_config as { standard_overrides?: StandardOverrides }).standard_overrides ?? {}
    const entries: { id: string; defaultLabel: string }[] = [
      { id: 'std_first_gen',     defaultLabel: 'First-generation university student?' },
      { id: 'std_additional',    defaultLabel: 'Any additional contextual information?' },
      { id: 'std_anything_else', defaultLabel: 'Anything else you’d like us to know?' },
      { id: 'std_attribution',   defaultLabel: 'How did you hear about this opportunity?' },
    ]
    return entries
      .filter(e => !overrides[e.id]?.hidden)
      .map(e => ({ id: e.id, label: stripToText(overrides[e.id]?.label ?? e.defaultLabel) }))
  }, [event])
  // Compute the effective ordered list of all visible columns (built-in + standard + custom)
  const allColumns = useMemo(() => {
    const builtIn: { id: string; label: string; kind: 'builtin' }[] =
      DEFAULT_BUILTIN_COLS.map(id => ({ id, label: BUILTIN_COL_LABELS[id], kind: 'builtin' as const }))
    const standard: { id: string; label: string; kind: 'standard' }[] =
      standardCols.map(c => ({ id: c.id, label: c.label, kind: 'standard' as const }))
    const custom: { id: string; label: string; kind: 'custom' }[] =
      customFieldCols.map(c => ({ id: `cf_${c.id}`, label: c.label, kind: 'custom' as const }))
    const all = [...builtIn, ...standard, ...custom]
    // Apply custom ordering if set
    if (colOrder.length > 0) {
      const map = new Map(all.map(c => [c.id, c]))
      const ordered = colOrder.filter(id => map.has(id)).map(id => map.get(id)!)
      // Add any new columns not in the saved order
      const inOrder = new Set(colOrder)
      all.filter(c => !inOrder.has(c.id)).forEach(c => ordered.push(c))
      return ordered
    }
    return all
  }, [customFieldCols, standardCols, colOrder])

  // Which column ids are click-to-sort eligible in the table header. We only
  // wire inline sort for columns that expose an unambiguous numeric/sortable
  // signal (the existing Sort-by dropdown still handles everything — this is
  // additive, not a replacement).
  const COL_SORT_KEY: Record<string, SortKey> = {
    name: 'name',
    school_type: 'school_type',
    status: 'status',
    grades: 'gradeScore',
    engagement: 'engagement',
    past_events: 'past_events',
    rsvp: 'rsvp',
    attended: 'attended',
  }
  // First-click direction for each sortable key. Numeric signals default to
  // "highest first" (desc) since that's what admins almost always want when
  // scanning grade/engagement scores.
  const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
    name: 'asc',
    school_type: 'asc',
    year_group: 'asc',
    status: 'asc',
    gradeScore: 'desc',
    submitted_at: 'desc',
    engagement: 'desc',
    past_events: 'desc',
    rsvp: 'desc',
    attended: 'desc',
  }
  const handleHeaderSort = (colId: string) => {
    const key = COL_SORT_KEY[colId]
    if (!key) return
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_SORT_DIR[key] ?? 'desc')
    }
  }

    const visibleColumns = useMemo(() => {
    return allColumns.filter(c => {
      if (hiddenCols.has(c.id)) return false
      // Auto-hide status when filtering by a specific status
      if (c.id === 'status' && statusFilter !== 'all') return false
      return true
    })
  }, [allColumns, hiddenCols, statusFilter])

  const toggleCol = useCallback((id: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      pushDashboardColumns(next, colOrder)
      return next
    })
  }, [colOrder, pushDashboardColumns])

  const reorderCols = useCallback((nextOrder: string[]) => {
    setColOrder(nextOrder)
    pushDashboardColumns(hiddenCols, nextOrder)
  }, [hiddenCols, pushDashboardColumns])

  const resetCols = useCallback(() => {
    setHiddenCols(new Set())
    setColOrder([])
    pushDashboardColumns(new Set(), [])
  }, [pushDashboardColumns])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-gray-500 dark:text-gray-400">Loading event…</div>
      </main>
    )
  }

  if (!event) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-red-600 dark:text-red-400">Event not found.</div>
        <Link href="/students/events" className="text-sm text-steps-blue-600 dark:text-steps-blue-400 hover:underline mt-2 inline-block">
          Back to Events
        </Link>
      </main>
    )
  }

  const formattedDate = event.event_date
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : 'Date TBC'

  const attendedCount = applicants.filter(a => a.attended).length
  const acceptedCount = applicants.filter(a => a.status === 'accepted').length

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/students/events" className="text-sm text-steps-blue-600 dark:text-steps-blue-400 hover:underline">
          &larr; Events
        </Link>
      </div>

      {/* Event header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
        {editing ? (
          /* ---- EDIT MODE ---- */
          <div className="space-y-4">
            {eventActionErr && (
              <div role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
                {eventActionErr}
              </div>
            )}
            {/* Sticky action bar: always-visible Save / Cancel / Preview / Copy-link */}
            <div className="sticky top-0 z-30 -mx-6 -mt-6 px-6 py-3 mb-2 flex flex-wrap items-center gap-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mr-auto">Edit Event</h2>
              <button
                type="button"
                onClick={() => copySignupLink(editDraft.slug ?? event.slug)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors"
                title="Copy sign-up link to clipboard"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                {signupLinkCopied === (editDraft.slug ?? event.slug) ? 'Copied!' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={() => { void openPreview() }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors"
                title="Preview the form as a new applicant"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                Preview
              </button>
              {/* Autosave status pill — shows live progress so the admin can trust their edits are landing without hitting Save. */}
              <AutosaveStatusPill status={autosaveStatus} savedAt={autosaveSavedAt} error={autosaveError} onRetry={() => { void runAutosave() }} />
              <button
                type="button"
                onClick={handleArchiveEvent}
                disabled={archiving || deleting || cancelling}
                className="px-3 py-1.5 text-sm rounded-md border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
                title={event.archived_at ? 'Restore this event to the default events list' : 'Hide this event from the default events list'}
              >
                {archiving ? '…' : event.archived_at ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={handleCancelEvent}
                disabled={archiving || deleting || cancelling}
                className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 disabled:opacity-50"
                title={event.status === 'cancelled' ? 'Restore from cancelled back to draft' : 'Mark this event as cancelled — applicants will see cancelled status'}
              >
                {cancelling ? '…' : event.status === 'cancelled' ? 'Uncancel' : 'Cancel event'}
              </button>
              <button
                type="button"
                onClick={handleDeleteEvent}
                disabled={archiving || deleting}
                className="px-3 py-1.5 text-sm rounded-md border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-50"
                title="Soft-delete this event. Applications stay in the DB; the row can be restored from Supabase."
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <span className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" aria-hidden />
              <button onClick={() => { void cancelEditing() }} disabled={editSaving} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50" title="Reverts any changes saved during this edit session">Cancel</button>
              <button onClick={saveEditing} disabled={editSaving || !editDraft.name || !editDraft.slug} className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50">{editSaving ? 'Saving…' : 'Save changes'}</button>
            </div>

            {/* === Publish checklist ===
                Live state of every required field. Ticks flip green as the admin
                fills things in. */}
            {(() => {
              const projectedStatus = (editDraft.status ?? event.status) as EventRow['status']
              const isPublished = projectedStatus !== 'draft'
              const ready = liveChecklist.length === 0
              return (
                <div className={`mb-4 rounded-lg border ${ready ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800' : 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800'} px-4 py-3`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className={`text-sm font-semibold ${ready ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-900 dark:text-amber-200'}`}>
                      {ready
                        ? (isPublished ? 'Published — all requirements met' : 'Ready to publish — set status above to Open')
                        : `Publish checklist · ${ALL_PUBLISH_REQUIREMENTS.length - liveChecklist.length}/${ALL_PUBLISH_REQUIREMENTS.length} done`}
                    </div>
                    {!ready && (
                      <span className="text-[11px] uppercase tracking-wider text-amber-800 dark:text-amber-300 font-bold">
                        {liveChecklist.length} missing
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                    {ALL_PUBLISH_REQUIREMENTS.map(req => {
                      const failing = liveChecklistFields.has(req.field)
                      const reason = liveChecklist.find(e => e.field === req.field)?.reason ?? ''
                      return (
                        <li key={req.field} className="flex items-start gap-1.5">
                          <span className={`mt-0.5 inline-block w-3.5 h-3.5 rounded-full flex-shrink-0 ${failing ? 'bg-rose-400' : 'bg-emerald-500 inline-flex items-center justify-center'}`} aria-hidden>
                            {!failing && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            )}
                          </span>
                          <span className={`${failing ? 'text-amber-900 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-300 line-through opacity-70'}`}>
                            <span className="font-medium">{req.label}</span>
                            {failing && reason && <span className="text-amber-700 dark:text-amber-300"> &mdash; {reason}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })()}

            {/* Section: Basics (Name, slug, status, date, times, location, capacity) */}
            <Section id="basics" title="Basics" subtitle="Name, status, date, times, location, capacity, application window, description" defaultOpen>
            {/* Row 1: Name + Slug + Status + Lead organiser */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Event name *</label>
                <input value={editDraft.name ?? ''} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Slug *</label>
                <input value={editDraft.slug ?? ''} onChange={e => setEditDraft(d => ({ ...d, slug: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                <select value={editDraft.status ?? 'draft'} onChange={e => setEditDraft(d => ({ ...d, status: e.target.value as EventRow['status'] }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Lead organiser</label>
                <select
                  value={editDraft.lead_team_member_id ?? event.lead_team_member_id ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, lead_team_member_id: e.target.value || null }))}
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">— Unassigned —</option>
                  {teamMembers.map(m => (
                    <option key={m.auth_uuid} value={m.auth_uuid}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Date + Start time + End time + Format */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Date</label>
                <input type="date" value={editDraft.event_date ?? ''} onChange={e => setEditDraft(d => ({ ...d, event_date: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start time</label>
                <input type="time" value={editDraft.time_start ?? ''} onChange={e => setEditDraft(d => ({ ...d, time_start: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">End time</label>
                <input type="time" value={editDraft.time_end ?? ''} onChange={e => setEditDraft(d => ({ ...d, time_end: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Format</label>
                <select value={editDraft.format ?? ''} onChange={e => setEditDraft(d => ({ ...d, format: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                  <option value="">—</option>
                  <option value="in_person">In person</option>
                  <option value="online">Online</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>

            {/* Row 3a: Public location (shown to everyone pre-acceptance) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Public location <span className="text-gray-400 font-normal">(shown to all applicants)</span></label>
                <input
                  value={editDraft.location ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, location: e.target.value }))}
                  placeholder="e.g. Central London — in-person"
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Full address <span className="text-gray-400 font-normal">(revealed only to accepted students)</span></label>
                <input
                  value={editDraft.location_full ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, location_full: e.target.value }))}
                  placeholder="e.g. Riverbank House, 2 Swan Lane, London EC4R 3AD"
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Row 3b: Capacity + Dress code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Capacity</label>
                <input type="number" value={editDraft.capacity ?? ''} onChange={e => setEditDraft(d => ({ ...d, capacity: e.target.value ? parseInt(e.target.value) : null }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Dress code</label>
                <input value={editDraft.dress_code ?? ''} onChange={e => setEditDraft(d => ({ ...d, dress_code: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
            </div>

            {/* Row 3c: Open to */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Open to <span className="text-gray-400 font-normal">(leave all unchecked = open to any student)</span>
              </label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {[12, 13].map(yr => {
                  const checked = Array.isArray(editDraft.eligible_year_groups) && editDraft.eligible_year_groups.includes(yr)
                  return (
                    <label key={yr} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => setEditDraft(d => {
                          const current = Array.isArray(d.eligible_year_groups) ? [...d.eligible_year_groups] : []
                          const next = e.target.checked
                            ? Array.from(new Set([...current, yr])).sort((a, b) => a - b)
                            : current.filter(v => v !== yr)
                          return { ...d, eligible_year_groups: next.length > 0 ? next : null }
                        })}
                        className="rounded border-gray-300"
                      />
                      Year {yr}
                    </label>
                  )
                })}
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={editDraft.open_to_gap_year ?? false}
                    onChange={e => setEditDraft(d => ({ ...d, open_to_gap_year: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  Gap year
                </label>
              </div>
            </div>

            {/* Row 4: Application windows (merged into Basics) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Applications open at</label>
                <input type="datetime-local" value={editDraft.applications_open_at ?? ''} onChange={e => setEditDraft(d => ({ ...d, applications_open_at: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Applications close at</label>
                <input type="datetime-local" value={editDraft.applications_close_at ?? ''} onChange={e => setEditDraft(d => ({ ...d, applications_close_at: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
            </div>

            {/* Row 5: Description (merged into Basics) */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
              <LinkableInput
                multiline
                rows={3}
                value={editDraft.description ?? ''}
                onChange={html => setEditDraft(d => ({ ...d, description: html }))}
                ariaLabel="Event description"
                className="!text-sm !px-3 !py-1.5"
              />
            </div>

            </Section>

            <Section id="images" title="Event images" subtitle="Application banner + student hub card">
            {/* Row 5b: Event images */}
            <div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <EventImageUploader
                  label="Application banner"
                  hint="Wide hero shown at the top of /apply/{slug}. Recommended 1600×400 (4:1). Drag the pin to reframe."
                  aspect="aspect-[4/1]"
                  eventId={event.id}
                  kind="banner"
                  value={editDraft.banner_image_url}
                  focalX={editDraft.banner_focal_x ?? 50}
                  focalY={editDraft.banner_focal_y ?? 50}
                  onChange={url => setEditDraft(d => ({ ...d, banner_image_url: url }))}
                  onFocalChange={(x, y) => setEditDraft(d => ({ ...d, banner_focal_x: x, banner_focal_y: y }))}
                />
                <EventImageUploader
                  label="Student hub card image"
                  hint="Thumbnail shown on the student hub event cards. Recommended 1200×675 (16:9). Drag the pin to reframe."
                  aspect="aspect-[16/9]"
                  eventId={event.id}
                  kind="hub"
                  value={editDraft.hub_image_url}
                  focalX={editDraft.hub_focal_x ?? 50}
                  focalY={editDraft.hub_focal_y ?? 50}
                  onChange={url => setEditDraft(d => ({ ...d, hub_image_url: url }))}
                  onFocalChange={(x, y) => setEditDraft(d => ({ ...d, hub_focal_x: x, hub_focal_y: y }))}
                />
              </div>
            </div>

            </Section>

            <Section id="form" title="Form questions" subtitle="Application form questions, pages, and routing">
            {/* Row 6: Custom form fields */}
            <div>
              <FormBuilder
                fields={(editDraft.form_config as { fields: FormFieldConfig[]; pages?: FormPage[]; standard_overrides?: StandardOverrides })?.fields ?? []}
                pages={(editDraft.form_config as { fields: FormFieldConfig[]; pages?: FormPage[]; standard_overrides?: StandardOverrides })?.pages}
                standardOverrides={(editDraft.form_config as { fields: FormFieldConfig[]; pages?: FormPage[]; standard_overrides?: StandardOverrides })?.standard_overrides}
                onChange={(fields, pages, standardOverrides) => setEditDraft(d => ({
                  ...d,
                  form_config: {
                    fields,
                    ...(pages ? { pages } : {}),
                    ...(standardOverrides ? { standard_overrides: standardOverrides } : {}),
                  },
                }))}
              />
            </div>
            </Section>

            <Section id="feedback" title="Post-event feedback" subtitle="Question schema for the live feedback form / QR">
              <FeedbackConfigEditor
                value={(editDraft as { feedback_config?: EventFeedbackConfig | null }).feedback_config ?? null}
                onChange={fc => setEditDraft(d => ({ ...d, feedback_config: fc }))}
              />
            </Section>
          </div>
        ) : (
          /* ---- VIEW MODE ---- */
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2 flex-wrap">
                    {event.name}
                    {event.archived_at && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 border border-slate-300">Archived</span>
                    )}
                  </h1>
                  <button onClick={startEditing} className="p-1 rounded-md text-gray-400 hover:text-steps-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Edit event details">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => copySignupLink(event.slug)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200 hover:bg-steps-blue-100 dark:bg-steps-blue-900/20 dark:text-steps-blue-400 dark:border-steps-blue-800 dark:hover:bg-steps-blue-900/30 transition-colors"
                    title="Copy sign-up link to clipboard"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    {signupLinkCopied === event.slug ? 'Copied!' : 'Copy sign-up link'}
                  </button>
                  <a href={`/apply/${event.slug}?preview=1`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors"
                    title="Preview the form as a new applicant">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    Preview form
                  </a>
                  <a href={`/students/events/${event.id}/responses`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-900/30 transition-colors"
                    title="Aggregated overview of every applicant's answers, with weighted rankings and CSV export">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    Application overview
                  </a>
                  {event.id && (eventFeedbackByEventId[event.id] || event.feedback_config) && (
                    <a href={`/students/events/${event.id}/feedback`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/30 transition-colors"
                      title="View post-event feedback, ratings and testimonials">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" /></svg>
                      View feedback
                    </a>
                  )}
                  {event.feedback_config && (
                    <a href={`/students/events/${event.id}/feedback-qr`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/30 transition-colors"
                      title="Open the fullscreen feedback QR to project on a screen">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm12 4h2m-2-4h4m-2 4v-4m0 4v2" /></svg>
                      Feedback QR
                    </a>
                  )}
                  <a href={`/students/events/${event.id}/check-in`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/30 transition-colors"
                    title="Open the door check-in scanner on this device">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" /></svg>
                    Door check-in
                  </a>
                </div>
                {/* Event detail tags */}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {/* Status badge */}
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                    event.status === 'open' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    event.status === 'closed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    event.status === 'completed' ? 'bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      event.status === 'open' ? 'bg-emerald-500' :
                      event.status === 'closed' ? 'bg-red-500' :
                      event.status === 'completed' ? 'bg-steps-blue-500' :
                      'bg-gray-400'
                    }`} />
                    {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                  </span>
                  {/* Date */}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {formattedDate}
                  </span>
                  {/* Time */}
                  {event.time_start && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}
                    </span>
                  )}
                  {/* Format (in-person / online / hybrid) */}
                  {event.format && (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      event.format === 'online' ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400' :
                      event.format === 'hybrid' ? 'bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400' :
                      'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                    }`}>
                      {event.format === 'online' ? (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      )}
                      {event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : 'Hybrid'}
                    </span>
                  )}
                  {/* Location */}
                  {event.location && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {event.location}
                    </span>
                  )}
                  {/* Capacity */}
                  {event.capacity != null && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Capacity: {event.capacity}
                    </span>
                  )}
                  {/* Dress code */}
                  {event.dress_code && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400">
                      {event.dress_code}
                    </span>
                  )}
                </div>
              </div>

            </div>
            {event.description && (
              <p
                className="mt-3 text-sm text-gray-600 dark:text-gray-300 rich-html whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(event.description) }}
              />
            )}
          </>
        )}
      </div>

      {/* === Wave 2: bento KPI strip ===
          At-a-glance funnel: Applicants → Accepted → RSVP'd → Attended.
          Applicant Manager filter chips remain below for drill-down. */}
      {!editing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiTile
            label="Applicants"
            value={applicants.length}
            tone="slate"
            sub={statusCounts.submitted ? `${statusCounts.submitted} submitted` : undefined}
            onClick={() => { setStatusFilter('all'); setSelected(new Set()) }}
          />
          <KpiTile
            label="Accepted"
            value={acceptedCount}
            tone="emerald"
            sub={event.capacity != null ? `of ${event.capacity} places` : undefined}
            onClick={() => { setStatusFilter('accepted'); setSelected(new Set()) }}
          />
          <KpiTile
            label="RSVP'd"
            value={rsvpStats.confirmed}
            tone="blue"
            sub={rsvpStats.accepted > 0 ? `${Math.round(rsvpStats.confirmed / Math.max(1, rsvpStats.accepted) * 100)}% of accepted` : 'awaiting decisions'}
          />
          <KpiTile
            label="Attended"
            value={attendedCount}
            tone="violet"
            sub={attendedCount > 0 && rsvpStats.confirmed > 0 ? `${Math.round(attendedCount / Math.max(1, rsvpStats.confirmed) * 100)}% show-up rate` : (event.event_date && new Date(event.event_date) > new Date() ? 'event upcoming' : undefined)}
          />
        </div>
      )}

      {/* Applicant Manager */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-visible">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-3">
            {/* Status filter tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              {[{ code: 'all', label: 'All' }, ...STATUSES].map(s => (
                <button
                  key={s.code}
                  onClick={() => { setStatusFilter(s.code); setSelected(new Set()) }}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    statusFilter === s.code
                      ? 'bg-steps-blue-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {s.label}
                  <span className="ml-1 opacity-70">{statusCounts[s.code] ?? 0}</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Search name, email, school…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 w-64"
            />

            {/* Filter & Sort toggle */}
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors flex items-center gap-1.5 ${
                showFilters || yearGroupFilter !== 'all' || schoolTypeFilter !== 'all' || sortKey !== 'submitted_at' || minGradeScore > 0 || hiddenCols.size > 0
                  ? 'border-steps-blue-300 bg-steps-blue-50 text-steps-blue-700 dark:border-steps-blue-600 dark:bg-steps-blue-900/20 dark:text-steps-blue-400'
                  : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
              Filter & Sort
              {(yearGroupFilter !== 'all' || schoolTypeFilter !== 'all' || sortKey !== 'submitted_at' || minGradeScore > 0 || hiddenCols.size > 0) && (
                <span className="w-1.5 h-1.5 rounded-full bg-steps-blue-500" />
              )}
            </button>

            {/* Email queue status — shown when there's activity on this event, until admin dismisses */}
            {!queueDismissed && (queueStats.queued > 0 || queueStats.sending > 0 || queueStats.failed > 0) && (
              <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span className="text-gray-500 dark:text-gray-400">Email queue:</span>
                {queueStats.queued > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="Waiting to send">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {queueStats.queued} queued
                  </span>
                )}
                {queueStats.sending > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400" title="Worker is sending">
                    <span className="w-1.5 h-1.5 rounded-full bg-steps-blue-500 animate-pulse" />
                    {queueStats.sending} sending
                  </span>
                )}
                {queueStats.sent > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" title="Successfully sent">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    {queueStats.sent}
                  </span>
                )}
                {queueStats.failed > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" title="Permanent failures after max retries">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    {queueStats.failed}
                  </span>
                )}
                <button
                  onClick={loadQueueStats}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Refresh"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                {/* Clear — only shows once the batch has fully drained, so admins can dismiss the tally */}
                {queueStats.queued === 0 && queueStats.sending === 0 && (
                  <button
                    onClick={() => {
                      setQueueDismissed(true)
                      setQueueStats({ queued: 0, sending: 0, sent: 0, failed: 0 })
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Clear queue tally"
                    aria-label="Clear queue tally"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => setShowInvite(true)}
              className={`${!queueDismissed && (queueStats.queued > 0 || queueStats.sending > 0 || queueStats.failed > 0) ? '' : 'ml-auto '}px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 whitespace-nowrap`}
            >
              Invite Students
            </button>
          </div>

          {/* Filter & Sort panel */}
          {showFilters && (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              {/* Row 1: Filters & Sort */}
              <div className="p-3 flex flex-wrap items-end gap-4">
                {/* Year Group filter */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Year Group</label>
                  <select
                    value={yearGroupFilter}
                    onChange={e => setYearGroupFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="all">All</option>
                    {uniqueYearGroups.map(yg => (
                      <option key={yg} value={String(yg)}>Year {yg}</option>
                    ))}
                  </select>
                </div>

                {/* School Type filter */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">School Type</label>
                  <select
                    value={schoolTypeFilter}
                    onChange={e => setSchoolTypeFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="all">All</option>
                    {uniqueSchoolTypes.map(st => (
                      <option key={st} value={st} className="capitalize">{st.charAt(0).toUpperCase() + st.slice(1)}</option>
                    ))}
                  </select>
                </div>

                {/* Min grade score */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Min Grade Score</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minGradeScore || ''}
                    onChange={e => setMinGradeScore(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-20 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>

                {/* Divider */}
                <div className="w-px h-8 bg-gray-300 dark:bg-gray-600 self-end" />

                {/* Sort by */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Sort By</label>
                  <div className="flex items-center gap-1">
                    <select
                      value={sortKey}
                      onChange={e => setSortKey(e.target.value as SortKey)}
                      className="px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      <option value="submitted_at">Date Applied</option>
                      <option value="name">Name</option>
                      <option value="school_type">School Type</option>
                      <option value="year_group">Year Group</option>
                      <option value="status">Status</option>
                      <option value="gradeScore">Grade Score</option>
                      <option value="engagement">Engagement</option>
                      <option value="past_events">Past Events</option>
                      <option value="rsvp">RSVP</option>
                      <option value="attended">Attended</option>
                    </select>
                    <button
                      onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                      className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                      title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {sortDir === 'asc' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
                        )}
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Reset */}
                {(yearGroupFilter !== 'all' || schoolTypeFilter !== 'all' || sortKey !== 'submitted_at' || minGradeScore > 0 || hiddenCols.size > 0 || colOrder.length > 0) && (
                  <button
                    onClick={() => { setYearGroupFilter('all'); setSchoolTypeFilter('all'); setSortKey('submitted_at'); setSortDir('desc'); setMinGradeScore(0); resetCols(); try { window.localStorage.removeItem(viewStorageKey) } catch {} }}
                    className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline self-end"
                  >
                    Reset all
                  </button>
                )}
              </div>

              {/* Row 2: Columns — show/hide & reorder (shared across admins) */}
              <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Columns</div>
                  <ColumnPicker
                    allColumns={allColumns.map<ColumnPickerItem>(c => ({
                      id: c.id,
                      label: c.label,
                      group: c.kind === 'custom' ? 'Form question' : c.kind === 'standard' ? 'Standard Q' : undefined,
                      disabled: c.id === 'status' && statusFilter !== 'all',
                      disabledReason: 'Auto-hidden while filtering by status',
                    }))}
                    hidden={hiddenCols}
                    order={colOrder}
                    onToggle={toggleCol}
                    onReorder={reorderCols}
                    onReset={resetCols}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400 font-medium">{selected.size} selected</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>

              {/* Decision dropdowns — each combines notify / internal / silent commit
                  for one outcome (Accept, Shortlist, Waitlist, Reject) so admins
                  pick "what" and "how loud" in one gesture instead of hunting
                  across three separate button strips.

                  Wave 2: optional decision-reason input piped into bulkUpdateStatus
                  (and via openCompose into the notify path) so admins can record
                  *why* this decision in one stroke. Persists to applications.decision_reason
                  (admin-only via RLS). */}
              <input
                type="text"
                value={bulkDecisionReason}
                onChange={e => setBulkDecisionReason(e.target.value)}
                placeholder="Optional reason — e.g. low engagement, capacity"
                className="px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs w-56 placeholder:text-gray-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
                aria-label="Decision reason (optional)"
              />
              <div ref={bulkMenuRef} className="flex flex-wrap items-center gap-2">
                {NOTIFY_STATUSES.map(ns => {
                  const internalCode = ns.code === 'accepted' ? 'accept'
                    : ns.code === 'shortlisted' ? 'shortlist'
                    : ns.code === 'waitlist' ? 'waitlist'
                    : 'reject'
                  const verb = ns.code === 'accepted' ? 'Accept'
                    : ns.code === 'shortlisted' ? 'Shortlist'
                    : ns.code === 'waitlist' ? 'Waitlist'
                    : 'Reject'
                  const isOpen = bulkMenuOpen === ns.code
                  return (
                    <div key={ns.code} className="relative">
                      <button
                        onClick={() => setBulkMenuOpen(isOpen ? null : ns.code)}
                        className={`px-2.5 py-1 rounded text-xs font-medium text-white transition-colors inline-flex items-center gap-1 ${ns.color}`}
                        aria-haspopup="menu"
                        aria-expanded={isOpen}
                      >
                        {verb}
                        <svg className="w-3 h-3 opacity-80" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div
                          role="menu"
                          className="absolute z-40 mt-1 left-0 min-w-[210px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 text-xs text-gray-700 dark:text-gray-200"
                        >
                          <button
                            role="menuitem"
                            onClick={() => { setBulkMenuOpen(null); openCompose(ns.code) }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {verb} &amp; notify
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => { setBulkMenuOpen(null); bulkUpdateInternalReviewStatus(internalCode as InternalReviewStatusCode) }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Internal mark — never shown to students"
                          >
                            {verb} internally
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => { setBulkMenuOpen(null); bulkUpdateStatus(ns.code) }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700"
                            title="Commit status without sending an email"
                          >
                            Just {verb.toLowerCase()} (no email)
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Withdraw — no internal-mark or notification analog, so it
                    stays a single-shot button. */}
                <button
                  onClick={() => bulkUpdateStatus('withdrew')}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gray-500 text-white hover:bg-gray-600 transition-colors"
                  title="Mark selected as withdrew"
                >
                  Withdraw
                </button>
              </div>

              <span className="text-gray-300 dark:text-gray-600">|</span>

              <button
                onClick={() => bulkUpdateInternalReviewStatus(null)}
                className="px-2.5 py-1 rounded text-xs font-medium hover:opacity-80 transition-opacity bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 ring-1 ring-dashed ring-gray-200 dark:ring-gray-700"
              >
                Clear internal
              </button>

              <span className="text-gray-300 dark:text-gray-600">|</span>

              <button
                onClick={() => openCompose()}
                className="px-2.5 py-1 rounded text-xs font-medium bg-steps-blue-600 text-white hover:bg-steps-blue-700 transition-colors"
              >
                Email only
              </button>

              <span className="text-gray-300 dark:text-gray-600">|</span>

              <button
                onClick={() => setDeleteModal({ open: true, mode: null })}
                className="px-2.5 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        {appLoading ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400 text-sm">Loading applicants…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 dark:text-gray-400 text-sm">
            {applicants.length === 0 ? 'No applications yet.' : 'No applicants match your filters.'}
          </div>
        ) : (
          <>
            <SelectAllBanner
              selectedCount={selected.size}
              pageCount={paged.length}
              filteredCount={filtered.length}
              allPageSelected={allPageSelected}
              allFilteredSelected={allFilteredSelected}
              onSelectAllFiltered={selectAllFiltered}
              onClear={clearSelection}
              noun="applicants"
            />
          <div className="overflow-x-scroll overflow-y-visible always-scrollbar" style={{ minHeight: Math.max((paged.length + 5) * 48, 336) }}>
            <table className="text-sm w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="p-3 w-8 sticky left-0 z-20 bg-white dark:bg-gray-900">
                    <input
                      type="checkbox"
                      checked={paged.length > 0 && paged.every(a => selected.has(a.id))}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </th>
                  {!hiddenCols.has('name') && (
                    <th className="p-3 min-w-[160px] sticky left-8 z-20 bg-white dark:bg-gray-900" style={{ boxShadow: '4px 0 8px -4px rgba(0,0,0,0.08)' }}>
                      <button
                        type="button"
                        onClick={() => handleHeaderSort('name')}
                        className={`inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${
                          sortKey === 'name' ? 'text-steps-blue-700 dark:text-steps-blue-400' : ''
                        }`}
                        title="Click to sort by Name"
                      >
                        <span>Name</span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                          {sortKey === 'name'
                            ? (sortDir === 'asc'
                                ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />)
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />}
                        </svg>
                      </button>
                    </th>
                  )}
                  {visibleColumns.filter(c => c.id !== 'name').map(col => {
                    const sortable = COL_SORT_KEY[col.id] != null
                    const isActive = sortable && sortKey === COL_SORT_KEY[col.id]
                    return (
                      <th
                        key={col.id}
                        className={
                          col.id.startsWith('cf_')
                            ? 'p-3 align-bottom min-w-[260px] max-w-[320px] leading-snug'
                            : 'p-3 whitespace-nowrap max-w-[200px] truncate'
                        }
                        title={sortable ? `Click to sort by ${col.label}` : col.label}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => handleHeaderSort(col.id)}
                            className={`inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${
                              isActive ? 'text-steps-blue-700 dark:text-steps-blue-400' : ''
                            }`}
                          >
                            <span className="truncate">{col.label}</span>
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                              {isActive
                                ? (sortDir === 'asc'
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />)
                                : <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />}
                            </svg>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {paged.map(app => {
                  const badge = STATUS_MAP[app.status] ?? STATUS_MAP.submitted
                  const post16 = app.qualifications.filter(q =>
                    /a.?level|ib|btec/i.test(q.qualType) || q.level === 'post-16'
                  )
                  const gradeLetters = post16.map(q => q.grade).filter(Boolean).join(', ')
                  const rowBg = app.eligibility === 'ineligible'
                    ? 'bg-red-50 dark:bg-red-900/10'
                    : selected.has(app.id)
                      ? 'bg-steps-blue-50/50 dark:bg-steps-blue-900/10'
                      : 'bg-white dark:bg-gray-900'

                  return (
                    <tr
                      key={app.id}
                      className={`border-b border-gray-100 dark:border-gray-800/50 transition-colors ${rowBg}`}
                    >
                      <td className={`p-3 sticky left-0 z-10 ${rowBg}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(app.id)}
                          onChange={() => toggleSelect(app.id)}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                      </td>
                      {!hiddenCols.has('name') && (
                        <td
                          className={`p-3 sticky left-8 z-10 ${rowBg}`}
                          style={{ boxShadow: '4px 0 8px -4px rgba(0,0,0,0.08)' }}
                        >
                          <Link
                            href={`/students/${app.student_id}`}
                            className={`font-medium hover:text-steps-blue-600 dark:hover:text-steps-blue-400 ${
                              app.eligibility === 'ineligible'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {app.first_name} {app.last_name}
                          </Link>
                          {app.eligibility === 'ineligible' && (
                            <span className="ml-1.5 text-[10px] font-medium text-red-500 dark:text-red-400 uppercase">Ineligible</span>
                          )}
                        </td>
                      )}
                      {/* Dynamic columns based on visibility & order */}
                      {visibleColumns.filter(c => c.id !== 'name').map((col, colIdx) => {
                        // Built-in: school_type
                        if (col.id === 'school_type') return (
                          <td key={col.id} className="p-3 text-gray-500 dark:text-gray-400 capitalize whitespace-nowrap">
                            {app.school_type ?? '—'}
                          </td>
                        )
                        // Built-in: status
                        if (col.id === 'status') return (
                          <td key={col.id} className="p-3">
                            <select
                              value={app.status}
                              onChange={e => updateStatus(app.id, e.target.value)}
                              disabled={saving.has(app.id)}
                              className={`text-xs font-medium rounded-full px-2.5 py-0.5 border-0 cursor-pointer ${badge.color} ${
                                saving.has(app.id) ? 'opacity-50' : ''
                              }`}
                            >
                              {STATUSES.map(s => (
                                <option key={s.code} value={s.code}>{s.label}</option>
                              ))}
                            </select>
                          </td>
                        )
                        // Built-in: internal review (draft, admin-only — never shown to students)
                        if (col.id === 'internal_review') {
                          const internalMeta = getInternalReviewMeta(app.internal_review_status)
                          return (
                            <td key={col.id} className="p-3">
                              <select
                                value={app.internal_review_status ?? ''}
                                onChange={e => updateInternalReviewStatus(app.id, (e.target.value || null) as InternalReviewStatusCode | null)}
                                disabled={saving.has(app.id)}
                                title="Internal mark — never shown to students"
                                className={`text-xs font-medium rounded-full px-2.5 py-0.5 border-0 cursor-pointer ${
                                  internalMeta
                                    ? internalMeta.badgeClasses
                                    : 'bg-gray-50 text-gray-400 ring-1 ring-dashed ring-gray-200 dark:bg-gray-900/30 dark:text-gray-500 dark:ring-gray-700'
                                } ${saving.has(app.id) ? 'opacity-50' : ''}`}
                              >
                                <option value="">—</option>
                                {INTERNAL_REVIEW_OPTIONS.map(o => (
                                  <option key={o.code} value={o.code}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          )
                        }
                        // Built-in: grades
                        if (col.id === 'grades') return (
                          <td key={col.id} className="p-3 whitespace-nowrap">
                            {post16.length > 0 ? (
                              <div className="group relative inline-block">
                                <span className="text-gray-700 dark:text-gray-300 cursor-default">
                                  {gradeLetters}
                                  <span className="ml-1 text-xs text-gray-400">({app.gradeScore})</span>
                                </span>
                                <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[220px]">
                                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase">Qualifications</div>
                                  {post16.map((q, qi) => (
                                    <div key={qi} className="flex justify-between gap-4 text-xs py-0.5">
                                      <span className="text-gray-700 dark:text-gray-300">{q.qualType}: {q.subject}</span>
                                      <span className="font-medium text-gray-900 dark:text-gray-100">{q.grade}</span>
                                    </div>
                                  ))}
                                  <div className="border-t border-gray-100 dark:border-gray-700 mt-1.5 pt-1.5 flex justify-between text-xs font-medium">
                                    <span className="text-gray-500 dark:text-gray-400">Total score</span>
                                    <span className="text-gray-900 dark:text-gray-100">{app.gradeScore}</span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-600">—</span>
                            )}
                          </td>
                        )
                        // Built-in: rsvp
                        if (col.id === 'rsvp') {
                          // Surface the RSVP timestamp in the tooltip so admins
                          // can see *when* a student confirmed without opening
                          // the detail page.
                          const rsvpTooltip = app.rsvp_confirmed === true && app.rsvp_confirmed_at
                            ? `Confirmed ${new Date(app.rsvp_confirmed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                            : app.rsvp_confirmed === true ? 'Confirmed' : 'Awaiting RSVP'
                          return (
                            <td key={col.id} className="p-3">
                              {app.status === 'accepted' ? (
                                app.rsvp_confirmed === true ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400" title={rsvpTooltip}>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Yes
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-600 dark:text-amber-400" title={rsvpTooltip}>Pending</span>
                                )
                              ) : (
                                <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
                              )}
                            </td>
                          )
                        }
                        // Built-in: attended
                        if (col.id === 'attended') return (
                          <td key={col.id} className="p-3 text-center">
                            <button
                              onClick={() => toggleAttended(app.id)}
                              disabled={saving.has(app.id)}
                              className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                                app.attended
                                  ? 'bg-emerald-500 border-emerald-500 text-white'
                                  : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'
                              } ${saving.has(app.id) ? 'opacity-50' : ''}`}
                              title={app.attended ? 'Attended' : 'Not attended'}
                            >
                              {app.attended && (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          </td>
                        )
                        // Built-in: engagement score (cumulative, from students_enriched)
                        if (col.id === 'engagement') return (
                          <td key={col.id} className="p-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-sm font-medium" title="Cumulative engagement score across all Steps events (separate from academic grades)">
                              {app.engagementScore}
                            </span>
                          </td>
                        )
                        // Built-in: past events — attended / accepted / submitted.
                        // Three-number funnel so admins can see at a glance:
                        //   * how many past applications this student has submitted
                        //   * how many we accepted (vs. waitlisted / rejected / submitted-only)
                        //   * how many they actually showed up to
                        // Subtract the current row's contribution so the cell reflects
                        // past activity only — not the application being reviewed right now.
                        if (col.id === 'past_events') {
                          const pastSubmitted = Math.max(0, (app.totalApplications ?? 0) - 1)
                          const pastAccepted = Math.max(0, (app.acceptedCount ?? 0) - (app.status === 'accepted' ? 1 : 0))
                          const pastAttended = Math.max(0, (app.attendedCount ?? 0) - (app.attended ? 1 : 0))
                          const pastNoShows = app.noShowCount ?? 0
                          // Perfect attendance: they attended every event we accepted them to,
                          // with at least 2 under their belt so the tick carries weight.
                          const perfect = pastAttended === pastAccepted && pastAccepted >= 2
                          const tooltip = pastSubmitted === 0
                            ? 'First-time applicant'
                            : `${pastAttended} attended · ${pastAccepted} accepted · ${pastSubmitted} applied${pastNoShows > 0 ? ` · ${pastNoShows} no-show${pastNoShows === 1 ? '' : 's'}` : ''}`
                          return (
                            <td key={col.id} className="p-3 whitespace-nowrap">
                              {pastSubmitted === 0 ? (
                                <span className="text-xs text-gray-400 dark:text-gray-500" title={tooltip}>New</span>
                              ) : (
                                <span className={`inline-flex items-center gap-1 text-sm ${perfect ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}`} title={tooltip}>
                                  <span className="font-medium">{pastAttended}</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">/</span>
                                  <span className="font-medium">{pastAccepted}</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">/</span>
                                  <span className="font-medium">{pastSubmitted}</span>
                                  {perfect && (
                                    <svg className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </span>
                              )}
                            </td>
                          )
                        }
                        // Standard textarea columns (long free text — truncate + hover popover).
                        if (col.id === 'std_additional' || col.id === 'std_anything_else') {
                          const rawText = col.id === 'std_additional' ? app.additionalContext : app.anythingElse
                          const text = rawText && rawText.trim() ? rawText : null
                          const flipStd = colIdx >= (hiddenCols.has('name') ? visibleColumns.length : visibleColumns.length - 1) - 2
                          return (
                            <td key={col.id} className="p-3 align-top min-w-[260px] max-w-[320px]">
                              {!text ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                <div className="group relative">
                                  <span className="text-gray-700 dark:text-gray-300 cursor-default line-clamp-2 break-words">
                                    {text}
                                  </span>
                                  {text.length > 80 && (
                                    <div className={`absolute ${flipStd ? 'right-0' : 'left-0'} top-full mt-1 z-30 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[280px] max-w-[400px] max-h-[200px] overflow-y-auto`}>
                                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{col.label}</div>
                                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{text}</div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          )
                        }
                        // First-gen uni — UI polarity: DB true means IS first-gen
                        // (i.e. no parent went to uni). The column header is phrased
                        // "First-generation university student?" so we render directly.
                        if (col.id === 'std_first_gen') {
                          const v = app.firstGenerationUni
                          const label = v === true ? 'Yes' : v === false ? 'No' : '—'
                          const klass = v === true
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                            : v === false
                              ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                              : 'bg-transparent text-gray-400'
                          return (
                            <td key={col.id} className="p-3 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${klass}`}>{label}</span>
                            </td>
                          )
                        }
                        // Standard attribution — single value. Prefer the raw `channel` (the
                        // human-readable option the student picked) and fall back to the
                        // normalised `attribution_source` code if the raw value is missing.
                        if (col.id === 'std_attribution') {
                          const val = app.attributionChannel || app.attributionSource || null
                          return (
                            <td key={col.id} className="p-3 text-gray-700 dark:text-gray-300 text-sm whitespace-nowrap max-w-[200px] truncate" title={val ?? undefined}>
                              {val ? toTitleCase(val) : <span className="text-gray-400">—</span>}
                            </td>
                          )
                        }
                        // Custom field columns (id starts with cf_)
                        const cfId = col.id.replace(/^cf_/, '')
                        const val = app.customFields[cfId]
                        const isRankedChoice = val != null && !Array.isArray(val) && typeof val === 'object'
                          && Object.keys(val as Record<string, unknown>).some(k => k in ORDINAL)
                        let display: string
                        let popoverContent: string | null = null
                        if (val == null) {
                          display = '—'
                        } else if (isRankedChoice) {
                          const obj = val as Record<string, unknown>
                          const orderedKeys = ['first', 'second', 'third', 'fourth', 'fifth'].filter(k => obj[k])
                          display = orderedKeys.map(k => toTitleCase(String(obj[k]))).join(', ')
                          popoverContent = orderedKeys.map(k => `${ORDINAL[k]}: ${toTitleCase(String(obj[k]))}`).join('\n')
                        } else if (Array.isArray(val)) {
                          display = val.map(v =>
                            typeof v === 'object' && v !== null
                              ? Object.values(v as Record<string, unknown>).filter(Boolean).map(x => toTitleCase(String(x))).join(': ')
                              : toTitleCase(String(v))
                          ).join(', ')
                        } else if (typeof val === 'object') {
                          const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v)
                          display = entries.map(([, v]) => toTitleCase(String(v))).join(', ')
                        } else {
                          display = String(val)
                        }
                        const isLong = display.length > 80 || popoverContent != null
                        const nonNameCount = hiddenCols.has('name') ? visibleColumns.length : visibleColumns.length - 1
                        const flipPopover = colIdx >= nonNameCount - 2
                        return (
                          <td key={col.id} className="p-3 align-top min-w-[260px] max-w-[320px]">
                            {display === '—' ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <div className="group relative">
                                <span className="text-gray-700 dark:text-gray-300 cursor-default line-clamp-2 break-words">
                                  {display}
                                </span>
                                {isLong && (
                                  <div className={`absolute ${flipPopover ? 'right-0' : 'left-0'} top-full mt-1 z-30 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[280px] max-w-[400px] max-h-[200px] overflow-y-auto`}>
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{col.label}</div>
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{popoverContent ?? display}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* Footer with pagination */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
          <span>
            Showing {filtered.length > 0 ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            {filtered.length !== applicants.length && ` (${applicants.length} total)`}
            {' · '}{attendedCount} attended · {applicants.length - attendedCount} no-show
            {rsvpStats.accepted > 0 && ` · ${rsvpStats.confirmed}/${rsvpStats.accepted} RSVPs`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ««
              </button>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ‹
              </button>
              <span className="px-2 text-gray-700 dark:text-gray-300">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ›
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                »»
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Email Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Modal header */}
            <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {emailStep === 'done'
                    ? 'Emails sent'
                    : emailStep === 'sending'
                    ? 'Sending…'
                    : notifyAction
                    ? `${NOTIFY_STATUSES.find(n => n.code === notifyAction)?.label ?? 'Notify'}`
                    : 'Compose email'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {getRecipients().length} recipient{getRecipients().length !== 1 ? 's' : ''}
                  {notifyAction && ` — status will change to "${STATUS_MAP[notifyAction]?.label ?? notifyAction}"`}
                  {getRecipients().length < selected.size && (
                    <span className="text-amber-600 dark:text-amber-400"> ({selected.size - getRecipients().length} without email — skipped)</span>
                  )}
                </p>
              </div>
              {emailStep !== 'sending' && (
                <button onClick={() => { setShowCompose(false); setNotifyAction(null) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Modal body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {emailStep === 'pick' && (() => {
                const bodyMergeTags: MergeTag[] = [
                  { tag: 'first_name', label: 'First Name' },
                  { tag: 'last_name', label: 'Last Name' },
                  { tag: 'full_name', label: 'Full Name' },
                  { tag: 'event_name', label: 'Event Name' },
                  ...(event?.event_date ? [{ tag: 'event_date', label: 'Event Date' }] : []),
                  ...(event?.time_start ? [{ tag: 'event_time', label: 'Event Time' }] : []),
                  ...(event?.location ? [{ tag: 'event_location', label: 'Location' }] : []),
                  ...(event?.dress_code ? [{ tag: 'dress_code', label: 'Dress Code' }] : []),
                  { tag: 'open_to', label: 'Open To' },
                  ...(event?.applications_close_at ? [{ tag: 'application_deadline', label: 'Application Deadline' }] : []),
                  { tag: 'rsvp_link', label: 'RSVP Link' },
                  { tag: 'portal_link', label: 'Portal Link' },
                ]
                const subjectMergeTags: MergeTag[] = [
                  { tag: 'first_name', label: 'First Name' },
                  { tag: 'event_name', label: 'Event Name' },
                ]
                return (
                  <EmailComposePanel
                    templates={templates}
                    selectedTemplate={selectedTemplate}
                    templateDirty={templateDirty}
                    savingTemplate={savingTemplate}
                    onApplyTemplate={applyTemplate}
                    onEditTemplate={openTemplateEditor}
                    onRenameTemplate={renameSelectedTemplate}
                    onDeleteTemplate={deleteSelectedTemplate}
                    onSaveTemplateChanges={saveTemplateChanges}
                    onSaveAsNewTemplate={saveCurrentAsNewTemplate}
                    templateFilter={t => !t.event_id || t.event_id === eventId}
                    subjectEditorRef={subjectEditorRef}
                    bodyEditorRef={bodyEditorRef}
                    emailSubject={emailSubject}
                    emailBody={emailBody}
                    onSubjectChange={setEmailSubject}
                    onBodyChange={setEmailBody}
                    onDirty={() => { if (selectedTemplate) setTemplateDirty(true) }}
                    bodyEditorKey={`${selectedTemplate}-${bodySeedCounter}`}
                    bodyInitialHtml={bodyEditorSeed}
                    subjectMergeTags={subjectMergeTags}
                    bodyMergeTags={bodyMergeTags}
                    subjectPlaceholder="e.g. An update on your {{event_name}} application"
                    bodyPlaceholder={`Hi {{first_name}},\n\n...\n\nVirtus non origo,\nThe Steps Foundation Team`}
                    attachments={emailAttachments}
                    onAttach={att => setEmailAttachments(prev => prev.some(p => p.url === att.url) ? prev : [...prev, att])}
                    onRemoveAttachment={url => setEmailAttachments(prev => prev.filter(p => p.url !== url))}
                  />
                )
              })()}

              {emailStep === 'preview' && (
                <EmailPreviewPanel
                  recipientName={`${getRecipients()[0]?.first_name ?? ''} ${getRecipients()[0]?.last_name ?? ''}`.trim()}
                  recipientEmail={getRecipients()[0]?.personal_email ?? null}
                  filledSubject={getRecipients()[0] ? fillMergeFields(emailSubject, getRecipients()[0]) : emailSubject}
                  filledBodyHtml={(() => {
                    const raw = getRecipients()[0] ? fillMergeFields(emailBody, getRecipients()[0]) : emailBody
                    return looksLikeHtml(raw) ? raw : plainTextToHtml(raw)
                  })()}
                  footerBanner={notifyAction ? (
                    <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                      After sending, all {getRecipients().length} selected applicant{getRecipients().length !== 1 ? 's' : ''} will be marked as <strong>{STATUS_MAP[notifyAction]?.label ?? notifyAction}</strong>.
                    </div>
                  ) : undefined}
                />
              )}

              {emailStep === 'sending' && (
                <EmailSendingPanel progress={sendProgress} />
              )}

              {emailStep === 'done' && (
                <EmailDonePanel
                  progress={sendProgress}
                  extra={notifyAction ? (
                    <div className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                      Statuses updated to {STATUS_MAP[notifyAction]?.label ?? notifyAction}
                    </div>
                  ) : undefined}
                />
              )}
            </div>

            {/* Modal footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              {emailStep === 'pick' && (
                <>
                  <button
                    onClick={() => { setShowCompose(false); setNotifyAction(null) }}
                    className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setEmailStep('preview')}
                    disabled={!emailSubject.trim() || !emailBody.trim() || getRecipients().length === 0}
                    className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50"
                  >
                    Preview
                  </button>
                </>
              )}
              {emailStep === 'preview' && (
                <>
                  <button
                    onClick={() => setEmailStep('pick')}
                    className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Back
                  </button>
                  <button
                    onClick={sendEmails}
                    className={`px-4 py-1.5 text-sm rounded-md text-white ${
                      notifyAction
                        ? NOTIFY_STATUSES.find(n => n.code === notifyAction)?.color ?? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {notifyAction
                      ? `${NOTIFY_STATUSES.find(n => n.code === notifyAction)?.label ?? 'Send'} (${getRecipients().length})`
                      : `Send to ${getRecipients().length} recipient${getRecipients().length !== 1 ? 's' : ''}`
                    }
                  </button>
                </>
              )}
              {emailStep === 'done' && (
                <button
                  onClick={() => { setShowCompose(false); setNotifyAction(null); setSelected(new Set()) }}
                  className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {editingTemplate && (
        <TemplateEditDialog
          initial={editingTemplate}
          saving={savingTemplate}
          error={editTemplateError}
          onCancel={() => { setEditingTemplate(null); setEditTemplateError(null) }}
          onSave={saveEditedTemplate}
        />
      )}
      {/* Delete Applications Modal */}
      {deleteModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md flex flex-col">
            <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Delete {selected.size} application{selected.size !== 1 ? 's' : ''}?
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Choose how these applications should be removed.
                </p>
              </div>
              {!deleteLoading && (
                <button
                  onClick={() => setDeleteModal({ open: false, mode: null })}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="p-5 space-y-3">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => handleDeleteApplications('soft')}
                className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 hover:border-steps-blue-500 hover:bg-steps-blue-50/40 dark:hover:bg-steps-blue-900/10 px-4 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Remove from this event</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Soft delete — the student record stays, the application is hidden from this event and can be restored later.
                </div>
              </button>

              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => handleDeleteApplications('hard')}
                className="w-full text-left rounded-lg border border-red-200 dark:border-red-900/40 hover:border-red-500 hover:bg-red-50/60 dark:hover:bg-red-900/10 px-4 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="font-medium text-sm text-red-700 dark:text-red-400">Permanently delete</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Hard delete — removes the application row entirely. This cannot be undone.
                </div>
              </button>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {deleteLoading ? 'Deleting…' : ''}
              </span>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setDeleteModal({ open: false, mode: null })}
                className="px-4 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Students Modal */}
      {previewOpen && event && (
        <div role="dialog" aria-modal="true" aria-label="Form preview" onClick={() => setPreviewOpen(false)} className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-tsf-fade-in">
          <div onClick={e => e.stopPropagation()} className="relative w-full max-w-4xl h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">Preview</span>
                <span className="text-sm text-slate-700 truncate">Form as a new applicant sees it</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={`/apply/${editDraft.slug ?? event.slug}?preview=1`} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 hover:text-slate-900 underline">Open in new tab</a>
                <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close preview" className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <iframe
              key={previewKey}
              src={`/apply/${editDraft.slug ?? event.slug}?preview=1`}
              title="Form preview"
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}

      {showInvite && event && (
        <InviteStudentsModal
          eventId={eventId}
          eventName={event.name}
          eventSlug={event.slug}
          teamMemberUuid={(teamMember as any)?.auth_uuid ?? null}
          onClose={() => setShowInvite(false)}
          onSent={() => { window.location.reload() }}
        />
      )}
    </main>
  )
}
