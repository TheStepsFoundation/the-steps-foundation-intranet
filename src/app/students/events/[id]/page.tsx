'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EventRow, fetchEvent, updateEvent } from '@/lib/events-api'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-provider'
import InviteStudentsModal from "@/components/InviteStudentsModal"
import FormBuilder from "@/components/FormBuilder"
import type { FormFieldConfig, FormPage } from "@/lib/events-api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QualEntry = { qualType: string; subject: string; grade: string; level?: string }

type Applicant = {
  id: string
  student_id: string
  first_name: string
  last_name: string
  personal_email: string | null
  school_name: string | null
  school_type: string | null
  year_group: number | null
  status: string
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
  if (st === 'private' || st === 'independent') return 'ineligible'
  return 'unknown'
}

const STATUSES = [
  { code: 'submitted', label: 'Submitted', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  { code: 'shortlisted', label: 'Shortlisted', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  { code: 'accepted', label: 'Accepted', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { code: 'waitlist', label: 'Waitlist', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { code: 'rejected', label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  { code: 'withdrew', label: 'Withdrew', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
]

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.code, s]))

// Notify-able statuses for combined actions
const NOTIFY_STATUSES = [
  { code: 'accepted', label: 'Accept & Notify', templateType: 'acceptance', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { code: 'rejected', label: 'Reject & Notify', templateType: 'rejection', color: 'bg-red-600 hover:bg-red-700' },
  { code: 'waitlist', label: 'Waitlist & Notify', templateType: 'waitlist', color: 'bg-amber-600 hover:bg-amber-700' },
]


// ---------------------------------------------------------------------------
// Email signature — matches the real events@ Gmail signature
// ---------------------------------------------------------------------------

const EMAIL_SIGNATURE_HTML = `
<br>
<table style="color:rgb(34,34,34);direction:ltr;border-collapse:collapse">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:508px">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;line-height:1.15;color:rgb(0,0,0)">
<tbody><tr>
<td style="vertical-align:top;padding:0.01px 14px 0.01px 1px;width:65px;text-align:center">
<img width="96" height="96" src="https://the-steps-foundation-intranet.vercel.app/tsf-logo.png" alt="The Steps Foundation">
</td>
<td valign="top" style="padding:0.01px 0.01px 0.01px 14px;vertical-align:top;border-left:1px solid rgb(189,189,189)">
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody>
<tr><td style="padding:0.01px">
<p style="margin:0.1px;line-height:19.2px;font-size:16px"><font style="color:rgb(100,100,100)" face="arial, sans-serif"><b>The Steps Foundation</b></font></p>
<p style="margin:0.1px;line-height:19.2px"><font face="arial, sans-serif"><i style="font-size:11px;text-align:center">Virtus, non Origo. \u2013 Character, not Origin.</i></font></p>
</td></tr>
<tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody><tr><td nowrap style="padding-top:14px">
<p style="margin:1px;line-height:10.89px;font-size:11px;color:rgb(33,33,33)"><a href="mailto:events@thestepsfoundation.com" style="color:rgb(17,85,204)">events@thestepsfoundation.com</a></p>
</td></tr></tbody>
</table>
</td></tr>
</tbody></table>
</td>
</tr></tbody></table>
</td></tr></tbody></table>
</td></tr></tbody></table>
<p style="margin:0cm;font-size:9pt;color:red;font-family:arial,sans-serif;font-style:italic;margin-top:12px">
This message is intended only for the addressee and may contain information that is confidential or privileged. Unauthorised use is strictly prohibited and may be unlawful. If you are not the addressee, you should not read, copy, disclose or otherwise use this message, except for the purpose of delivery to the addressee. If you have received this in error, please delete it and advise The Steps Foundation.
</p>
`;

// Helpers for ranked-choice display
function toTitleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
const ORDINAL: Record<string, string> = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
}

// Convert plain-text email body into Gmail-friendly HTML.
// Each non-empty line becomes a <p>; consecutive blank lines collapse to one
// paragraph break. Mirrors the InviteStudentsModal sender so notify emails
// look identical in the recipient's inbox.
function plainTextToHtml(text: string): string {
  if (!text) return ''
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map(block =>
      `<p style="margin:0 0 12px;font-family:arial,sans-serif;font-size:14px;line-height:1.5;color:#222">` +
      escape(block).replace(/\n/g, '<br>') +
      `</p>`
    )
    .join('')
}

// Detect if a stored template body is HTML (legacy) or plain text (new style).
// Plain-text bodies have no angle brackets at all, so a single < anywhere is
// our cue to keep treating it as raw HTML on send.
function looksLikeHtml(s: string): boolean {
  return /<[a-z!\/]/i.test(s)
}

// ---------------------------------------------------------------------------
// Merge-tag chip rendering — while editing we display {{first_name}} as a
// pretty blue pill via a contenteditable=false span. On serialise we collapse
// the span back to its {{tag}} token so saved templates / sent emails stay
// the same plain-text format. Keep this list in sync with the chip palette
// rendered above the editor.
// ---------------------------------------------------------------------------
const MERGE_TAG_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  full_name: 'Full Name',
  email: 'Email',
  event_name: 'Event Name',
  event_date: 'Event Date',
  event_time: 'Event Time',
  event_location: 'Location',
  dress_code: 'Dress Code',
  rsvp_link: 'RSVP Link',
  portal_link: 'Portal Link',
}

function makeChipHtml(tag: string, label?: string): string {
  const safeTag = tag.replace(/[^a-zA-Z0-9_]/g, '')
  const text = (label ?? MERGE_TAG_LABELS[safeTag] ?? safeTag).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // inline styles so the chip renders correctly inside the contenteditable
  // surface regardless of whether tailwind classes hydrate; user-select:all
  // keeps chips atomic when the user drags or backspaces.
  return `<span class="merge-tag-chip" contenteditable="false" data-tag="${safeTag}" style="display:inline-block;padding:1px 8px;margin:0 2px;border-radius:9999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:500;line-height:18px;vertical-align:baseline;user-select:all;white-space:nowrap;">${text}</span>`
}

function tokensToChips(html: string): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_m, tag) => makeChipHtml(tag))
}

