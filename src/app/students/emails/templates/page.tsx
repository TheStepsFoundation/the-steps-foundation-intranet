'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-provider'
import {
  RichTextEmailEditor,
  type RichTextEmailEditorHandle,
  SingleLineMergeEditor,
  type SingleLineMergeEditorHandle,
  MergeTagInsertBar,
  DEFAULT_MERGE_TAGS,
} from '@/components/RichTextEmailEditor'

// ---------------------------------------------------------------------------
// /students/emails/templates — Wave 2 redesign (Apr 2026).
//
// What changed:
//  - Master/detail layout: list rail on the left grouped by template type
//    (Acceptance / Rejection / Waitlist / Invite / Reminder / Follow-up /
//    Custom), editor + live preview on the right.
//  - Search across templates by name / subject / body.
//  - Live preview pane renders the body_html below the editor with the
//    merge tags substituted for sample values, so admins can see what
//    students will actually receive without sending a test.
//  - Type pills + "global" / per-event chips made consistent with the rest
//    of the redesigned admin surfaces.
//  - Soft-delete preserved (sets deleted_at) — same approach as before.
// ---------------------------------------------------------------------------

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
  updated_at?: string | null
}

const TEMPLATE_TYPES = [
  { code: 'acceptance', label: 'Acceptance', tone: 'emerald' },
  { code: 'rejection', label: 'Rejection', tone: 'rose' },
  { code: 'waitlist', label: 'Waitlist', tone: 'amber' },
  { code: 'invite', label: 'Invite', tone: 'blue' },
  { code: 'shortlist', label: 'Shortlist', tone: 'violet' },
  { code: 'reminder', label: 'Reminder', tone: 'slate' },
  { code: 'follow_up', label: 'Follow-up', tone: 'slate' },
  { code: 'custom', label: 'Custom', tone: 'slate' },
] as const

type TypeTone = typeof TEMPLATE_TYPES[number]['tone']

const TONE_PILL: Record<TypeTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose:    'bg-rose-50 text-rose-700 border-rose-200',
  amber:   'bg-amber-50 text-amber-800 border-amber-200',
  blue:    'bg-steps-blue-50 text-steps-blue-700 border-steps-blue-200',
  violet:  'bg-violet-50 text-violet-700 border-violet-200',
  slate:   'bg-slate-100 text-slate-700 border-slate-200',
}

function typeMeta(code: string) {
  return TEMPLATE_TYPES.find(t => t.code === code) ?? { code, label: code, tone: 'slate' as TypeTone }
}

// Sample values used by the live preview to substitute merge tags.
const PREVIEW_SAMPLES: Record<string, string> = {
  '{{first_name}}': 'Maya',
  '{{last_name}}': 'Adesanya',
  '{{full_name}}': 'Maya Adesanya',
  '{{event_name}}': 'Oxbridge Interview Workshop',
  '{{event_date}}': 'Saturday 15 November 2026',
  '{{event_location}}': 'LSE — Old Building',
  '{{event_time}}': '10:00 – 16:00',
  '{{apply_link}}': 'https://the-steps-foundation-intranet.vercel.app/apply/...',
}

function applyPreviewSubs(html: string): string {
  let out = html
  for (const [tag, val] of Object.entries(PREVIEW_SAMPLES)) {
    out = out.split(tag).join(val)
  }
  // Also replace mergetag pill spans (data-mt-tag attribute) with the sample.
  out = out.replace(/<span[^>]*data-mt-tag="([^"]+)"[^>]*>[^<]*<\/span>/g, (_m, tag) =>
    PREVIEW_SAMPLES['{{' + tag + '}}'] ?? `{{${tag}}}`
  )
  return out
}

