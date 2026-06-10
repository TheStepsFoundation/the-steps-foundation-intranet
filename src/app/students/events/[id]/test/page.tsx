'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PromptContent, OptionContent } from '@/components/TestRunner'

// ---------------------------------------------------------------------------
// /students/events/[id]/test — admin view for an event's selection test.
//
// Everything here uses the ADMIN client: RLS on the test tables is
// is_admin()-only, so wider members see empty data (same posture as
// /students). Four cards: settings, the student link, the invite list
// (explicit allow-list), and live results (with admin-only void/retake).
// Questions are read-only here (seeded via migration; edit via SQL for now).
// ---------------------------------------------------------------------------

type TestRow = {
  id: string
  event_id: string
  title: string
  status: 'draft' | 'open' | 'closed'
  duration_seconds: number
  opens_at: string | null
  closes_at: string | null
  video_url: string | null
  instructions: string | null
}

type ApplicantRow = {
  application_id: string
  student_id: string
  name: string
  email: string | null
  status: string
  internal: string | null
}

type AttemptRow = {
  id: string
  student_id: string | null
  team_email: string | null
  kind: 'student' | 'team'
  status: string
  started_at: string
  submitted_at: string | null
  deadline_at: string
  score: number | null
  correct_count: number | null
  answered_count: number
  current_index: number
  question_order: string[]
}

type QuestionRow = {
  id: string
  position: number
  difficulty: number
  category: string
  prompt: string
  options: string[]
  correct_index: number
  is_practice: boolean
  active: boolean
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—'
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const STATUS_BADGE: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700',
  submitted: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-amber-100 text-amber-700',
  voided: 'bg-gray-100 text-gray-500',
}

