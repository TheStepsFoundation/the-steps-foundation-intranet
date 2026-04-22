'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  EVENTS,
  STAGE_CODES,
  A_LEVEL_GRADES,
  useEvents,
  type SchoolType,
} from '@/lib/students-api'
import { fetchRandomSchool, type School } from '@/lib/schools-api'
import SchoolPicker, { type SchoolPickerValue } from '@/components/SchoolPicker'

// ---------------------------------------------------------------------------
// Admin-only test student creator.
//
// This is explicitly designed to look like a real (often patchy) migrated
// student from the Google Sheets days: email is required, everything else is
// optional and individually blankable. Password is optional too — leave it
// blank to simulate a student who hasn't signed in yet (no auth.users row).
//
// Randomize fills every section with plausible values but also rolls a
// ~15-20% chance of leaving each field blank, so repeated clicks generate
// a mix of fully-populated and patchy profiles for dashboard testing.
// ---------------------------------------------------------------------------

// Where to route test-student emails. Defaults to Favour's inbox via Gmail
// plus-addressing ('tenzinpham+<anything>@gmail.com' all land in the same
// inbox) so every OTP / invite / confirmation email sent to a dummy student
// actually arrives somewhere the admin can open. Persisted to localStorage
// so it only has to be set once; editable inline.
const EMAIL_BASE_STORAGE_KEY = 'add_test_student_email_base_v1'
const DEFAULT_EMAIL_BASE = 'tenzinpham@gmail.com'

function loadEmailBase(): string {
  if (typeof window === 'undefined') return DEFAULT_EMAIL_BASE
  try {
    const raw = window.localStorage.getItem(EMAIL_BASE_STORAGE_KEY)
    if (raw && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) return raw.trim()
  } catch { /* noop */ }
  return DEFAULT_EMAIL_BASE
}
function saveEmailBase(v: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(EMAIL_BASE_STORAGE_KEY, v) } catch { /* noop */ }
}

/** Build a plus-addressed derivative: 'foo+<slug>.<rand>@bar.com' */
function deriveTestEmail(base: string, first: string, last: string): string {
  const slug = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '')
  const rand = Math.random().toString(36).slice(2, 7)
  const at = base.lastIndexOf('@')
  if (at <= 0) return `test+${slug}.${rand}@stepsfoundation.test` // fallback
  const local = base.slice(0, at)
  const domain = base.slice(at + 1)
  // If the local already contains a '+', respect its prefix (e.g. 'me+dev' stays 'me+dev.slug').
  const sep = local.includes('+') ? '.' : '+'
  return `${local}${sep}${slug}.${rand}@${domain}`
}

const FIRST_NAMES = [
  'Amara', 'Olu', 'Chidi', 'Nia', 'Zayn', 'Priya', 'Kai', 'Mei', 'Jamal', 'Sofia',
  'Aisha', 'Ravi', 'Lena', 'Theo', 'Sam', 'Nadia', 'Ben', 'Yara', 'Finn', 'Zara',
  'Ayaan', 'Eden', 'Rohan', 'Maya', 'Jin', 'Fola', 'Ivy', 'Kofi', 'Layla', 'Seun',
]
const LAST_NAMES = [
  'Oyelaran', 'Patel', 'Chen', 'Ahmed', 'Singh', 'Khan', 'Adeyemi', 'Cohen',
  'Nguyen', 'Okafor', 'Gupta', 'Tadesse', 'Dubois', 'Russo', 'Park', 'Silva',
  'Ibrahim', 'Hussain', 'Obi', 'Mensah', 'Takahashi', 'Kim', 'Zhao', 'O\u2019Brien',
]
const INCOME_BANDS: Array<{ code: 'under_40k' | 'over_40k' | 'prefer_na'; label: string }> = [
  { code: 'under_40k', label: 'Under \u00a340k' },
  { code: 'over_40k', label: 'Over \u00a340k' },
  { code: 'prefer_na', label: 'Prefer not to say' },
]
// Must match public.application_statuses.code — attended/no_show are NOT
// statuses (we have a separate `attended` boolean column for that).
const APPLICATION_STATUSES = [
  'submitted', 'shortlisted', 'accepted', 'waitlist', 'rejected', 'withdrew',
] as const
type AppStatus = typeof APPLICATION_STATUSES[number]

