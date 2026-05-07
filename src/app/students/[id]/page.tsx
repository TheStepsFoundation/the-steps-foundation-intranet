'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type PreviewProfile } from '@/components/StudentHubPreview'
import {
  ATTRIBUTION_SOURCES,
  StudentRow,
  ApplicationRow,
  EnrichedStudent,
  StudentUpdate,
  ApplicationUpdate,
  fetchEnrichedStudent,
  updateStudent,
  upsertApplication,
  deleteApplication,
  useEvents,
} from '@/lib/students-api'
import SchoolPicker from '@/components/SchoolPicker'
import QualificationsEditor, { defaultQualifications } from '@/components/QualificationsEditor'
import type { QualificationEntry } from '@/lib/students-api'
import { eventFeedbackByEventId } from '@/data/event-feedback'
import type { FreeTextResponse } from '@/data/event-feedback/types'
import { fetchFeedbackForStudent, getFeedbackFields, type EventFeedbackRow, type EventFeedbackConfig } from '@/lib/events-api'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'
import {
  STAGE_CODES,
  A_LEVEL_GRADES,
  ProgressionRow,
  fetchProgressionForStudent,
  createProgression,
  updateProgression,
  deleteProgression,
} from '@/lib/students-api'

const STATUS_OPTIONS = ['submitted', 'shortlisted', 'accepted', 'waitlist', 'rejected', 'withdrew'] as const

