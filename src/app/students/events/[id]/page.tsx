'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EventRow, fetchEvent } from '@/lib/events-api'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-provider'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Applicant = {
  id: string
  student_id: string
  first_name: string
  last_name: string
  personal_email: string | null
  school_name: string | null
  year_group: number | null
  status: string
  submitted_at: string
  attended: boolean
  reviewed_by: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  rsvp_confirmed: boolean | null // null = no RSVP row, true/false from application_rsvp
  rsvp_confirmed_at: string | null
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
<img width="96" height="96" src="https://drive.google.com/uc?export=view&id=1opsHkt2hbBhGdYHVQrWpNjK8lGZnydjS" alt="The Steps Foundation">
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

type StatusFilter = 'all' | string

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

  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Inline editing feedback
  const [saving, setSaving] = useState<Set<string>>(new Set())

  // Email compose state
  const [showCompose, setShowCompose] = useState(false)
  const [templates, setTemplates] = useState<{ id: string; name: string; type: string; subject: string; body_html: string; event_id: string | null }[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailStep, setEmailStep] = useState<'pick' | 'preview' | 'sending' | 'done'>('pick')
  const [sendProgress, setSendProgress] = useState({ sent: 0, failed: 0, total: 0 })

  // Combined action: status to apply after emails are queued
  const [notifyAction, setNotifyAction] = useState<string | null>(null)

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
          id, student_id, status, submitted_at, attended, reviewed_by, reviewed_at,
          students!inner(first_name, last_name, personal_email, year_group, school_id,
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
      return {
        id: row.id,
        student_id: row.student_id,
        first_name: s.first_name,
        last_name: s.last_name,
        personal_email: s.personal_email,
        school_name: s.schools?.name ?? null,
        year_group: s.year_group,
        status: row.status,
        submitted_at: row.submitted_at,
        attended: row.attended ?? false,
        reviewed_by: row.reviewed_by,
        reviewer_name: row.reviewed_by ? (reviewerMap[row.reviewed_by] ?? null) : null,
        reviewed_at: row.reviewed_at,
        rsvp_confirmed: rsvp ? rsvp.confirmed : null,
        rsvp_confirmed_at: rsvp?.confirmed_at ?? null,
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
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
        (a.personal_email?.toLowerCase().includes(q) ?? false) ||
        (a.school_name?.toLowerCase().includes(q) ?? false)
      )
    }
    return list
  }, [applicants, statusFilter, search])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: applicants.length }
    for (const a of applicants) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [applicants])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [statusFilter, search])

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
    }
  }, [templates, notifyAction, eventId, selectedTemplate])

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) return
    setSelectedTemplate(templateId)
    setEmailSubject(tpl.subject)
    setEmailBody(tpl.body_html)
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
      .replace(/\{\{portal_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/student-portal')
      .replace(/\{\{rsvp_link\}\}/g, 'https://the-steps-foundation-intranet.vercel.app/student-portal')
  }

  const getRecipients = () => {
    return applicants.filter(a => selected.has(a.id) && a.personal_email)
  }

  const sendEmails = async () => {
    const recipients = getRecipients()
    if (recipients.length === 0) return

    setEmailStep('sending')
    setSendProgress({ sent: 0, failed: 0, total: recipients.length })

    const now = new Date().toISOString()
    const emailLogIds: { appId: string; logId: string }[] = []

    for (const recipient of recipients) {
      const renderedSubject = fillMergeFields(emailSubject, recipient)
      const renderedBody = fillMergeFields(emailBody, recipient)

      try {
        const fullBody = renderedBody + EMAIL_SIGNATURE_HTML

        // Insert into email_log with status pending
        const { data: logRow } = await supabase.from('email_log').insert({
          student_id: recipient.student_id,
          event_id: eventId,
          template_id: selectedTemplate || null,
          to_email: recipient.personal_email!,
          from_email: 'events@thestepsfoundation.com',
          subject: renderedSubject,
          body_html: fullBody,
          status: 'pending',
          sent_by: (teamMember as any)?.auth_uuid ?? null,
        }).select('id').single()

        // Actually send via server-side Gmail API
        const sendRes = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipient.personal_email!,
            subject: renderedSubject,
            html: fullBody,
          }),
        })
        const sendData = await sendRes.json()

        if (logRow) {
          emailLogIds.push({ appId: recipient.id, logId: logRow.id })
          // Update email_log with send result
          await supabase.from('email_log').update({
            status: sendRes.ok ? 'sent' : 'failed',
            gmail_message_id: sendData.messageId ?? null,
            sent_at: sendRes.ok ? new Date().toISOString() : null,
            error_message: sendRes.ok ? null : (sendData.error ?? 'Send failed'),
          }).eq('id', logRow.id)
        }

        if (sendRes.ok) {
          setSendProgress(prev => ({ ...prev, sent: prev.sent + 1 }))
        } else {
          setSendProgress(prev => ({ ...prev, failed: prev.failed + 1 }))
        }
      } catch (err) {
        setSendProgress(prev => ({ ...prev, failed: prev.failed + 1 }))
      }
    }

    // If this is a combined action, update statuses now and link to email_log
    if (notifyAction) {
      const ids = recipients.map(r => r.id)

      // Log status history for each, linking to email_log
      for (const recipient of recipients) {
        if (recipient.status !== notifyAction) {
          const logEntry = emailLogIds.find(e => e.appId === recipient.id)
          await supabase.from('application_status_history').insert({
            application_id: recipient.id,
            old_status: recipient.status,
            new_status: notifyAction,
            changed_by: teamMember?.auth_uuid ?? null,
            email_log_id: logEntry?.logId ?? null,
          })
        }
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

      // Optimistic update
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
        <Link href="/students/events" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block">
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
        <Link href="/students/events" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          &larr; Events
        </Link>
      </div>

      {/* Event header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{event.name}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{formattedDate}</span>
              {event.time_start && <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>}
              {event.location && <span>{event.location}</span>}
              {event.capacity != null && <span>Capacity: {event.capacity}</span>}
              {event.dress_code && <span>Dress code: {event.dress_code}</span>}
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
                <div className="text-2xl font-semibold text-purple-600 dark:text-purple-400">{rsvpStats.confirmed}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">RSVPs</div>
              </div>
            )}
            <div className="text-center">
              <div className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">{attendedCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Attended</div>
            </div>
          </div>
        </div>
        {event.description && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{event.description}</p>
        )}
      </div>

      {/* Applicant Manager */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
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
                      ? 'bg-indigo-600 text-white'
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
              className="ml-auto px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 w-64"
            />
          </div>

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
                className="px-2.5 py-1 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Email only
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={paged.length > 0 && paged.every(a => selected.has(a.id))}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </th>
                  <th className="p-3">Name</th>
                  <th className="p-3 hidden md:table-cell">Email</th>
                  <th className="p-3 hidden lg:table-cell">School</th>
                  <th className="p-3 hidden lg:table-cell">Year</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">RSVP</th>
                  <th className="p-3 hidden md:table-cell">Submitted</th>
                  <th className="p-3">Attended</th>
                  <th className="p-3 hidden lg:table-cell">Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(app => {
                  const badge = STATUS_MAP[app.status] ?? STATUS_MAP.submitted
                  return (
                    <tr
                      key={app.id}
                      className={`border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors ${
                        selected.has(app.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(app.id)}
                          onChange={() => toggleSelect(app.id)}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                      </td>
                      <td className="p-3">
                        <Link
                          href={`/students/${app.student_id}`}
                          className="font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {app.first_name} {app.last_name}
                        </Link>
                      </td>
                      <td className="p-3 hidden md:table-cell text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                        {app.personal_email ?? '—'}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                        {app.school_name ?? '—'}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-gray-500 dark:text-gray-400">
                        {app.year_group ?? '—'}
                      </td>
                      <td className="p-3">
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
                      <td className="p-3">
                        {app.status === 'accepted' ? (
                          app.rsvp_confirmed === true ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Confirmed
                            </span>
                          ) : (
                            <span className="text-xs text-amber-600 dark:text-amber-400">Pending</span>
                          )
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="p-3 hidden md:table-cell text-gray-500 dark:text-gray-400">
                        {new Date(app.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggleAttended(app.id)}
                          disabled={saving.has(app.id)}
                          className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                            app.attended
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'
                          } ${saving.has(app.id) ? 'opacity-50' : ''}`}
                          title={app.attended ? 'Attended' : 'Not attended (no-show)'}
                        >
                          {app.attended && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </td>
                      <td className="p-3 hidden lg:table-cell text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
                        {app.reviewer_name ?? '—'}
                      </td>
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
                  {/* Template picker */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Template</label>
                    <select
                      value={selectedTemplate}
                      onChange={e => applyTemplate(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                    >
                      <option value="">— Select a template or write from scratch —</option>
                      {templates
                        .filter(t => !t.event_id || t.event_id === eventId)
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.type}){!t.event_id ? ' — Global' : ''}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                    <input
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                      placeholder="e.g. Your application to {{event_name}}"
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body (HTML)</label>
                    <textarea
                      value={emailBody}
                      onChange={e => setEmailBody(e.target.value)}
                      rows={8}
                      placeholder="<p>Hey {{first_name}},</p>"
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono"
                    />
                  </div>

                  {/* Merge field hints */}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium">Merge fields: </span>
                    {['{{first_name}}', '{{last_name}}', '{{full_name}}', '{{event_name}}', '{{event_date}}', '{{event_location}}', '{{event_time}}', '{{dress_code}}', '{{portal_link}}', '{{rsvp_link}}'].map((f, i, arr) => (
                      <span key={f}>
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{f}</code>
                        {i < arr.length - 1 ? ', ' : ''}
                      </span>
                    ))}
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
                        __html: (getRecipients()[0] ? fillMergeFields(emailBody, getRecipients()[0]) : emailBody) + EMAIL_SIGNATURE_HTML,
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
                      className="h-full rounded-full bg-indigo-500 transition-all"
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
                    className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
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
                  className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