const STATUS_LABELS: Record<AppStatus, string> = {
  submitted: 'submitted',
  shortlisted: 'shortlisted',
  accepted: 'accepted',
  waitlist: 'waitlist',
  rejected: 'rejected',
  withdrew: 'withdrew',
}

const A_LEVEL_SUBJECT_POOL = [
  'Mathematics', 'Further Mathematics', 'Economics', 'Physics', 'Chemistry',
  'Biology', 'History', 'Geography', 'English Literature', 'English Language',
  'Business Studies', 'Psychology', 'Sociology', 'Politics', 'French',
  'Spanish', 'Computer Science', 'Art & Design',
]

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
/** 15% chance to return null (patchy migration data). */
function maybeBlank<T>(v: T, pBlank = 0.15): T | null { return Math.random() < pBlank ? null : v }

// ---------- Attended events ---------------------------------------------------
type EventPick = { event_id: string; status: AppStatus; attended: boolean }

function randomPastEventPicks(): EventPick[] {
  const now = Date.now()
  const past = EVENTS.filter(e => new Date(e.date).getTime() < now)
  if (past.length === 0) return []
  const howMany = pick([0, 1, 1, 2, 2, 3]) // skew towards 1-2
  const shuffled = [...past].sort(() => Math.random() - 0.5).slice(0, howMany)
  return shuffled.map(e => {
    // Weight 'accepted' (with attended=true) as the most common outcome — that
    // matches reality for past events in our pipeline.
    const status = pick<AppStatus>([
      'accepted', 'accepted', 'accepted',
      'submitted', 'waitlist', 'rejected',
    ])
    // Roughly: if accepted, 75% actually showed up. Otherwise attended=false.
    const attended = status === 'accepted' ? Math.random() < 0.75 : false
    return { event_id: e.id, status, attended }
  })
}

// ---------- Academics ---------------------------------------------------------
type GradesMap = Record<string, string>
type AcademicPayload = {
  current_stage: string | null
  a_level_subjects: string[]
  predicted_grades: GradesMap
  actual_grades: GradesMap
}

function randomAcademic(year: number | null): AcademicPayload {
  // Only Y12/13/gap/uni really need academics; younger kids rarely have grades
  const stage = year === 11 ? 'y11'
    : year === 12 ? 'y12'
    : year === 13 ? 'y13'
    : pick(['y12', 'y13', 'gap', 'uni_y1'])
  const n = pick([3, 3, 4])
  const pool = [...A_LEVEL_SUBJECT_POOL].sort(() => Math.random() - 0.5)
  const subjects = pool.slice(0, n)
  const predicted: GradesMap = {}
  const actual: GradesMap = {}
  subjects.forEach(s => {
    // Weight grades towards A-B-C range with some A*s and Ds sprinkled in
    predicted[s] = pick(['A*', 'A', 'A', 'B', 'B', 'C', 'D'])
    // Only fill actual grades for Y13+/alum — younger students don't have them yet
    if (stage === 'y13' || stage === 'gap' || stage.startsWith('uni_') || stage === 'alum') {
      actual[s] = pick(['A*', 'A', 'A', 'B', 'B', 'C', 'D'])
    }
  })
  return {
    current_stage: stage,
    a_level_subjects: subjects,
    predicted_grades: predicted,
    actual_grades: actual,
  }
}

type Props = {
  onClose: () => void
  onCreated: (student_id: string, extras?: { warning?: string | null; magicLink?: string | null }) => void
}