export default function EventTestAdminPage() {
  const params = useParams<{ id: string }>()
  const eventId = params?.id ?? ''

  const [event, setEvent] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [test, setTest] = useState<TestRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [creating, setCreating] = useState(false)

  // settings draft
  const [draft, setDraft] = useState<Partial<TestRow>>({})

  const [applicants, setApplicants] = useState<ApplicantRow[]>([])
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [showInvitedOnly, setShowInvitedOnly] = useState(false)

  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [studentNames, setStudentNames] = useState<Record<string, { name: string; email: string | null }>>({})
  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [showQuestions, setShowQuestions] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!eventId) return
    const { data: ev } = await supabase.from('events').select('id, name, slug').eq('id', eventId).maybeSingle()
    setEvent(ev ?? null)
    const { data: t } = await supabase
      .from('tests')
      .select('id, event_id, title, status, duration_seconds, opens_at, closes_at, video_url, instructions')
      .eq('event_id', eventId)
      .maybeSingle()
    setTest((t as TestRow | null) ?? null)
    if (t) {
      setDraft(t as TestRow)
      const [{ data: inv }, { data: att }, { data: qs }] = await Promise.all([
        supabase.from('test_invitations').select('student_id').eq('test_id', t.id),
        supabase.from('test_attempts')
          .select('id, student_id, team_email, kind, status, started_at, submitted_at, deadline_at, score, correct_count, answered_count, current_index, question_order')
          .eq('test_id', t.id)
          .order('score', { ascending: false, nullsFirst: false }),
        supabase.from('test_questions')
          .select('id, position, difficulty, category, prompt, options, correct_index, is_practice, active')
          .eq('test_id', t.id)
          .order('is_practice')
          .order('position'),
      ])
      setInvited(new Set((inv ?? []).map(r => r.student_id)))
      setAttempts((att ?? []) as AttemptRow[])
      setQuestions((qs ?? []) as QuestionRow[])
    }
    // applicants for the invite list
    const { data: apps } = await supabase
      .from('applications')
      .select('id, student_id, status, internal_review_status, students!inner(first_name, last_name, preferred_name, personal_email)')
      .eq('event_id', eventId)
      .is('deleted_at', null)
    const rows: ApplicantRow[] = (apps ?? []).map((a: any) => ({
      application_id: a.id,
      student_id: a.student_id,
      name: `${a.students?.preferred_name || a.students?.first_name || ''} ${a.students?.last_name || ''}`.trim() || 'Unknown',
      email: a.students?.personal_email ?? null,
      status: a.status,
      internal: a.internal_review_status,
    }))
    rows.sort((x, y) => x.name.localeCompare(y.name))
    setApplicants(rows)
    setLoaded(true)
  }, [eventId])

  useEffect(() => { void load() }, [load])

  const createTest = async () => {
    if (!event || creating) return
    setCreating(true)
    await supabase.from('tests').insert({ event_id: event.id, title: `${event.name} Selection Test`, status: 'draft' })
    await load()
    setCreating(false)
  }

  const saveSettings = async () => {
    if (!test || saving) return
    setSaving(true)
    const patch = {
      title: draft.title ?? test.title,
      status: draft.status ?? test.status,
      duration_seconds: draft.duration_seconds ?? test.duration_seconds,
      opens_at: draft.opens_at ?? null,
      closes_at: draft.closes_at ?? null,
      video_url: (draft.video_url ?? '') || null,
      instructions: (draft.instructions ?? '') || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('tests').update(patch).eq('id', test.id)
    if (!error) {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
      await load()
    }
    setSaving(false)
  }

  const setInvitedFor = async (studentIds: string[], on: boolean) => {
    if (!test || inviteBusy || studentIds.length === 0) return
    setInviteBusy(true)
    if (on) {
      const { data: u } = await supabase.auth.getUser()
      const rows = studentIds.map(sid => ({ test_id: test.id, student_id: sid, invited_by: u?.user?.id ?? null }))
      await supabase.from('test_invitations').upsert(rows, { onConflict: 'test_id,student_id', ignoreDuplicates: true })
    } else {
      await supabase.from('test_invitations').delete().eq('test_id', test.id).in('student_id', studentIds)
    }
    const { data: inv } = await supabase.from('test_invitations').select('student_id').eq('test_id', test.id)
    setInvited(new Set((inv ?? []).map(r => r.student_id)))
    setInviteBusy(false)
  }

  const voidAttempt = async (attemptId: string) => {
    if (!window.confirm('Void this attempt? The student will be able to take the test again from scratch. This cannot be undone.')) return
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('test_attempts')
      .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: u?.user?.id ?? null })
      .eq('id', attemptId)
    await load()
  }

  // names for attempts
  useEffect(() => {
    const ids = [...new Set(attempts.map(a => a.student_id).filter(Boolean))] as string[]
    if (ids.length === 0) { setStudentNames({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('students')
        .select('id, first_name, last_name, preferred_name, personal_email')
        .in('id', ids)
      if (cancelled) return
      const map: Record<string, { name: string; email: string | null }> = {}
      for (const s of data ?? []) {
        map[s.id] = {
          name: `${s.preferred_name || s.first_name || ''} ${s.last_name || ''}`.trim() || 'Unknown',
          email: s.personal_email,
        }
      }
      setStudentNames(map)
    })()
    return () => { cancelled = true }
  }, [attempts])

  const studentLink = event ? `${typeof window !== 'undefined' ? window.location.origin : ''}/my/test/${event.slug}` : ''
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(studentLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  const visibleApplicants = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase()
    return applicants.filter(a => {
      if (showInvitedOnly && !invited.has(a.student_id)) return false
      if (!q) return true
      return a.name.toLowerCase().includes(q) || (a.email ?? '').toLowerCase().includes(q)
    })
  }, [applicants, inviteSearch, invited, showInvitedOnly])

  const nonRejectedIds = useMemo(
    () => applicants.filter(a => !['rejected', 'withdrew', 'ineligible'].includes(a.status)).map(a => a.student_id),
    [applicants],
  )

  const studentAttempts = attempts.filter(a => a.kind === 'student' && a.status !== 'voided')
  const voidedAttempts = attempts.filter(a => a.kind === 'student' && a.status === 'voided')
  const teamAttempts = attempts.filter(a => a.kind === 'team')

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-steps-blue-600" />
        <span className="sr-only">Loading test…</span>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/students/events/${eventId}`} className="text-sm text-steps-blue-600 hover:text-steps-blue-700 font-medium">
            ← Back to {event?.name ?? 'event'}
          </Link>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            Selection test
          </h1>
        </div>
        {test && (
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={`/my/test/${event?.slug ?? ''}?preview=admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-steps-blue-600 text-white hover:bg-steps-blue-700 transition-colors"
              title="Open the exact student experience (intro, warm-ups, timed runner) in a new tab — runs in practice mode under an admin-preview banner, never linked to applicants"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              Preview as a student
            </a>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              test.status === 'open' ? 'bg-emerald-100 text-emerald-700'
              : test.status === 'closed' ? 'bg-gray-200 text-gray-600'
              : 'bg-amber-100 text-amber-700'
            }`}>
              {test.status === 'draft' ? 'Draft — not visible to students' : test.status === 'open' ? 'Open' : 'Closed'}
            </span>
          </div>
        )}
      </div>

      {!test && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-gray-600 dark:text-gray-300 mb-4">This event has no selection test yet.</p>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createTest()}
            className="px-4 py-2 rounded-lg bg-steps-blue-600 text-white text-sm font-medium hover:bg-steps-blue-700 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create a test for this event'}
          </button>
          <p className="text-xs text-gray-400 mt-3">It starts as a draft with no questions — add questions before opening it.</p>
        </div>
      )}

      {test && (
        <>
          {/* ── Settings ─────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Settings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Title</span>
                <input
                  type="text"
                  value={draft.title ?? ''}
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Status</span>
                <select
                  value={draft.status ?? 'draft'}
                  onChange={e => setDraft(d => ({ ...d, status: e.target.value as TestRow['status'] }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                >
                  <option value="draft">Draft (hidden from students)</option>
                  <option value="open">Open (invited students can take it)</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Duration (minutes)</span>
                <input
                  type="number" min={1} max={120}
                  value={Math.round((draft.duration_seconds ?? 900) / 60)}
                  onChange={e => setDraft(d => ({ ...d, duration_seconds: Math.max(1, Number(e.target.value) || 15) * 60 }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Briefing video URL (optional)</span>
                <input
                  type="url" placeholder="https://youtu.be/…"
                  value={draft.video_url ?? ''}
                  onChange={e => setDraft(d => ({ ...d, video_url: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Opens at (optional — bounds the window while status is Open)</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.opens_at ?? null)}
                  onChange={e => setDraft(d => ({ ...d, opens_at: fromLocalInput(e.target.value) }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Closes at (optional)</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.closes_at ?? null)}
                  onChange={e => setDraft(d => ({ ...d, closes_at: fromLocalInput(e.target.value) }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-gray-500">Instructions shown to students</span>
                <textarea
                  rows={4}
                  value={draft.instructions ?? ''}
                  onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveSettings()}
                className="px-4 py-1.5 rounded-lg bg-steps-blue-600 text-white text-sm font-medium hover:bg-steps-blue-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              {savedFlash && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
            </div>
          </div>

          {/* ── Student link ─────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Student link</h2>
            <p className="text-xs text-gray-500 mb-3">
              Send this in your invite email. Students sign in to the student hub; only invited accounts can start the test.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 break-all">{studentLink}</code>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <a href={`/my/test/${event?.slug ?? ''}?preview=admin`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-steps-blue-600 hover:text-steps-blue-700">
                Preview as a student →
              </a>
              <Link href="/hub/test" className="text-sm font-medium text-steps-blue-600 hover:text-steps-blue-700">
                Practice with scores (hub) →
              </Link>
            </div>
          </div>

          {/* ── Invitations ──────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Invitations <span className="font-normal text-gray-400">— {invited.size} invited</span>
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={inviteBusy}
                  onClick={() => void setInvitedFor(nonRejectedIds, true)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                >
                  Invite all non-rejected ({nonRejectedIds.length})
                </button>
                <button
                  type="button"
                  disabled={inviteBusy || invited.size === 0}
                  onClick={() => { if (window.confirm('Remove ALL invitations?')) void setInvitedFor([...invited], false) }}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                >
                  Remove all
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="search"
                placeholder="Search applicants…"
                value={inviteSearch}
                onChange={e => setInviteSearch(e.target.value)}
                className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5"
              />
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={showInvitedOnly} onChange={e => setShowInvitedOnly(e.target.checked)} />
                Invited only
              </label>
            </div>
            <div className="max-h-80 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {visibleApplicants.length === 0 && (
                <p className="text-sm text-gray-400 p-4">No applicants match.</p>
              )}
              {visibleApplicants.map(a => {
                const isInvited = invited.has(a.student_id)
                return (
                  <div key={a.application_id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{a.name}</div>
                      <div className="text-xs text-gray-400 truncate">{a.email ?? '—'} · {a.status}{a.internal ? ` · marked ${a.internal}` : ''}</div>
                    </div>
                    <button
                      type="button"
                      disabled={inviteBusy}
                      onClick={() => void setInvitedFor([a.student_id], !isInvited)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60 ${
                        isInvited
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {isInvited ? 'Invited ✓' : 'Invite'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Results ──────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Results <span className="font-normal text-gray-400">— {studentAttempts.filter(a => a.status !== 'in_progress').length} completed, {studentAttempts.filter(a => a.status === 'in_progress').length} in progress</span>
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Score = questions answered correctly (no guessing penalty). Accuracy and questions reached are the tiebreakers.
              Scores also appear in the applicants table on the event page.
            </p>
            {studentAttempts.length === 0 ? (
              <p className="text-sm text-gray-400">No attempts yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">Student</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                      <th className="py-2 pr-3 font-medium">Answered</th>
                      <th className="py-2 pr-3 font-medium">Accuracy</th>
                      <th className="py-2 pr-3 font-medium">Time used</th>
                      <th className="py-2 pr-3 font-medium">Started</th>
                      <th className="py-2 pr-0 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {studentAttempts.map((a, i) => {
                      const who = a.student_id ? studentNames[a.student_id] : null
                      const acc = a.answered_count > 0 && a.correct_count !== null
                        ? `${Math.round((a.correct_count / a.answered_count) * 100)}%` : '—'
                      return (
                        <tr key={a.id}>
                          <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                          <td className="py-2 pr-3">
                            <div className="text-gray-900 dark:text-gray-100">{who?.name ?? '…'}</div>
                            <div className="text-xs text-gray-400">{who?.email ?? ''}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {a.status === 'in_progress' ? 'in progress' : a.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                            {a.status === 'in_progress' ? '—' : a.score ?? 0}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-300">
                            {a.status === 'in_progress' ? `${a.current_index}/${a.question_order.length} reached` : `${a.answered_count}/${a.question_order.length}`}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{a.status === 'in_progress' ? '—' : acc}</td>
                          <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{fmtDuration(a.started_at, a.submitted_at)}</td>
                          <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{fmtWhen(a.started_at)}</td>
                          <td className="py-2 pr-0 text-right">
                            <button
                              type="button"
                              onClick={() => void voidAttempt(a.id)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                              title="Void this attempt so the student can retake (tech-failure override)"
                            >
                              Void
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {voidedAttempts.length > 0 && (
              <p className="text-xs text-gray-400 mt-3">{voidedAttempts.length} voided attempt{voidedAttempts.length === 1 ? '' : 's'} hidden.</p>
            )}
            {teamAttempts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <h3 className="text-xs font-semibold text-gray-500 mb-2">Team practice runs (not applicants)</h3>
                <div className="flex flex-wrap gap-2">
                  {teamAttempts.map(a => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300">
                      {a.team_email} · {a.status === 'in_progress' ? 'in progress' : `${a.score ?? 0} pts`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Question bank (read-only) ────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <button
              type="button"
              onClick={() => setShowQuestions(s => !s)}
              className="w-full flex items-center justify-between text-left"
            >
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Question bank <span className="font-normal text-gray-400">— {questions.filter(q => !q.is_practice && q.active).length} live, {questions.filter(q => q.is_practice).length} practice</span>
              </h2>
              <span className="text-gray-400 text-sm">{showQuestions ? 'Hide' : 'Show'}</span>
            </button>
            {showQuestions && (
              <div className="mt-4 space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                  Answers are visible here (admins only — students can never fetch them). Don&apos;t screen-share this card.
                </p>
                {questions.map(q => (
                  <div key={q.id} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                      <span>#{q.position}</span>
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{q.category}</span>
                      <span>{q.difficulty === 1 ? 'easy' : q.difficulty === 2 ? 'medium' : 'hard'}</span>
                      {q.is_practice && <span className="text-steps-blue-600 font-medium">practice</span>}
                      {!q.active && <span className="text-red-500 font-medium">inactive</span>}
                    </div>
                    <PromptContent text={q.prompt} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5" />
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((opt, i) => (
                        <span key={i} className={`text-xs px-2 py-0.5 border ${opt.includes('<svg') ? 'rounded-lg' : 'rounded-full'} ${
                          i === q.correct_index
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-medium'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500'
                        }`}>
                          {String.fromCharCode(65 + i)}. <OptionContent opt={opt} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