export default function StudentProfilePage({ params }: { params: { id: string } }) {
  const { id } = params
  const { events: EVENTS } = useEvents()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enriched, setEnriched] = useState<EnrichedStudent | null>(null)
  const [showHubPreview, setShowHubPreview] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StudentUpdate>({})
  const [saving, setSaving] = useState(false)
  const [rowSaving, setRowSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const student: StudentRow | null = enriched
  const apps: ApplicationRow[] = enriched?.applications ?? []

  const previewProfile: PreviewProfile | null = student ? {
    first_name: student.first_name ?? null,
    last_name: student.last_name ?? null,
    personal_email: student.personal_email ?? null,
    year_group: (() => {
      const yg = student.year_group
      if (yg == null) return null
      const n = parseInt(String(yg).match(/\d+/)?.[0] ?? '', 10)
      return Number.isFinite(n) ? n : null
    })(),
    school_name_raw: student.school_name_raw ?? null,
    school_type: student.school_type ?? null,
    free_school_meals: student.free_school_meals ?? null,
    parental_income_band: student.parental_income_band ?? null,
    first_generation_uni: student.first_generation_uni ?? null,
    gcse_results: student.gcse_results ?? null,
    additional_context: student.additional_context ?? null,
  } : null

  async function reload() {
    const row = await fetchEnrichedStudent(id)
    setEnriched(row)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchEnrichedStudent(id)
      .then(row => {
        if (!active) return
        setEnriched(row)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message ?? 'Failed to load')
        setLoading(false)
      })
    return () => { active = false }
  }, [id])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  function startEdit() {
    if (!student) return
    setDraft({
      first_name: student.first_name,
      last_name: student.last_name,
      personal_email: student.personal_email,
      school_name_raw: student.school_name_raw,
      school_id: student.school_id,
      year_group: student.year_group,
      free_school_meals: student.free_school_meals,
      parental_income_band: student.parental_income_band,
      subscribed_to_mailing: student.subscribed_to_mailing,
      school_type: student.school_type,
      notes: student.notes,
      first_generation_uni: student.first_generation_uni,
      gcse_results: student.gcse_results,
      qualifications: student.qualifications,
      additional_context: student.additional_context,
    })
    setEditing(true)
  }

  async function saveStudent() {
    if (!student) return
    setSaving(true)
    try {
      const currentEmail = (student.personal_email ?? '').toLowerCase().trim()
      const desiredEmailRaw = typeof draft.personal_email === 'string' ? draft.personal_email.trim() : ''
      const desiredEmail = desiredEmailRaw.toLowerCase()
      const emailChanging = Boolean(desiredEmail) && desiredEmail !== currentEmail

      // When the email changes we MUST also update auth.users, or the student
      // can't sign in to the hub under the new email (and an orphan ghost
      // auth row can even take over their sign-in). Route goes through the
      // service-role admin endpoint; we skip the direct personal_email write
      // below because the endpoint handles it atomically.
      if (emailChanging) {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error('Your session has expired — sign in again')
        const res = await fetch('/api/admin/update-student-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ student_id: student.id, new_email: desiredEmailRaw }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error ?? `Email sync failed (HTTP ${res.status})`)
      }

      // Pass every OTHER field (and personal_email too when it didn't
      // change — updateStudent no-ops that case) to the usual RLS update.
      const { personal_email: _omit, ...rest } = draft
      const restHasChanges = Object.keys(rest).length > 0
      if (emailChanging) {
        if (restHasChanges) await updateStudent(student.id, rest)
      } else {
        await updateStudent(student.id, draft)
      }

      await reload()
      setEditing(false)
      flash(emailChanging ? 'Saved (email synced to auth)' : 'Saved')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function saveRow(eventId: string, patch: ApplicationUpdate) {
    if (!student) return
    const existing = apps.find(a => a.event_id === eventId)
    setRowSaving(eventId)
    try {
      await upsertApplication(student.id, eventId, patch, existing?.id)
      await reload()
      flash('Updated')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update application')
    } finally {
      setRowSaving(null)
    }
  }

  async function removeRow(appId: string) {
    if (!confirm('Delete this application record?')) return
    setRowSaving(appId)
    try {
      await deleteApplication(appId)
      await reload()
      flash('Deleted')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setRowSaving(null)
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Loading…</div>
  if (error) return <div className="max-w-5xl mx-auto p-8 text-red-600">{error}</div>
  if (!student || !enriched) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Student not found.</div>

  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.personal_email || 'Unnamed'

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/students" className="text-sm text-steps-blue-600 dark:text-steps-blue-400 hover:underline">← All students</Link>
        {toast && <span className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded">{toast}</span>}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{fullName}</h1>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            {student.personal_email && <span>{student.personal_email}</span>}
            {student.school_name_raw && <span>{student.school_name_raw}</span>}
            {student.year_group && <span>{student.year_group}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={`${enriched.attended_count} attended`} tone="emerald" />
          {enriched.no_show_count > 0 && <Badge label={`${enriched.no_show_count} no-show`} tone="amber" />}
          {enriched.bonus_total !== 0 && (
            <Badge
              label={`Bonus ${enriched.bonus_total > 0 ? '+' : ''}${enriched.bonus_total}`}
              tone={enriched.bonus_total > 0 ? 'emerald' : 'amber'}
            />
          )}
          <Badge label={`Score ${enriched.engagement_score}`} tone="indigo" />
          <button
            type="button"
            onClick={() => setShowHubPreview(true)}
            className="ml-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-violet-300 dark:border-violet-700 text-violet-800 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40 inline-flex items-center gap-1.5"
            title="See /my from this student's perspective"
          >
            <svg aria-hidden className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            Preview Student Hub
          </button>
          {!editing ? (
            <button onClick={startEdit} className="ml-2 px-3 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700">Edit</button>
          ) : (
            <div className="flex gap-2 ml-2">
              <button onClick={() => setEditing(false)} disabled={saving} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
              <button onClick={saveStudent} disabled={saving} className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
        <h2 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Details</h2>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="First name" value={student.first_name} />
            <Field label="Last name" value={student.last_name} />
            <Field label="Email" value={student.personal_email} />
            <Field
              label="School"
              value={
                enriched.school_name
                  ? enriched.school_town
                    ? `${enriched.school_name} — ${enriched.school_town}`
                    : enriched.school_name
                  : student.school_name_raw
                    ? `${student.school_name_raw} (unmatched)`
                    : null
              }
            />
            <Field label="Year group" value={student.year_group} />
            <Field label="Income band" value={incomeLabel(student.parental_income_band)} />
            <Field label="Free school meals" value={boolLabel(student.free_school_meals)} />
            <Field label="Mailing list" value={boolLabel(student.subscribed_to_mailing)} />
            <Field label="School type" value={schoolTypeLabel(student.school_type)} />
            <Field label="Eligibility" value={enriched.eligibility} />
            <Field
              label="Parent went to university"
              value={
                student.first_generation_uni === true
                  ? 'No (first-generation)'
                  : student.first_generation_uni === false
                    ? 'Yes'
                    : null
              }
            />
            <Field label="GCSE results" value={student.gcse_results} />
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Subjects and grades</div>
              <div className="text-gray-900 dark:text-gray-100">
                {Array.isArray(student.qualifications) && student.qualifications.length > 0 ? (
                  <div className="group relative inline-block mt-0.5">
                    <span className="cursor-default text-base tracking-wide font-medium text-gray-800 dark:text-gray-200">
                      {student.qualifications.map(q => q.grade || '?').join(' ')}
                    </span>
                    <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[260px]">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase">Qualifications</div>
                      {student.qualifications.map((q, qi) => {
                        const subj = q.subject === '__other' ? 'Other' : (q.subject || '—')
                        const lvl = q.qualType === 'ib' && q.level ? ` (${q.level.split(' ')[0]})` : ''
                        const type = qualTypeLabel(q.qualType)
                        return (
                          <div key={qi} className="flex justify-between gap-4 text-xs py-0.5">
                            <span className="text-gray-700 dark:text-gray-300">
                              <span className="text-gray-500 dark:text-gray-400 mr-1.5">{type}</span>
                              {subj}{lvl}
                            </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{q.grade || '—'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Additional context</div>
              <div className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                {student.additional_context || <span className="text-gray-400">—</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Input label="First name" value={draft.first_name ?? ''} onChange={v => setDraft(d => ({ ...d, first_name: v }))} />
            <Input label="Last name" value={draft.last_name ?? ''} onChange={v => setDraft(d => ({ ...d, last_name: v }))} />
            <Input label="Email" value={draft.personal_email ?? ''} onChange={v => setDraft(d => ({ ...d, personal_email: v }))} type="email" />
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">School</label>
              <SchoolPicker
                value={{ schoolId: draft.school_id ?? null, schoolNameRaw: draft.school_name_raw ?? null }}
                initialSchool={
                  enriched.school_id && enriched.school_name
                    ? { id: enriched.school_id, name: enriched.school_name, town: enriched.school_town }
                    : null
                }
                onChange={v =>
                  setDraft(d => ({ ...d, school_id: v.schoolId, school_name_raw: v.schoolNameRaw }))
                }
              />
            </div>
            <Input label="Year group" value={draft.year_group ?? ''} onChange={v => setDraft(d => ({ ...d, year_group: v }))} />
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Income band</label>
              <select
                value={draft.parental_income_band ?? ''}
                onChange={e => setDraft(d => ({ ...d, parental_income_band: e.target.value || null }))}
                className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">Unknown</option>
                <option value="under_40k">Under £40k</option>
                <option value="over_40k">£40k or more</option>
                <option value="prefer_na">Prefer not to say</option>
              </select>
            </div>
            <TriCheckbox label="Free school meals" value={draft.free_school_meals} onChange={v => setDraft(d => ({ ...d, free_school_meals: v }))} />
            <TriCheckbox label="Mailing list" value={draft.subscribed_to_mailing} onChange={v => setDraft(d => ({ ...d, subscribed_to_mailing: v }))} />
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">School type</label>
              <select
                value={draft.school_type ?? ''}
                onChange={e => setDraft(d => ({ ...d, school_type: (e.target.value || null) as any }))}
                className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">Unknown</option>
                <option value="state">State non-selective</option>
                <option value="grammar">State selective / grammar</option>
                <option value="independent">Independent (fee-paying)</option>
                <option value="independent_bursary">Independent with 90%+ bursary</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
              <textarea
                value={draft.notes ?? ''}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                rows={4}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Parent went to university</label>
              <select
                value={draft.first_generation_uni === true ? 'no' : draft.first_generation_uni === false ? 'yes' : ''}
                onChange={e => {
                  const v = e.target.value
                  setDraft(d => ({ ...d, first_generation_uni: v === 'no' ? true : v === 'yes' ? false : null }))
                }}
                className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">Unknown</option>
                <option value="yes">Yes (parent attended uni)</option>
                <option value="no">No (first-generation)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">GCSE results</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draft.gcse_results ?? ''}
                onChange={e => setDraft(d => ({ ...d, gcse_results: e.target.value.replace(/\D/g, '') || null }))}
                placeholder="e.g. 999887766"
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono tracking-wider"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subjects and grades</label>
              <QualificationsEditor
                value={Array.isArray(draft.qualifications) && draft.qualifications.length > 0 ? draft.qualifications : defaultQualifications()}
                onChange={(next: QualificationEntry[]) => setDraft(d => ({ ...d, qualifications: next.filter(q => q.subject && q.grade).length > 0 ? next : null }))}
                allowEmpty
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Additional context</label>
              <textarea
                value={draft.additional_context ?? ''}
                onChange={e => setDraft(d => ({ ...d, additional_context: e.target.value || null }))}
                rows={3}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                placeholder="Care experience, young carer, school disruption, etc."
              />
            </div>
          </div>
        )}
      </section>

      <ProgressionSection studentId={student.id} />

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-medium text-gray-900 dark:text-gray-100">Event history</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Status and attendance save on change.</p>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
            <tr>
              <Th>Event</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th>Attended</Th>
              <Th>Submitted</Th>
              <Th>Source</Th>
              <Th>Bonus</Th>
              <Th>Reason</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {EVENTS.map(e => {
              const app = apps.find(a => a.event_id === e.id)
              const busy = rowSaving === e.id || (app && rowSaving === app.id)
              return (
                <tr key={e.id} className={busy ? 'opacity-60' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{e.name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{e.date}</td>
                  <td className="px-3 py-2">
                    <select
                      value={app?.status ?? ''}
                      onChange={ev => {
                        const v = ev.target.value
                        if (!v) return
                        saveRow(e.id, { status: v })
                      }}
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!app?.attended}
                      disabled={!app}
                      onChange={ev => saveRow(e.id, { attended: ev.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    <input
                      type="date"
                      value={app?.submitted_at ? app.submitted_at.slice(0, 10) : ''}
                      onChange={ev => {
                        const v = ev.target.value
                        saveRow(e.id, { submitted_at: v ? new Date(v).toISOString() : null })
                      }}
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    <select
                      value={app?.attribution_source ?? ''}
                      onChange={ev => {
                        const v = ev.target.value
                        saveRow(e.id, { attribution_source: v || null })
                      }}
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs w-40"
                    >
                      <option value="">—</option>
                      {ATTRIBUTION_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      {app?.attribution_source && !ATTRIBUTION_SOURCES.some(s => s.value === app.attribution_source) && (
                        <option value={app.attribution_source}>{app.attribution_source} (legacy)</option>
                      )}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={String(app?.bonus_points ?? 0)}
                      onChange={ev => saveRow(e.id, { bonus_points: Number(ev.target.value) })}
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                    >
                      <option value="0">—</option>
                      <option value="1">+1</option>
                      <option value="-1">-1</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    <input
                      type="text"
                      defaultValue={app?.bonus_reason ?? ''}
                      onBlur={ev => {
                        const v = ev.target.value
                        if ((app?.bonus_reason ?? '') !== v) saveRow(e.id, { bonus_reason: v || null })
                      }}
                      placeholder="reason…"
                      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs w-40"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {app && (
                      <button
                        onClick={() => removeRow(app.id)}
                        className="text-xs text-red-600 hover:underline"
                      >Delete</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <EventFeedbackPanel
        studentId={student.id}
        studentEmail={student.personal_email}
        studentFullName={fullName}
        attendedEventIds={apps.filter(a => a.attended || a.status === 'submitted' || a.status === 'accepted').map(a => a.event_id)}
        eventNameById={Object.fromEntries(EVENTS.map(e => [e.id, e.name]))}
      />

      <div className="flex flex-wrap gap-2">
        {student.free_school_meals && <Flag>Free school meals</Flag>}
        {student.parental_income_band && <Flag>Income: {incomeLabel(student.parental_income_band)}</Flag>}
        {student.subscribed_to_mailing ? <Flag tone="green">On mailing list</Flag> : <Flag tone="gray">Not subscribed</Flag>}
      </div>
    {showHubPreview && previewProfile && (
        <div role="dialog" aria-modal="true" aria-label="Preview Student Hub" onClick={() => setShowHubPreview(false)}
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-4 sm:p-6 animate-tsf-fade-in">
          <div onClick={e => e.stopPropagation()} className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col animate-tsf-fade-up">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 bg-violet-50">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] font-bold text-violet-700">Hub preview</p>
                <p className="text-sm font-semibold text-steps-dark mt-0.5">As seen by {previewProfile.first_name ?? 'this student'}</p>
              </div>
              <button type="button" onClick={() => setShowHubPreview(false)} aria-label="Close" className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <iframe
              src={`/my?_admin_preview=${student.id}`}
              title={`Hub preview — ${previewProfile.first_name ?? 'student'}`}
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}
    </main>
  )
}

function boolLabel(v: boolean | null | undefined) {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

function qualTypeLabel(v: string | null | undefined) {
  if (!v) return ''
  if (v === 'a_level') return 'A-Level'
  if (v === 'ib') return 'IB'
  if (v === 'btec') return 'BTEC'
  if (v === 't_level') return 'T-Level'
  if (v === 'pre_u') return 'Pre-U'
  return v
}

function schoolTypeLabel(v: string | null | undefined) {
  if (!v) return null
  if (v === 'state') return 'State'
  if (v === 'grammar') return 'Grammar'
  if (v === 'independent') return 'Independent'
  if (v === 'independent_bursary') return 'Independent (90%+ bursary)'
  return v
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-gray-900 dark:text-gray-100">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
      />
    </div>
  )
}

function TriCheckbox({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void }) {
  const state: 'yes' | 'no' | 'unknown' = value === true ? 'yes' : value === false ? 'no' : 'unknown'
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select
        value={state}
        onChange={e => {
          const v = e.target.value
          onChange(v === 'yes' ? true : v === 'no' ? false : null)
        }}
        className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
      >
        <option value="unknown">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">{children}</th>
}

function Badge({ label, tone }: { label: string; tone: 'emerald' | 'amber' | 'indigo' }) {
  const map = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    indigo: 'bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400',
  }
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[tone]}`}>{label}</span>
}

function Flag({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'gray' }) {
  const map = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200/60 dark:border-blue-900/40',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-900/40',
    gray: 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  }
  return <span className={`px-2.5 py-1 rounded-md text-xs border ${map[tone]}`}>{children}</span>
}

function incomeLabel(code: string | null | undefined): string | null {
  if (!code) return null
  if (code === 'under_40k') return 'Under £40k'
  if (code === 'over_40k') return '£40k or more'
  if (code === 'prefer_na') return 'Prefer not to say'
  return code
}

// =============================================================================
// Per-event feedback panel
// =============================================================================
//
// Surfaces, per event the student attended (or applied to), the free-text
// answers they gave on that event's feedback form. Matches by email first,
// then by case-insensitive full-name match as a fallback (some early sheets
// were submitted without an email column).

function EventFeedbackPanel({
  studentId,
  studentEmail,
  studentFullName,
  attendedEventIds,
  eventNameById,
}: {
  studentId: string
  studentEmail: string | null
  studentFullName: string
  attendedEventIds: string[]
  eventNameById: Record<string, string>
}) {
  const normEmail = (studentEmail ?? '').trim().toLowerCase()
  const normName = studentFullName.trim().toLowerCase()

  // ---- Static (curated) dataset matches (for past events with curated TS data) ----
  const staticMatches = attendedEventIds
    .map(eventId => {
      const dataset = eventFeedbackByEventId[eventId]
      if (!dataset) return null
      const row = dataset.appendix.find(r => {
        const rowEmail = (r.email ?? '').trim().toLowerCase()
        if (normEmail && rowEmail && rowEmail === normEmail) return true
        const rowName = (r.fullName || r.name || '').trim().toLowerCase()
        return rowName === normName && normName.length > 0
      })
      if (!row) return null
      return { eventId, eventName: eventNameById[eventId] ?? dataset.eventName, row }
    })
    .filter((x): x is { eventId: string; eventName: string; row: FreeTextResponse } => x !== null)

  // ---- Live submissions from the new event_feedback table ----
  const [liveRows, setLiveRows] = useState<(EventFeedbackRow & { event: { id: string; name: string; slug: string; event_date: string | null; feedback_config: EventFeedbackConfig | null } | null })[]>([])
  useEffect(() => {
    let cancelled = false
    fetchFeedbackForStudent(studentId)
      .then(rows => { if (!cancelled) setLiveRows(rows) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [studentId])

  const totalCount = staticMatches.length + liveRows.length
  if (totalCount === 0) return null

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-medium text-gray-900 dark:text-gray-100">Feedback they’ve left ({totalCount})</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Responses this student submitted on each event’s feedback form.
        </p>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {liveRows.map(r => {
          const eventName = r.event?.name ?? eventNameById[r.event_id] ?? 'Event'
          const cfg = r.event?.feedback_config
          const labelById: Record<string, { label: string; type: string }> = {}
          for (const f of getFeedbackFields(cfg)) {
            labelById[f.id] = { label: f.label, type: f.type }
          }
          return (
            <div key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/students/events/${r.event_id}/feedback`}
                    className="text-sm font-medium text-steps-blue-600 dark:text-steps-blue-400 hover:underline"
                  >
                    {eventName}
                  </Link>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                    live
                  </span>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    consent: {r.consent}
                  </span>
                </div>
                <span className="text-[11px] tabular-nums text-gray-400">{new Date(r.submitted_at).toLocaleString('en-GB')}</span>
              </div>
              <dl className="space-y-1.5">
                {Object.entries(r.ratings ?? {}).map(([k, v]) => (
                  <div key={`r-${k}`}>
                    <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{labelById[k]?.label ?? k}</dt>
                    <dd className="text-sm text-gray-800 dark:text-gray-200">{String(v)}</dd>
                  </div>
                ))}
                {Object.entries(r.answers ?? {}).map(([k, v]) => (
                  <div key={`a-${k}`}>
                    <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{labelById[k]?.label ?? k}</dt>
                    <dd className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{Array.isArray(v) ? v.join(', ') : v}</dd>
                  </div>
                ))}
                {r.postable_quote && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Postable quote</dt>
                    <dd className="text-sm text-gray-800 dark:text-gray-200 italic">“{r.postable_quote}”</dd>
                  </div>
                )}
              </dl>
            </div>
          )
        })}
        {staticMatches.map(({ eventId, eventName, row }) => (
          <div key={eventId} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Link
                  href={`/students/events/${eventId}/feedback`}
                  className="text-sm font-medium text-steps-blue-600 dark:text-steps-blue-400 hover:underline"
                >
                  {eventName}
                </Link>
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  consent: {row.consent}
                </span>
              </div>
              <span className="text-[11px] tabular-nums text-gray-400">{row.timestamp}</span>
            </div>
            <dl className="space-y-1.5">
              {Object.entries(row.fields).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{k}</dt>
                  <dd className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}

// =============================================================================
// Progression Section
// =============================================================================

function ProgressionSection({ studentId }: { studentId: string }) {
  const { teamMember } = useAuth()
  const [records, setRecords] = useState<ProgressionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Draft state for add/edit
  const emptyDraft = {
    current_stage: '' as string,
    a_level_subjects: ['', '', '', ''] as string[],
    predicted_grades: {} as Record<string, string>,
    actual_grades: {} as Record<string, string>,
    firm_choice: '',
    insurance_choice: '',
    outcome: '',
    notes: '',
  }
  const [draft, setDraft] = useState(emptyDraft)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchProgressionForStudent(studentId)
    setRecords(data)
    setLoading(false)
  }, [studentId])

  useEffect(() => { load() }, [load])

  function startAdd() {
    setDraft(emptyDraft)
    setAdding(true)
    setEditingId(null)
  }

  function startEdit(r: ProgressionRow) {
    const subjects = r.a_level_subjects ?? []
    // Pad to 4 slots
    while (subjects.length < 4) subjects.push('')
    setDraft({
      current_stage: r.current_stage ?? '',
      a_level_subjects: subjects,
      predicted_grades: r.predicted_grades ?? {},
      actual_grades: r.actual_grades ?? {},
      firm_choice: r.firm_choice ?? '',
      insurance_choice: r.insurance_choice ?? '',
      outcome: r.outcome ?? '',
      notes: r.notes ?? '',
    })
    setEditingId(r.id)
    setAdding(false)
  }

  function cancel() {
    setAdding(false)
    setEditingId(null)
  }

  async function save() {
    setSaving(true)
    const subjects = draft.a_level_subjects.filter(s => s.trim())
    const payload = {
      current_stage: draft.current_stage || null,
      a_level_subjects: subjects.length > 0 ? subjects : null,
      predicted_grades: Object.keys(draft.predicted_grades).length > 0 ? draft.predicted_grades : null,
      actual_grades: Object.keys(draft.actual_grades).length > 0 ? draft.actual_grades : null,
      firm_choice: draft.firm_choice || null,
      insurance_choice: draft.insurance_choice || null,
      outcome: draft.outcome || null,
      notes: draft.notes || null,
    }
    try {
      if (editingId) {
        await updateProgression(editingId, {
          ...payload,
          updated_by: (teamMember as any)?.auth_uuid ?? null,
        })
      } else {
        await createProgression({
          student_id: studentId,
          as_of_date: new Date().toISOString().slice(0, 10),
          ...payload,
          created_by: (teamMember as any)?.auth_uuid ?? null,
          updated_by: (teamMember as any)?.auth_uuid ?? null,
        })
      }
      await load()
      cancel()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this progression record?')) return
    await deleteProgression(id)
    await load()
  }

  function updateSubject(index: number, value: string) {
    setDraft(d => {
      const subs = [...d.a_level_subjects]
      const oldName = subs[index]
      subs[index] = value
      // Move grades to new key
      const pg = { ...d.predicted_grades }
      const ag = { ...d.actual_grades }
      if (oldName && pg[oldName]) { pg[value] = pg[oldName]; delete pg[oldName] }
      if (oldName && ag[oldName]) { ag[value] = ag[oldName]; delete ag[oldName] }
      return { ...d, a_level_subjects: subs, predicted_grades: pg, actual_grades: ag }
    })
  }

  function updatePredicted(subject: string, grade: string) {
    setDraft(d => ({ ...d, predicted_grades: { ...d.predicted_grades, [subject]: grade } }))
  }

  function updateActual(subject: string, grade: string) {
    setDraft(d => ({ ...d, actual_grades: { ...d.actual_grades, [subject]: grade } }))
  }

  const isEditing = adding || editingId !== null

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mb-6">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-gray-900 dark:text-gray-100">Progression</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">A-levels, UCAS, outcomes</p>
        </div>
        {!isEditing && (
          <button
            onClick={startAdd}
            className="px-3 py-1.5 text-xs rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700"
          >
            + Add record
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : isEditing ? (
        <div className="p-4 space-y-4">
          {/* Stage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Current stage</label>
              <select
                value={draft.current_stage}
                onChange={e => setDraft(d => ({ ...d, current_stage: e.target.value }))}
                className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">—</option>
                {STAGE_CODES.map(s => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* A-level subjects + grades */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">A-level subjects & grades</label>
            <div className="space-y-2">
              {draft.a_level_subjects.map((subject, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Subject ${i + 1}`}
                    value={subject}
                    onChange={e => updateSubject(i, e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  />
                  <select
                    value={subject ? (draft.predicted_grades[subject] ?? '') : ''}
                    onChange={e => subject && updatePredicted(subject, e.target.value)}
                    disabled={!subject}
                    className="w-20 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
                  >
                    <option value="">Pred.</option>
                    {A_LEVEL_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select
                    value={subject ? (draft.actual_grades[subject] ?? '') : ''}
                    onChange={e => subject && updateActual(subject, e.target.value)}
                    disabled={!subject}
                    className="w-20 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
                  >
                    <option value="">Actual</option>
                    {A_LEVEL_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* UCAS: firm + insurance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Firm choice</label>
              <input
                type="text"
                placeholder="e.g. LSE — BSc Management"
                value={draft.firm_choice}
                onChange={e => setDraft(d => ({ ...d, firm_choice: e.target.value }))}
                className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Insurance choice</label>
              <input
                type="text"
                placeholder="e.g. KCL — BSc Economics"
                value={draft.insurance_choice}
                onChange={e => setDraft(d => ({ ...d, insurance_choice: e.target.value }))}
                className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>

          {/* Outcome */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Outcome</label>
            <input
              type="text"
              placeholder="e.g. Placed at firm, Clearing to UCL, Gap year"
              value={draft.outcome}
              onChange={e => setDraft(d => ({ ...d, outcome: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Additional context…"
              value={draft.notes}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={cancel} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Add record'}
            </button>
          </div>
        </div>
      ) : records.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No progression records yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {records.map(r => {
            const stageLabel = STAGE_CODES.find(s => s.code === r.current_stage)?.label ?? r.current_stage
            const subjects = r.a_level_subjects ?? []
            return (
              <div key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2">
                    {r.current_stage && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-400">
                        {stageLabel}
                      </span>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      as of {new Date(r.as_of_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(r)} className="text-xs text-steps-blue-600 dark:text-steps-blue-400 hover:underline">Edit</button>
                    <button onClick={() => remove(r.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                </div>

                {/* Subjects + grades */}
                {subjects.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">A-levels</div>
                    <div className="flex flex-wrap gap-2">
                      {subjects.map(sub => {
                        const pred = r.predicted_grades?.[sub]
                        const actual = r.actual_grades?.[sub]
                        return (
                          <span key={sub} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{sub}</span>
                            {pred && <span className="text-gray-500 dark:text-gray-400">pred: {pred}</span>}
                            {actual && <span className="text-emerald-600 dark:text-emerald-400">actual: {actual}</span>}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* UCAS */}
                {(r.firm_choice || r.insurance_choice) && (
                  <div className="mb-2 text-sm">
                    {r.firm_choice && <div><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Firm:</span> <span className="text-gray-900 dark:text-gray-100">{r.firm_choice}</span></div>}
                    {r.insurance_choice && <div><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Insurance:</span> <span className="text-gray-900 dark:text-gray-100">{r.insurance_choice}</span></div>}
                  </div>
                )}

                {/* Outcome */}
                {r.outcome && (
                  <div className="mb-2 text-sm">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Outcome:</span>{' '}
                    <span className="text-gray-900 dark:text-gray-100">{r.outcome}</span>
                  </div>
                )}

                {/* Notes */}
                {r.notes && (
                  <div className="text-sm text-gray-600 dark:text-gray-300 italic">{r.notes}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