export default function AddTestStudentModal({ onClose, onCreated }: Props) {
  // Subscribe so renames in the event editor propagate into the event picker.
  useEvents()
  // --- Auth fields ---
  const [email, setEmail] = useState('')
  const [emailBase, setEmailBase] = useState<string>(DEFAULT_EMAIL_BASE)
  const [password, setPassword] = useState('')

  // --- Basic details ---
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [schoolValue, setSchoolValue] = useState<SchoolPickerValue>({ schoolId: null, schoolNameRaw: null, typeGroup: null, schoolName: null })
  const [initialSchool, setInitialSchool] = useState<Pick<School, 'id' | 'name' | 'town'> | null>(null)
  const [schoolType, setSchoolType] = useState<SchoolType | ''>('')
  const [yearGroup, setYearGroup] = useState<number | ''>('')
  const [freeSchoolMeals, setFreeSchoolMeals] = useState<boolean | null>(null)
  const [parentalIncomeBand, setParentalIncomeBand] = useState<'under_40k' | 'over_40k' | 'prefer_na' | ''>('')

  // --- Past events ---
  // Map event_id -> {status, attended}; absence means "not attended / no row"
  const [eventPicks, setEventPicks] = useState<Record<string, { status: AppStatus; attended: boolean }>>({})

  // --- Academics ---
  const [currentStage, setCurrentStage] = useState('')
  // Always 4 slots, blank strings = unused (mirrors the UX in /students/[id])
  const [aLevelSubjects, setALevelSubjects] = useState<string[]>(['', '', '', ''])
  const [predictedGrades, setPredictedGrades] = useState<GradesMap>({})
  const [actualGrades, setActualGrades] = useState<GradesMap>({})

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [randomizing, setRandomizing] = useState(false)

  // Rehydrate the persisted email base on mount. Doing this in an effect
  // instead of the useState initializer keeps SSR safe.
  useEffect(() => { setEmailBase(loadEmailBase()) }, [])

  // Recomputed on every render so event-editor renames/date changes show up
  // immediately (cheap: at most a handful of events).
  const pastEvents = EVENTS.filter(e => new Date(e.date).getTime() < Date.now())

  const doRandomize = async () => {
    setRandomizing(true)
    try {
      const first = pick(FIRST_NAMES)
      const last = pick(LAST_NAMES)
      setFirstName(first)
      setLastName(last)

      // Year group: weight towards Y12/Y13 (our real demographic). Sometimes blank.
      const yearRaw = pick([11, 12, 12, 13, 13, 12])
      const year = maybeBlank(yearRaw, 0.15)
      setYearGroup(year ?? '')

      // Fetch one real GIAS school. Sometimes skip entirely.
      let picked: School | null = null
      if (Math.random() > 0.15) {
        picked = await fetchRandomSchool().catch(() => null)
      }
      let resolvedType: SchoolType | '' = ''
      if (picked) {
        setSchoolValue({ schoolId: picked.id, schoolNameRaw: picked.name, typeGroup: picked.type_group ?? null, schoolName: picked.name })
        setInitialSchool({ id: picked.id, name: picked.name, town: picked.town ?? null })
        // Map GIAS type_group -> our SchoolType (best-effort, admin can override).
        const tg = (picked.type_group ?? '').toLowerCase()
        const inferredType: SchoolType = tg.includes('independent')
          ? (Math.random() < 0.5 ? 'independent' : 'independent_bursary')
          : (picked.name.toLowerCase().includes('grammar') ? 'grammar' : 'state')
        resolvedType = maybeBlank(inferredType, 0.1) ?? ''
        setSchoolType(resolvedType)
      } else {
        setSchoolValue({ schoolId: null, schoolNameRaw: null, typeGroup: null, schoolName: null })
        setInitialSchool(null)
        resolvedType = maybeBlank(pick<SchoolType>(['state', 'state', 'grammar', 'independent']), 0.2) ?? ''
        setSchoolType(resolvedType)
      }

      // FSM + income (correlated with school type)
      const fsm = schoolTypeFsm(resolvedType)
      setFreeSchoolMeals(fsm === undefined ? null : fsm)
      const incomeRaw = pick<'under_40k' | 'over_40k' | 'prefer_na'>(['under_40k', 'over_40k', 'prefer_na', 'under_40k'])
      setParentalIncomeBand(maybeBlank(incomeRaw, 0.25) ?? '')

      // Past events (sometimes none)
      const picks = Math.random() < 0.2 ? [] : randomPastEventPicks()
      const m: Record<string, { status: AppStatus; attended: boolean }> = {}
      picks.forEach(p => { m[p.event_id] = { status: p.status, attended: p.attended } })
      setEventPicks(m)

      // Academics (sometimes blank entirely)
      if (Math.random() < 0.8) {
        const a = randomAcademic(year)
        setCurrentStage(a.current_stage ?? '')
        const subs = [...a.a_level_subjects, '', '', '', ''].slice(0, 4)
        setALevelSubjects(subs)
        setPredictedGrades(a.predicted_grades)
        setActualGrades(a.actual_grades)
      } else {
        setCurrentStage('')
        setALevelSubjects(['', '', '', ''])
        setPredictedGrades({})
        setActualGrades({})
      }

      // Email: suggest one if blank so one-click-randomize-then-submit works.
      // Uses plus-addressing off `emailBase` so the OTP / invite / confirm
      // emails to this dummy actually land in an inbox the admin can open.
      if (!email) {
        setEmail(deriveTestEmail(emailBase, first, last))
      }
      // Password stays blank on purpose — default behaviour now creates a row
      // with no auth account (which mirrors the migrated-from-Sheets case).
    } finally {
      setRandomizing(false)
    }
  }

  function schoolTypeFsm(t: SchoolType | '' | null): boolean | undefined {
    // ~70% of students on FSM are at state schools; use the school_type
    // we just picked in the same randomize pass (state arg — NOT the stale
    // React value) to bias sensibly.
    if (t === 'state' || t === 'independent_bursary') {
      return Math.random() < 0.4 ? true : false
    }
    if (t === 'grammar') return Math.random() < 0.15
    if (t === 'independent') return false
    return pick([true, false, false, undefined])
  }

  function toggleEvent(eventId: string) {
    setEventPicks(prev => {
      const next = { ...prev }
      if (next[eventId]) delete next[eventId]
      else next[eventId] = { status: 'accepted', attended: true }
      return next
    })
  }

  function updateEventStatus(eventId: string, status: AppStatus) {
    setEventPicks(prev => {
      const existing = prev[eventId] ?? { status: 'submitted' as AppStatus, attended: false }
      // Rejected/withdrew auto-sets attended=false (they definitionally didn't go).
      const attended = (status === 'rejected' || status === 'withdrew') ? false : existing.attended
      return {
        ...prev,
        [eventId]: { status, attended },
      }
    })
  }

  function updateEventAttended(eventId: string, attended: boolean) {
    setEventPicks(prev => ({
      ...prev,
      [eventId]: { ...(prev[eventId] ?? { status: 'submitted' as AppStatus, attended: false }), attended },
    }))
  }

  function updateSubject(i: number, value: string) {
    setALevelSubjects(prev => {
      const oldVal = prev[i]
      const next = [...prev]
      next[i] = value
      // If renaming a subject that had a predicted/actual grade, move it over
      if (oldVal && oldVal !== value) {
        if (predictedGrades[oldVal]) {
          const pg = { ...predictedGrades }
          if (value) pg[value] = pg[oldVal]
          delete pg[oldVal]
          setPredictedGrades(pg)
        }
        if (actualGrades[oldVal]) {
          const ag = { ...actualGrades }
          if (value) ag[value] = ag[oldVal]
          delete ag[oldVal]
          setActualGrades(ag)
        }
      }
      return next
    })
  }

  const submit = async () => {
    setError(null)
    if (!email.trim()) return setError('Email is required')
    if (password && password.length < 6) return setError('Password must be at least 6 characters (or leave blank to skip auth account)')
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required (click Randomize if you want)')

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Your session has expired \u2014 sign in again'); setSubmitting(false); return }

      // --- Filter/normalise subjects + grade maps ---
      const subjectsClean = aLevelSubjects.map(s => s.trim()).filter(Boolean)
      const predictedClean: GradesMap = {}
      const actualClean: GradesMap = {}
      subjectsClean.forEach(s => {
        if (predictedGrades[s]) predictedClean[s] = predictedGrades[s]
        if (actualGrades[s]) actualClean[s] = actualGrades[s]
      })
      const anyAcademic = Boolean(currentStage || subjectsClean.length || Object.keys(predictedClean).length || Object.keys(actualClean).length)

      // --- Applications (past events chosen) ---
      const applications = Object.entries(eventPicks).map(([event_id, v]) => ({
        event_id,
        status: v.status,
        attended: v.attended,
      }))

      const payload = {
        email: email.trim(),
        password: password || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        school_id: schoolValue.schoolId ?? null,
        school_name_raw: (schoolValue.schoolNameRaw ?? '').trim() || null,
        school_type: schoolType || null,
        year_group: typeof yearGroup === 'number' ? yearGroup : null,
        free_school_meals: freeSchoolMeals,
        parental_income_band: parentalIncomeBand || null,
        applications,
        progression: anyAcademic ? {
          current_stage: currentStage || null,
          a_level_subjects: subjectsClean.length ? subjectsClean : null,
          predicted_grades: Object.keys(predictedClean).length ? predictedClean : null,
          actual_grades: Object.keys(actualClean).length ? actualClean : null,
        } : null,
      }

      const res = await fetch('/api/admin/create-test-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      // Student row was created (201). If the API surfaces a warning (e.g.
      // applications insert failed), keep the modal open and show it — don't
      // let the admin leave the page thinking everything worked. Otherwise
      // close normally.
      const warning: string | null = typeof body?.warning === 'string' ? body.warning : null
      const magicLink: string | null = typeof body?.magic_link === 'string' ? body.magic_link : null
      if (warning) {
        setError(`Student was created (${body.student_id}) but: ${warning}`)
        setSubmitting(false)
        return
      }
      onCreated(body.student_id, { warning, magicLink })
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add test student</h2>
            <p className="text-xs text-gray-500 mt-0.5">All fields other than email are optional. Leave password blank to simulate a migrated student who hasn\u2019t signed in yet.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
          {/* Email-base setting — persisted to localStorage. */}
          <div className="rounded-md bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center gap-3">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">Inbox for test emails</label>
            <input
              value={emailBase}
              onChange={e => { setEmailBase(e.target.value); saveEmailBase(e.target.value) }}
              type="email"
              placeholder="you@gmail.com"
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
            <span className="text-[11px] text-gray-500 hidden sm:inline">Randomize generates plus-addressed aliases so all test mail lands here.</span>
          </div>

          {/* Auth fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Email <span className="text-red-500">*</span></label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder={deriveTestEmail(emailBase, 'amara', 'patel')} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Password <span className="text-gray-400">(optional)</span></label>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Leave blank to skip auth account" className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
          </div>

          {/* Randomize */}
          <div className="flex items-center justify-between pt-2 pb-1 border-t border-gray-100 dark:border-gray-800">
            <div className="text-xs text-gray-500">Randomize fills every section with plausible values, occasionally leaving fields blank to mimic patchy migration data.</div>
            <button
              type="button"
              onClick={doRandomize}
              disabled={randomizing}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {randomizing ? 'Randomising\u2026' : 'Randomize details'}
            </button>
          </div>

          {/* Basic details */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Basic details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">First name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Last name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">School (GIAS)</label>
                <SchoolPicker
                  value={schoolValue}
                  initialSchool={initialSchool}
                  onChange={setSchoolValue}
                  placeholder="Search GIAS or type manually\u2026"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">School type</label>
                <select value={schoolType} onChange={e => setSchoolType(e.target.value as SchoolType | '')} className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value="">(unset)</option>
                  <option value="state">State</option>
                  <option value="grammar">Grammar</option>
                  <option value="independent">Independent</option>
                  <option value="independent_bursary">Independent (90%+ bursary)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Year group</label>
                <select value={yearGroup === '' ? '' : String(yearGroup)} onChange={e => setYearGroup(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value="">(unset)</option>
                  {[10, 11, 12, 13].map(y => <option key={y} value={y}>Y{y}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Free school meals</label>
                <select value={freeSchoolMeals === null ? '' : (freeSchoolMeals ? 'true' : 'false')} onChange={e => setFreeSchoolMeals(e.target.value === '' ? null : e.target.value === 'true')} className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value="">(unset)</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Parental income</label>
                <select value={parentalIncomeBand} onChange={e => setParentalIncomeBand(e.target.value as any)} className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value="">(unset)</option>
                  {INCOME_BANDS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Past events */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Past events attended</h3>
            {pastEvents.length === 0 ? (
              <div className="text-xs text-gray-500">No past events yet.</div>
            ) : (
              <div className="rounded-md border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {pastEvents.map(e => {
                  const picked = eventPicks[e.id]
                  return (
                    <div key={e.id} className="px-3 py-2 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(picked)}
                        onChange={() => toggleEvent(e.id)}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{e.name}</div>
                        <div className="text-xs text-gray-500">{e.short} \u00b7 {e.date}</div>
                      </div>
                      {picked && (
                        <>
                          <select
                            value={picked.status}
                            onChange={ev => updateEventStatus(e.id, ev.target.value as AppStatus)}
                            className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                          >
                            {APPLICATION_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                          </select>
                          <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={picked.attended}
                              onChange={ev => updateEventAttended(e.id, ev.target.checked)}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            attended
                          </label>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Academics */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Academic info</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Current stage</label>
                <select value={currentStage} onChange={e => setCurrentStage(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <option value="">(unset)</option>
                  {STAGE_CODES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-md border border-gray-200 dark:border-gray-800">
              <div className="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-800 grid grid-cols-[1fr_100px_100px] gap-2">
                <span>Subject</span>
                <span>Predicted</span>
                <span>Actual</span>
              </div>
              {aLevelSubjects.map((sub, i) => (
                <div key={i} className="px-3 py-1.5 grid grid-cols-[1fr_100px_100px] gap-2 items-center border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                  <input
                    value={sub}
                    onChange={e => updateSubject(i, e.target.value)}
                    placeholder={`Subject ${i + 1}`}
                    className="w-full px-2 py-1 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  />
                  <select
                    value={sub ? (predictedGrades[sub] ?? '') : ''}
                    onChange={e => {
                      if (!sub) return
                      const v = e.target.value
                      setPredictedGrades(prev => {
                        const next = { ...prev }
                        if (v) next[sub] = v
                        else delete next[sub]
                        return next
                      })
                    }}
                    disabled={!sub}
                    className="w-full px-1 py-1 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50"
                  >
                    <option value="">-</option>
                    {A_LEVEL_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select
                    value={sub ? (actualGrades[sub] ?? '') : ''}
                    onChange={e => {
                      if (!sub) return
                      const v = e.target.value
                      setActualGrades(prev => {
                        const next = { ...prev }
                        if (v) next[sub] = v
                        else delete next[sub]
                        return next
                      })
                    }}
                    disabled={!sub}
                    className="w-full px-1 py-1 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50"
                  >
                    <option value="">-</option>
                    {A_LEVEL_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>

          {error && (
            <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-between shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Creating\u2026' : 'Create test student'}
          </button>
        </div>
      </div>
    </div>
  )
}