export default function EmailTemplatesPage() {
  const { teamMember } = useAuth()
  const [templates, setTemplates] = useState<Template[]>([])
  const [events, setEvents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bodySeedCounter, setBodySeedCounter] = useState(0)
  const [search, setSearch] = useState('')
  const [activeType, setActiveType] = useState<string>('all')
  const [previewOn, setPreviewOn] = useState(true)

  const bodyEditorRef = useRef<RichTextEmailEditorHandle | null>(null)
  const subjectEditorRef = useRef<SingleLineMergeEditorHandle | null>(null)

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
        .select('id, name, type, subject, body_html, body_text, event_id, created_at, updated_at, events(name)')
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
    setBodySeedCounter(c => c + 1)
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
    setBodySeedCounter(c => c + 1)
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

  // Filtered + grouped list
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter(t => {
      if (activeType !== 'all' && t.type !== activeType) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.event_name ?? '').toLowerCase().includes(q) ||
        t.body_html.toLowerCase().includes(q)
      )
    })
  }, [templates, search, activeType])

  const groupedByType = useMemo(() => {
    const map = new Map<string, Template[]>()
    for (const t of filtered) {
      const arr = map.get(t.type) ?? []
      arr.push(t)
      map.set(t.type, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = TEMPLATE_TYPES.findIndex(x => x.code === a)
      const bi = TEMPLATE_TYPES.findIndex(x => x.code === b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  }, [filtered])

  const isEditing = adding || editing !== null
  const previewHtml = useMemo(() => applyPreviewSubs(draft.body_html || ''), [draft.body_html])
  const previewSubject = useMemo(() => applyPreviewSubs(draft.subject || ''), [draft.subject])

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <Link href="/students/events" className="text-sm text-steps-blue-600 hover:text-steps-blue-700 inline-flex items-center gap-1 mb-2">
            <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
            Events
          </Link>
          <h1 className="font-display text-3xl font-black text-steps-dark tracking-tight">Email templates</h1>
          <p className="text-sm text-slate-500 mt-1">Global defaults with optional per-event overrides. Merge tags become real values on send.</p>
        </div>
        {!isEditing && (
          <button
            onClick={startAdd}
            className="px-4 py-2.5 text-sm rounded-xl bg-steps-blue-600 text-white font-semibold border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none transition-all duration-150 inline-flex items-center gap-2"
          >
            <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            New template
          </button>
        )}
      </div>

      {/* Filter chips + search — only when not editing */}
      {!isEditing && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setActiveType('all')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full transition-colors ${activeType === 'all' ? 'bg-steps-dark text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              All <span className="opacity-70 ml-1">{templates.length}</span>
            </button>
            {TEMPLATE_TYPES.map(t => {
              const count = templates.filter(x => x.type === t.code).length
              if (count === 0) return null
              return (
                <button
                  key={t.code}
                  onClick={() => setActiveType(t.code)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full transition-colors ${activeType === t.code ? 'bg-steps-dark text-white' : `border ${TONE_PILL[t.tone]} hover:opacity-80`}`}
                >
                  {t.label} <span className="opacity-70 ml-1">{count}</span>
                </button>
              )
            })}
          </div>
          <input
            type="text"
            placeholder="Search name, subject, body…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="ml-auto px-3.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white placeholder:text-slate-400 w-64 focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
          />
        </div>
      )}

      {isEditing ? (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* === Editor pane === */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="font-display text-lg font-bold text-steps-dark">
                {editing ? 'Edit template' : 'New template'}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewOn(p => !p)}
                className="text-xs font-semibold text-steps-blue-600 hover:text-steps-blue-800 lg:hidden"
                aria-pressed={previewOn}
              >
                {previewOn ? 'Hide preview' : 'Show preview'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Template name</label>
                <input
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Starting Point Acceptance"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Type</label>
                  <select
                    value={draft.type}
                    onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
                    className="w-full px-2.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                  >
                    {TEMPLATE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Event</label>
                  <select
                    value={draft.event_id}
                    onChange={e => setDraft(d => ({ ...d, event_id: e.target.value }))}
                    className="w-full px-2.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                  >
                    <option value="">Global default</option>
                    {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Subject line</label>
              <MergeTagInsertBar
                tags={DEFAULT_MERGE_TAGS}
                onInsert={(tag, label) => subjectEditorRef.current?.insertMergeTag(tag, label)}
              />
              <SingleLineMergeEditor
                key={`subj-${bodySeedCounter}`}
                ref={subjectEditorRef}
                value={draft.subject}
                onChange={v => setDraft(d => ({ ...d, subject: v }))}
                placeholder="e.g. Your application to {{event_name}} has been accepted!"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Body</label>
                <span className="text-[10px] text-slate-400">Merge tags render as pills; replaced on send.</span>
              </div>
              <MergeTagInsertBar
                tags={DEFAULT_MERGE_TAGS}
                onInsert={(tag, label) => bodyEditorRef.current?.insertMergeTag(tag, label)}
              />
              <RichTextEmailEditor
                key={bodySeedCounter}
                ref={bodyEditorRef}
                initialHtml={draft.body_html}
                onChange={html => setDraft(d => ({ ...d, body_html: html }))}
                placeholder={'Hi {{first_name}},\n\n...\n\nVirtus non origo,\nThe Steps Foundation Team'}
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={cancel}
                className="px-4 py-2 text-sm rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !draft.name || !draft.subject || !draft.body_html}
                className="ml-auto px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                {saving ? 'Saving…' : editing ? 'Update template' : 'Create template'}
              </button>
            </div>
          </div>

          {/* === Live preview pane === */}
          <aside className={`${previewOn ? '' : 'hidden lg:block'} rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6 lg:sticky lg:top-6 lg:self-start`}>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">Preview</h3>
              <span className="text-[10px] text-slate-400">Sample data substituted</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Subject</p>
                <p className="text-sm font-semibold text-steps-dark mt-0.5">{previewSubject || <span className="text-slate-300">(no subject yet)</span>}</p>
              </div>
              <div className="px-5 py-4 text-sm text-slate-700 leading-relaxed rich-html prose-sm max-w-none">
                {previewHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <p className="text-slate-300 italic">Body preview appears here.</p>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Merge tags use sample data above (Maya Adesanya / Oxbridge Interview Workshop). Real values are substituted per recipient when the email is sent.
            </p>
          </aside>
        </div>
      ) : loading ? (
        <div className="text-center py-16">
          <div aria-hidden className="animate-spin w-7 h-7 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading templates…</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-white text-slate-400 border border-slate-200 flex items-center justify-center mb-3">
            <svg aria-hidden className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          </div>
          <p className="font-display text-lg font-bold text-steps-dark">No templates yet</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">Create one to get started — global defaults appear in every event compose.</p>
          <button
            onClick={startAdd}
            className="px-4 py-2 text-sm rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition"
          >
            Create your first template
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">No templates match {search ? <>“<span className="text-steps-dark font-medium">{search}</span>”</> : 'this filter'}.</p>
          <button onClick={() => { setSearch(''); setActiveType('all') }} className="mt-2 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByType.map(([typeCode, list]) => {
            const meta = typeMeta(typeCode)
            return (
              <section key={typeCode} aria-labelledby={`group-${typeCode}`}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 id={`group-${typeCode}`} className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">{meta.label}</h2>
                  <span className="text-xs text-slate-400">{list.length}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {list.map(t => (
                    <div key={t.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-steps-blue-200 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-steps-dark truncate">{t.name}</h3>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${TONE_PILL[meta.tone]}`}>
                              {meta.label}
                            </span>
                            {t.event_name ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-steps-blue-50 text-steps-blue-700 border border-steps-blue-200">
                                {t.event_name}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                                Global
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-2 line-clamp-1">
                            <span className="font-semibold text-slate-600">Subject:</span> {t.subject}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(t)}
                            className="px-2 py-1 text-xs font-semibold text-steps-blue-700 hover:bg-steps-blue-50 rounded transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => remove(t.id)}
                            className="px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
