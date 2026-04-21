'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type EnrichedStudent, fetchAllStudentsEnriched, fetchEnrichedStudent, EVENTS, EVENT_BY_ID } from '@/lib/students-api'
import { type EventRow, fetchEvent } from '@/lib/events-api'
import SelectAllBanner from './SelectAllBanner'

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

// Email signature — matches the real events@ Gmail signature
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
`

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InviteStudentsModal({ eventId, eventName, eventSlug, teamMemberUuid, onClose, onSent }: Props) {
  // Event details (for merge tags)
  const [eventData, setEventData] = useState<EventRow | null>(null)
  useEffect(() => { fetchEvent(eventId).then(e => setEventData(e)) }, [eventId])

  // Data
  const [students, setStudents] = useState<EnrichedStudent[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])

  // Filters
  const [yearFilter, setYearFilter] = useState<string[]>([])
  const [minScore, setMinScore] = useState(0)
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

  // Send progress
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0, total: 0 })

  // Template management
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [templateDraft, setTemplateDraft] = useState({ name: '', type: 'custom', subject: '', body_html: '' })
  const [templateSaving, setTemplateSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true)
    const [enriched, { data: appData }, { data: tplData }] = await Promise.all([
      fetchAllStudentsEnriched({ forceRefresh: true }),
      supabase.from('applications').select('student_id').eq('event_id', eventId).is('deleted_at', null),
      supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false }),
    ])
    const applied = new Set((appData ?? []).map((a: any) => a.student_id))
    setAppliedIds(applied)
    // Only include students who haven't applied and aren't ineligible
    setStudents(enriched.filter(s => !applied.has(s.id) && s.eligibility !== 'ineligible' && s.personal_email))
    setTemplates((tplData ?? []) as Template[])
    setLoading(false)
  }, [eventId])

  useEffect(() => { loadData() }, [loadData])

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  const yearGroups = useMemo(() => {
    const yrs = new Set(students.map(s => s.year_group).filter((y): y is string => y != null))
    return Array.from(yrs).sort((a, b) => Number(a) - Number(b))
  }, [students])

  const filtered = useMemo(() => {
    return students.filter(s => {
      if (yearFilter.length && s.year_group != null && !yearFilter.includes(s.year_group)) return false
      if (minScore > 0 && s.engagement_score < minScore) return false
      if (eventFilter.length > 0) {
        const attendedEventIds = new Set(s.applications.filter(a => a.attended).map(a => a.event_id))
        if (!eventFilter.some(eid => attendedEventIds.has(eid))) return false
      }
      if (search) {
        const q = search.toLowerCase()
        if (!`${s.first_name} ${s.last_name}`.toLowerCase().includes(q) &&
            !(s.school_type ?? '').toLowerCase().includes(q) &&
            !(s.personal_email ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [students, yearFilter, minScore, eventFilter, search])

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
  useEffect(() => { setPage(0) }, [yearFilter, minScore, eventFilter, search])

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
      .replace(/\{\{first_name\}\}/g, s.first_name ?? '')
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
  }

  // ---------------------------------------------------------------------------
  // Template CRUD
  // ---------------------------------------------------------------------------

  const startNewTemplate = () => {
    setTemplateDraft({ name: '', type: 'custom', subject: '', body_html: '' })
    setEditingTemplate(null)
    setShowTemplateEditor(true)
  }

  const startEditTemplate = (t: Template) => {
    setTemplateDraft({ name: t.name, type: t.type, subject: t.subject, body_html: t.body_html })
    setEditingTemplate(t)
    setShowTemplateEditor(true)
  }

  const saveTemplate = async () => {
    setTemplateSaving(true)
    const payload = {
      name: templateDraft.name,
      type: templateDraft.type,
      subject: templateDraft.subject,
      body_html: templateDraft.body_html,
      event_id: eventId,
      updated_by: teamMemberUuid,
    }
    try {
      if (editingTemplate) {
        await supabase.from('email_templates').update(payload).eq('id', editingTemplate.id)
      } else {
        await supabase.from('email_templates').insert({ ...payload, created_by: teamMemberUuid })
      }
      // Reload templates
      const { data } = await supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false })
      setTemplates((data ?? []) as Template[])
      setShowTemplateEditor(false)
    } finally {
      setTemplateSaving(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await supabase.from('email_templates').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    const { data } = await supabase.from('email_templates').select('id, name, type, subject, body_html, event_id').is('deleted_at', null).order('created_at', { ascending: false })
    setTemplates((data ?? []) as Template[])
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const sendInvites = async () => {
    setStep('sending')
    setSendProgress({ sent: 0, failed: 0, total: recipients.length })

    for (const student of recipients) {
      const renderedSubject = fillMerge(emailSubject, student)
      const renderedBody = fillMerge(emailBody, student)
      // Convert plain text to HTML paragraphs
      const htmlBody = renderedBody
        .split('\n\n')
        .map(p => `<p style="margin:0 0 12px 0;font-family:arial,sans-serif;font-size:14px;color:#222">${p.replace(/\n/g, '<br>')}</p>`)
        .join('')
      const fullBody = htmlBody + EMAIL_SIGNATURE_HTML

      try {
        // Insert email_log
        await supabase.from('email_log').insert({
          student_id: student.id,
          event_id: eventId,
          template_id: selectedTemplate || null,
          to_email: student.personal_email!,
          from_email: 'events@thestepsfoundation.com',
          subject: renderedSubject,
          body_html: fullBody,
          status: 'pending',
          sent_by: teamMemberUuid,
        })

        // Send via API route
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: student.personal_email!, subject: renderedSubject, html: fullBody }),
        })

        if (res.ok) {
          setSendProgress(p => ({ ...p, sent: p.sent + 1 }))
        } else {
          setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
        }
      } catch {
        setSendProgress(p => ({ ...p, failed: p.failed + 1 }))
      }
    }
    setStep('done')
  }

  // ---------------------------------------------------------------------------
  // Event label helpers
  // ---------------------------------------------------------------------------

  const eventLabels = useMemo(() => {
    const map: Record<string, string> = {}
    if (EVENTS) {
      EVENTS.forEach((e: any) => { map[e.id] = e.short ?? e.name })
    }
    return map
  }, [])

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
              {step === 'select' ? 'Invite Students' : step === 'compose' ? 'Compose Invite Email' : step === 'preview' ? 'Preview' : step === 'sending' ? 'Sending…' : 'Done'}
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
                    >
                      Y{y}
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
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">School Type</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Year</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Events</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Eligibility</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Score</th>
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
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">{s.school_type ? s.school_type.charAt(0).toUpperCase() + s.school_type.slice(1) : '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{s.year_group ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">
                          {EVENTS.length > 0
                            ? `${s.attended_count}/${EVENTS.length}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                            s.eligibility === 'eligible'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {s.eligibility === 'eligible' ? 'Eligible' : 'Unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{s.engagement_score}</td>
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
          {step === 'compose' && (
            <div className="space-y-4">
              {/* Templates section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Email Template</label>
                  <button onClick={startNewTemplate} className="text-xs text-steps-blue-600 dark:text-steps-blue-400 hover:underline">+ New template</button>
                </div>

                {showTemplateEditor ? (
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 mb-3 space-y-3 bg-gray-50 dark:bg-gray-800/50">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        value={templateDraft.name}
                        onChange={e => setTemplateDraft(d => ({ ...d, name: e.target.value }))}
                        placeholder="Template name"
                        className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      />
                      <select
                        value={templateDraft.type}
                        onChange={e => setTemplateDraft(d => ({ ...d, type: e.target.value }))}
                        className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      >
                        <option value="custom">Custom</option>
                        <option value="invite">Invite</option>
                        <option value="acceptance">Acceptance</option>
                        <option value="rejection">Rejection</option>
                        <option value="waitlist">Waitlist</option>
                        <option value="reminder">Reminder</option>
                        <option value="follow_up">Follow-up</option>
                      </select>
                    </div>
                    <input
                      value={templateDraft.subject}
                      onChange={e => setTemplateDraft(d => ({ ...d, subject: e.target.value }))}
                      placeholder="Subject line with {{merge_tags}}"
                      className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                    <textarea
                      value={templateDraft.body_html}
                      onChange={e => setTemplateDraft(d => ({ ...d, body_html: e.target.value }))}
                      rows={6}
                      placeholder="Email body with {{merge_tags}} — plain text, signature auto-appended"
                      className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setShowTemplateEditor(false)} className="px-3 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700">Cancel</button>
                      <button
                        onClick={saveTemplate}
                        disabled={templateSaving || !templateDraft.name || !templateDraft.subject || !templateDraft.body_html}
                        className="px-3 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {templateSaving ? 'Saving…' : editingTemplate ? 'Update' : 'Save template'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 mb-3">
                    {/* Event-specific templates first, then global */}
                    {templates
                      .filter(t => t.event_id === eventId || !t.event_id)
                      .map(t => (
                        <div
                          key={t.id}
                          className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer border ${
                            selectedTemplate === t.id
                              ? 'border-steps-blue-500 bg-steps-blue-50 dark:bg-steps-blue-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/30'
                          }`}
                          onClick={() => applyTemplate(t.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.name}</span>
                            <span className="text-xs text-gray-400">{t.event_id ? 'Event' : 'Global'}</span>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={e => { e.stopPropagation(); startEditTemplate(t) }} className="text-xs text-steps-blue-600 dark:text-steps-blue-400 hover:underline">Edit</button>
                            <button onClick={e => { e.stopPropagation(); deleteTemplate(t.id) }} className="text-xs text-red-500 hover:underline">Delete</button>
                          </div>
                        </div>
                      ))}
                    {templates.filter(t => t.event_id === eventId || !t.event_id).length === 0 && (
                      <p className="text-xs text-gray-400 py-2">No templates yet. Create one or write a custom email below.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                <input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g. You're Invited to {{event_name}}!"
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Body</label>
                  <span className="text-[10px] text-gray-400">Plain text — signature is auto-appended</span>
                </div>

                {/* Merge tag buttons */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] text-gray-400 self-center mr-1">Insert:</span>
                  {[
                    { tag: 'first_name', label: 'First Name' },
                    { tag: 'event_name', label: 'Event Name' },
                    { tag: 'apply_link', label: 'Apply Link' },
                    { tag: 'last_attended_event', label: 'Last Event' },
                    ...(eventData?.event_date ? [{ tag: 'event_date', label: 'Event Date' }] : []),
                    ...(eventData?.time_start ? [{ tag: 'event_time', label: 'Event Time' }] : []),
                    ...(eventData?.location ? [{ tag: 'event_location', label: 'Location' }] : []),
                    ...(eventData?.format ? [{ tag: 'event_format', label: 'Format' }] : []),
                    ...(eventData?.dress_code ? [{ tag: 'event_dress_code', label: 'Dress Code' }] : []),
                    ...getAvailableDynamicTags(recipients),
                  ].map(({ tag, label }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setEmailBody(prev => {
                          const el = document.getElementById('invite-body-textarea') as HTMLTextAreaElement | null
                          if (el) {
                            const start = el.selectionStart
                            const end = el.selectionEnd
                            const insert = `{{${tag}}}`
                            const next = prev.slice(0, start) + insert + prev.slice(end)
                            // Restore cursor after React re-render
                            setTimeout(() => { el.selectionStart = el.selectionEnd = start + insert.length; el.focus() }, 0)
                            return next
                          }
                          return prev + `{{${tag}}}`
                        })
                      }}
                      className="px-2 py-0.5 text-[11px] rounded-full border border-steps-blue-200 dark:border-steps-blue-800 bg-steps-blue-50 dark:bg-steps-blue-900/20 text-steps-blue-700 dark:text-steps-blue-300 hover:bg-steps-blue-100 dark:hover:bg-steps-blue-900/40 transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <textarea
                  id="invite-body-textarea"
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  rows={8}
                  placeholder={`Hey {{first_name}},\n\nWe'd love for you to apply to {{event_name}}!\n\nApply here: {{apply_link}}\n\nBest wishes,\nThe Steps Foundation Team`}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />

                {/* Signature preview */}
                <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
                  <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide">Email signature (auto-appended)</div>
                  <div
                    className="text-xs opacity-60 pointer-events-none"
                    dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ======= STEP: PREVIEW ======= */}
          {step === 'preview' && firstRecipient && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Preview with first recipient: <strong>{firstRecipient.first_name} {firstRecipient.last_name}</strong>
              </div>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">From: Events - The Steps Foundation &lt;events@thestepsfoundation.com&gt;</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">To: {firstRecipient.personal_email}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                  {fillMerge(emailSubject, firstRecipient)}
                </div>
                <div
                  className="prose dark:prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: (() => {
                    const filled = fillMerge(emailBody, firstRecipient)
                    const html = filled
                      .split('\n\n')
                      .map(p => `<p style="margin:0 0 12px 0;font-family:arial,sans-serif;font-size:14px;color:#222">${p.replace(/\n/g, '<br>')}</p>`)
                      .join('')
                    return html + EMAIL_SIGNATURE_HTML
                  })() }}
                />
              </div>
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                This will send <strong>{recipients.length}</strong> individual email{recipients.length !== 1 ? 's' : ''} to <strong>{recipients.length}</strong> student{recipients.length !== 1 ? 's' : ''}.
              </div>
            </div>
          )}

          {/* ======= STEP: SENDING ======= */}
          {step === 'sending' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">&#9993;</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Sending {sendProgress.sent + sendProgress.failed} / {sendProgress.total}…
              </div>
              <div className="w-48 mx-auto mt-3 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full rounded-full bg-steps-blue-500 transition-all" style={{ width: `${sendProgress.total > 0 ? ((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* ======= STEP: DONE ======= */}
          {step === 'done' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">&#10003;</div>
              <div className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">Invites sent!</div>
              <div className="text-sm text-gray-500">
                {sendProgress.sent} sent{sendProgress.failed > 0 ? `, ${sendProgress.failed} failed` : ''}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-between shrink-0">
          {step === 'select' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
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
                onClick={sendInvites}
                className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Send {recipients.length} invite{recipients.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <div className="w-full text-right">
              <button onClick={() => { onSent(sendProgress.sent); onClose() }} className="px-4 py-2 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700">
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ======= STUDENT PREVIEW SLIDE-OUT ======= */}
      {previewStudent && (
        <div className="fixed inset-0 z-[60]" onClick={() => setPreviewStudent(null)}>
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
