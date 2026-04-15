'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  EVENTS,
  ATTRIBUTION_SOURCES,
  StudentRow,
  ApplicationRow,
  StudentUpdate,
  ApplicationUpdate,
  fetchStudent,
  enrich,
  updateStudent,
  upsertApplication,
  deleteApplication,
} from '@/lib/students-api'

const STATUS_OPTIONS = ['submitted', 'shortlisted', 'accepted', 'waitlist', 'rejected', 'withdrew'] as const

export default function StudentProfilePage({ params }: { params: { id: string } }) {
  const { id } = params
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [apps, setApps] = useState<ApplicationRow[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StudentUpdate>({})
  const [saving, setSaving] = useState(false)
  const [rowSaving, setRowSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchStudent(id)
      .then(({ student, applications }) => {
        if (!active) return
        setStudent(student)
        setApps(applications)
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
      year_group: student.year_group,
      free_school_meals: student.free_school_meals,
      parental_income_band: student.parental_income_band,
      first_generation_uni: student.first_generation_uni,
      subscribed_to_mailing: student.subscribed_to_mailing,
      notes: student.notes,
    })
    setEditing(true)
  }

  async function saveStudent() {
    if (!student) return
    setSaving(true)
    try {
      const updated = await updateStudent(student.id, draft)
      setStudent(updated)
      setEditing(false)
      flash('Saved')
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
      const row = await upsertApplication(student.id, eventId, patch, existing?.id)
      setApps(prev => {
        const others = prev.filter(a => a.event_id !== eventId)
        return [...others, row]
      })
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
      setApps(prev => prev.filter(a => a.id !== appId))
      flash('Deleted')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setRowSaving(null)
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Loading…</div>
  if (error) return <div className="max-w-5xl mx-auto p-8 text-red-600">{error}</div>
  if (!student) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Student not found.</div>

  const enriched = enrich(student, apps.map(a => ({ ...a, student_id: student.id })))
  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.personal_email || 'Unnamed'

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/students" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← All students</Link>
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
          <Badge label={`Score ${enriched.engagement_score}`} tone="indigo" />
          {!editing ? (
            <button onClick={startEdit} className="ml-2 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Edit</button>
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
            <Field label="School" value={student.school_name_raw} />
            <Field label="Year group" value={student.year_group} />
            <Field label="Income band" value={student.parental_income_band} />
            <Field label="Free school meals" value={boolLabel(student.free_school_meals)} />
            <Field label="First-gen uni" value={boolLabel(student.first_generation_uni)} />
            <Field label="Mailing list" value={boolLabel(student.subscribed_to_mailing)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Input label="First name" value={draft.first_name ?? ''} onChange={v => setDraft(d => ({ ...d, first_name: v }))} />
            <Input label="Last name" value={draft.last_name ?? ''} onChange={v => setDraft(d => ({ ...d, last_name: v }))} />
            <Input label="Email" value={draft.personal_email ?? ''} onChange={v => setDraft(d => ({ ...d, personal_email: v }))} type="email" />
            <Input label="School" value={draft.school_name_raw ?? ''} onChange={v => setDraft(d => ({ ...d, school_name_raw: v }))} />
            <Input label="Year group" value={draft.year_group ?? ''} onChange={v => setDraft(d => ({ ...d, year_group: v }))} />
            <Input label="Income band" value={draft.parental_income_band ?? ''} onChange={v => setDraft(d => ({ ...d, parental_income_band: v }))} />
            <TriCheckbox label="Free school meals" value={draft.free_school_meals} onChange={v => setDraft(d => ({ ...d, free_school_meals: v }))} />
            <TriCheckbox label="First-gen uni" value={draft.first_generation_uni} onChange={v => setDraft(d => ({ ...d, first_generation_uni: v }))} />
            <TriCheckbox label="Mailing list" value={draft.subscribed_to_mailing} onChange={v => setDraft(d => ({ ...d, subscribed_to_mailing: v }))} />
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
              <textarea
                value={draft.notes ?? ''}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                rows={4}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </section>

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

      <div className="flex flex-wrap gap-2">
        {student.free_school_meals && <Flag>Free school meals</Flag>}
        {student.first_generation_uni && <Flag>First-gen uni</Flag>}
        {student.parental_income_band && <Flag>Income: {student.parental_income_band}</Flag>}
        {student.subscribed_to_mailing ? <Flag tone="green">On mailing list</Flag> : <Flag tone="gray">Not subscribed</Flag>}
      </div>
    </main>
  )
}

function boolLabel(v: boolean | null | undefined) {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
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
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
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
