'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { SchoolType } from '@/lib/students-api'

// ---------------------------------------------------------------------------
// Small randomisation pools. Names are deliberately diverse and school names
// are a mix of state/grammar/independent so a single 'Randomize' click yields
// plausible-looking test data across the eligibility spectrum.
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Amara', 'Olu', 'Chidi', 'Nia', 'Zayn', 'Priya', 'Kai', 'Mei', 'Jamal', 'Sofia',
  'Aisha', 'Ravi', 'Lena', 'Theo', 'Sam', 'Nadia', 'Ben', 'Yara', 'Finn', 'Zara',
]
const LAST_NAMES = [
  'Oyelaran', 'Patel', 'Chen', 'Ahmed', 'Singh', 'Khan', 'Adeyemi', 'Cohen',
  'Nguyen', 'Okafor', 'Gupta', 'Tadesse', 'Dubois', 'Russo', 'Park', 'Silva',
]
const SCHOOL_POOL: Array<{ name: string; type: SchoolType }> = [
  { name: 'Bexley Grammar School', type: 'grammar' },
  { name: 'St Olave\u2019s Grammar School', type: 'grammar' },
  { name: 'Hackney Central Academy', type: 'state' },
  { name: 'Ark Globe Academy', type: 'state' },
  { name: 'Harris Academy Bermondsey', type: 'state' },
  { name: 'Westminster School', type: 'independent' },
  { name: 'Eton College', type: 'independent' },
  { name: 'Dulwich College', type: 'independent_bursary' },
  { name: 'Christ\u2019s Hospital', type: 'independent_bursary' },
  { name: 'King\u2019s College School Wimbledon', type: 'independent' },
]
const INCOME_BANDS: Array<{ code: 'under_40k' | 'over_40k' | 'prefer_na'; label: string }> = [
  { code: 'under_40k', label: 'Under \u00a340k' },
  { code: 'over_40k', label: 'Over \u00a340k' },
  { code: 'prefer_na', label: 'Prefer not to say' },
]

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

function randomizePayload() {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  const school = pick(SCHOOL_POOL)
  const year = pick([12, 13, 11, 12, 13]) // weight towards Y12/13 (our actual demo)
  const fsm = school.type === 'state' ? pick([true, false, false]) : false
  const income = school.type === 'state' || school.type === 'independent_bursary'
    ? pick<'under_40k' | 'over_40k' | 'prefer_na'>(['under_40k', 'under_40k', 'prefer_na'])
    : pick<'under_40k' | 'over_40k' | 'prefer_na'>(['over_40k', 'over_40k', 'prefer_na'])
  return {
    first_name: first,
    last_name: last,
    school_name_raw: school.name,
    school_type: school.type as SchoolType,
    year_group: year,
    free_school_meals: fsm,
    parental_income_band: income,
  }
}

type Props = {
  onClose: () => void
  onCreated: (student_id: string) => void
}

export default function AddTestStudentModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [schoolNameRaw, setSchoolNameRaw] = useState('')
  const [schoolType, setSchoolType] = useState<SchoolType | ''>('')
  const [yearGroup, setYearGroup] = useState<number | ''>('')
  const [freeSchoolMeals, setFreeSchoolMeals] = useState<boolean | null>(null)
  const [parentalIncomeBand, setParentalIncomeBand] = useState<'under_40k' | 'over_40k' | 'prefer_na' | ''>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doRandomize = () => {
    const p = randomizePayload()
    setFirstName(p.first_name)
    setLastName(p.last_name)
    setSchoolNameRaw(p.school_name_raw)
    setSchoolType(p.school_type)
    setYearGroup(p.year_group)
    setFreeSchoolMeals(p.free_school_meals)
    setParentalIncomeBand(p.parental_income_band)
    // Suggest an email + password if empty so 'randomize then submit' is truly one-click.
    if (!email) {
      const slug = `${p.first_name}.${p.last_name}`.toLowerCase().replace(/[^a-z.]/g, '')
      setEmail(`test+${slug}.${Date.now().toString(36)}@stepsfoundation.test`)
    }
    if (!password) setPassword('testpass123')
  }

  const submit = async () => {
    setError(null)
    if (!email.trim()) return setError('Email is required')
    if (!password || password.length < 6) return setError('Password must be at least 6 characters')
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required (click Randomize if you want)')

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Your session has expired \u2014 sign in again'); setSubmitting(false); return }

      const payload = {
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        school_name_raw: schoolNameRaw.trim() || null,
        school_type: schoolType || null,
        year_group: typeof yearGroup === 'number' ? yearGroup : null,
        free_school_meals: freeSchoolMeals,
        parental_income_band: parentalIncomeBand || null,
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
      onCreated(body.student_id)
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add test student</h2>
            <p className="text-xs text-gray-500 mt-0.5">Creates a real auth account you can sign into, and a student row that shows up in dashboards.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Required: email + password */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Email <span className="text-red-500">*</span></label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="test+amara@stepsfoundation.test" className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Password <span className="text-red-500">*</span></label>
              <input value={password} onChange={e => setPassword(e.target.value)} type="text" placeholder="6+ characters" className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono" />
            </div>
          </div>

          {/* Randomize */}
          <div className="flex items-center justify-between pt-2 pb-1 border-t border-gray-100 dark:border-gray-800">
            <div className="text-xs text-gray-500">The fields below are randomisable or editable. Leave any blank to skip.</div>
            <button
              type="button"
              onClick={doRandomize}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Randomize details
            </button>
          </div>

          {/* Details */}
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
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">School (free-text)</label>
              <input value={schoolNameRaw} onChange={e => setSchoolNameRaw(e.target.value)} className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
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