function chipsToTokens(html: string): string {
  if (typeof document === 'undefined') return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('span.merge-tag-chip').forEach(span => {
    const tag = span.getAttribute('data-tag') || ''
    span.replaceWith(document.createTextNode(`{{${tag}}}`))
  })
  return tpl.innerHTML
}


// Available sortable columns
type SortKey = 'name' | 'school_type' | 'year_group' | 'status' | 'gradeScore' | 'submitted_at'
type SortDir = 'asc' | 'desc'


// Built-in columns for the applicants table
type BuiltInColId = 'school_type' | 'status' | 'grades' | 'rsvp' | 'attended'
const DEFAULT_BUILTIN_COLS: BuiltInColId[] = ['school_type', 'status', 'grades', 'rsvp', 'attended']
const BUILTIN_COL_LABELS: Record<BuiltInColId, string> = {
  school_type: 'School Type',
  status: 'Status',
  grades: 'Grades (Score)',
  rsvp: 'RSVP',
  attended: 'Attended',
}

type StatusFilter = 'all' | string

// ---------------------------------------------------------------------------
// Rich-text editor — contenteditable with a small formatting toolbar.
// Uses document.execCommand; deprecated but still the most reliable
// cross-browser way to get Gmail-style inline formatting without pulling
// in a full editor dep. Emits HTML via onChange; accepts any merge-tag
// inserts via the insertText imperative handle exposed on the ref.
// ---------------------------------------------------------------------------

type RichTextEditorHandle = {
  insertText: (text: string) => void
  insertMergeTag: (tag: string, label?: string) => void
  focus: () => void
}

type RichTextEditorProps = {
  /** HTML to seed the editor with. Re-keyed when template changes so the
   *  contenteditable isn't overwritten on every keystroke. */
  initialHtml: string
  /** Called whenever the user edits — receives current innerHTML. */
  onChange: (html: string) => void
  /** Placeholder shown when the editor is empty. */
  placeholder?: string
}

