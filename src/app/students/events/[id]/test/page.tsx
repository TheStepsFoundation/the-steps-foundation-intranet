'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import MetaLine from '@/components/MetaLine'
import Badge, { type BadgeTone } from '@/components/Badge'
import { effectiveTestStatusRow } from '@/lib/test-client'
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

type AnswerRow = {
  attempt_id: string
  question_id: string
  selected_index: number | null
  is_correct: boolean | null
  time_ms: number | null
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

// Attempt-status tones for the shared <Badge/> (the house status style).
const STATUS_TONE: Record<string, BadgeTone> = {
  in_progress: 'blue',
  submitted: 'emerald',
  expired: 'amber',
  voided: 'neutral',
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
  // Lightweight feedback + safety chrome (replaces window.confirm/alert):
  // toast = transient confirmation after an action; confirmAction = modal
  // describing exactly what a destructive click will do before it does it.
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    body: string
    confirmLabel: string
    run: () => void | Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  // Per-attempt audit modal + question analytics (lazy-loaded answers)
  const [auditAttempt, setAuditAttempt] = useState<AttemptRow | null>(null)
  const [auditAnswers, setAuditAnswers] = useState<AnswerRow[] | null>(null)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [allAnswers, setAllAnswers] = useState<AnswerRow[] | null>(null)
  const [answersLoading, setAnswersLoading] = useState(false)
  const [analyticsSort, setAnalyticsSort] = useState<'wrong' | 'skipped' | 'slowest' | 'position'>('wrong')
  // null = auto: team practice runs count while there are no real student
  // attempts (so the team can sanity-check the bank), then drop out.
  const [analyticsIncludeTeam, setAnalyticsIncludeTeam] = useState<boolean | null>(null)
  const [expandedAnalyticsQ, setExpandedAnalyticsQ] = useState<string | null>(null)
  // Results table controls
  const [resultSearch, setResultSearch] = useState('')
  // Multi-select for bulk void/delete on the results table.
  const [selectedAttempts, setSelectedAttempts] = useState<Set<string>>(new Set())
  // Synced horizontal scrollbar pinned to the viewport bottom — the table is
  // wider than the card on most screens and its native scrollbar lives below
  // a long list, so the actions column was effectively unreachable.
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  const resultsBarRef = useRef<HTMLDivElement | null>(null)
  const [resultsBar, setResultsBar] = useState<{ left: number; width: number; scrollWidth: number } | null>(null)
  const [resultSort, setResultSort] = useState<{ key: 'name' | 'status' | 'score' | 'answered' | 'accuracy' | 'started'; dir: 'asc' | 'desc' } | null>(null)
  // Team practice runs use the same database-view conventions (sortable
  // headers, one row per run) as every other data table on the site.
  const [teamSort, setTeamSort] = useState<{ key: 'member' | 'status' | 'score' | 'answered' | 'accuracy' | 'time' | 'started'; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' })
  const [studentNames, setStudentNames] = useState<Record<string, { name: string; email: string | null }>>({})
  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [showQuestions, setShowQuestions] = useState(false)
  const [qCategory, setQCategory] = useState('all')
  const [qSort, setQSort] = useState<'number' | 'easiest' | 'hardest'>('number')
  const [qShowInactive, setQShowInactive] = useState(false)
  const qCategories = useMemo(
    () => Array.from(new Set(questions.map(q => q.category))).sort(),
    [questions],
  )
  const visibleQuestions = useMemo(() => {
    let list = qShowInactive ? questions : questions.filter(q => q.active)
    if (qCategory !== 'all') list = list.filter(q => q.category === qCategory)
    const out = [...list]
    // 'number' keeps fetch order (practice last, then by position)
    if (qSort === 'easiest') out.sort((a, b) => a.difficulty - b.difficulty || Number(a.is_practice) - Number(b.is_practice) || a.position - b.position)
    if (qSort === 'hardest') out.sort((a, b) => b.difficulty - a.difficulty || Number(a.is_practice) - Number(b.is_practice) || a.position - b.position)
    return out
  }, [questions, qCategory, qSort, qShowInactive])
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

  const voidAttempt = async (attemptId: string, studentName?: string) => {
    setConfirmAction({
      title: 'Void this attempt?',
      body: `${studentName ?? 'The student'} will be able to take the test again from scratch — use this only for genuine technical failures. The voided attempt stays in the database but disappears from results. This cannot be undone.`,
      confirmLabel: 'Void attempt',
      run: async () => {
        const { data: u } = await supabase.auth.getUser()
        await supabase.from('test_attempts')
          .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: u?.user?.id ?? null })
          .eq('id', attemptId)
        await load()
        setAllAnswers(null)   // analytics excludes voided attempts — recrunch
        showToast(`Attempt voided — ${studentName ?? 'the student'} can retake the test.`)
      },
    })
  }

  /** Hard delete: the attempt row AND its answers (FK cascade) are gone for
   *  good. Unlike voiding there is no trace left; a student gets a fresh
   *  attempt either way. Main use: clearing practice clutter / test data. */
  const deleteAttempt = async (a: AttemptRow, name?: string | null) => {
    const label = name ?? a.team_email ?? 'this attempt'
    setConfirmAction({
      title: 'Delete this attempt?',
      body: `${label}'s attempt and every recorded answer will be permanently deleted — unlike voiding, nothing is kept for the audit trail${a.kind === 'student' ? ', and they will be able to start a fresh attempt' : ''}. This cannot be undone.`,
      confirmLabel: 'Delete attempt',
      run: async () => {
        const { error } = await supabase.from('test_attempts').delete().eq('id', a.id)
        if (error) { window.alert(`Delete failed: ${error.message}`); return }
        await load()
        setAllAnswers(null)
        showToast(`Attempt deleted — ${label}.`)
      },
    })
  }

  const deleteVoidedAttempts = async (ids: string[]) => {
    setConfirmAction({
      title: `Delete ${ids.length} voided attempt${ids.length === 1 ? '' : 's'}?`,
      body: 'Voided attempts are already hidden from results and grant nothing — deleting them just removes the rows and their answers permanently. This cannot be undone.',
      confirmLabel: `Delete ${ids.length} voided`,
      run: async () => {
        const { error } = await supabase.from('test_attempts').delete().in('id', ids)
        if (error) { window.alert(`Delete failed: ${error.message}`); return }
        await load()
        setAllAnswers(null)
        showToast(`Deleted ${ids.length} voided attempt${ids.length === 1 ? '' : 's'}.`)
      },
    })
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

  // All answers across non-voided student attempts — powers the question
  // analytics. Paginated reads: supabase caps a select at 1000 rows and a
  // full cohort can produce ~6000 (100 students × 60 questions).
  const loadAllAnswers = useCallback(async () => {
    if (answersLoading) return
    setAnswersLoading(true)
    try {
      const ids = attempts.filter(a => a.status !== 'voided').map(a => a.id)
      if (ids.length === 0) { setAllAnswers([]); return }
      const rows: AnswerRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('test_answers')
          .select('attempt_id, question_id, selected_index, is_correct, time_ms')
          .in('attempt_id', ids)
          .range(from, from + 999)
        if (error) { console.error('loadAllAnswers:', error); break }
        rows.push(...((data ?? []) as AnswerRow[]))
        if (!data || data.length < 1000) break
      }
      setAllAnswers(rows)
    } finally {
      setAnswersLoading(false)
    }
  }, [attempts, answersLoading])

  const openAudit = async (a: AttemptRow) => {
    setAuditAttempt(a)
    setAuditAnswers(null)
    const { data, error } = await supabase
      .from('test_answers')
      .select('attempt_id, question_id, selected_index, is_correct, time_ms')
      .eq('attempt_id', a.id)
    if (error) { console.error('openAudit:', error); setAuditAnswers([]); return }
    setAuditAnswers((data ?? []) as AnswerRow[])
  }

  const questionById = useMemo(() => {
    const m: Record<string, QuestionRow> = {}
    for (const q of questions) m[q.id] = q
    return m
  }, [questions])

  // Per-question aggregates: reached (has an answers row), skipped
  // (selected_index null), % wrong among real answers, average time.
  const hasStudentAttempts = attempts.some(a => a.kind === 'student' && a.status !== 'voided')
  const includeTeamRuns = analyticsIncludeTeam ?? !hasStudentAttempts

  const analytics = useMemo(() => {
    if (!allAnswers) return null
    const allowed = new Set(
      attempts
        .filter(a => a.status !== 'voided' && (a.kind === 'student' || includeTeamRuns))
        .map(a => a.id),
    )
    const agg: Record<string, { reached: number; skipped: number; answered: number; correct: number; timeSum: number; timeN: number }> = {}
    for (const r of allAnswers) {
      if (!allowed.has(r.attempt_id)) continue
      const a = (agg[r.question_id] ??= { reached: 0, skipped: 0, answered: 0, correct: 0, timeSum: 0, timeN: 0 })
      a.reached += 1
      if (r.selected_index === null) a.skipped += 1
      else {
        a.answered += 1
        if (r.is_correct) a.correct += 1
      }
      if (r.time_ms !== null) { a.timeSum += r.time_ms; a.timeN += 1 }
    }
    const rows = Object.entries(agg)
      .map(([qid, a]) => ({
        q: questionById[qid],
        qid,
        reached: a.reached,
        skipped: a.skipped,
        skipRate: a.reached > 0 ? a.skipped / a.reached : 0,
        answered: a.answered,
        correct: a.correct,
        wrongRate: a.answered > 0 ? 1 - a.correct / a.answered : 0,
        avgTimeMs: a.timeN > 0 ? a.timeSum / a.timeN : null,
      }))
      .filter(r => r.q && !r.q.is_practice)
    rows.sort((x, y) => {
      if (analyticsSort === 'wrong') return (y.answered > 0 ? y.wrongRate : -1) - (x.answered > 0 ? x.wrongRate : -1) || y.answered - x.answered
      if (analyticsSort === 'skipped') return y.skipRate - x.skipRate || y.skipped - x.skipped
      if (analyticsSort === 'slowest') return (y.avgTimeMs ?? -1) - (x.avgTimeMs ?? -1)
      return (x.q!.position ?? 0) - (y.q!.position ?? 0)
    })
    return rows
  }, [allAnswers, attempts, includeTeamRuns, questionById, analyticsSort])

  const fmtMs = (ms: number | null | undefined) => ms == null ? '—' : ms < 1000 ? `${(ms / 1000).toFixed(1)}s` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`

  // Measure the results table for the pinned scrollbar (and re-measure on
  // resize / when rows change).
  useEffect(() => {
    const measure = () => {
      const e = resultsScrollRef.current
      if (!e) { setResultsBar(null); return }
      const r = e.getBoundingClientRect()
      setResultsBar(e.scrollWidth > e.clientWidth + 2 ? { left: r.left, width: e.clientWidth, scrollWidth: e.scrollWidth } : null)
    }
    measure()
    const t = setTimeout(measure, 100)
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure); clearTimeout(t) }
  }, [attempts, resultSearch, loaded])

  const bulkVoidAttempts = (ids: string[]) => {
    setConfirmAction({
      title: `Void ${ids.length} attempt${ids.length === 1 ? '' : 's'}?`,
      body: 'Each student will be able to take the test again from scratch — use this only for genuine technical failures. Voided attempts stay in the database but disappear from results. This cannot be undone.',
      confirmLabel: `Void ${ids.length}`,
      run: async () => {
        const { data: u } = await supabase.auth.getUser()
        const { error } = await supabase.from('test_attempts')
          .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: u?.user?.id ?? null })
          .in('id', ids)
        if (error) { window.alert(`Void failed: ${error.message}`); return }
        await load()
        setAllAnswers(null)
        setSelectedAttempts(new Set())
        showToast(`Voided ${ids.length} attempt${ids.length === 1 ? '' : 's'}.`)
      },
    })
  }

  const bulkDeleteAttempts = (ids: string[]) => {
    setConfirmAction({
      title: `Delete ${ids.length} attempt${ids.length === 1 ? '' : 's'}?`,
      body: 'The attempts and every recorded answer will be permanently deleted — unlike voiding, nothing is kept, and the students can start fresh attempts. This cannot be undone.',
      confirmLabel: `Delete ${ids.length}`,
      run: async () => {
        const { error } = await supabase.from('test_attempts').delete().in('id', ids)
        if (error) { window.alert(`Delete failed: ${error.message}`); return }
        await load()
        setAllAnswers(null)
        setSelectedAttempts(new Set())
        showToast(`Deleted ${ids.length} attempt${ids.length === 1 ? '' : 's'}.`)
      },
    })
  }

  // Results view: name/email filter + click-to-sort headers.
  const displayAttempts = useMemo(() => {
    const q = resultSearch.trim().toLowerCase()
    let rows = studentAttempts
    if (q) {
      rows = rows.filter(a => {
        const who = a.student_id ? studentNames[a.student_id] : null
        return (who?.name ?? '').toLowerCase().includes(q) || (who?.email ?? '').toLowerCase().includes(q)
      })
    }
    if (!resultSort) return rows
    const { key, dir } = resultSort
    const mul = dir === 'asc' ? 1 : -1
    const val = (a: AttemptRow): string | number => {
      switch (key) {
        case 'name': return (a.student_id ? studentNames[a.student_id]?.name ?? '' : '').toLowerCase()
        case 'status': return a.status
        case 'score': return a.status === 'in_progress' ? -1 : Number(a.score ?? 0)
        case 'answered': return a.status === 'in_progress' ? a.current_index : a.answered_count
        case 'accuracy': return a.answered_count > 0 && a.correct_count !== null ? a.correct_count / a.answered_count : -1
        case 'started': return new Date(a.started_at).getTime()
      }
    }
    return [...rows].sort((x, y) => { const a = val(x); const b = val(y); return a < b ? -mul : a > b ? mul : 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, studentNames, resultSearch, resultSort])

  const sortableTh = (key: NonNullable<typeof resultSort>['key'], label: string) => {
    const active = resultSort?.key === key
    return (
      <th className="py-2 pr-3 font-medium">
        <button
          type="button"
          onClick={() => setResultSort(prev => prev?.key === key ? (prev.dir === 'desc' ? { key, dir: 'asc' } : null) : { key, dir: key === 'name' || key === 'status' ? 'asc' : 'desc' })}
          className={`inline-flex items-center gap-0.5 hover:text-gray-600 dark:hover:text-gray-200 ${active ? 'text-gray-700 dark:text-gray-200' : ''}`}
          title="Sort"
        >
          {label}
          <span aria-hidden="true" className={active ? '' : 'opacity-30'}>{active ? (resultSort?.dir === 'asc' ? '\u25B4' : '\u25BE') : '\u25BE'}</span>
        </button>
      </th>
    )
  }

  const sortedTeamAttempts = useMemo(() => {
    const acc = (a: AttemptRow) => (a.answered_count > 0 && a.correct_count !== null) ? a.correct_count / a.answered_count : -1
    const timeUsed = (a: AttemptRow) => a.submitted_at ? new Date(a.submitted_at).getTime() - new Date(a.started_at).getTime() : -1
    const val = (a: AttemptRow): string | number => {
      switch (teamSort.key) {
        case 'member': return (a.team_email ?? '').toLowerCase()
        case 'status': return a.status
        case 'score': return a.status === 'in_progress' ? -1 : Number(a.score ?? 0)
        case 'answered': return a.answered_count
        case 'accuracy': return a.status === 'in_progress' ? -1 : acc(a)
        case 'time': return timeUsed(a)
        case 'started': return a.started_at
      }
    }
    const mul = teamSort.dir === 'asc' ? 1 : -1
    const rows = attempts.filter(a => a.kind === 'team')
    return [...rows].sort((x, y) => { const a = val(x); const b = val(y); return a < b ? -mul : a > b ? mul : 0 })
  }, [attempts, teamSort])

  const teamTh = (key: typeof teamSort.key, label: string) => {
    const active = teamSort.key === key
    return (
      <th className="py-2 pr-3 font-medium">
        <button
          type="button"
          onClick={() => setTeamSort(prev => prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'member' || key === 'status' ? 'asc' : 'desc' })}
          className={`inline-flex items-center gap-0.5 hover:text-gray-600 dark:hover:text-gray-200 ${active ? 'text-gray-700 dark:text-gray-200' : ''}`}
          title="Sort"
        >
          {label}
          <span aria-hidden="true" className={active ? '' : 'opacity-30'}>{active ? (teamSort.dir === 'asc' ? '\u25B4' : '\u25BE') : '\u25BE'}</span>
        </button>
      </th>
    )
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-steps-blue-600" />
        <span className="sr-only">Loading test…</span>
      </div>
    )
  }

  // Date-aware status drives every badge/banner so the admin view can never
  // contradict what students experience (a draft past opens_at IS open).
  const effStatus = test ? effectiveTestStatusRow(test) : null
  const opensAtLabel = test?.opens_at ? new Date(test.opens_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null

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
            <Badge tone={effStatus === 'open' ? 'emerald' : effStatus === 'closed' ? 'neutral' : 'amber'}>
              {effStatus === 'open'
                ? (test.status === 'draft' ? 'Open (auto-opened)' : 'Open')
                : effStatus === 'closed' ? 'Closed'
                : effStatus === 'scheduled' ? 'Scheduled' : 'Draft — not visible to students'}
            </Badge>
          </div>
        )}
      </div>

      {test && effStatus !== 'open' && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${
          effStatus === 'closed'
            ? 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60'
            : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
        }`}>
          <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${effStatus === 'closed' ? 'text-gray-500' : 'text-amber-600'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div className="text-sm">
            {effStatus === 'scheduled' ? (
              <>
                <p className="font-semibold text-amber-900 dark:text-amber-200">Scheduled — opens automatically{opensAtLabel ? ` on ${opensAtLabel}` : ''}.</p>
                <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">Invited students see a locked preview until then, and can start the moment it opens — no further action needed. To open it early, set <strong>Status</strong> to Open and save.</p>
              </>
            ) : effStatus === 'draft' ? (
              <>
                <p className="font-semibold text-amber-900 dark:text-amber-200">Draft — no open date set, so invited students can&apos;t start it yet.</p>
                <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">Set an <strong>Opens at</strong> date (it will open automatically then) or set <strong>Status</strong> to Open to open immediately, and save.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-gray-800 dark:text-gray-200">This test is closed.</p>
                <p className="text-gray-600 dark:text-gray-400 mt-0.5">Invited students can no longer start or continue it. Re-open it from Settings if someone still needs to sit it.</p>
              </>
            )}
          </div>
        </div>
      )}

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
                  <option value="draft">Draft (invited students see a locked preview; auto-opens at the date below)</option>
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
                <span className="text-xs font-medium text-gray-500">Opens at (auto-opens at this time — or set status to Open to open immediately. Invited students can see a locked preview before then)</span>
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
                  onClick={async () => { await setInvitedFor(nonRejectedIds, true); showToast(`Invited ${nonRejectedIds.length} students.`) }}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                >
                  Invite all non-rejected ({nonRejectedIds.length})
                </button>
                <button
                  type="button"
                  disabled={inviteBusy || invited.size === 0}
                  onClick={() => setConfirmAction({
                    title: 'Remove all invitations?',
                    body: `All ${invited.size} invited students will lose access to the test (anyone mid-attempt keeps their attempt). Their emailed links will stop working until re-invited.`,
                    confirmLabel: `Remove ${invited.size} invitation${invited.size === 1 ? '' : 's'}`,
                    run: async () => {
                      const n = invited.size
                      await setInvitedFor([...invited], false)
                      showToast(`Removed ${n} invitation${n === 1 ? '' : 's'}.`)
                    },
                  })}
                  className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
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
              <p className="text-sm text-gray-400">No attempts yet — they appear here the moment an invited student starts the test.</p>
            ) : (
              <>
                <input
                  type="search"
                  placeholder="Search by name or email…"
                  value={resultSearch}
                  onChange={e => setResultSearch(e.target.value)}
                  className="w-full sm:w-72 text-sm rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-3 py-1.5 mb-3"
                />
                {displayAttempts.length === 0 && (
                  <p className="text-sm text-gray-400 mb-2">No attempts match &quot;{resultSearch}&quot;.</p>
                )}
              <div
                ref={resultsScrollRef}
                onScroll={e => { if (resultsBarRef.current) resultsBarRef.current.scrollLeft = e.currentTarget.scrollLeft }}
                className="overflow-x-auto"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                      <th className="py-2 pr-2 font-medium">
                        <input
                          type="checkbox"
                          aria-label="Select all shown"
                          checked={displayAttempts.length > 0 && displayAttempts.every(a => selectedAttempts.has(a.id))}
                          onChange={e => setSelectedAttempts(e.target.checked ? new Set(displayAttempts.map(a => a.id)) : new Set())}
                        />
                      </th>
                      <th className="py-2 pr-3 font-medium">#</th>
                      {sortableTh('name', 'Student')}
                      {sortableTh('status', 'Status')}
                      {sortableTh('score', 'Score')}
                      {sortableTh('answered', 'Answered')}
                      {sortableTh('accuracy', 'Accuracy')}
                      <th className="py-2 pr-3 font-medium">Time used</th>
                      {sortableTh('started', 'Started')}
                      <th className="py-2 pr-2 pl-2 font-medium sticky right-0 bg-white dark:bg-gray-900"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {displayAttempts.map((a, i) => {
                      const who = a.student_id ? studentNames[a.student_id] : null
                      const acc = a.answered_count > 0 && a.correct_count !== null
                        ? `${Math.round((a.correct_count / a.answered_count) * 100)}%` : '—'
                      return (
                        <tr
                          key={a.id}
                          onClick={() => void openAudit(a)}
                          className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                          title="Click for the question-by-question breakdown"
                        >
                          <td className="py-2 pr-2" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${who?.name ?? 'attempt'}`}
                              checked={selectedAttempts.has(a.id)}
                              onChange={e => setSelectedAttempts(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(a.id); else next.delete(a.id)
                                return next
                              })}
                            />
                          </td>
                          <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                          <td className="py-2 pr-3">
                            <div className="text-gray-900 dark:text-gray-100">{who?.name ?? '…'}</div>
                            <div className="text-xs text-gray-400">{who?.email ?? ''}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status === 'in_progress' ? 'in progress' : a.status}</Badge>
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
                          <td className="py-2 pr-2 pl-2 text-right sticky right-0 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800/40 transition-colors">
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); void voidAttempt(a.id, who?.name) }}
                                className="text-xs text-red-500 hover:text-red-700 font-medium"
                                title="Void this attempt so the student can retake (tech-failure override) — kept in the database"
                              >
                                Void
                              </button>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); void deleteAttempt(a, who?.name) }}
                                className="text-xs text-gray-400 hover:text-red-700 font-medium"
                                title="Permanently delete this attempt and its answers"
                              >
                                Delete
                              </button>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {voidedAttempts.length > 0 && (
              <p className="text-xs text-gray-400 mt-3">
                {voidedAttempts.length} voided attempt{voidedAttempts.length === 1 ? '' : 's'} hidden.{' '}
                <button
                  type="button"
                  onClick={() => void deleteVoidedAttempts(voidedAttempts.map(a => a.id))}
                  className="text-gray-400 hover:text-red-700 underline underline-offset-2"
                >
                  Delete them permanently
                </button>
              </p>
            )}
            {teamAttempts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <h3 className="text-xs font-semibold text-gray-500 mb-2">Team practice runs (not applicants)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                        <th className="py-2 pr-2 font-medium">
                          <input
                            type="checkbox"
                            aria-label="Select all practice runs"
                            checked={sortedTeamAttempts.length > 0 && sortedTeamAttempts.every(a => selectedAttempts.has(a.id))}
                            onChange={e => setSelectedAttempts(prev => {
                              const next = new Set(prev)
                              for (const a of sortedTeamAttempts) { if (e.target.checked) next.add(a.id); else next.delete(a.id) }
                              return next
                            })}
                          />
                        </th>
                        <th className="py-2 pr-3 font-medium">#</th>
                        {teamTh('member', 'Team member')}
                        {teamTh('status', 'Status')}
                        {teamTh('score', 'Score')}
                        {teamTh('answered', 'Answered')}
                        {teamTh('accuracy', 'Accuracy')}
                        {teamTh('time', 'Time used')}
                        {teamTh('started', 'Started')}
                        <th className="py-2 pr-0 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                      {sortedTeamAttempts.map((a, i) => {
                        const acc = a.answered_count > 0 && a.correct_count !== null
                          ? `${Math.round((a.correct_count / a.answered_count) * 100)}%` : '—'
                        return (
                          <tr
                            key={a.id}
                            onClick={() => void openAudit(a)}
                            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                            title="Click for the question-by-question breakdown"
                          >
                            <td className="py-2 pr-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${a.team_email ?? 'practice run'}`}
                                checked={selectedAttempts.has(a.id)}
                                onChange={e => setSelectedAttempts(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(a.id); else next.delete(a.id)
                                  return next
                                })}
                              />
                            </td>
                            <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                            <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">{a.team_email}</td>
                            <td className="py-2 pr-3">
                              <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status === 'in_progress' ? 'in progress' : a.status}</Badge>
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
                                onClick={e => { e.stopPropagation(); void deleteAttempt(a, a.team_email) }}
                                className="text-xs text-gray-400 hover:text-red-700 font-medium"
                                title="Permanently delete this practice run"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Question analytics (aggregate, lazy-loaded) ──────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <button
              type="button"
              onClick={() => { if (!showAnalytics && allAnswers === null) void loadAllAnswers(); setShowAnalytics(v => !v) }}
              className="w-full flex items-center justify-between text-left"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Question analytics <span className="font-normal text-gray-400">— how the bank performed across all attempts</span>
              </span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAnalytics ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showAnalytics && (
              answersLoading || analytics === null ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-6" role="status">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-steps-blue-600" />
                  Crunching every answer…
                </div>
              ) : analytics.length === 0 ? (
                <div className="py-4 space-y-2">
                  <p className="text-sm text-gray-400">
                    No answers recorded yet{!includeTeamRuns ? ' from students' : ''} — analytics appear the moment someone starts answering.
                  </p>
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={includeTeamRuns} onChange={e => setAnalyticsIncludeTeam(e.target.checked)} />
                    Include team practice runs
                  </label>
                </div>
              ) : (
                <div className="mt-4">
                  {(() => {
                    const mostWrong = [...analytics].filter(r => r.answered >= 3).sort((x, y) => y.wrongRate - x.wrongRate)[0]
                    const mostSkipped = [...analytics].sort((x, y) => y.skipped - x.skipped)[0]
                    const slowest = [...analytics].filter(r => r.avgTimeMs !== null).sort((x, y) => (y.avgTimeMs ?? 0) - (x.avgTimeMs ?? 0))[0]
                    return (
                      <MetaLine
                        className="mb-3"
                        items={[
                          mostWrong && mostWrong.wrongRate > 0 ? { label: <>Most missed: <strong className="text-gray-700 dark:text-gray-200">#{mostWrong.q!.position}</strong> ({Math.round(mostWrong.wrongRate * 100)}% wrong)</> } : null,
                          mostSkipped && mostSkipped.skipped > 0 ? { label: <>Most skipped: <strong className="text-gray-700 dark:text-gray-200">#{mostSkipped.q!.position}</strong> ({mostSkipped.skipped}×)</> } : null,
                          slowest ? { label: <>Slowest: <strong className="text-gray-700 dark:text-gray-200">#{slowest.q!.position}</strong> ({fmtMs(slowest.avgTimeMs)} avg)</> } : null,
                        ].filter(Boolean) as { label: React.ReactNode }[]}
                      />
                    )
                  })()}
                  <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs text-gray-500">Sort by</label>
                    <select
                      value={analyticsSort}
                      onChange={e => setAnalyticsSort(e.target.value as typeof analyticsSort)}
                      className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1"
                    >
                      <option value="wrong">Most wrong</option>
                      <option value="skipped">Most skipped</option>
                      <option value="slowest">Slowest</option>
                      <option value="position">Question number</option>
                    </select>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 ml-1">
                      <input
                        type="checkbox"
                        checked={includeTeamRuns}
                        onChange={e => setAnalyticsIncludeTeam(e.target.checked)}
                      />
                      Include team practice runs
                    </label>
                    <span className="text-xs text-gray-400">· {analytics.length} questions reached · click a row for the full question</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                          <th className="py-2 pr-3 font-medium">#</th>
                          <th className="py-2 pr-3 font-medium">Question</th>
                          <th className="py-2 pr-3 font-medium">Difficulty</th>
                          <th className="py-2 pr-3 font-medium">Reached</th>
                          <th className="py-2 pr-3 font-medium">Skipped</th>
                          <th className="py-2 pr-3 font-medium">Wrong</th>
                          <th className="py-2 pr-0 font-medium">Avg time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                        {analytics.map(r => {
                          const q = r.q!
                          const hasFigure = q.prompt.includes('<svg')
                          const textOnly = q.prompt.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s+/g, ' ').trim()
                          const preview = `${hasFigure ? '[figure] ' : ''}${textOnly}`.slice(0, 90) || '[figure]'
                          const expanded = expandedAnalyticsQ === r.qid
                          return (
                            <Fragment key={r.qid}>
                              <tr
                                onClick={() => setExpandedAnalyticsQ(expanded ? null : r.qid)}
                                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                              >
                                <td className="py-2 pr-3 text-gray-400">#{q.position}</td>
                                <td className="py-2 pr-3 text-gray-900 dark:text-gray-100 max-w-[320px]">
                                  <span className="block truncate" title={textOnly}>{preview}</span>
                                  <span className="text-xs text-gray-400">{q.category}</span>
                                </td>
                                <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{q.difficulty === 1 ? 'easy' : q.difficulty === 2 ? 'medium' : 'hard'}</td>
                                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-300">{r.reached}</td>
                                <td className="py-2 pr-3 tabular-nums">
                                  <span className={r.skipped > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}>
                                    {r.skipped}{r.reached > 0 && r.skipped > 0 ? ` (${Math.round(r.skipRate * 100)}%)` : ''}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 tabular-nums">
                                  <span className={r.answered === 0 ? 'text-gray-400' : r.wrongRate >= 0.5 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-gray-300'}>
                                    {r.answered === 0 ? '—' : `${r.answered - r.correct}/${r.answered} (${Math.round(r.wrongRate * 100)}%)`}
                                  </span>
                                </td>
                                <td className="py-2 pr-0 tabular-nums text-gray-600 dark:text-gray-300">{fmtMs(r.avgTimeMs)}</td>
                              </tr>
                              {expanded && (
                                <tr>
                                  <td colSpan={7} className="py-3 pr-3">
                                    <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-800/30">
                                      <PromptContent text={q.prompt} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5" />
                                      <div className="flex flex-wrap gap-1.5">
                                        {q.options.map((opt, oi) => (
                                          <span key={oi} className={`text-xs px-2 py-0.5 border ${opt.includes('<svg') ? 'rounded-lg' : 'rounded-full'} ${
                                            oi === q.correct_index
                                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-medium'
                                              : 'border-gray-200 dark:border-gray-700 text-gray-500'
                                          }`}>
                                            {String.fromCharCode(65 + oi)}. <OptionContent opt={opt} />
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
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
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <select
                    value={qCategory}
                    onChange={e => setQCategory(e.target.value)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <option value="all">All types</option>
                    {qCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    value={qSort}
                    onChange={e => setQSort(e.target.value as 'number' | 'easiest' | 'hardest')}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <option value="number">Sort: number</option>
                    <option value="easiest">Sort: easiest first</option>
                    <option value="hardest">Sort: hardest first</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={qShowInactive}
                      onChange={e => setQShowInactive(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Show inactive ({questions.filter(q => !q.active).length})
                  </label>
                  <span className="ml-auto text-xs text-gray-400">{visibleQuestions.length} shown</span>
                </div>
                {visibleQuestions.map(q => (
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

      {/* Per-attempt audit modal — question-by-question breakdown */}
      {auditAttempt && (() => {
        const who = auditAttempt.student_id ? studentNames[auditAttempt.student_id] : null
        const auditName = who?.name ?? auditAttempt.team_email ?? 'Attempt'
        const byQ: Record<string, AnswerRow> = {}
        for (const r of auditAnswers ?? []) byQ[r.question_id] = r
        const lastServedIdx = auditAttempt.question_order.reduce((acc, qid, idx) => byQ[qid] ? idx : acc, -1)
        const notReached = auditAttempt.question_order.length - (lastServedIdx + 1)
        const acc = auditAttempt.answered_count > 0 && auditAttempt.correct_count !== null
          ? `${Math.round((auditAttempt.correct_count / auditAttempt.answered_count) * 100)}%` : '—'
        return (
          <div role="dialog" aria-modal="true" aria-labelledby="audit-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAuditAttempt(null)}>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="audit-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {auditName} <span className="font-normal text-gray-400">— question by question</span>
                  </h3>
                  <MetaLine
                    className="mt-1 !text-xs"
                    items={[
                      { label: <Badge tone={STATUS_TONE[auditAttempt.status] ?? 'neutral'}>{auditAttempt.status === 'in_progress' ? 'in progress' : auditAttempt.status}</Badge> },
                      ...(auditAttempt.kind === 'team' ? [{ label: <Badge tone="violet">team practice — not an applicant</Badge> }] : []),
                      { label: <>Score <strong className="text-gray-700 dark:text-gray-200">{auditAttempt.status === 'in_progress' ? '—' : auditAttempt.score ?? 0}</strong></> },
                      { label: <>Accuracy {auditAttempt.status === 'in_progress' ? '—' : acc}</> },
                      { label: <>{fmtDuration(auditAttempt.started_at, auditAttempt.submitted_at)}</> },
                      { label: <>{fmtWhen(auditAttempt.started_at)}</> },
                    ]}
                  />
                </div>
                <button type="button" onClick={() => setAuditAttempt(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-5 overflow-y-auto flex-1 space-y-3">
                {auditAnswers === null ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-6" role="status">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-steps-blue-600" />
                    Loading their answers…
                  </div>
                ) : lastServedIdx < 0 ? (
                  <p className="text-sm text-gray-400">No questions served yet.</p>
                ) : (
                  <>
                    {auditAttempt.question_order.slice(0, lastServedIdx + 1).map((qid, idx) => {
                      const q = questionById[qid]
                      const ans = byQ[qid]
                      if (!q) return null
                      const outcome: { tone: BadgeTone; label: string } = !ans
                        ? { tone: 'neutral', label: 'not served' }
                        : ans.selected_index === null
                        ? { tone: 'amber', label: 'skipped' }
                        : ans.is_correct
                        ? { tone: 'emerald', label: 'correct' }
                        : { tone: 'red', label: 'wrong' }
                      return (
                        <div key={qid} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1.5 flex-wrap">
                            <span className="font-medium text-gray-500">Q{idx + 1}</span>
                            <Badge tone={outcome.tone}>{outcome.label}</Badge>
                            <span>bank #{q.position} · {q.category} · {q.difficulty === 1 ? 'easy' : q.difficulty === 2 ? 'medium' : 'hard'}</span>
                            {ans?.time_ms != null && <span>· {fmtMs(ans.time_ms)}</span>}
                          </div>
                          <PromptContent text={q.prompt} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5" />
                          <div className="flex flex-wrap gap-1.5">
                            {q.options.map((opt, oi) => {
                              const isCorrect = oi === q.correct_index
                              const isTheirs = ans?.selected_index === oi
                              return (
                                <span key={oi} className={`text-xs px-2 py-0.5 border ${opt.includes('<svg') ? 'rounded-lg' : 'rounded-full'} ${
                                  isCorrect
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-medium'
                                    : isTheirs
                                    ? 'border-red-300 bg-red-50 text-red-700 font-medium'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-500'
                                }`}>
                                  {isTheirs && <span aria-hidden>{ans!.is_correct ? '✓ ' : '✗ '}</span>}
                                  {String.fromCharCode(65 + oi)}. <OptionContent opt={opt} />
                                  {isTheirs && <span className="ml-1 opacity-70">(their answer)</span>}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    {notReached > 0 && (
                      <p className="text-xs text-gray-400 text-center py-1">
                        {notReached} more question{notReached === 1 ? '' : 's'} never reached{auditAttempt.status === 'in_progress' ? ' (yet — attempt still in progress)' : ''}.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Destructive-action confirm modal (replaces window.confirm) */}
      {confirmAction && (
        <div role="dialog" aria-modal="true" aria-labelledby="test-confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-5">
            <h3 id="test-confirm-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{confirmAction.title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{confirmAction.body}</p>
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-5">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={async () => {
                  setConfirmBusy(true)
                  try { await confirmAction.run() } finally { setConfirmBusy(false); setConfirmAction(null) }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {confirmBusy ? 'Working…' : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk-select action bar — pinned above the bottom edge */}
      {selectedAttempts.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl bg-gray-900 text-white shadow-2xl px-4 py-2.5 text-sm">
          <span className="font-medium">{selectedAttempts.size} selected</span>
          <span className="text-gray-600">|</span>
          <button
            type="button"
            onClick={() => bulkVoidAttempts([...selectedAttempts])}
            className="font-medium text-amber-300 hover:text-amber-200"
            title="Voided attempts stay in the database; students can retake"
          >
            Void
          </button>
          <button
            type="button"
            onClick={() => bulkDeleteAttempts([...selectedAttempts])}
            className="font-medium text-red-400 hover:text-red-300"
            title="Permanently delete attempts and their answers"
          >
            Delete
          </button>
          <span className="text-gray-600">|</span>
          <button type="button" onClick={() => setSelectedAttempts(new Set())} className="text-gray-300 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {/* Pinned horizontal scrollbar for the results table — the table is
          wider than the card, and its native scrollbar sits below the whole
          list, so sideways scrolling was impossible mid-list. */}
      {resultsBar && (
        <div
          ref={resultsBarRef}
          onScroll={e => { if (resultsScrollRef.current) resultsScrollRef.current.scrollLeft = e.currentTarget.scrollLeft }}
          className="fixed bottom-0 z-30 overflow-x-auto overflow-y-hidden bg-white/80 dark:bg-gray-900/80 backdrop-blur border-t border-gray-200 dark:border-gray-800"
          style={{ left: resultsBar.left, width: resultsBar.width, height: 14 }}
          aria-hidden="true"
        >
          <div style={{ width: resultsBar.scrollWidth, height: 1 }} />
        </div>
      )}

      {/* Action toast */}
      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl bg-gray-900 text-white text-sm px-4 py-3 shadow-2xl flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {toast}
        </div>
      )}
    </div>
  )
}
