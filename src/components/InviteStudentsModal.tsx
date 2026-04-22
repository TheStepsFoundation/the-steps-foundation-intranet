'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getCapStatus, type CapStatus } from '@/lib/send-cap'
import { type EnrichedStudent, fetchAllStudentsEnriched, fetchEnrichedStudent, useEvents } from '@/lib/students-api'
import { type EventRow, fetchEvent, formatOpenTo } from '@/lib/events-api'
import SelectAllBanner from './SelectAllBanner'
import ColumnPicker, { type ColumnPickerItem } from './ColumnPicker'
import {
  type RichTextEmailEditorHandle,
  type SingleLineMergeEditorHandle,
  type MergeTag,
  type EmailAttachmentInfo,
} from './RichTextEmailEditor'
import {
  EmailComposePanel,
  EmailPreviewPanel,
  EmailSendingPanel,
  EmailDonePanel,
  TemplateEditDialog,
  EMAIL_SIGNATURE_HTML,
} from './EmailComposePanels'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  eventId: string
  eventName: string
  eventSlug: string
  teamMemberUuid: string | null
  onClose: () => void
  onSent: (count: number) => void
}

type Step = 'select' | 'compose' | 'preview' | 'sending' | 'done'

type Template = {
  id: string
  name: string
  type: string
  subject: string
  body_html: string
  event_id: string | null
}

// ---------------------------------------------------------------------------
// Curated merge-tag fields from application raw_response
// ---------------------------------------------------------------------------

const MERGE_TAG_FIELDS: Record<string, { tag: string; label: string; multiSelect?: boolean }> = {
  // Starting Point
  'Which sessions are you most interested in?': { tag: 'session', label: 'Session', multiSelect: true },
  'A Level Predicted (subjects + grades)': { tag: 'a_level_predicted', label: 'A-Level Predicted' },
  // Oxbridge
  'course': { tag: 'course', label: 'Course' },
  'college': { tag: 'college', label: 'College' },
  'ox_cam': { tag: 'ox_cam', label: 'Oxford/Cambridge' },
  // DA Masterclass
  'stage': { tag: 'stage', label: 'Stage' },
}

/** Extract merge-tag values from a student's applications */
function getStudentMergeTags(s: EnrichedStudent): Record<string, string> {
  const tags: Record<string, string> = {}
  if (!s.applications) return tags
  for (const app of s.applications) {
    const raw = (app as any).raw_response as Record<string, any> | null
    if (!raw) continue
    for (const [fieldKey, config] of Object.entries(MERGE_TAG_FIELDS)) {
      const val = raw[fieldKey]
      if (val == null || String(val).trim() === '') continue
      if (config.multiSelect) {
        const parts = String(val).split(',').map((p: string) => p.trim()).filter(Boolean)
        parts.forEach((p: string, i: number) => {
          const key = `${config.tag}_${i + 1}`
          if (!tags[key]) tags[key] = p
        })
      } else {
        if (!tags[config.tag]) tags[config.tag] = String(val).trim()
      }
    }
  }
  return tags
}

/** Determine which dynamic merge tags are available across selected students */
function getAvailableDynamicTags(students: EnrichedStudent[]): { tag: string; label: string }[] {
  const tagSet = new Set<string>()
  const tagLabels: Record<string, string> = {}
  for (const s of students) {
    const tags = getStudentMergeTags(s)
    for (const key of Object.keys(tags)) {
      tagSet.add(key)
      // Generate label from tag name
      if (!tagLabels[key]) {
        // e.g. session_1 → Session 1, a_level_predicted → A-Level Predicted
        for (const config of Object.values(MERGE_TAG_FIELDS)) {
          if (key === config.tag) {
            tagLabels[key] = config.label
            break
          }
          if (config.multiSelect && key.startsWith(config.tag + '_')) {
            const num = key.split('_').pop()
            tagLabels[key] = `${config.label} ${num}`
            break
          }
        }
        if (!tagLabels[key]) tagLabels[key] = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      }
    }
  }
  return Array.from(tagSet).sort().map(tag => ({ tag, label: tagLabels[tag] || tag }))
}

/** Format an ISO timestamp as a compact relative age: "2d", "3w", "1mo".
 *  Returns empty string if ts is null/undefined. */