const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { initialHtml, onChange, placeholder },
  forwardedRef,
) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [isEmpty, setIsEmpty] = useState(!initialHtml || initialHtml === '<br>' || initialHtml === '<p><br></p>')

  // Seed the div on mount / when initialHtml identity changes (new template).
  // initialHtml is in token form ({{first_name}}); we hydrate to chip spans
  // for display, then collapse back to tokens on every change.
  useEffect(() => {
    if (!divRef.current) return
    const seeded = tokensToChips(initialHtml || '')
    if (divRef.current.innerHTML !== seeded) {
      divRef.current.innerHTML = seeded
      setIsEmpty(!divRef.current.textContent)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  const saveSelection = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.rangeCount > 0 && divRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    if (!savedRange.current || !divRef.current) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }

  const emitChange = () => {
    if (!divRef.current) return
    onChange(chipsToTokens(divRef.current.innerHTML))
    setIsEmpty(!divRef.current.textContent)
  }

  const exec = (cmd: string, value?: string) => {
    restoreSelection()
    divRef.current?.focus()
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand(cmd, false, value)
    } catch {
      // Old browsers / disabled execCommand — silently no-op.
    }
    saveSelection()
    emitChange()
  }

  // Insert a chip + trailing space at the caret. Uses execCommand insertHTML
  // so the contenteditable=false span is treated as a single atomic node.
  const insertChipAtCaret = (tag: string, label?: string) => {
    restoreSelection()
    divRef.current?.focus()
    const html = makeChipHtml(tag, label) + '&nbsp;'
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand('insertHTML', false, html)
    } catch {
      // Fallback for any browser that's stripped insertHTML.
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && divRef.current) {
        const range = sel.getRangeAt(0)
        const tplEl = document.createElement('template')
        tplEl.innerHTML = html
        range.deleteContents()
        range.insertNode(tplEl.content)
      }
    }
    saveSelection()
    emitChange()
  }

  React.useImperativeHandle(forwardedRef, () => ({
    insertText: (text: string) => exec('insertText', text),
    insertMergeTag: (tag: string, label?: string) => insertChipAtCaret(tag, label),
    focus: () => divRef.current?.focus(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onChange])

  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => exec('bold')}>
          <span className="font-bold">B</span>
        </ToolbarBtn>
        <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => exec('italic')}>
          <span className="italic">I</span>
        </ToolbarBtn>
        <ToolbarBtn title="Underline (Ctrl+U)" onClick={() => exec('underline')}>
          <span className="underline">U</span>
        </ToolbarBtn>
        <ToolbarBtn title="Strikethrough" onClick={() => exec('strikeThrough')}>
          <span className="line-through">S</span>
        </ToolbarBtn>
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        <label className="relative inline-flex items-center justify-center w-7 h-7 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer" title="Text colour">
          <span className="text-xs font-bold" style={{ color: 'currentColor' }}>A</span>
          <span className="absolute bottom-0.5 left-1 right-1 h-0.5 bg-gradient-to-r from-red-500 via-amber-500 to-steps-blue-500 rounded" />
          <input
            type="color"
            onMouseDown={saveSelection}
            onChange={e => exec('foreColor', e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <ToolbarBtn title="Numbered list" onClick={() => exec('insertOrderedList')}>
          <span className="text-xs">1.</span>
        </ToolbarBtn>
        <ToolbarBtn title="Bulleted list" onClick={() => exec('insertUnorderedList')}>
          <span className="text-xs">•</span>
        </ToolbarBtn>
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn
          title="Insert link"
          onClick={() => {
            const url = window.prompt('Link URL')
            if (url) exec('createLink', url)
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        </ToolbarBtn>
        <ToolbarBtn title="Clear formatting" onClick={() => exec('removeFormat')}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </ToolbarBtn>
      </div>

      {/* Editor surface */}
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-2.5 left-3 text-sm text-gray-400 pointer-events-none whitespace-pre-line">
            {placeholder}
          </div>
        )}
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={saveSelection}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          className="min-h-[180px] max-h-[420px] overflow-y-auto px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
          style={{ lineHeight: 1.5 }}
        />
      </div>
    </div>
  )
})

function ToolbarBtn(
  { title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }
) {
  return (
    <button
      type="button"
      title={title}
      // preventDefault on mousedown stops the contenteditable from losing focus
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
    >
      {children}
    </button>
  )
}

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

