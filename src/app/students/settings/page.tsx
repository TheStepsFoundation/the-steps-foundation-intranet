'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { EMAIL_AUTOMATION_TYPE_META, type EmailAutomationType, PUBLISH_REQUIRED_FIELD_OPTIONS } from '@/lib/events-api'
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, OPENTO_FORMAT_OPTIONS, type DateFormatKey, type TimeFormatKey, type OpenToFormatKey, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, DEFAULT_OPENTO_FORMAT, formatMergeDate, formatMergeTime, formatMergeOpenTo } from '@/lib/merge-tag-format'
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

type Tab = 'brand' | 'send' | 'team' | 'defaults' | 'copy' | 'formats'

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
          { id: 'copy' as const, label: 'Copy & messaging' },
          { id: 'formats' as const, label: 'Merge tag formats' },
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
        {tab === 'copy' && <CopyTab />}
        {tab === 'formats' && <FormatsTab />}
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
  const [enabledAutomationTypes, setEnabledAutomationTypes] = useState<EmailAutomationType[]>(SETTINGS_DEFAULTS.enabledAutomationTypes as EmailAutomationType[])
  const [publishRequiredFields, setPublishRequiredFields] = useState<string[]>(SETTINGS_DEFAULTS.publishRequiredFields as string[])
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
      const eat = s[SETTINGS_KEYS.enabledAutomationTypes]
      if (Array.isArray(eat) && eat.every(x => typeof x === 'string')) setEnabledAutomationTypes(eat as EmailAutomationType[])
      const prf = s[SETTINGS_KEYS.publishRequiredFields]
      if (Array.isArray(prf) && prf.every(x => typeof x === 'string')) setPublishRequiredFields(prf as string[])
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
      setSetting(SETTINGS_KEYS.enabledAutomationTypes, enabledAutomationTypes),
      setSetting(SETTINGS_KEYS.publishRequiredFields, publishRequiredFields),
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
      <Section title="Default email automations available on new events" hint="Which automation types appear in the 'Add automation' picker on the event editor. Untick to remove an option from the default; existing automations on events stay manageable even if their type is later removed.">
        <div className="space-y-1.5">
          {(Object.entries(EMAIL_AUTOMATION_TYPE_META) as [EmailAutomationType, { label: string; description: string }][]).map(([type, meta]) => (
            <label key={type} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabledAutomationTypes.includes(type)}
                onChange={e => {
                  if (e.target.checked) setEnabledAutomationTypes([...enabledAutomationTypes, type])
                  else setEnabledAutomationTypes(enabledAutomationTypes.filter(t => t !== type))
                }}
                className="mt-1 accent-steps-blue-600"
              />
              <span className="text-sm">
                <strong className="font-semibold">{meta.label}</strong>
                <span className="block text-xs text-gray-500">{meta.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Publish requirements" hint="Which event fields must be set before an event can move from draft to open. Untick a field to make it optional at publish time — e.g. drop the banner image requirement for lightweight events.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {PUBLISH_REQUIRED_FIELD_OPTIONS.map(opt => (
            <label key={opt.field} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={publishRequiredFields.includes(opt.field)}
                onChange={e => {
                  if (e.target.checked) setPublishRequiredFields([...publishRequiredFields, opt.field])
                  else setPublishRequiredFields(publishRequiredFields.filter(f => f !== opt.field))
                }}
                className="accent-steps-blue-600"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Name + slug are technically optional here too, but the validator will still trip on missing them at publish since they\'re needed elsewhere — leave them ticked.</p>
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

function CopyTab() {
  const [hubGreeting, setHubGreeting] = useState<string>(SETTINGS_DEFAULTS.copyHubGreeting)
  const [withdrawConfirm, setWithdrawConfirm] = useState<string>(SETTINGS_DEFAULTS.copyWithdrawConfirm)
  const [eventOptoutConfirm, setEventOptoutConfirm] = useState<string>(SETTINGS_DEFAULTS.copyEventOptoutConfirm)
  const [unsubscribeConfirm, setUnsubscribeConfirm] = useState<string>(SETTINGS_DEFAULTS.copyUnsubscribeConfirm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSettings().then(s => {
      const g = s[SETTINGS_KEYS.copyHubGreeting]
      if (typeof g === 'string') setHubGreeting(g)
      const w = s[SETTINGS_KEYS.copyWithdrawConfirm]
      if (typeof w === 'string') setWithdrawConfirm(w)
      const o = s[SETTINGS_KEYS.copyEventOptoutConfirm]
      if (typeof o === 'string') setEventOptoutConfirm(o)
      const u = s[SETTINGS_KEYS.copyUnsubscribeConfirm]
      if (typeof u === 'string') setUnsubscribeConfirm(u)
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true); setError(null); setSaved(null)
    const writes = await Promise.all([
      setSetting(SETTINGS_KEYS.copyHubGreeting, hubGreeting),
      setSetting(SETTINGS_KEYS.copyWithdrawConfirm, withdrawConfirm),
      setSetting(SETTINGS_KEYS.copyEventOptoutConfirm, eventOptoutConfirm),
      setSetting(SETTINGS_KEYS.copyUnsubscribeConfirm, unsubscribeConfirm),
    ])
    const firstErr = writes.find(w => w.error)
    if (firstErr) setError(firstErr.error)
    else setSaved('Copy saved. Changes take effect on the next page load.')
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <CopyField
        label="Hub greeting"
        hint="The big welcome line at the top of /my. Available tags: {{first_name}}, {{last_name}}, {{full_name}}."
        tags={['first_name', 'last_name', 'full_name']}
        value={hubGreeting}
        onChange={setHubGreeting}
        defaultValue={SETTINGS_DEFAULTS.copyHubGreeting}
      />
      <CopyField
        label="Withdraw confirmation page"
        hint="Shown to students when they click a withdraw link from an event email. Available tags: {{first_name}}, {{event_name}}."
        tags={['first_name', 'event_name']}
        value={withdrawConfirm}
        onChange={setWithdrawConfirm}
        defaultValue={SETTINGS_DEFAULTS.copyWithdrawConfirm}
      />
      <CopyField
        label="Event opt-out confirmation page"
        hint="Shown when a student clicks the per-event opt-out link. Available tags: {{first_name}}, {{event_name}}."
        tags={['first_name', 'event_name']}
        value={eventOptoutConfirm}
        onChange={setEventOptoutConfirm}
        defaultValue={SETTINGS_DEFAULTS.copyEventOptoutConfirm}
      />
      <CopyField
        label="Global unsubscribe confirmation"
        hint="Shown when a student clicks the unsubscribe footer link. Available tags: {{email}}."
        tags={['email']}
        value={unsubscribeConfirm}
        onChange={setUnsubscribeConfirm}
        defaultValue={SETTINGS_DEFAULTS.copyUnsubscribeConfirm}
      />
      <SaveBar saving={saving} onSave={save} saved={saved} error={error} />
    </Card>
  )
}

function CopyField({ label, hint, tags, value, onChange, defaultValue }: {
  label: string
  hint: string
  tags: string[]
  value: string
  onChange: (v: string) => void
  defaultValue: string
}) {
  const renderPreview = () => {
    // Render the merge-tag tokens as visible chips inside the preview so the
    // admin can see exactly where each value lands without typing real data.
    return value.replace(/\{\{([a-z_0-9]+)\}\}/g, (m, t) => `<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:9999px;font-size:11px;font-weight:500;border:1px solid #bfdbfe">{${t}}</span>`)
  }
  return (
    <div className="mb-6 last:mb-0">
      <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{label}</label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{hint}</p>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-sans"
      />
      <div className="mt-1 flex flex-wrap gap-1.5 items-center">
        <span className="text-[11px] text-gray-500">Insert tag:</span>
        {tags.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(value + `{{${t}}}`)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-slate-100"
          >
            {`{{${t}}}`}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="text-[11px] px-2 py-0.5 rounded text-gray-500 hover:text-gray-900 underline"
        >
          Reset to default
        </button>
      </div>
      <div className="mt-2 p-2 rounded-md bg-slate-50 dark:bg-gray-800 text-sm text-slate-700 dark:text-gray-300" dangerouslySetInnerHTML={{ __html: renderPreview() }} />
    </div>
  )
}


// Tags whose picker / inserted-chip label admins can override. Order is the
// order they show in the Settings UI. Keep in sync with the mergeTags arrays
// in /students/events/[id]/page.tsx and /components/InviteStudentsModal.tsx.
const MERGE_TAG_LABEL_DEFAULTS: { tag: string; defaultLabel: string; group: 'Student' | 'Event' | 'Links' | 'Server' }[] = [
  { tag: 'first_name',          defaultLabel: 'First Name',         group: 'Student' },
  { tag: 'last_name',           defaultLabel: 'Last Name',          group: 'Student' },
  { tag: 'full_name',           defaultLabel: 'Full Name',          group: 'Student' },
  { tag: 'last_attended_event', defaultLabel: 'Last Event',         group: 'Student' },
  { tag: 'event_name',          defaultLabel: 'Event Name',         group: 'Event' },
  { tag: 'event_date',          defaultLabel: 'Event Date',         group: 'Event' },
  { tag: 'event_time',          defaultLabel: 'Event Time',         group: 'Event' },
  { tag: 'event_location',      defaultLabel: 'Location',           group: 'Event' },
  { tag: 'event_format',        defaultLabel: 'Format',             group: 'Event' },
  { tag: 'event_dress_code',    defaultLabel: 'Dress Code',         group: 'Event' },
  { tag: 'open_to',             defaultLabel: 'Open To',            group: 'Event' },
  { tag: 'application_deadline', defaultLabel: 'Application Deadline', group: 'Event' },
  { tag: 'apply_link',          defaultLabel: 'Apply Link',         group: 'Links' },
  { tag: 'portal_link',         defaultLabel: 'Portal Link',        group: 'Links' },
  { tag: 'rsvp_link',           defaultLabel: 'RSVP Link',          group: 'Links' },
  { tag: 'withdraw_link',       defaultLabel: 'Withdraw link',      group: 'Server' },
  { tag: 'event_optout_link',   defaultLabel: 'Opt-out link (this event only)', group: 'Server' },
]

function FormatsTab() {
  const [dateFmt, setDateFmt] = useState<DateFormatKey>(DEFAULT_DATE_FORMAT)
  const [timeFmt, setTimeFmt] = useState<TimeFormatKey>(DEFAULT_TIME_FORMAT)
  const [openToFmt, setOpenToFmt] = useState<OpenToFormatKey>(DEFAULT_OPENTO_FORMAT)
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})
  const [withdrawAnchor, setWithdrawAnchor] = useState<string>(SETTINGS_DEFAULTS.withdrawLinkAnchor)
  const [optoutAnchor, setOptoutAnchor] = useState<string>(SETTINGS_DEFAULTS.eventOptoutLinkAnchor)
  const [applyAnchor, setApplyAnchor] = useState<string>(SETTINGS_DEFAULTS.applyLinkAnchor)
  const [portalAnchor, setPortalAnchor] = useState<string>(SETTINGS_DEFAULTS.portalLinkAnchor)
  const [rsvpAnchor, setRsvpAnchor] = useState<string>(SETTINGS_DEFAULTS.rsvpLinkAnchor)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllSettings().then(s => {
      const d = s[SETTINGS_KEYS.mergeDateFormat]
      if (typeof d === 'string') setDateFmt(d as DateFormatKey)
      const t = s[SETTINGS_KEYS.mergeTimeFormat]
      if (typeof t === 'string') setTimeFmt(t as TimeFormatKey)
      const o = s[SETTINGS_KEYS.mergeOpenToFormat]
      if (typeof o === 'string') setOpenToFmt(o as OpenToFormatKey)
      const ml = s[SETTINGS_KEYS.mergeTagLabels]
      if (ml && typeof ml === 'object' && !Array.isArray(ml)) setLabelOverrides(ml as Record<string, string>)
      const wa = s[SETTINGS_KEYS.withdrawLinkAnchor]
      if (typeof wa === 'string' && wa.length > 0) setWithdrawAnchor(wa)
      const oa = s[SETTINGS_KEYS.eventOptoutLinkAnchor]
      if (typeof oa === 'string' && oa.length > 0) setOptoutAnchor(oa)
      const aa = s[SETTINGS_KEYS.applyLinkAnchor]
      if (typeof aa === 'string' && aa.length > 0) setApplyAnchor(aa)
      const pa = s[SETTINGS_KEYS.portalLinkAnchor]
      if (typeof pa === 'string' && pa.length > 0) setPortalAnchor(pa)
      const ra = s[SETTINGS_KEYS.rsvpLinkAnchor]
      if (typeof ra === 'string' && ra.length > 0) setRsvpAnchor(ra)
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true); setError(null); setSaved(null)
    // Strip empty / whitespace-only overrides so the picker falls back to
    // the hardcoded default rather than rendering a blank chip.
    const cleanedOverrides: Record<string, string> = {}
    for (const [k, v] of Object.entries(labelOverrides)) {
      if (typeof v === 'string' && v.trim().length > 0) cleanedOverrides[k] = v.trim()
    }
    const writes = await Promise.all([
      setSetting(SETTINGS_KEYS.mergeDateFormat, dateFmt),
      setSetting(SETTINGS_KEYS.mergeTimeFormat, timeFmt),
      setSetting(SETTINGS_KEYS.mergeOpenToFormat, openToFmt),
      setSetting(SETTINGS_KEYS.mergeTagLabels, cleanedOverrides),
      setSetting(SETTINGS_KEYS.withdrawLinkAnchor, withdrawAnchor.trim() || SETTINGS_DEFAULTS.withdrawLinkAnchor),
      setSetting(SETTINGS_KEYS.eventOptoutLinkAnchor, optoutAnchor.trim() || SETTINGS_DEFAULTS.eventOptoutLinkAnchor),
      setSetting(SETTINGS_KEYS.applyLinkAnchor, applyAnchor.trim() || SETTINGS_DEFAULTS.applyLinkAnchor),
      setSetting(SETTINGS_KEYS.portalLinkAnchor, portalAnchor.trim() || SETTINGS_DEFAULTS.portalLinkAnchor),
      setSetting(SETTINGS_KEYS.rsvpLinkAnchor, rsvpAnchor.trim() || SETTINGS_DEFAULTS.rsvpLinkAnchor),
    ])
    const firstErr = writes.find(w => w.error)
    if (firstErr) setError(firstErr.error)
    else setSaved('Merge tag formats saved.')
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <Card>
      <FormatSelector
        label="Event date — {{event_date}}"
        hint="How dates render in emails. Also drives the date portion of {{application_deadline}}."
        options={DATE_FORMAT_OPTIONS}
        value={dateFmt}
        onChange={(v) => setDateFmt(v as DateFormatKey)}
      />
      <FormatSelector
        label="Event time — {{event_time}}"
        hint="How time ranges render. Also drives the time portion of {{application_deadline}}."
        options={TIME_FORMAT_OPTIONS}
        value={timeFmt}
        onChange={(v) => setTimeFmt(v as TimeFormatKey)}
      />
      <FormatSelector
        label="Open-to year groups — {{open_to}}"
        hint="How the eligible year-group label reads."
        options={OPENTO_FORMAT_OPTIONS}
        value={openToFmt}
        onChange={(v) => setOpenToFmt(v as OpenToFormatKey)}
      />

      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Pill labels &amp; recipient text</label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Per tag: the <strong>label</strong> column controls how the chip appears to you in the composer. The <strong>recipient sees</strong> column shows what students actually see in the email body when the tag is resolved. Leave label blank to use the default. The {`{{tag}}`} token in the body is unchanged.</p>
        {(['Student', 'Event', 'Links', 'Server'] as const).map(group => (
          <div key={group} className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-gray-400 mb-2">{group}</p>
            <div className="space-y-1.5">
              {MERGE_TAG_LABEL_DEFAULTS.filter(t => t.group === group).map(t => {
                const samplePreview = recipientPreview(t.tag, { dateFmt, timeFmt, openToFmt, withdrawAnchor, optoutAnchor, applyAnchor, portalAnchor, rsvpAnchor })
                const isServer = t.tag === 'withdraw_link' || t.tag === 'event_optout_link' || t.tag === 'apply_link' || t.tag === 'portal_link' || t.tag === 'rsvp_link'
                return (
                  <div key={t.tag} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 truncate shrink-0">{`{{${t.tag}}}`}</code>
                    <input
                      type="text"
                      value={labelOverrides[t.tag] ?? ''}
                      onChange={e => setLabelOverrides(prev => ({ ...prev, [t.tag]: e.target.value }))}
                      placeholder={t.defaultLabel}
                      className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      title={`Label shown in the composer picker chip. Defaults to '${t.defaultLabel}'.`}
                    />
                    {labelOverrides[t.tag] && (
                      <button
                        type="button"
                        onClick={() => setLabelOverrides(prev => { const n = { ...prev }; delete n[t.tag]; return n })}
                        className="text-[11px] text-gray-500 hover:text-gray-900 underline shrink-0"
                        title="Reset label to default"
                      >reset</button>
                    )}
                    <div className="flex-1 text-xs min-w-0">
                      <span className="text-slate-400 mr-1">→</span>
                      <span className="inline-block max-w-full truncate align-middle" title={typeof samplePreview === 'string' ? samplePreview : undefined}>
                        {isServer
                          ? <span dangerouslySetInnerHTML={{ __html: samplePreview }} />
                          : <span className="text-slate-700 dark:text-gray-300">{samplePreview}</span>}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="mt-4 p-3 rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50/40 dark:bg-gray-900/30">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Server link anchor text</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">The clickable text recipients see when a server-resolved link is rendered into the email body.</p>
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 shrink-0">{`{{withdraw_link}}`}</code>
              <input
                type="text"
                value={withdrawAnchor}
                onChange={e => setWithdrawAnchor(e.target.value)}
                placeholder={SETTINGS_DEFAULTS.withdrawLinkAnchor}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 shrink-0">{`{{event_optout_link}}`}</code>
              <input
                type="text"
                value={optoutAnchor}
                onChange={e => setOptoutAnchor(e.target.value)}
                placeholder={SETTINGS_DEFAULTS.eventOptoutLinkAnchor}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 shrink-0">{`{{apply_link}}`}</code>
              <input
                type="text"
                value={applyAnchor}
                onChange={e => setApplyAnchor(e.target.value)}
                placeholder={SETTINGS_DEFAULTS.applyLinkAnchor}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 shrink-0">{`{{portal_link}}`}</code>
              <input
                type="text"
                value={portalAnchor}
                onChange={e => setPortalAnchor(e.target.value)}
                placeholder={SETTINGS_DEFAULTS.portalLinkAnchor}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-[11px] font-mono text-slate-600 dark:text-gray-400 w-44 shrink-0">{`{{rsvp_link}}`}</code>
              <input
                type="text"
                value={rsvpAnchor}
                onChange={e => setRsvpAnchor(e.target.value)}
                placeholder={SETTINGS_DEFAULTS.rsvpLinkAnchor}
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              />
            </div>
          </div>
        </div>
      </div>

      <SaveBar saving={saving} onSave={save} saved={saved} error={error} />
    </Card>
  )
}

// Resolve a sample recipient-side preview for each tag, using the current
// format + anchor settings. Returns string for plain tags, HTML string for
// server-resolved anchors (rendered via dangerouslySetInnerHTML by caller).
function recipientPreview(tag: string, opts: { dateFmt: string; timeFmt: string; openToFmt: string; withdrawAnchor: string; optoutAnchor: string; applyAnchor: string; portalAnchor: string; rsvpAnchor: string }): string {
  const SAMPLE_NAME = 'Tenzin'
  const SAMPLE_LAST = 'Pham'
  const SAMPLE_EVENT = 'Step Inside: Man Group'
  const SAMPLE_DATE_ISO = '2026-07-27'
  const ANCHOR_STYLE = 'color:#1d4ed8;text-decoration:underline;font-weight:600'
  switch (tag) {
    case 'first_name': return SAMPLE_NAME
    case 'last_name': return SAMPLE_LAST
    case 'full_name': return `${SAMPLE_NAME} ${SAMPLE_LAST}`
    case 'last_attended_event': return 'Step Inside: Microsoft'
    case 'event_name': return SAMPLE_EVENT
    case 'event_date': return formatMergeDate(SAMPLE_DATE_ISO, opts.dateFmt as DateFormatKey)
    case 'event_time': return formatMergeTime('16:00', '17:30', opts.timeFmt as TimeFormatKey)
    case 'event_location': return 'Central London'
    case 'event_format': return 'in person'
    case 'event_dress_code':
    case 'dress_code': return 'Smart casual'
    case 'open_to': return formatMergeOpenTo([12, 13], false, opts.openToFmt as OpenToFormatKey)
    case 'application_deadline': return `${formatMergeDate(SAMPLE_DATE_ISO, opts.dateFmt as DateFormatKey)} at ${formatMergeTime('23:59', null, opts.timeFmt as TimeFormatKey)}`
    case 'apply_link': return `<a href="#preview" style="${ANCHOR_STYLE}">${escapeHtml(opts.applyAnchor || 'Application Link')}</a>`
    case 'portal_link': return `<a href="#preview" style="${ANCHOR_STYLE}">${escapeHtml(opts.portalAnchor || 'Student Hub')}</a>`
    case 'rsvp_link': return `<a href="#preview" style="${ANCHOR_STYLE}">${escapeHtml(opts.rsvpAnchor || 'RSVP')}</a>`
    case 'withdraw_link': return `<a href="#preview" style="${ANCHOR_STYLE}">${escapeHtml(opts.withdrawAnchor || 'Withdraw link')}</a>`
    case 'event_optout_link': return `<a href="#preview" style="${ANCHOR_STYLE}">${escapeHtml(opts.optoutAnchor || 'Opt out of further emails about this event')}</a>`
    default: return ''
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function FormatSelector({ label, hint, options, value, onChange }: {
  label: string
  hint: string
  options: { value: string; label: string; sample: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const selected = options.find(o => o.value === value)
  return (
    <div className="mb-6 last:mb-0">
      <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{label}</label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{hint}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-md px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {selected && (
        <p className="mt-2 text-xs text-slate-600 dark:text-gray-400">Preview: <span className="font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-gray-800">{selected.sample}</span></p>
      )}
    </div>
  )
}

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
