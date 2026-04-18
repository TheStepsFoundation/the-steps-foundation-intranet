'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-provider'

type Template = {
  id: string
  name: string
  type: string
  subject: string
  body_html: string
  body_text: string | null
  event_id: string | null
  event_name?: string | null
  created_at: string
}

const TEMPLATE_TYPES = [
  { code: 'acceptance', label: 'Acceptance' },
  { code: 'rejection', label: 'Rejection' },
  { code: 'waitlist', label: 'Waitlist' },
  { code: 'reminder', label: 'Reminder' },
  { code: 'follow_up', label: 'Follow-up' },
  { code: 'custom', label: 'Custom' },
]

const MERGE_FIELDS = [
  { token: '{{first_name}}', desc: "Student's first name" },
  { token: '{{last_name}}', desc: "Student's last name" },
  { token: '{{event_name}}', desc: 'Event name' },
  { token: '{{event_date}}', desc: 'Event date' },
  { token: '{{event_location}}', desc: 'Event location' },
  { token: '{{event_time}}', desc: 'Event time' },
]

export default function EmailTemplatesPage() {
  const { teamMember } = useAuth()
  const [templates, setTemplates] = useState<Template[]>([])
  const [events, setEvents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const emptyDraft = {
    name: '',
    type: 'custom' as string,
    subject: '',
    body_html: '',
    body_text: '',
    event_id: '' as string,
  }
  const [draft, setDraft] = useState(emptyDraft)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: tData }, { data: eData }] = await Promise.all([
      supabase
        .from('email_templates')
        .select('id, name, type, subject, body_html, body_text, event_id, created_at, events(name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('events')
        .select('id, name')
        .is('deleted_at', null)
        .order('event_date', { ascending: false }),
    ])
    setTemplates((tData ?? []).map((t: any) => ({
      ...t,
      event_name: t.events?.name ?? null,
    })))
    setEvents((eData ?? []) as any[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startAdd() {
    setDraft(emptyDraft)
    setAdding(true)
    setEditing(null)
  }

  function startEdit(t: Template) {
    setDraft({
      name: t.name,
      type: t.type,
      subject: t.subject,
      body_html: t.body_html,
      body_text: t.body_text ?? '',
      event_id: t.event_id ?? '',
    })
    setEditing(t)
    setAdding(false)
  }

  function cancel() {
    setAdding(false)
    setEditing(null)
  }

  async function save() {
    setSaving(true)
    const payload = {
      name: draft.name,
      type: draft.type,
      subject: draft.subject,
      body_html: draft.body_html,
      body_text: draft.body_text || null,
      event_id: draft.event_id || null,
      updated_by: (teamMember as any)?.auth_uuid ?? null,
    }
    try {
      if (editing) {
        await supabase.from('email_templates').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('email_templates').insert({
          ...payload,
          created_by: (teamMember as any)?.auth_uuid ?? null,
        })
      }
      await load()
      cancel()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this template?')) return
    await supabase.from('email_templates').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    await load()
  }

  const isEditing = adding || editing !== null

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="mb-2">
            <Link href="/students/events" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">&larr; Events</Link>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Email Templates</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Global templates with optional per-event overrides.</p>
        </div>
        {!isEditing && (
          <button onClick={startAdd} className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            + New template
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Template name</label>
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Starting Point Acceptance"
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
                <select
                  value={draft.type}
                  onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
                  className="w-full px-2 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                >
                  {TEMPLATE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Event (optional)</label>
                <select
                  value={draft.event_id}
                  onChange={e => setDraft(d => ({ ...d, event_id: e.target.value }))}
                  className="w-full px-2 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                >
                  <option value="">Global (all events)</option>
                  {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject line</label>
            <input
              value={draft.subject}
              onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
              placeholder="e.g. Your application to {{event_name}} has been accepted!"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body (HTML)</label>
            <textarea
              value={draft.body_html}
              onChange={e => setDraft(d => ({ ...d, body_html: e.target.value }))}
              rows={10}
              placeholder="<p>Dear {{first_name}},</p><p>We're delighted to let you know...</p>"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
            />
          </div>

          {/* Merge field reference */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium">Merge fields:</span>{' '}
            {MERGE_FIELDS.map((f, i) => (
              <span key={f.token}>
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{f.token}</code>
                {i < MERGE_FIELDS.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={cancel} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
            <button
              onClick={save}
              disabled={saving || !draft.name || !draft.subject || !draft.body_html}
              className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Update' : 'Create template'}
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-10">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-10 text-center text-sm text-gray-500 dark:text-gray-400">
          No templates yet. Create one to get started.
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <div key={t.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{t.name}</h3>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {TEMPLATE_TYPES.find(tt => tt.code === t.type)?.label ?? t.type}
                    </span>
                    {t.event_name && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {t.event_name}
                      </span>
                    )}
                    {!t.event_id && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Global
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">Subject: {t.subject}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(t)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => remove(t.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