export default function EventDetailPage() {
  const params = useParams()
  const eventId = params.id as string
  const { teamMember } = useAuth()

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

  // View state persistence — load once, save on change, keyed by event ID.
  // Survives refresh so admins don't have to re-customise the table every visit.
  const [viewHydrated, setViewHydrated] = useState(false)
  const viewStorageKey = `steps:event-view:${eventId}`

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
        if (Array.isArray(v.hiddenCols)) setHiddenCols(new Set(v.hiddenCols))
        if (Array.isArray(v.colOrder)) setColOrder(v.colOrder)
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
        hiddenCols: Array.from(hiddenCols),
        colOrder,
        search,
      }
      window.localStorage.setItem(viewStorageKey, JSON.stringify(payload))
    } catch {
      // Storage full / disabled — view still works for this session.
    }
  }, [viewHydrated, eventId, viewStorageKey, statusFilter, yearGroupFilter, schoolTypeFilter, minGradeScore, sortKey, sortDir, hiddenCols, colOrder, search])


  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; mode: 'soft' | 'hard' | null }>({ open: false, mode: null })
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Inline editing feedback
  const [saving, setSaving] = useState<Set<string>>(new Set())

  // Email compose state
  const [showCompose, setShowCompose] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  // Inline event editing
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<Partial<EventRow>>({})
  const [editSaving, setEditSaving] = useState(false)

  const startEditing = () => {
    if (!event) return
    setEditDraft({
      name: event.name,
      slug: event.slug,
      event_date: event.event_date ?? '',
      location: event.location ?? '',
      format: event.format ?? '',
      description: event.description ?? '',
      capacity: event.capacity,
      time_start: event.time_start ?? '',
      time_end: event.time_end ?? '',
      dress_code: event.dress_code ?? '',
      status: event.status,
      applications_open_at: event.applications_open_at ? event.applications_open_at.slice(0, 16) : '',
      applications_close_at: event.applications_close_at ? event.applications_close_at.slice(0, 16) : '',
      form_config: event.form_config ?? { fields: [] },
      banner_image_url: event.banner_image_url,
      hub_image_url: event.hub_image_url,
      banner_focal_x: event.banner_focal_x,
      banner_focal_y: event.banner_focal_y,
      hub_focal_x: event.hub_focal_x,
      hub_focal_y: event.hub_focal_y,
    })
    setEditing(true)
  }

  const cancelEditing = () => { setEditing(false); setEditDraft({}) }

  const saveEditing = async () => {
    if (!event) return
    setEditSaving(true)
    try {
      const patch: Record<string, any> = {}
      if (editDraft.name && editDraft.name !== event.name) patch.name = editDraft.name
      if (editDraft.slug && editDraft.slug !== event.slug) patch.slug = editDraft.slug
      if ((editDraft.event_date ?? '') !== (event.event_date ?? '')) patch.event_date = editDraft.event_date || null
      if ((editDraft.location ?? '') !== (event.location ?? '')) patch.location = editDraft.location || null
      if ((editDraft.format ?? '') !== (event.format ?? '')) patch.format = editDraft.format || null
      if ((editDraft.description ?? '') !== (event.description ?? '')) patch.description = editDraft.description || null
      if (editDraft.capacity !== event.capacity) patch.capacity = editDraft.capacity ?? null
      if ((editDraft.time_start ?? '') !== (event.time_start ?? '')) patch.time_start = editDraft.time_start || null
      if ((editDraft.time_end ?? '') !== (event.time_end ?? '')) patch.time_end = editDraft.time_end || null
      if ((editDraft.dress_code ?? '') !== (event.dress_code ?? '')) patch.dress_code = editDraft.dress_code || null
      if (editDraft.status && editDraft.status !== event.status) patch.status = editDraft.status
      const openAt = editDraft.applications_open_at ? new Date(editDraft.applications_open_at as string).toISOString() : null
      const closeAt = editDraft.applications_close_at ? new Date(editDraft.applications_close_at as string).toISOString() : null
      if (openAt !== (event.applications_open_at ?? null)) patch.applications_open_at = openAt
      if (closeAt !== (event.applications_close_at ?? null)) patch.applications_close_at = closeAt

      if ((editDraft.banner_image_url ?? null) !== (event.banner_image_url ?? null)) patch.banner_image_url = editDraft.banner_image_url ?? null
      if ((editDraft.hub_image_url ?? null) !== (event.hub_image_url ?? null)) patch.hub_image_url = editDraft.hub_image_url ?? null
      if ((editDraft.banner_focal_x ?? 50) !== (event.banner_focal_x ?? 50)) patch.banner_focal_x = editDraft.banner_focal_x ?? 50
      if ((editDraft.banner_focal_y ?? 50) !== (event.banner_focal_y ?? 50)) patch.banner_focal_y = editDraft.banner_focal_y ?? 50
      if ((editDraft.hub_focal_x ?? 50) !== (event.hub_focal_x ?? 50)) patch.hub_focal_x = editDraft.hub_focal_x ?? 50
      if ((editDraft.hub_focal_y ?? 50) !== (event.hub_focal_y ?? 50)) patch.hub_focal_y = editDraft.hub_focal_y ?? 50

      // Always include form_config if it was edited
      const currentFormConfig = JSON.stringify(event.form_config ?? { fields: [] })
      const draftFormConfig = JSON.stringify(editDraft.form_config ?? { fields: [] })
      if (draftFormConfig !== currentFormConfig) patch.form_config = editDraft.form_config

      if (Object.keys(patch).length > 0) {
        const updated = await updateEvent(event.id, patch as any)
        setEvent(updated)
      }
      setEditing(false)
      setEditDraft({})
    } catch (err) {
      console.error('Failed to save event:', err)
      alert('Failed to save: ' + (err && typeof err === 'object' && 'message' in err ? (err as any).message : JSON.stringify(err)))
    } finally {
      setEditSaving(false)
    }
  }
  const [templates, setTemplates] = useState<{ id: string; name: string; type: string; subject: string; body_html: string; event_id: string | null }[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailStep, setEmailStep] = useState<'pick' | 'preview' | 'sending' | 'done'>('pick')
  const [templateDirty, setTemplateDirty] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Rich-text editor ref — used to inject merge tags at the caret.
  const bodyEditorRef = useRef<RichTextEditorHandle | null>(null)
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
          id, student_id, status, submitted_at, attended, reviewed_by, reviewed_at, raw_response,
          students!inner(first_name, last_name, personal_email, year_group, school_id,
            school_type, bursary_90plus, free_school_meals, parental_income_band,
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

    const mapped: Applicant[] = (data ?? []).map((row: any) => {
      const s = row.students
      const rsvp = row.application_rsvp
      const raw = row.raw_response ?? {}

      // Parse qualifications from raw_response
      const quals: QualEntry[] = Array.isArray(raw.qualifications)
        ? raw.qualifications.map((q: any) => ({
            qualType: q.type ?? q.qualType ?? '',
            subject: q.subject ?? '',
            grade: q.grade ?? '',
            level: q.level,
          }))
        : []

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
        personal_email: s.personal_email,
        school_name: s.schools?.name ?? null,
        school_type: s.school_type ?? null,
        year_group: s.year_group,
        status: row.status,
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

    await supabase
      .from('applications')
      .update({
        status: newStatus,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewed_at: now,
        updated_by: teamMember?.auth_uuid ?? null,
        updated_at: now,
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
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewer_name: teamMember?.name ?? null,
        reviewed_at: now,
      } : a
    ))
    setSaving(prev => { const n = new Set(prev); n.delete(appId); return n })
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

  const bulkUpdateStatus = async (newStatus: string) => {
    if (selected.size === 0) return
    const ids = [...selected]
    const now = new Date().toISOString()

    // Log history for each
    for (const id of ids) {
      const old = applicants.find(a => a.id === id)
      if (old && old.status !== newStatus) {
        await supabase.from('application_status_history').insert({
          application_id: id,
          old_status: old.status,
          new_status: newStatus,
          changed_by: teamMember?.auth_uuid ?? null,
        })
      }
    }

    await supabase
      .from('applications')
      .update({
        status: newStatus,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewed_at: now,
        updated_by: teamMember?.auth_uuid ?? null,
        updated_at: now,
      } as any)
      .in('id', ids)

    setApplicants(prev => prev.map(a =>
      selected.has(a.id) ? {
        ...a,
        status: newStatus,
        reviewed_by: teamMember?.auth_uuid ?? null,
        reviewer_name: teamMember?.name ?? null,
        reviewed_at: now,
      } : a
    ))
    setSelected(new Set())
  }

  // Delete handlers
  const handleDeleteApplications = async (mode: 'soft' | 'hard') => {
    if (selected.size === 0) return
    setDeleteLoading(true)
    const ids = [...selected]

    if (mode === 'soft') {
      await supabase
        .from('applications')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids)
    } else {
      await supabase
        .from('applications')
        .delete()
        .in('id', ids)
    }

    // Remove from local state
    setApplicants(prev => prev.filter(a => !selected.has(a.id)))
    setSelected(new Set())
    setDeleteLoading(false)
    setDeleteModal({ open: false, mode: null })
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
    return text
      .replace(/\{\{first_name\}\}/g, applicant.first_name)
      .replace(/\{\{last_name\}\}/g, applicant.last_name)
      .replace(/\{\{full_name\}\}/g, `${applicant.first_name} ${applicant.last_name}`)
      .replace(/\{\{email\}\}/g, applicant.personal_email ?? '')
      .replace(/\{\{event_name\}\}/g, event?.name ?? '')
      .replace(/\{\{event_date\}\}/g, event?.event_date
        ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : 'TBC')
      .replace(/\{\{event_location\}\}/g, event?.location ?? 'TBC')
      .replace(/\{\{event_time\}\}/g, [event?.time_start, event?.time_end].filter(Boolean).join(' – ') || 'TBC')
      .replace(/\{\{dress_code\}\}/g, event?.dress_code ?? '')
      .replace(/\{\{portal_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/my')
      .replace(/\{\{rsvp_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/my')
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
    const cfg = event.form_config as { fields?: { id: string; label: string; type: string }[] }
    return (cfg.fields ?? []).map(f => ({ id: f.id, label: f.label, type: f.type }))
  }, [event])
  // Compute the effective ordered list of all visible columns (built-in + custom)
  const allColumns = useMemo(() => {
    const builtIn: { id: string; label: string; kind: 'builtin' }[] =
      DEFAULT_BUILTIN_COLS.map(id => ({ id, label: BUILTIN_COL_LABELS[id], kind: 'builtin' as const }))
    const custom: { id: string; label: string; kind: 'custom' }[] =
      customFieldCols.map(c => ({ id: `cf_${c.id}`, label: c.label, kind: 'custom' as const }))
    const all = [...builtIn, ...custom]
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
  }, [customFieldCols, colOrder])

  const visibleColumns = useMemo(() => {
    return allColumns.filter(c => {
      if (hiddenCols.has(c.id)) return false
      // Auto-hide status when filtering by a specific status
      if (c.id === 'status' && statusFilter !== 'all') return false
      return true
    })
  }, [allColumns, hiddenCols, statusFilter])

  const moveCol = (id: string, dir: -1 | 1) => {
    const order = colOrder.length > 0 ? [...colOrder] : allColumns.map(c => c.id)
    const idx = order.indexOf(id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= order.length) return
    ;[order[idx], order[newIdx]] = [order[newIdx], order[idx]]
    setColOrder(order)
  }

  const toggleCol = (id: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Event</h2>
              <div className="flex items-center gap-2">
                <button onClick={cancelEditing} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
                <button onClick={saveEditing} disabled={editSaving || !editDraft.name || !editDraft.slug} className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50">{editSaving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>

            {/* Row 1: Name + Slug + Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

            {/* Row 3: Location + Capacity + Dress code */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Location</label>
                <input value={editDraft.location ?? ''} onChange={e => setEditDraft(d => ({ ...d, location: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Capacity</label>
                <input type="number" value={editDraft.capacity ?? ''} onChange={e => setEditDraft(d => ({ ...d, capacity: e.target.value ? parseInt(e.target.value) : null }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Dress code</label>
                <input value={editDraft.dress_code ?? ''} onChange={e => setEditDraft(d => ({ ...d, dress_code: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              </div>
            </div>

            {/* Row 4: Application windows */}
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

            {/* Row 5: Description */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
              <textarea rows={3} value={editDraft.description ?? ''} onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y" />
            </div>

            {/* Row 5b: Event images */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Event images</h3>
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

            {/* Row 6: Custom form fields */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span></span>
                <a href={`/apply/${editDraft.slug ?? event.slug}?preview=1`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Preview form
                </a>
              </div>
              <FormBuilder
                fields={(editDraft.form_config as { fields: FormFieldConfig[]; pages?: FormPage[] })?.fields ?? []}
                pages={(editDraft.form_config as { fields: FormFieldConfig[]; pages?: FormPage[] })?.pages}
                onChange={(fields, pages) => setEditDraft(d => ({ ...d, form_config: { fields, ...(pages ? { pages } : {}) } }))}
              />
            </div>
          </div>
        ) : (
          /* ---- VIEW MODE ---- */
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{event.name}</h1>
                  <button onClick={startEditing} className="p-1 rounded-md text-gray-400 hover:text-steps-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Edit event details">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <a href={`/apply/${event.slug}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200 hover:bg-steps-blue-100 dark:bg-steps-blue-900/20 dark:text-steps-blue-400 dark:border-steps-blue-800 dark:hover:bg-steps-blue-900/30 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Sign up form
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
              {/* Quick stats */}
              <div className="hidden sm:flex items-center gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{applicants.length}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Applicants</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{acceptedCount}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Accepted</div>
                </div>
                {rsvpStats.accepted > 0 && (
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-steps-blue-600 dark:text-steps-blue-400">{rsvpStats.confirmed}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">RSVPs</div>
                  </div>
                )}
                <div className="text-center">
                  <div className="text-2xl font-semibold text-steps-blue-600 dark:text-steps-blue-400">{attendedCount}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Attended</div>
                </div>
              </div>
            </div>
            {event.description && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{event.description}</p>
            )}
          </>
        )}
      </div>

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

            {/* Email queue status — only shown when there's activity on this event */}
            {(queueStats.queued > 0 || queueStats.sending > 0 || queueStats.sent > 0 || queueStats.failed > 0) && (
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
              </div>
            )}

            <button
              onClick={() => setShowInvite(true)}
              className={`${queueStats.queued > 0 || queueStats.sending > 0 || queueStats.sent > 0 || queueStats.failed > 0 ? '' : 'ml-auto '}px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 whitespace-nowrap`}
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
                    onClick={() => { setYearGroupFilter('all'); setSchoolTypeFilter('all'); setSortKey('submitted_at'); setSortDir('desc'); setMinGradeScore(0); setHiddenCols(new Set()); setColOrder([]); try { window.localStorage.removeItem(viewStorageKey) } catch {} }}
                    className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline self-end"
                  >
                    Reset all
                  </button>
                )}
              </div>

              {/* Row 2: Columns — show/hide & reorder */}
              <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Columns</div>
                <div className="flex flex-wrap gap-1.5">
                  {allColumns.map((col, i) => {
                    const isVisible = !hiddenCols.has(col.id) && !(col.id === 'status' && statusFilter !== 'all')
                    const autoHidden = col.id === 'status' && statusFilter !== 'all'
                    return (
                      <div key={col.id} className="flex items-center gap-0.5">
                        {/* Reorder arrows */}
                        <button
                          onClick={() => moveCol(col.id, -1)}
                          disabled={i === 0}
                          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed"
                          title="Move left"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        {/* Column pill */}
                        <button
                          onClick={() => !autoHidden && toggleCol(col.id)}
                          className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                            autoHidden
                              ? 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed line-through'
                              : isVisible
                                ? 'border-steps-blue-200 dark:border-steps-blue-700 bg-steps-blue-50 dark:bg-steps-blue-900/20 text-steps-blue-700 dark:text-steps-blue-400'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 line-through'
                          }`}
                          title={autoHidden ? 'Auto-hidden (filtering by status)' : isVisible ? 'Click to hide' : 'Click to show'}
                        >
                          {col.label}
                        </button>
                        <button
                          onClick={() => moveCol(col.id, 1)}
                          disabled={i === allColumns.length - 1}
                          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 disabled:cursor-not-allowed"
                          title="Move right"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400 font-medium">{selected.size} selected</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>

              {/* Combined status + notify actions */}
              {NOTIFY_STATUSES.map(ns => (
                <button
                  key={ns.code}
                  onClick={() => openCompose(ns.code)}
                  className={`px-2.5 py-1 rounded text-xs font-medium text-white transition-colors ${ns.color}`}
                >
                  {ns.label}
                </button>
              ))}

              <span className="text-gray-300 dark:text-gray-600">|</span>

              {/* Status-only changes (no email) */}
              {STATUSES.filter(s => s.code !== 'withdrew').map(s => (
                <button
                  key={s.code}
                  onClick={() => bulkUpdateStatus(s.code)}
                  className="px-2.5 py-1 rounded text-xs font-medium hover:opacity-80 transition-opacity bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  → {s.label}
                </button>
              ))}

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
          <div className="overflow-x-auto overflow-y-visible" style={{ minHeight: Math.max((paged.length + 5) * 48, 336) }}>
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
                  <th className="p-3 min-w-[160px] sticky left-8 z-20 bg-white dark:bg-gray-900" style={{ boxShadow: '4px 0 8px -4px rgba(0,0,0,0.08)' }}>Name</th>
                  {visibleColumns.map(col => (
                    <th key={col.id} className="p-3 whitespace-nowrap max-w-[200px] truncate" title={col.label}>
                      {col.label}
                    </th>
                  ))}
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
                      {/* Dynamic columns based on visibility & order */}
                      {visibleColumns.map(col => {
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
                        if (col.id === 'rsvp') return (
                          <td key={col.id} className="p-3">
                            {app.status === 'accepted' ? (
                              app.rsvp_confirmed === true ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Yes
                                </span>
                              ) : (
                                <span className="text-xs text-amber-600 dark:text-amber-400">Pending</span>
                              )
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
                            )}
                          </td>
                        )
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
                        const isLong = display.length > 40 || popoverContent != null
                        return (
                          <td key={col.id} className="p-3 max-w-[200px]">
                            {display === '—' ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <div className="group relative">
                                <span className="text-gray-700 dark:text-gray-300 truncate block cursor-default">
                                  {display.length > 40 ? display.slice(0, 40) + '…' : display}
                                </span>
                                {isLong && (
                                  <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[280px] max-w-[400px] max-h-[200px] overflow-y-auto">
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
              {emailStep === 'pick' && (
                <>
                  {/* Template controls header strip */}
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">Template</span>
                      {selectedTemplate ? (
                        <>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[220px]" title={templates.find(t => t.id === selectedTemplate)?.name}>
                            {templates.find(t => t.id === selectedTemplate)?.name ?? 'Untitled'}
                          </span>
                          <button
                            type="button"
                            onClick={renameSelectedTemplate}
                            disabled={savingTemplate}
                            title="Rename template"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-steps-blue-600 hover:bg-steps-blue-50 dark:hover:bg-steps-blue-900/20 disabled:opacity-40"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={deleteSelectedTemplate}
                            disabled={savingTemplate}
                            title="Delete template"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <span className="text-sm text-gray-500 italic">No template &mdash; writing from scratch</span>
                      )}
                      <div className="flex-1" />
                      <select
                        value={selectedTemplate}
                        onChange={e => applyTemplate(e.target.value)}
                        className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 max-w-[220px]"
                      >
                        <option value="">Change template…</option>
                        {templates
                          .filter(t => !t.event_id || t.event_id === eventId)
                          .map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.type}){!t.event_id ? ' — Global' : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                    <input
                      value={emailSubject}
                      onChange={e => { setEmailSubject(e.target.value); if (selectedTemplate) setTemplateDirty(true) }}
                      placeholder="e.g. An update on your {{event_name}} application"
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Body</label>
                      <span className="text-[10px] text-gray-400">Tags show as pills here — sent as values. Signature is auto-appended.</span>
                    </div>

                    {/* Merge-tag insert chips */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="text-[10px] text-gray-400 self-center mr-1">Insert:</span>
                      {[
                        { tag: 'first_name', label: 'First Name' },
                        { tag: 'last_name', label: 'Last Name' },
                        { tag: 'full_name', label: 'Full Name' },
                        { tag: 'event_name', label: 'Event Name' },
                        ...(event?.event_date ? [{ tag: 'event_date', label: 'Event Date' }] : []),
                        ...(event?.time_start ? [{ tag: 'event_time', label: 'Event Time' }] : []),
                        ...(event?.location ? [{ tag: 'event_location', label: 'Location' }] : []),
                        ...(event?.dress_code ? [{ tag: 'dress_code', label: 'Dress Code' }] : []),
                        { tag: 'rsvp_link', label: 'RSVP Link' },
                        { tag: 'portal_link', label: 'Portal Link' },
                      ].map(({ tag, label }) => (
                        <button
                          key={tag}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            bodyEditorRef.current?.insertMergeTag(tag, label)
                            if (selectedTemplate) setTemplateDirty(true)
                          }}
                          className="px-2 py-0.5 text-[11px] rounded-full border border-steps-blue-200 dark:border-steps-blue-800 bg-steps-blue-50 dark:bg-steps-blue-900/20 text-steps-blue-700 dark:text-steps-blue-300 hover:bg-steps-blue-100 dark:hover:bg-steps-blue-900/40 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <RichTextEditor
                      ref={bodyEditorRef}
                      initialHtml={bodyEditorSeed}
                      onChange={html => { setEmailBody(html); if (selectedTemplate) setTemplateDirty(true) }}
                      placeholder={`Hi {{first_name}},\n\n...\n\nVirtus non origo,\nThe Steps Foundation Team`}
                    />

                    {/* Save-back-to-template CTA */}
                    {selectedTemplate && templateDirty && (
                      <div className="mt-2 flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          You&rsquo;ve edited this template. Save changes so future sends start from this version?
                        </span>
                        <button
                          type="button"
                          disabled={savingTemplate}
                          onClick={saveTemplateChanges}
                          className="text-xs font-medium px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {savingTemplate ? 'Saving...' : 'Save to template'}
                        </button>
                      </div>
                    )}

                    {/* Signature preview */}
                    <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
                      <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide">Email signature (auto-appended)</div>
                      <div
                        className="text-xs opacity-60 pointer-events-none"
                        dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                      />
                    </div>
                  </div>
                </>
              )}

              {emailStep === 'preview' && (
                <>
                  <div className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                    Preview with first recipient: <strong>{getRecipients()[0]?.first_name} {getRecipients()[0]?.last_name}</strong>
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">From: Events - The Steps Foundation &lt;events@thestepsfoundation.com&gt;</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">To: {getRecipients()[0]?.personal_email}</div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                      {getRecipients()[0] ? fillMergeFields(emailSubject, getRecipients()[0]) : emailSubject}
                    </div>
                    <div
                      className="prose dark:prose-invert prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: (() => {
                          const raw = getRecipients()[0] ? fillMergeFields(emailBody, getRecipients()[0]) : emailBody
                          const html = looksLikeHtml(raw) ? raw : plainTextToHtml(raw)
                          return html + EMAIL_SIGNATURE_HTML
                        })(),
                      }}
                    />
                  </div>
                  {notifyAction && (
                    <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                      After sending, all {getRecipients().length} selected applicant{getRecipients().length !== 1 ? 's' : ''} will be marked as <strong>{STATUS_MAP[notifyAction]?.label ?? notifyAction}</strong>.
                    </div>
                  )}
                </>
              )}

              {emailStep === 'sending' && (
                <div className="text-center py-6">
                  <div className="text-4xl mb-3">&#9993;</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Processing {sendProgress.sent + sendProgress.failed} / {sendProgress.total}…
                  </div>
                  <div className="w-48 mx-auto mt-3 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-steps-blue-500 transition-all"
                      style={{ width: `${sendProgress.total > 0 ? ((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {emailStep === 'done' && (
                <div className="text-center py-6">
                  <div className="text-4xl mb-3">&#10003;</div>
                  <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                    {sendProgress.sent} email{sendProgress.sent !== 1 ? 's' : ''} queued for sending
                  </div>
                  {sendProgress.failed > 0 && (
                    <div className="text-sm text-red-600 dark:text-red-400 mt-1">
                      {sendProgress.failed} failed to queue
                    </div>
                  )}
                  {notifyAction && (
                    <div className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                      Statuses updated to {STATUS_MAP[notifyAction]?.label ?? notifyAction}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Emails will be sent from events@thestepsfoundation.com
                  </p>
                </div>
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
      {/* Invite Students Modal */}
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
