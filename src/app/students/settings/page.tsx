'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SETTINGS_KEYS, SETTINGS_DEFAULTS, fetchAllSettings, setSetting } from '@/lib/settings-api'

// ---------------------------------------------------------------------------
// /students/settings — admin Settings page (v1).
//
// Four tabs covering the most commonly-tweaked surfaces:
//   • Brand & sending: email signature HTML, from/reply-to email
//   • Send behaviour: 24h marketing cap, per-event opt-out scope
//   • Team management: team_members list, activate/deactivate
//   • Form & event defaults: default eligible year groups, lead time
//
// Each tab reads its data on mount and writes via setSetting() into the new
// app_settings table. Values are picked up at request-time by the server-
// side routes (queue worker, send-email) so changes take effect immediately
// with no redeploy. Falls back to SETTINGS_DEFAULTS when a row is missing.
// ---------------------------------------------------------------------------

type Tab = 'brand' | 'send' | 'team' | 'defaults'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('brand')
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Edit the things you'd otherwise have to ask a developer to change.</p>
      </header>

      <nav className="flex flex-wrap gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
        {[
          { id: 'brand' as const, label: 'Brand & sending' },
          { id: 'send' as const, label: 'Send behaviour' },
          { id: 'team' as const, label: 'Team management' },
          { id: 'defaults' as const, label: 'Form & event defaults' },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-steps-blue-600 text-steps-blue-700 dark:text-steps-blue-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div>
        {tab === 'brand' && <BrandTab />}
        {tab === 'send' && <SendTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'defaults' && <DefaultsTab />}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Brand & sending — signature HTML + from/reply-to email
// ---------------------------------------------------------------------------

function BrandTab() {
  const [signature, setSignature] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSettings().then(s => {
      const sig = s[SETTINGS_KEYS.signatureHtml]
      setSignature(typeof sig === 'string' ? sig : '')
      const fe = s[SETTINGS_KEYS.fromEmail]
      setFromEmail(typeof fe === 'string' ? fe : SETTINGS_DEFAULTS.fromEmail)
      const fn = s[SETTINGS_KEYS.fromName]
      setFromName(typeof fn === 'string' ? fn : SETTINGS_DEFAULTS.fromName)
      const rt = s[SETTINGS_KEYS.replyToEmail]
      setReplyTo(typeof rt === 'string' ? rt : SETTINGS_DEFAULTS.replyToEmail)
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(null)
    const writes = await Promise.all([
      setSetting(SETTINGS_KEYS.signatureHtml, signature),
      setSetting(SETTINGS_KEYS.fromEmail, fromEmail.trim()),
      setSetting(SETTINGS_KEYS.fromName, fromName.trim()),
      setSetting(SETTINGS_KEYS.replyToEmail, replyTo.trim()),
    ])
    const firstErr = writes.find(w => w.error)
    if (firstErr) setError(firstErr.error)
    else setSaved('Brand settings saved.')
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <Section title="Email signature (HTML)" hint="Appended to every email the intranet sends. Edit as HTML — copy-paste from a Gmail signature works. Leave blank to fall back to the hardcoded constant.">
        <textarea
          value={signature}
          onChange={e => setSignature(e.target.value)}
          rows={12}
          className="w-full font-mono text-xs px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          placeholder="<table>…</table>"
        />
      </Section>
      <Section title="From email" hint="Address every send uses for the From header. Should be a Gmail alias on the sending mailbox.">
        <input
          type="email"
          value={fromEmail}
          onChange={e => setFromEmail(e.target.value)}
          className="w-full max-w-md px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          placeholder={SETTINGS_DEFAULTS.fromEmail}
        />
      </Section>
      <Section title="From name" hint="Display name shown next to the From email in recipients' inboxes.">
        <input
          type="text"
          value={fromName}
          onChange={e => setFromName(e.target.value)}
          className="w-full max-w-md px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          placeholder={SETTINGS_DEFAULTS.fromName}
        />
      </Section>
      <Section title="Reply-to email" hint="Where replies to outgoing emails land. Usually the same as From.">
        <input
          type="email"
          value={replyTo}
          onChange={e => setReplyTo(e.target.value)}
          className="w-full max-w-md px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          placeholder={SETTINGS_DEFAULTS.replyToEmail}
        />
      </Section>
      <SaveBar saving={saving} onSave={save} saved={saved} error={error} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Send behaviour — marketing cap + opt-out scope
// ---------------------------------------------------------------------------

function SendTab() {
  const [cap, setCap] = useState<number>(SETTINGS_DEFAULTS.marketingCap24h)
  const [optoutScope, setOptoutScope] = useState<'all' | 'marketing_only'>(SETTINGS_DEFAULTS.eventOptoutScope)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSettings().then(s => {
      const c = s[SETTINGS_KEYS.marketingCap24h]
      if (typeof c === 'number' && Number.isFinite(c)) setCap(c)
      const sc = s[SETTINGS_KEYS.eventOptoutScope]
      if (sc === 'all' || sc === 'marketing_only') setOptoutScope(sc)
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(null)
    const writes = await Promise.all([
      setSetting(SETTINGS_KEYS.marketingCap24h, Math.max(1, Math.floor(cap))),
      setSetting(SETTINGS_KEYS.eventOptoutScope, optoutScope),
    ])
    const firstErr = writes.find(w => w.error)
    if (firstErr) setError(firstErr.error)
    else setSaved('Send behaviour saved.')
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <Section title="24-hour marketing send cap" hint="Maximum number of marketing-kind emails the queue worker will send in any rolling 24-hour window. Defends Gmail's daily send limit. Transactional sends (decision notifications etc.) bypass the cap.">
        <input
          type="number"
          min={1}
          value={cap}
          onChange={e => setCap(parseInt(e.target.value) || SETTINGS_DEFAULTS.marketingCap24h)}
          className="w-32 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="ml-2 text-xs text-gray-500">Default: {SETTINGS_DEFAULTS.marketingCap24h}</span>
      </Section>
      <Section title="Per-event opt-out scope" hint="When a student clicks the opt-out link in an event invite, what gets blocked?">
        <fieldset className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={optoutScope === 'all'}
              onChange={() => setOptoutScope('all')}
              className="mt-1 accent-steps-blue-600"
            />
            <span className="text-sm">
              <strong>Block all event emails</strong>
              <span className="block text-xs text-gray-500">Invites, reminders, decisions — anything tied to the event. Strictest interpretation of the opt-out.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={optoutScope === 'marketing_only'}
              onChange={() => setOptoutScope('marketing_only')}
              className="mt-1 accent-steps-blue-600"
            />
            <span className="text-sm">
              <strong>Block marketing only</strong>
              <span className="block text-xs text-gray-500">Stops invites and reminders, but lets transactional emails through (e.g. "your application was accepted"). Recommended once you start sending decisions.</span>
            </span>
          </label>
        </fieldset>
      </Section>
      <SaveBar saving={saving} onSave={save} saved={saved} error={error} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Team management — team_members list + activate/deactivate
// ---------------------------------------------------------------------------

type TeamRow = {
  id: string
  auth_uuid: string | null
  name: string | null
  email: string | null
  role: string | null
  deleted_at: string | null
}

function TeamTab() {
  const [rows, setRows] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('team_members')
      .select('id, auth_uuid, name, email, role, deleted_at')
      .order('name')
    if (error) setError(error.message)
    else setRows((data ?? []) as TeamRow[])
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  const toggle = async (row: TeamRow) => {
    setBusy(row.id)
    const patch = row.deleted_at
      ? { deleted_at: null }
      : { deleted_at: new Date().toISOString() }
    const { error } = await supabase.from('team_members').update(patch).eq('id', row.id)
    if (error) setError(error.message)
    else await reload()
    setBusy(null)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Team members listed here can sign in to the admin. Deactivating removes their admin access but preserves their audit trail (review notes, status changes). Inviting new members is currently a database task — ask in chat to add the form here.
      </p>
      {error && <div role="alert" className="mb-3 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <ul className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
        {rows.map(row => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{row.name || row.email || row.auth_uuid || row.id}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{row.email}{row.role ? ` · ${row.role}` : ''}{row.deleted_at ? ' · deactivated' : ''}</p>
            </div>
            <button
              type="button"
              onClick={() => toggle(row)}
              disabled={busy === row.id}
              className={
                row.deleted_at
                  ? 'text-xs px-3 py-1.5 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50'
                  : 'text-xs px-3 py-1.5 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50'
              }
            >
              {busy === row.id ? 'Saving…' : row.deleted_at ? 'Reactivate' : 'Deactivate'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Form & event defaults
// ---------------------------------------------------------------------------

function DefaultsTab() {
  const [yearGroups, setYearGroups] = useState<number[]>(SETTINGS_DEFAULTS.defaultEligibleYearGroups as number[])
  const [leadDays, setLeadDays] = useState<number>(SETTINGS_DEFAULTS.defaultApplicationsOpenLeadDays)
  const [minCustomQuestions, setMinCustomQuestions] = useState<number>(SETTINGS_DEFAULTS.minCustomQuestions)
  const [pageSize, setPageSize] = useState<number>(SETTINGS_DEFAULTS.studentDashboardPageSize)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSettings().then(s => {
      const yg = s[SETTINGS_KEYS.defaultEligibleYearGroups]
      if (Array.isArray(yg) && yg.every(n => typeof n === 'number')) setYearGroups(yg as number[])
      const ld = s[SETTINGS_KEYS.defaultApplicationsOpenLeadDays]
      if (typeof ld === 'number' && Number.isFinite(ld)) setLeadDays(ld)
      const mcq = s[SETTINGS_KEYS.minCustomQuestions]
      if (typeof mcq === 'number' && Number.isFinite(mcq) && mcq >= 0) setMinCustomQuestions(mcq)
      const ps = s[SETTINGS_KEYS.studentDashboardPageSize]
      if (typeof ps === 'number' && Number.isFinite(ps) && ps > 0) setPageSize(Math.floor(ps))
      setLoading(false)
    })
  }, [])

  const toggleYg = (n: number) => {
    if (yearGroups.includes(n)) setYearGroups(yearGroups.filter(x => x !== n))
    else setYearGroups([...yearGroups, n].sort((a, b) => a - b))
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(null)
    const writes = await Promise.all([
      setSetting(SETTINGS_KEYS.defaultEligibleYearGroups, yearGroups),
      setSetting(SETTINGS_KEYS.defaultApplicationsOpenLeadDays, Math.max(0, Math.floor(leadDays))),
      setSetting(SETTINGS_KEYS.minCustomQuestions, Math.max(0, Math.floor(minCustomQuestions))),
      setSetting(SETTINGS_KEYS.studentDashboardPageSize, Math.max(10, Math.floor(pageSize))),
    ])
    const firstErr = writes.find(w => w.error)
    if (firstErr) setError(firstErr.error)
    else setSaved('Defaults saved.')
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <Section title="Default eligible year groups for new events" hint="Pre-selected on the event-create form. You can still override per event.">
        <div className="flex flex-wrap gap-2">
          {[12, 13, 14].map(yg => (
            <label key={yg} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={yearGroups.includes(yg)}
                onChange={() => toggleYg(yg)}
                className="accent-steps-blue-600"
              />
              <span className="text-sm">{yg === 14 ? 'Gap year' : `Y${yg}`}</span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Default applications-open lead-time" hint="Days between an event being published and applications opening. Used to pre-fill the applications_open_at field on new events.">
        <input
          type="number"
          min={0}
          value={leadDays}
          onChange={e => setLeadDays(parseInt(e.target.value) || 0)}
          className="w-32 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="ml-2 text-xs text-gray-500">days</span>
      </Section>
      <Section title="Student dashboard — rows per page" hint="How many students to show per page on /students. Lower numbers are faster to load and easier to scan; higher numbers mean fewer clicks. Minimum 10.">
        <input
          type="number"
          min={10}
          value={pageSize}
          onChange={e => setPageSize(parseInt(e.target.value) || SETTINGS_DEFAULTS.studentDashboardPageSize)}
          className="w-32 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="ml-2 text-xs text-gray-500">Default: {SETTINGS_DEFAULTS.studentDashboardPageSize}</span>
      </Section>

            <Section title="Minimum custom questions to publish" hint="How many event-specific custom questions a form must have before publish is allowed. Standard auto-included questions (school type, FSM, GCSEs, etc.) don't count. Set to 0 to allow publishing with no custom questions — useful for lightweight events like office hours.">
        <input
          type="number"
          min={0}
          value={minCustomQuestions}
          onChange={e => setMinCustomQuestions(parseInt(e.target.value) || 0)}
          className="w-32 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="ml-2 text-xs text-gray-500">Default: {SETTINGS_DEFAULTS.minCustomQuestions}</span>
      </Section>
      <SaveBar saving={saving} onSave={save} saved={saved} error={error} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Reusable bits
// ---------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">{children}</div>
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</label>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

function SaveBar({ saving, onSave, saved, error }: { saving: boolean; onSave: () => void; saved: string | null; error: string | null }) {
  return (
    <div className="mt-6 flex items-center gap-3 border-t border-gray-200 dark:border-gray-800 pt-4">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="px-4 py-1.5 text-sm font-semibold rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span className="text-xs text-emerald-700 dark:text-emerald-400">{saved}</span>}
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </div>
  )
}