function formatRelativeAge(ts: string | null | undefined): string {
  if (!ts) return ''
  const diffMs = Date.now() - new Date(ts).getTime()
  if (diffMs < 0) return 'just now'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

/** Tooltip-friendly absolute formatter. */
function formatAbsolute(ts: string | null | undefined): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

// ---------------------------------------------------------------------------
// Column picker config
// ---------------------------------------------------------------------------

/** All candidate columns in canonical default order. Name is pinned in the
 *  render layer; this list is what the picker shows. */
const INVITE_COLUMN_DEFS: ColumnPickerItem[] = [
  { id: 'school_type', label: 'School type' },
  { id: 'year', label: 'Year group' },
  { id: 'events', label: 'Events attended' },
  { id: 'past_events_detail', label: 'Past events (attended:accepted:submitted)' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'score', label: 'Engagement score' },
  { id: 'apps_total', label: 'Total applications' },
  { id: 'last_contacted', label: 'Last contacted' },
]

const INVITE_COL_STORAGE_KEY = 'invite_modal_cols_v1'
const INVITE_DEFAULT_HIDDEN = new Set<string>(['past_events_detail', 'apps_total'])

type InviteColPrefs = { hidden: string[]; order: string[] }

function loadInviteColPrefs(): InviteColPrefs {
  if (typeof window === 'undefined') return { hidden: Array.from(INVITE_DEFAULT_HIDDEN), order: [] }
  try {
    const raw = window.localStorage.getItem(INVITE_COL_STORAGE_KEY)
    if (!raw) return { hidden: Array.from(INVITE_DEFAULT_HIDDEN), order: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('bad shape')
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((x: any) => typeof x === 'string') : Array.from(INVITE_DEFAULT_HIDDEN),
      order: Array.isArray(parsed.order) ? parsed.order.filter((x: any) => typeof x === 'string') : [],
    }
  } catch {
    return { hidden: Array.from(INVITE_DEFAULT_HIDDEN), order: [] }
  }
}

function saveInviteColPrefs(prefs: InviteColPrefs) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(INVITE_COL_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // quota errors are non-fatal — the defaults will kick in next session
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InviteStudentsModal({ eventId, eventName, eventSlug, teamMemberUuid, onClose, onSent }: Props) {
  // Canonical event list (names/dates live in the events table, not the old constant).
  const { events: EVENTS, byId: EVENT_BY_ID } = useEvents()
  // Event details (for merge tags)
  const [eventData, setEventData] = useState<EventRow | null>(null)
  useEffect(() => { fetchEvent(eventId).then(e => setEventData(e)) }, [eventId])

  // Data
  const [students, setStudents] = useState<EnrichedStudent[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])

  // Last-contacted: when each student was last successfully emailed. Two maps:
  //   - ForEvent: only rows for this event (what this modal is about to spam)
  //   - Any:     rows across all events (broader anti-spam signal)
  // Keyed by student_id, value = ISO timestamp of most recent 'sent' row.
  const [lastContactedForEvent, setLastContactedForEvent] = useState<Record<string, string>>({})
  const [lastContactedAny, setLastContactedAny] = useState<Record<string, string>>({})
  // Anti-spam filter: hide students contacted within the last N days.
  // 0 means 'show everyone'. Scope follows the hideScope toggle.
  const [hideContactedDays, setHideContactedDays] = useState(0)
  const [hideContactedScope, setHideContactedScope] = useState<'event' | 'any'>('event')

  // Column picker — per-user localStorage-backed preferences. The picker
  // doesn't cover 'name' (always pinned); the user's choice here drives the
  // rest of the row.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(INVITE_DEFAULT_HIDDEN))
  const [colOrder, setColOrder] = useState<string[]>([])
  // Seed from localStorage exactly once on mount.
  const colsSeededRef = useRef(false)
  useEffect(() => {
    if (colsSeededRef.current) return
    colsSeededRef.current = true
    const prefs = loadInviteColPrefs()
    setHiddenCols(new Set(prefs.hidden))
    setColOrder(prefs.order)
  }, [])

  const persistCols = useCallback((nextHidden: Set<string>, nextOrder: string[]) => {
    saveInviteColPrefs({ hidden: Array.from(nextHidden), order: nextOrder })
  }, [])

  const toggleCol = useCallback((id: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      persistCols(next, colOrder)
      return next
    })
  }, [colOrder, persistCols])

  const reorderCols = useCallback((newOrder: string[]) => {
    setColOrder(newOrder)
    persistCols(hiddenCols, newOrder)
  }, [hiddenCols, persistCols])

  const resetCols = useCallback(() => {
    const def = new Set<string>(INVITE_DEFAULT_HIDDEN)
    setHiddenCols(def)
    setColOrder([])
    persistCols(def, [])
  }, [persistCols])

  // Visible columns resolved in display order.
  const visibleCols = useMemo(() => {
    const order = colOrder.length ? colOrder : INVITE_COLUMN_DEFS.map(c => c.id)
    const seen = new Set<string>()
    const result: string[] = []
    for (const id of order) {
      if (INVITE_COLUMN_DEFS.some(c => c.id === id) && !seen.has(id)) {
        seen.add(id); result.push(id)
      }
    }
    // Any new columns not yet in saved order
    for (const c of INVITE_COLUMN_DEFS) if (!seen.has(c.id)) result.push(c.id)
    return result.filter(id => !hiddenCols.has(id))
  }, [colOrder, hiddenCols])

  // Filters
  const [yearFilter, setYearFilter] = useState<string[]>([])
  const [minScore, setMinScore] = useState(0)
  const [minAttended, setMinAttended] = useState(0)
  const [eventFilter, setEventFilter] = useState<string[]>([])
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Student preview panel
  const [previewStudent, setPreviewStudent] = useState<EnrichedStudent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Compose
  const [step, setStep] = useState<Step>('select')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  // Per-send attachments — cleared whenever the modal reopens. Not
  // persisted to localStorage because uploaded storage keys aren't
  // guaranteed to still exist after a long-lived draft sits around.
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachmentInfo[]>([])
  // Rich-editor refs — used to inject merge-tag pills at the caret.
  const bodyEditorRef = useRef<RichTextEmailEditorHandle | null>(null)
  const subjectEditorRef = useRef<SingleLineMergeEditorHandle | null>(null)
  // Re-seed counter: bumped whenever we programmatically set body/subject
  // (template pick, draft restore) so the contenteditable re-initialises.
  const [editorSeedCounter, setEditorSeedCounter] = useState(0)

  // Draft persistence (localStorage, per event). Survives accidental modal
  // close or a browser refresh mid-compose so nobody loses a 10-min edit.
  const draftKey = `invite_modal_draft_v1:${eventId}`
  const draftSeededRef = useRef(false)
  useEffect(() => {
    if (draftSeededRef.current) return
    draftSeededRef.current = true
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed?.subject) setEmailSubject(String(parsed.subject))
      if (parsed?.body) setEmailBody(String(parsed.body))
      if (parsed?.templateId) setSelectedTemplate(String(parsed.templateId))
      setEditorSeedCounter(c => c + 1)
    } catch {
      // ignore — a corrupt draft shouldn't block the user
    }
  }, [draftKey])
  useEffect(() => {
    if (!draftSeededRef.current) return
    if (typeof window === 'undefined') return
    if (!emailSubject && !emailBody) {
      // Empty draft — clear so the key doesn't linger stale
      try { window.localStorage.removeItem(draftKey) } catch { /* noop */ }
      return
    }
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ subject: emailSubject, body: emailBody, templateId: selectedTemplate }))
    } catch { /* quota — best-effort */ }
  }, [draftKey, emailSubject, emailBody, selectedTemplate])

  // Send progress
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0, total: 0 })
  // Daily marketing cap (rolling 24h). Refreshed on mount and after each
  // send completes so the indicator stays honest without polling.
  const [capStatus, setCapStatus] = useState<CapStatus | null>(null)
  const refreshCapStatus = useCallback(async () => {
    try { setCapStatus(await getCapStatus(supabase)) } catch { /* fail-open — server still enforces */ }
  }, [])
  useEffect(() => { refreshCapStatus() }, [refreshCapStatus])
  // Ref flag polled between sends so an admin can stop a batch mid-flight
  // (e.g. they noticed the subject line was wrong after 3 of 50 went out).
  const sendAbortRef = useRef(false)
  const [sendAborted, setSendAborted] = useState(false)

  // Template management — mirrors the decision-flow (events/[id]) pattern:
  // inline rename/delete + in-place 'Save to template' when the editor
  // content diverges from the loaded template.
  const [templateDirty, setTemplateDirty] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  // Full template editor (opened by the pencil icon in the compose header).
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [editTemplateError, setEditTemplateError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  // Pull the MAX(sent_at) per student from email_log, both scoped to this
  // event and across all events. Called from loadData and again after a send
  // so the UI reflects reality without a full reload.
  const refreshLastContacted = useCallback(async () => {
    // Paginate to avoid the default 1000-row PostgREST ceiling.
    const pageSize = 1000
    const forEvent: Record<string, string> = {}
    const any: Record<string, string> = {}
    const applyRow = (row: { student_id: string | null; event_id: string | null; sent_at: string | null }) => {
      if (!row.student_id || !row.sent_at) return
      if (!any[row.student_id] || row.sent_at > any[row.student_id]) any[row.student_id] = row.sent_at
      if (row.event_id === eventId) {
        if (!forEvent[row.student_id] || row.sent_at > forEvent[row.student_id]) forEvent[row.student_id] = row.sent_at
      }
    }
    for (let page = 0; page < 20; page++) {
      const { data } = await supabase
        .from('email_log')
        .select('student_id, event_id, sent_at')
        .eq('status', 'sent')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (!data || data.length === 0) break
      data.forEach((r: any) => applyRow(r))
      if (data.length < pageSize) break
    }
    setLastContactedForEvent(forEvent)
    setLastContactedAny(any)
  }, [eventId])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [enriched, { data: appData }, { data: tplData }] = await Promise.all([
      fetchAllStudentsEnriched({ forceRefresh: true }),
      supabase.from('applications').select('student_id').eq('event_id', eventId).is('deleted_at', null),
      supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false }),
      refreshLastContacted(),
    ])
    const applied = new Set((appData ?? []).map((a: any) => a.student_id))
    setAppliedIds(applied)
    // Only include students who haven't applied and aren't ineligible
    setStudents(enriched.filter(s => !applied.has(s.id) && s.eligibility !== 'ineligible' && s.personal_email && s.subscribed_to_mailing !== false))
    setTemplates((tplData ?? []) as Template[])
    setLoading(false)
  }, [eventId, refreshLastContacted])

  useEffect(() => { loadData() }, [loadData])

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  const yearGroups = useMemo(() => {
    const yrs = new Set<string>()
    let hasUnknown = false
    students.forEach(s => {
      if (s.year_group != null) yrs.add(s.year_group)
      else hasUnknown = true
    })
    const sorted = Array.from(yrs).sort((a, b) => Number(a) - Number(b))
    if (hasUnknown) sorted.push('unknown')
    return sorted
  }, [students])

  const filtered = useMemo(() => {
    const cutoff = hideContactedDays > 0
      ? new Date(Date.now() - hideContactedDays * 24 * 60 * 60 * 1000).toISOString()
      : null
    const contactMap = hideContactedScope === 'any' ? lastContactedAny : lastContactedForEvent
    return students.filter(s => {
      if (yearFilter.length) {
        const yr = s.year_group ?? 'unknown'
        if (!yearFilter.includes(yr)) return false
      }
      if (minScore > 0 && s.engagement_score < minScore) return false
      if (minAttended > 0 && (s.attended_count ?? 0) < minAttended) return false
      if (eventFilter.length > 0) {
        const attendedEventIds = new Set(s.applications.filter(a => a.attended).map(a => a.event_id))
        if (!eventFilter.some(eid => attendedEventIds.has(eid))) return false
      }
      if (cutoff) {
        const lc = contactMap[s.id]
        if (lc && lc > cutoff) return false
      }
      if (search) {
        const q = search.toLowerCase()
        if (!`${s.first_name} ${s.last_name}`.toLowerCase().includes(q) &&
            !(s.school_type ?? '').toLowerCase().includes(q) &&
            !(s.personal_email ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [students, yearFilter, minScore, minAttended, eventFilter, search, hideContactedDays, hideContactedScope, lastContactedForEvent, lastContactedAny])

  // Pagination
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageStudents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Close event dropdown on outside click
  const eventDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!eventDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (eventDropRef.current && !eventDropRef.current.contains(e.target as Node)) {
        setEventDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [eventDropdownOpen])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [yearFilter, minScore, minAttended, eventFilter, search, hideContactedDays, hideContactedScope])

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  const toggleAll = () => {
    const pageIds = pageStudents.map(s => s.id)
    const allSelected = pageIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(filtered.map(s => s.id)))
  }
  const clearSelection = () => setSelected(new Set())

  // Gmail-style banner state. pageStudents is what's rendered now; filtered is
  // everything matching the filter. When the page is fully ticked, we offer an
  // "extend to filter" action instead of silently doing it (too easy to send a
  // bulk invite to 400 students when you meant 50).
  const pageIds = useMemo(() => pageStudents.map(s => s.id), [pageStudents])
  const filteredIds = useMemo(() => filtered.map(s => s.id), [filtered])
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))

  // Silently clear selection when the filter changes — consistent with the
  // /students and applicants surfaces.
  const filteredSigRef = useRef('')
  useEffect(() => {
    const sig = filteredIds.length === 0 ? '' : `${filteredIds.length}:${filteredIds[0]}:${filteredIds[filteredIds.length - 1]}`
    if (filteredSigRef.current && filteredSigRef.current !== sig) {
      setSelected(new Set())
    }
    filteredSigRef.current = sig
  }, [filteredIds])

  // ---------------------------------------------------------------------------
  // Compose helpers
  // ---------------------------------------------------------------------------

  const applyLink = `https://the-steps-foundation-intranet.vercel.app/apply/${eventSlug}`

  const fillMerge = (text: string, s: EnrichedStudent): string => {
    let result = text
      .replace(/\{\{first_name\}\}/g, (s.preferred_name && s.preferred_name.trim()) ? s.preferred_name : (s.first_name ?? ''))
      .replace(/\{\{last_name\}\}/g, s.last_name ?? '')
      .replace(/\{\{full_name\}\}/g, `${s.first_name ?? ''} ${s.last_name ?? ''}`)
      .replace(/\{\{email\}\}/g, String(s.personal_email ?? ''))
      .replace(/\{\{event_name\}\}/g, eventName)
      .replace(/\{\{apply_link\}\}/g, applyLink)
      .replace(/\{\{event_date\}\}/g, eventData?.event_date ? new Date(eventData.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')
      .replace(/\{\{event_time\}\}/g, eventData?.time_start ? (eventData.time_start + (eventData.time_end ? ` – ${eventData.time_end}` : '')) : '')
      .replace(/\{\{event_location\}\}/g, eventData?.location ?? '')
      .replace(/\{\{event_format\}\}/g, eventData?.format === 'in_person' ? 'in person' : eventData?.format === 'online' ? 'online' : eventData?.format === 'hybrid' ? 'hybrid' : '')
      .replace(/\{\{event_dress_code\}\}/g, eventData?.dress_code ?? '')
      .replace(/\{\{event_capacity\}\}/g, eventData?.capacity != null ? String(eventData.capacity) : '')
      .replace(/\{\{open_to\}\}/g, formatOpenTo(eventData?.eligible_year_groups, eventData?.open_to_gap_year ?? false))
      .replace(/\{\{application_deadline\}\}/g, eventData?.applications_close_at
        ? new Date(eventData.applications_close_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).replace(',', ' at')
        : '')
    // Last attended event — most recent event the student actually attended
    const attendedApps = (s.applications || [])
      .filter(a => a.attended)
      .map(a => ({ ...a, ev: EVENT_BY_ID[a.event_id] }))
      .filter(a => a.ev)
      .sort((a, b) => new Date(b.ev.date).getTime() - new Date(a.ev.date).getTime())
    result = result.replace(/\{\{last_attended_event\}\}/g, attendedApps[0]?.ev?.name ?? '')
    // Dynamic tags from raw_response
    const dynTags = getStudentMergeTags(s)
    for (const [key, val] of Object.entries(dynTags)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    }
    // Clear any unfilled dynamic tags
    result = result.replace(/\{\{[a-z_0-9]+\}\}/g, '')
    return result
  }

  const recipients = students.filter(s => selected.has(s.id))
  const firstRecipient = recipients[0]

  const applyTemplate = (tplId: string) => {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    setSelectedTemplate(tplId)
    setEmailSubject(tpl.subject)
    setEmailBody(tpl.body_html)
    setEditorSeedCounter(c => c + 1)
    setTemplateDirty(false)
  }

  const reloadTemplates = async () => {
    const { data } = await supabase
      .from('email_templates')
      .select('id, name, type, subject, body_html, event_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    setTemplates((data ?? []) as Template[])
  }

  // ---------------------------------------------------------------------------
  // Template CRUD — lightweight inline flow matching the decision notify UI:
  // rename via prompt, delete via confirm, save current edits back via
  // 'Save to template' CTA. Full-editor panel retired.
  // ---------------------------------------------------------------------------

  const renameSelectedTemplate = async () => {
    if (!selectedTemplate) return
    const current = templates.find(t => t.id === selectedTemplate)
    if (!current) return
    const next = window.prompt('Rename template', current.name)?.trim()
    if (!next || next === current.name) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        name: next,
        updated_by: teamMemberUuid,
      }).eq('id', selectedTemplate)
      await reloadTemplates()
    } finally {
      setSavingTemplate(false)
    }
  }

  const deleteSelectedTemplate = async () => {
    if (!selectedTemplate) return
    const current = templates.find(t => t.id === selectedTemplate)
    if (!current) return
    if (!confirm(`Delete template "${current.name}"? This can't be undone from the UI.`)) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        deleted_at: new Date().toISOString(),
      }).eq('id', selectedTemplate)
      setSelectedTemplate('')
      setTemplateDirty(false)
      await reloadTemplates()
    } finally {
      setSavingTemplate(false)
    }
  }

  const saveTemplateChanges = async () => {
    if (!selectedTemplate) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        subject: emailSubject,
        body_html: emailBody,
        updated_by: teamMemberUuid,
      }).eq('id', selectedTemplate)
      setTemplateDirty(false)
      await reloadTemplates()
    } finally {
      setSavingTemplate(false)
    }
  }

  /** Save current subject+body as a brand-new template of type 'invite',
   *  scoped to this event. Used by the '+ New template…' dropdown option. */
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
          updated_by: teamMemberUuid ?? null,
        })
        .eq('id', editingTemplate.id)
      if (error) { setEditTemplateError(error.message); return }
      await reloadTemplates()
      // If the just-edited template is the one currently loaded in the
      // compose editor, re-seed the live editor with the fresh content.
      if (selectedTemplate === editingTemplate.id) {
        setEmailSubject(draft.subject)
        setEmailBody(draft.body_html)
        setEditorSeedCounter(c => c + 1)
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
    setSavingTemplate(true)
    try {
      const { data, error } = await supabase.from('email_templates').insert({
        name,
        type: 'invite',
        subject: emailSubject,
        body_html: emailBody,
        event_id: eventId,
        created_by: teamMemberUuid,
        updated_by: teamMemberUuid,
      }).select('id').single()
      if (error) throw error
      await reloadTemplates()
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

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const sendInvites = async () => {
    setStep('sending')
    sendAbortRef.current = false
    setSendAborted(false)
    setSendProgress({ sent: 0, failed: 0, total: recipients.length })

    for (const student of recipients) {
      if (sendAbortRef.current) break
      const renderedSubject = fillMerge(emailSubject, student)
      const renderedBody = fillMerge(emailBody, student)
      // Convert plain text to HTML paragraphs
      const htmlBody = renderedBody
        .split('\n\n')
        .map(p => `<p style="margin:0 0 12px 0;font-family:arial,sans-serif;font-size:14px;color:#222">${p.replace(/\n/g, '<br>')}</p>`)
        .join('')
      const fullBody = htmlBody + EMAIL_SIGNATURE_HTML

      // Insert email_log at 'pending' and capture the id so we can flip it to
      // 'sent'/'failed' after the API call. If the insert itself fails we still
      // attempt the send, but we won't have a log row to flip.
      let emailLogId: string | null = null
      try {
        const { data: logRow } = await supabase.from('email_log').insert({
          student_id: student.id,
          event_id: eventId,
          template_id: selectedTemplate || null,
          to_email: student.personal_email!,
          from_email: 'events@thestepsfoundation.com',
          subject: renderedSubject,
          body_html: fullBody,
          status: 'pending',
          sent_by: teamMemberUuid,
        }).select('id').single()
        emailLogId = logRow?.id ?? null
      } catch {
        // swallow — the send is what matters; log row is best-effort
      }

      try {
        // Send via API route
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: student.personal_email!,
            subject: renderedSubject,
            html: fullBody,
            attachments: emailAttachments,
            studentId: student.id,
          }),
        })

        if (res.ok) {
          if (emailLogId) {
            await supabase.from('email_log')
              .update({ status: 'sent', sent_at: new Date().toISOString() })
              .eq('id', emailLogId)
          }
          setSendProgress(p => ({ ...p, sent: p.sent + 1 }))
        } else {
          let errMsg = `HTTP ${res.status}`
          let capReached = false
          try {
            const body = await res.json()
            if (body?.error) errMsg = String(body.error).slice(0, 1000)
            if (body?.capReached) capReached = true
          } catch { /* noop */ }
          if (emailLogId) {
            await supabase.from('email_log')
              .update({ status: 'failed', error_message: errMsg })
              .eq('id', emailLogId)
          }
          setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
          // Cap hit — stop the batch immediately so the remaining recipients
          // aren't marked as 'failed' when the real reason is the 24h ceiling.
          // The log row we already inserted for THIS recipient stays 'failed'
          // with the cap message as a record.
          if (capReached) {
            sendAbortRef.current = true
            setSendAborted(true)
            break
          }
        }
      } catch (err: any) {
        const errMsg = String(err?.message ?? 'Network error').slice(0, 1000)
        if (emailLogId) {
          await supabase.from('email_log')
            .update({ status: 'failed', error_message: errMsg })
            .eq('id', emailLogId)
        }
        setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
      }
    }
    // Refresh last-contacted timestamps so they reflect the just-sent invites
    // without having to close and reopen the modal.
    await refreshLastContacted()
    // Also refresh the cap indicator — we just pushed N emails into the
    // rolling-24h window.
    await refreshCapStatus()
    // If the send ran to completion (not aborted), clear the draft — this
    // copy has done its job.
    if (!sendAbortRef.current && typeof window !== 'undefined') {
      try { window.localStorage.removeItem(draftKey) } catch { /* noop */ }
    }
    setStep('done')
  }

  // ---------------------------------------------------------------------------
  // Event label helpers
  // ---------------------------------------------------------------------------

  const eventLabels = useMemo(() => {
    const map: Record<string, string> = {}
    EVENTS.forEach(e => { map[e.id] = e.short ?? e.name })
    return map
  }, [EVENTS])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-8 text-center" onClick={e => e.stopPropagation()}>
          <div className="text-sm text-gray-500">Loading students…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {step === 'select' ? 'Invite Students' : step === 'compose' ? 'Compose Invite Email' : step === 'preview' ? 'Preview' : step === 'sending' ? 'Sending…' : 'Emails sent'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step === 'select' && (() => {
                const eligibleCount = filtered.filter(s => s.eligibility === 'eligible').length
                const unknownCount = filtered.filter(s => s.eligibility !== 'eligible').length
                return `${filtered.length} students shown — ${eligibleCount} eligible, ${unknownCount} unknown (excluding ${appliedIds.size} already applied)`
              })()}
              {step === 'compose' && `${selected.size} students selected`}
              {step === 'preview' && `Sending to ${recipients.length} student${recipients.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ======= STEP: SELECT ======= */}
          {step === 'select' && (
            <>
              {/* Filters row */}
              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, school, email…"
                  className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-56"
                />

                {/* Year group */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Year:</span>
                  {yearGroups.map(y => (
                    <button
                      key={y}
                      onClick={() => setYearFilter(f => f.includes(y) ? f.filter(v => v !== y) : [...f, y])}
                      className={`px-2 py-1 text-xs rounded-md border ${
                        yearFilter.includes(y)
                          ? 'bg-steps-blue-600 text-white border-steps-blue-600'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                      title={y === 'unknown' ? 'Students with no year group on file' : undefined}
                    >
                      {y === 'unknown' ? 'Unknown' : `Y${y}`}
                    </button>
                  ))}
                </div>

                {/* Min score */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">Min score:</span>
                  <input
                    type="number"
                    value={minScore}
                    onChange={e => setMinScore(Number(e.target.value))}
                    className="w-14 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    min={0}
                  />
                </div>

                {/* Min attended events — useful for templates targeting
                     returning attendees (e.g. "enjoyed seeing you at {{last_event}}"). */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Attended:</span>
                  {[
                    { v: 0, label: 'Any' },
                    { v: 1, label: '≥1' },
                    { v: 2, label: '≥2' },
                    { v: 3, label: '≥3' },
                  ].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setMinAttended(opt.v)}
                      className={`px-2 py-1 text-xs rounded-md border ${
                        minAttended === opt.v
                          ? 'bg-steps-blue-600 text-white border-steps-blue-600'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                      title={opt.v === 0 ? 'No attendance filter' : `Students who attended at least ${opt.v} event${opt.v > 1 ? 's' : ''}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Recent-contact filter — anti-spam guard. Scope follows the
                     scope toggle (this event vs any event). */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">Hide contacted:</span>
                  {[
                    { v: 0, label: 'Off' },
                    { v: 7, label: '7d' },
                    { v: 14, label: '14d' },
                    { v: 30, label: '30d' },
                  ].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setHideContactedDays(opt.v)}
                      className={`px-2 py-1 text-xs rounded-md border ${
                        hideContactedDays === opt.v
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                      title={opt.v === 0
                        ? 'Show everyone regardless of last-contact date'
                        : `Hide students emailed in the last ${opt.v} days`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {hideContactedDays > 0 && (
                    <select
                      value={hideContactedScope}
                      onChange={e => setHideContactedScope(e.target.value as 'event' | 'any')}
                      className="text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-1 ml-1"
                      title="Scope: look at emails for this event only, or any event"
                    >
                      <option value="event">this event</option>
                      <option value="any">any event</option>
                    </select>
                  )}
                </div>

                {/* Past events multi-select */}
                <div className="relative" ref={eventDropRef}>
                  <button
                    onClick={() => setEventDropdownOpen(o => !o)}
                    className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center gap-1 min-w-[140px]"
                  >
                    <span className="truncate">
                      {eventFilter.length === 0 ? 'All events' : `${eventFilter.length} event${eventFilter.length > 1 ? 's' : ''} selected`}
                    </span>
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {eventDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-64 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
                      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium">Attended event:</div>
                      {EVENTS.map(ev => (
                        <label key={ev.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={eventFilter.includes(ev.id)}
                            onChange={() => {
                              setEventFilter(prev =>
                                prev.includes(ev.id)
                                  ? prev.filter(id => id !== ev.id)
                                  : [...prev, ev.id]
                              )
                            }}
                          />
                          <span className="text-sm">{ev.short} <span className="text-gray-400">({ev.date})</span></span>
                        </label>
                      ))}
                      {eventFilter.length > 0 && (
                        <button
                          onClick={() => setEventFilter([])}
                          className="w-full text-left px-3 py-1.5 text-xs text-steps-blue-600 dark:text-steps-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-800 mt-1"
                        >
                          Clear selection
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Column picker — per-user persistence via localStorage */}
                <div className="ml-auto">
                  <ColumnPicker
                    allColumns={INVITE_COLUMN_DEFS}
                    hidden={hiddenCols}
                    order={colOrder}
                    onToggle={toggleCol}
                    onReorder={reorderCols}
                    onReset={resetCols}
                    buttonLabel={`Columns (${visibleCols.length}/${INVITE_COLUMN_DEFS.length})`}
                  />
                </div>
              </div>

              {/* Bulk actions */}
              {selected.size > 0 && (
                <div className="mb-3 flex items-center gap-3 text-sm">
                  <span className="font-medium text-steps-blue-600 dark:text-steps-blue-400">{selected.size} selected</span>
                  <button onClick={clearSelection} className="text-xs text-gray-500 hover:underline">
                    Clear
                  </button>
                </div>
              )}

              <SelectAllBanner
                selectedCount={selected.size}
                pageCount={pageIds.length}
                filteredCount={filtered.length}
                allPageSelected={allPageSelected}
                allFilteredSelected={allFilteredSelected}
                onSelectAllFiltered={selectAll}
                onClear={clearSelection}
                noun="students"
              />

              {/* Table */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <input type="checkbox" checked={pageStudents.length > 0 && pageStudents.every(s => selected.has(s.id))} onChange={toggleAll} />
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
                      {visibleCols.map(colId => {
                        const def = INVITE_COLUMN_DEFS.find(c => c.id === colId)
                        if (!def) return null
                        const align =
                          colId === 'score' ? 'text-right'
                          : colId === 'school_type' ? 'text-left'
                          : 'text-center'
                        const titleHint =
                          colId === 'last_contacted' ? 'Most recent email sent to this student (this event first, dimmed = any event)'
                          : colId === 'past_events_detail' ? 'Attended : Accepted : Submitted (lifetime)'
                          : colId === 'apps_total' ? 'Lifetime count of applications submitted'
                          : undefined
                        return (
                          <th key={colId} className={`${align} px-3 py-2 text-xs font-medium text-gray-500 uppercase`} title={titleHint}>
                            {colId === 'school_type' ? 'School Type' : def.label.replace(' (attended:accepted:submitted)', '')}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {pageStudents.map(s => (
                      <tr key={s.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected.has(s.id) ? 'bg-steps-blue-50 dark:bg-steps-blue-900/10' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewLoading(true)
                              setPreviewStudent(s as any)
                              fetchEnrichedStudent(s.id).then(full => {
                                setPreviewStudent(full)
                                setPreviewLoading(false)
                              }).catch(() => setPreviewLoading(false))
                            }}
                            className="text-left hover:text-steps-blue-600 dark:hover:text-steps-blue-400 hover:underline cursor-pointer"
                          >
                            {s.first_name} {s.last_name}
                          </button>
                          <div className="text-xs text-gray-400">{s.personal_email}</div>
                        </td>
                        {visibleCols.map(colId => {
                          if (colId === 'school_type') {
                            return (
                              <td key={colId} className="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">
                                {s.school_type ? s.school_type.charAt(0).toUpperCase() + s.school_type.slice(1) : '—'}
                              </td>
                            )
                          }
                          if (colId === 'year') {
                            return (
                              <td key={colId} className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                                {s.year_group ?? '—'}
                              </td>
                            )
                          }
                          if (colId === 'events') {
                            return (
                              <td key={colId} className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                                {EVENTS.length > 0 ? `${s.attended_count}/${EVENTS.length}` : '—'}
                              </td>
                            )
                          }
                          if (colId === 'past_events_detail') {
                            const att = s.attended_count ?? 0
                            const acc = s.accepted_count ?? 0
                            const sub = s.submitted_count ?? 0
                            return (
                              <td key={colId} className="px-3 py-2 text-center text-xs text-gray-600 dark:text-gray-400 font-mono" title={`Attended ${att} • Accepted ${acc} • Submitted ${sub}`}>
                                {att}:{acc}:{sub}
                              </td>
                            )
                          }
                          if (colId === 'eligibility') {
                            return (
                              <td key={colId} className="px-3 py-2 text-center">
                                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                                  s.eligibility === 'eligible'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                }`}>
                                  {s.eligibility === 'eligible' ? 'Eligible' : 'Unknown'}
                                </span>
                              </td>
                            )
                          }
                          if (colId === 'score') {
                            return (
                              <td key={colId} className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                                {s.engagement_score}
                              </td>
                            )
                          }
                          if (colId === 'apps_total') {
                            const total = (s.applications ?? []).length
                            return (
                              <td key={colId} className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                                {total}
                              </td>
                            )
                          }
                          if (colId === 'last_contacted') {
                            const evTs = lastContactedForEvent[s.id]
                            const anyTs = lastContactedAny[s.id]
                            return (
                              <td key={colId} className="px-3 py-2 text-center text-xs">
                                {evTs ? (
                                  <span className="text-amber-700 dark:text-amber-400 font-medium" title={`This event — ${formatAbsolute(evTs)}`}>
                                    {formatRelativeAge(evTs)}
                                  </span>
                                ) : anyTs ? (
                                  <span className="text-gray-400" title={`Last email (any event) — ${formatAbsolute(anyTs)}`}>
                                    {formatRelativeAge(anyTs)}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                              </td>
                            )
                          }
                          return <td key={colId} className="px-3 py-2">—</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                  <span>Page {page + 1} of {totalPages} ({filtered.length} students)</span>
                  <div className="flex gap-1">
                    <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&laquo;</button>
                    <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&lsaquo;</button>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&rsaquo;</button>
                    <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-30">&raquo;</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ======= STEP: COMPOSE ======= */}
          {step === 'compose' && (() => {
            const mergeTags: MergeTag[] = [
              { tag: 'first_name', label: 'First Name' },
              { tag: 'event_name', label: 'Event Name' },
              { tag: 'apply_link', label: 'Apply Link' },
              { tag: 'last_attended_event', label: 'Last Event' },
              ...(eventData?.event_date ? [{ tag: 'event_date', label: 'Event Date' }] : []),
              ...(eventData?.time_start ? [{ tag: 'event_time', label: 'Event Time' }] : []),
              ...(eventData?.location ? [{ tag: 'event_location', label: 'Location' }] : []),
              ...(eventData?.format ? [{ tag: 'event_format', label: 'Format' }] : []),
              ...(eventData?.dress_code ? [{ tag: 'event_dress_code', label: 'Dress Code' }] : []),
              { tag: 'open_to', label: 'Open To' },
              ...(eventData?.applications_close_at ? [{ tag: 'application_deadline', label: 'Application Deadline' }] : []),
              ...getAvailableDynamicTags(recipients),
            ]
            const subjectTags = mergeTags.filter(t =>
              ['first_name', 'event_name'].includes(t.tag),
            )
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
                onClearTemplate={() => { setSelectedTemplate(''); setTemplateDirty(false) }}
                templateFilter={t => !t.event_id || t.event_id === eventId}
                subjectEditorRef={subjectEditorRef}
                bodyEditorRef={bodyEditorRef}
                emailSubject={emailSubject}
                emailBody={emailBody}
                onSubjectChange={setEmailSubject}
                onBodyChange={setEmailBody}
                onDirty={() => { if (selectedTemplate) setTemplateDirty(true) }}
                subjectEditorKey={editorSeedCounter}
                bodyEditorKey={editorSeedCounter}
                bodyInitialHtml={emailBody}
                subjectMergeTags={subjectTags}
                bodyMergeTags={mergeTags}
                subjectPlaceholder="e.g. You're Invited to {{event_name}}!"
                bodyPlaceholder={`Hey {{first_name}},\n\nWe'd love for you to apply to {{event_name}}!\n\nApply here: {{apply_link}}\n\nBest wishes,\nThe Steps Foundation Team`}
                attachments={emailAttachments}
                onAttach={att => setEmailAttachments(prev => prev.some(p => p.url === att.url) ? prev : [...prev, att])}
                onRemoveAttachment={url => setEmailAttachments(prev => prev.filter(p => p.url !== url))}
              />
            )
          })()}

          {/* ======= STEP: PREVIEW ======= */}
          {step === 'preview' && firstRecipient && (
            <EmailPreviewPanel
              recipientName={`${firstRecipient.first_name} ${firstRecipient.last_name}`}
              recipientEmail={firstRecipient.personal_email}
              filledSubject={fillMerge(emailSubject, firstRecipient)}
              filledBodyHtml={(() => {
                const filled = fillMerge(emailBody, firstRecipient)
                return filled
                  .split('\n\n')
                  .map(p => `<p style="margin:0 0 12px 0;font-family:arial,sans-serif;font-size:14px;color:#222">${p.replace(/\n/g, '<br>')}</p>`)
                  .join('')
              })()}
              footerBanner={
                <>
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                    This will send <strong>{recipients.length}</strong> individual email{recipients.length !== 1 ? 's' : ''} to <strong>{recipients.length}</strong> student{recipients.length !== 1 ? 's' : ''}.
                  </div>
                  {capStatus && recipients.length > capStatus.remaining && (
                    <div className="mt-2 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-3 text-sm text-rose-800 dark:text-rose-300">
                      <strong>Daily cap warning.</strong> You've used {capStatus.used} of {capStatus.cap} marketing emails in the last 24h ({capStatus.remaining} remaining). Only the first <strong>{capStatus.remaining}</strong> of {recipients.length} will go through — the rest will be stopped at the cap. The window is rolling, so capacity frees up as older sends age past 24h.
                    </div>
                  )}
                  {capStatus && recipients.length <= capStatus.remaining && capStatus.used >= capStatus.cap * 0.8 && (
                    <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                      FYI — {capStatus.used} of {capStatus.cap} marketing emails used in the last 24h. Sending these {recipients.length} will leave {Math.max(0, capStatus.remaining - recipients.length)} headroom.
                    </div>
                  )}
                </>
              }
            />
          )}

          {/* ======= STEP: SENDING ======= */}
          {step === 'sending' && (
            <EmailSendingPanel
              progress={sendProgress}
              aborted={sendAborted}
              onAbort={() => { sendAbortRef.current = true; setSendAborted(true) }}
            />
          )}

          {/* ======= STEP: DONE ======= */}
          {step === 'done' && (
            <EmailDonePanel
              progress={sendProgress}
              aborted={sendAborted}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-between shrink-0">
          {step === 'select' && (
            <>
              <div className="flex items-center gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
                {capStatus && (() => {
                  const pct = Math.min(100, Math.round((capStatus.used / capStatus.cap) * 100))
                  const over = selected.size > capStatus.remaining
                  const tone = over
                    ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                    : pct >= 80
                      ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800'
                  return (
                    <span
                      className={`text-xs px-2 py-1 rounded-md border ${tone}`}
                      title={`Marketing-email daily cap: ${capStatus.used} of ${capStatus.cap} used in the rolling 24h window. ${capStatus.remaining} remaining.`}
                    >
                      {capStatus.used}/{capStatus.cap} used · {capStatus.remaining} left
                      {over && selected.size > 0 ? ` · ${selected.size - capStatus.remaining} over` : ''}
                    </span>
                  )
                })()}
              </div>
              <button
                onClick={() => setStep('compose')}
                disabled={selected.size === 0}
                className="px-4 py-2 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50"
              >
                Next: Compose email ({selected.size})
              </button>
            </>
          )}
          {step === 'compose' && (
            <>
              <button onClick={() => setStep('select')} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">&larr; Back</button>
              <button
                onClick={() => setStep('preview')}
                disabled={!emailSubject || !emailBody}
                className="px-4 py-2 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50"
              >
                Preview
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('compose')} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">&larr; Edit</button>
              <button
                onClick={() => {
                  // Anti-spam guard: if any recipients were emailed in the
                  // last 7 days (this event or any event), make sure the
                  // admin sees the count before committing.
                  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
                  let recentForEvent = 0
                  let recentAny = 0
                  for (const r of recipients) {
                    const evTs = lastContactedForEvent[r.id]
                    const anyTs = lastContactedAny[r.id]
                    if (evTs && new Date(evTs).getTime() > weekAgo) recentForEvent++
                    else if (anyTs && new Date(anyTs).getTime() > weekAgo) recentAny++
                  }
                  const warnParts: string[] = []
                  if (recentForEvent > 0) warnParts.push(`${recentForEvent} already emailed about this event in the last 7 days`)
                  if (recentAny > 0) warnParts.push(`${recentAny} emailed about another event in the last 7 days`)
                  if (warnParts.length > 0) {
                    const ok = confirm(`Heads up: ${warnParts.join(' and ')}. Send anyway?`)
                    if (!ok) return
                  }
                  // Cap pre-flight: if this batch would breach the rolling
                  // 24h marketing cap, make sure the admin acknowledges
                  // that only `remaining` will go through.
                  if (capStatus && recipients.length > capStatus.remaining) {
                    const ok = confirm(
                      `Daily marketing cap: ${capStatus.used} of ${capStatus.cap} used in the last 24h — only ${capStatus.remaining} of ${recipients.length} recipients will go through before the cap stops the batch. Send anyway? (Window is rolling — capacity frees up as older sends age past 24h.)`
                    )
                    if (!ok) return
                  }
                  sendInvites()
                }}
                className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Send {recipients.length} invite{recipients.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <div className="w-full text-right">
              <button onClick={() => { onSent(sendProgress.sent); onClose() }} className="px-4 py-2 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700">
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ======= STUDENT PREVIEW SLIDE-OUT ======= */}
      {previewStudent && (
        <div className="fixed inset-0 z-[60]" onClick={e => { e.stopPropagation(); setPreviewStudent(null) }}>
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="absolute right-0 top-0 h-full w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto animate-slide-in-right"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {previewStudent.first_name} {previewStudent.last_name}
              </h3>
              <button onClick={() => setPreviewStudent(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">&times;</button>
            </div>

            {previewLoading ? (
              <div className="p-8 text-center text-gray-400">Loading full profile…</div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Contact & basics */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <PreviewField label="Email" value={previewStudent.personal_email} />
                  <PreviewField label="Year group" value={previewStudent.year_group} />
                  <PreviewField label="School" value={previewStudent.school_name_raw} />
                  <PreviewField label="School type" value={previewStudent.school_type ? previewStudent.school_type.charAt(0).toUpperCase() + previewStudent.school_type.slice(1) : null} />
                </div>

                {/* Scores & eligibility */}
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400">
                    Score {previewStudent.engagement_score}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    {previewStudent.attended_count} attended
                  </span>
                  {previewStudent.no_show_count > 0 && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {previewStudent.no_show_count} no-show
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    previewStudent.eligibility === 'eligible'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : previewStudent.eligibility === 'ineligible'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {previewStudent.eligibility === 'eligible' ? 'Eligible' : previewStudent.eligibility === 'ineligible' ? 'Ineligible' : 'Unknown'}
                  </span>
                </div>

                {/* SMI indicators */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase">Social Mobility Indicators</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <PreviewField label="Free school meals" value={previewStudent.free_school_meals === true ? 'Yes' : previewStudent.free_school_meals === false ? 'No' : '—'} />
                    <PreviewField label="Income band" value={
                      previewStudent.parental_income_band === 'under_40k' ? 'Under £40k'
                        : previewStudent.parental_income_band === 'over_40k' ? '£40k or more'
                        : previewStudent.parental_income_band === 'prefer_na' ? 'Prefer not to say'
                        : '—'
                    } />
                    <PreviewField label="Mailing list" value={previewStudent.subscribed_to_mailing === true ? 'Yes' : previewStudent.subscribed_to_mailing === false ? 'No' : '—'} />
                  </div>
                </div>

                {/* Event history */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50">
                    <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Event History</h4>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800/30">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium text-gray-500">Event</th>
                        <th className="text-center px-2 py-1.5 font-medium text-gray-500">Status</th>
                        <th className="text-center px-2 py-1.5 font-medium text-gray-500">Attended</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {EVENTS.map(ev => {
                        const app = previewStudent.applications.find(a => a.event_id === ev.id)
                        return (
                          <tr key={ev.id}>
                            <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">{ev.short}</td>
                            <td className="px-2 py-1.5 text-center">
                              {app ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  app.status === 'accepted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : app.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                }`}>
                                  {app.status}
                                </span>
                              ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {app?.attended ? '✓' : app ? '✗' : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Notes */}
                {previewStudent.notes && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                    <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">Notes</h4>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{previewStudent.notes}</p>
                  </div>
                )}
              </div>
            )}
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
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-gray-900 dark:text-gray-100">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  )
}
