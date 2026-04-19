'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import SchoolPicker, { SchoolPickerValue } from '@/components/SchoolPicker'
import DynamicFormField, { type FieldValue, evaluateConditions } from '@/components/DynamicFormField'
import type { FormFieldConfig, FormPage, EventRow } from '@/lib/events-api'
import { fetchEventBySlug } from '@/lib/events-api'
import {
  sendOtp, verifyOtp, signInWithPassword, lookupSelf, hasExistingApplication, fetchExistingApplication, getExistingSession,
  submitApplication, upgradeToPassword, signOutStudent,
  fetchEventFormConfig,
  type StudentSelf, type ApplicationSubmission,
  type QualificationEntry,
} from '@/lib/apply-api'

// ---------------------------------------------------------------------------
// Event registry — maps slug to event metadata + form config
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Qualification constants
// ---------------------------------------------------------------------------

const QUAL_TYPES = [
  { value: 'a_level', label: 'A-Level' },
  { value: 'ib', label: 'IB (International Baccalaureate)' },
  { value: 'btec', label: 'BTEC' },
  { value: 't_level', label: 'T-Level' },
  { value: 'pre_u', label: 'Cambridge Pre-U' },
]

const SUBJECTS: Record<string, string[]> = {
  a_level: [
    'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics',
    'Computer Science', 'Economics', 'Business Studies', 'Politics', 'History',
    'Geography', 'Psychology', 'Sociology', 'Religious Studies',
    'English Literature', 'English Language', 'Spanish', 'French', 'German',
    'Art/Design', 'Drama', 'Physical Education', 'Media/Film Studies',
    'Music', 'Philosophy', 'Law', 'Accounting',
  ],
  ib: [
    'Mathematics: Analysis and Approaches', 'Mathematics: Applications and Interpretation',
    'Biology', 'Chemistry', 'Physics', 'Computer Science',
    'Economics', 'Business Management', 'History', 'Geography',
    'Psychology', 'Philosophy', 'Global Politics',
    'English A: Language and Literature', 'English A: Literature',
    'Spanish B', 'French B', 'German B', 'Mandarin B',
    'Visual Arts', 'Music', 'Theatre',
    'Environmental Systems and Societies',
    'Theory of Knowledge',
  ],
  btec: [
    'Applied Science', 'Business', 'Health and Social Care', 'IT',
    'Engineering', 'Sport', 'Art and Design', 'Media',
    'Performing Arts', 'Travel and Tourism', 'Construction',
    'Computing', 'Hospitality', 'Music',
  ],
  t_level: [
    'Accounting', 'Agriculture, Land Management and Production',
    'Building Services Engineering', 'Business and Administration',
    'Catering', 'Craft and Design', 'Design and Development for Engineering',
    'Design, Surveying and Planning for Construction',
    'Digital Business Services', 'Digital Production, Design and Development',
    'Digital Support Services', 'Education and Early Years',
    'Engineering, Manufacturing, Processing and Control',
    'Finance', 'Health', 'Healthcare Science', 'Legal Services',
    'Maintenance, Installation and Repair for Engineering',
    'Management and Administration', 'Media, Broadcast and Production',
    'Onsite Construction', 'Science',
  ],
  pre_u: [
    'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics',
    'Economics', 'History', 'Geography', 'Philosophy and Theology',
    'English Literature', 'French', 'Spanish', 'German', 'Mandarin Chinese',
    'Art and Design', 'Music', 'Global Perspectives',
  ],
}

const GRADES: Record<string, string[]> = {
  a_level: ['A*', 'A', 'B', 'C', 'D', 'E'],
  ib: ['7', '6', '5', '4', '3', '2', '1'],
  btec: ['D* (Distinction*)', 'D (Distinction)', 'M (Merit)', 'P (Pass)'],
  t_level: ['A*', 'A', 'B', 'C', 'D', 'E'],
  pre_u: ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'P1', 'P2', 'P3'],
}

const IB_LEVELS = ['HL (Higher Level)', 'SL (Standard Level)']

const ATTRIBUTION_OPTIONS = [
  { value: 'email_invite', label: 'Email invite' },
  { value: 'school_teacher', label: 'School / teacher' },
  { value: 'previous_steps_event', label: 'Attended a previous Steps Foundation event' },
  { value: 'previous_steps_application', label: 'Applied to a previous Steps Foundation event' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'friend_word_of_mouth', label: 'Friend / word of mouth' },
  { value: 'other', label: 'Other' },
]

const SCHOOL_TYPE_OPTIONS = [
  { value: 'state', label: 'State non-selective school' },
  { value: 'grammar', label: 'State selective / grammar school' },
  { value: 'independent', label: 'Independent (fee-paying) school' },
  { value: 'independent_bursary', label: 'Independent (fee-paying) school with >90% bursary/scholarship' },
]


// ---------------------------------------------------------------------------
// School type: detect independent schools from GIAS type_group
// ---------------------------------------------------------------------------

function isIndependentSchool(typeGroup: string | null | undefined): boolean {
  return typeGroup === 'Independent schools'
}


// ---------------------------------------------------------------------------
// Draft persistence — auto-save form state to localStorage
// ---------------------------------------------------------------------------

const DRAFT_VERSION = 1

type DraftData = {
  v: number
  step: string
  // Details
  firstName: string
  lastName: string
  school: { schoolId: string | null; schoolNameRaw: string | null; typeGroup?: string | null; schoolName?: string | null }
  yearGroup: number | ''
  schoolType: string
  freeSchoolMeals: string
  householdIncome: string
  additionalContext: string
  // Application
  gcseResults: string
  qualifications: QualificationEntry[]
  attribution: string
  // Custom fields
  customFieldValues: Record<string, unknown>
}

function draftKey(eventId: string, email: string): string {
  return `steps_draft_${eventId}_${email.toLowerCase().trim()}`
}

function saveDraft(eventId: string, email: string, data: Omit<DraftData, 'v'>): void {
  try {
    localStorage.setItem(draftKey(eventId, email), JSON.stringify({ ...data, v: DRAFT_VERSION }))
  } catch { /* quota exceeded or private mode — silently skip */ }
}

function loadDraft(eventId: string, email: string): DraftData | null {
  try {
    const raw = localStorage.getItem(draftKey(eventId, email))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftData
    if (parsed.v !== DRAFT_VERSION) return null
    return parsed
  } catch { return null }
}

function clearDraft(eventId: string, email: string): void {
  try { localStorage.removeItem(draftKey(eventId, email)) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Step = 'email' | 'otp' | 'details' | 'application' | 'submitting' | 'success' | 'applied'

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ApplyPage() {
  const params = useParams()
  const slug = params.slug as string
  const [event, setEvent] = useState<EventRow | null>(null)
  const [eventLoading, setEventLoading] = useState(true)

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [loginMode, setLoginMode] = useState<'password' | 'otp'>('password')
  const [loginPassword, setLoginPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [existingStudent, setExistingStudent] = useState<StudentSelf | null>(null)
  const [alreadyApplied, setAlreadyApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Form state — details step
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [school, setSchool] = useState<SchoolPickerValue>({ schoolId: null, schoolNameRaw: null })
  const [yearGroup, setYearGroup] = useState<number | ''>('')
  const [schoolType, setSchoolType] = useState('')
  const [freeSchoolMeals, setFreeSchoolMeals] = useState('')
  const [householdIncome, setHouseholdIncome] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')

  // Form state — application step (fixed fields)
  const [gcseResults, setGcseResults] = useState('')
  const [qualifications, setQualifications] = useState<QualificationEntry[]>([
    { qualType: 'a_level', subject: '', grade: '' },
    { qualType: 'a_level', subject: '', grade: '' },
    { qualType: 'a_level', subject: '', grade: '' },
  ])
  const [attribution, setAttribution] = useState('')

  // Form state — custom fields (from form_config)
  const [formFields, setFormFields] = useState<FormFieldConfig[]>([])
  const [formPages, setFormPages] = useState<FormPage[]>([])
  const [customPageIdx, setCustomPageIdx] = useState(0)
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, FieldValue>>({})

  // Draft restore guard
  const restoringRef = useRef(false)
  const draftRestoredRef = useRef(false)

  // Success step
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Fetch event by slug on mount
  useEffect(() => {
    let active = true
    fetchEventBySlug(slug)
      .then(data => { if (active) { setEvent(data); setEventLoading(false) } })
      .catch(() => { if (active) setEventLoading(false) })
    return () => { active = false }
  }, [slug])

  // Fetch form config from DB when event is known
  useEffect(() => {
    if (!event?.id) return
    fetchEventFormConfig(event!.id).then(config => {
      setFormFields(config.fields ?? [])
      setFormPages(config.pages ?? [])
    })
  }, [event?.id])

  // Pre-fill form when we get existing student data
  const prefill = useCallback((s: StudentSelf) => {
    if (s.first_name) setFirstName(s.first_name)
    if (s.last_name) setLastName(s.last_name)
    if (s.school_id || s.school_name_raw) {
      setSchool({ schoolId: s.school_id, schoolNameRaw: s.school_name_raw })
    }
    if (s.year_group) setYearGroup(s.year_group)
    if (s.school_type) setSchoolType(s.school_type)
    if (s.free_school_meals === true) setFreeSchoolMeals('yes')
    else if (s.free_school_meals === false) setFreeSchoolMeals('no')
    if (s.parental_income_band) {
      if (['under_20k', '20_40k'].includes(s.parental_income_band)) setHouseholdIncome('yes')
      else if (s.parental_income_band === 'prefer_na') setHouseholdIncome('prefer_not_to_say')
      else setHouseholdIncome('no')
    }
  }, [])


  // Restore full application data (GCSEs, qualifications, custom fields, etc.)
  const restoreApplication = useCallback(async (eventId: string) => {
    const app = await fetchExistingApplication(eventId)
    if (!app?.raw_response) return
    const raw = app.raw_response
    if (raw.gcse_results) setGcseResults(raw.gcse_results)
    if (raw.qualifications?.length) {
      setQualifications(raw.qualifications.map(q => ({
        qualType: q.qualType || 'a_level',
        subject: q.subject || '',
        grade: q.grade || '',
        level: q.level,
      })))
    }
    if (raw.additional_context) setAdditionalContext(raw.additional_context)
    if (raw.custom_fields) setCustomFieldValues(raw.custom_fields as Record<string, FieldValue>)
    if (app.attribution_source) setAttribution(app.attribution_source)
  }, [])

  // Check for existing Supabase session on mount (e.g. page refresh after OTP)
  useEffect(() => {
    if (!event?.id) return
    let cancelled = false
    getExistingSession().then(async (session) => {
      if (cancelled || !session) return
      setEmail(session.email)
      // Re-fetch form config with auth
      fetchEventFormConfig(event!.id).then(config => {
        setFormFields(config.fields ?? [])
      })
      const student = await lookupSelf()
      if (student) {
        setExistingStudent(student)
        prefill(student)
        const applied = await hasExistingApplication(event!.id)
        if (applied) { setAlreadyApplied(true); await restoreApplication(event!.id); if (!cancelled) setStep('applied'); return }
      }
      if (!cancelled) setStep('details')
    })
    return () => { cancelled = true }
  }, [event?.id, prefill])


  // Restore draft from localStorage after auth is established (runs once)
  useEffect(() => {
    if (!event?.id || !email || step === 'email' || step === 'otp' || step === 'success' || step === 'applied') return
    if (draftRestoredRef.current) return
    const draft = loadDraft(event!.id, email)
    if (!draft) { draftRestoredRef.current = true; return }
    draftRestoredRef.current = true
    restoringRef.current = true

    // Restore details
    if (draft.firstName) setFirstName(draft.firstName)
    if (draft.lastName) setLastName(draft.lastName)
    if (draft.school?.schoolId || draft.school?.schoolNameRaw) setSchool(draft.school)
    if (draft.yearGroup) setYearGroup(draft.yearGroup)
    if (draft.schoolType) setSchoolType(draft.schoolType)
    if (draft.freeSchoolMeals) setFreeSchoolMeals(draft.freeSchoolMeals)
    if (draft.householdIncome) setHouseholdIncome(draft.householdIncome)
    if (draft.additionalContext) setAdditionalContext(draft.additionalContext)

    // Restore application
    if (draft.gcseResults) setGcseResults(draft.gcseResults)
    if (draft.qualifications?.length) setQualifications(draft.qualifications)
    if (draft.attribution) setAttribution(draft.attribution)

    // Restore custom fields
    if (draft.customFieldValues) setCustomFieldValues(draft.customFieldValues as Record<string, FieldValue>)

    // Restore step (but only if they were past details)
    if (draft.step === 'application') setStep('application')

    // Allow saving again after a tick
    setTimeout(() => { restoringRef.current = false }, 100)
  }, [event?.id, email, step]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Qualification row helpers ---
  const addQualification = () => {
    setQualifications(prev => [...prev, { qualType: 'a_level', subject: '', grade: '' }])
  }
  const removeQualification = (index: number) => {
    setQualifications(prev => prev.filter((_, i) => i !== index))
  }
  const updateQualification = (index: number, field: keyof QualificationEntry, value: string) => {
    setQualifications(prev => prev.map((q, i) => {
      if (i !== index) return q
      const updated = { ...q, [field]: value }
      if (field === 'qualType') { updated.subject = ''; updated.grade = ''; updated.level = undefined }
      if (field === 'subject') { updated.grade = '' }
      return updated
    }))
  }

  // --- Custom field handler ---
  const handleCustomFieldChange = (fieldId: string, value: FieldValue) => {
    setCustomFieldValues(prev => ({ ...prev, [fieldId]: value }))
  }



  // Auto-save draft to localStorage on field changes (debounced)
  useEffect(() => {
    if (!event?.id || !email || restoringRef.current) return
    if (step === 'email' || step === 'otp' || step === 'success' || step === 'applied' || step === 'submitting') return

    const t = setTimeout(() => {
      saveDraft(event!.id, email, {
        step,
        firstName, lastName, school, yearGroup, schoolType,
        freeSchoolMeals, householdIncome, additionalContext,
        gcseResults, qualifications, attribution,
        customFieldValues,
      })
    }, 500)
    return () => clearTimeout(t)
  }, [
    event?.id, email, step,
    firstName, lastName, school, yearGroup, schoolType,
    freeSchoolMeals, householdIncome, additionalContext,
    gcseResults, qualifications, attribution,
    customFieldValues,
  ])

  // When an independent school is selected, clear any non-independent school type
  // so the student must answer the bursary question
  useEffect(() => {
    if (isIndependentSchool(school.typeGroup) && schoolType && !schoolType.startsWith('independent')) {
      setSchoolType('')
    }
  }, [school.typeGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Handlers ---

  const handleSendOtp = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    const { error: err } = await sendOtp(email)
    setLoading(false)
    if (err) { setError(err); return }
    setStep('otp')
  }


  const handlePasswordLogin = async () => {
    if (!email.trim() || !loginPassword) return
    setLoading(true)
    setError(null)
    const { error: err } = await signInWithPassword(email, loginPassword)
    if (err) {
      setLoading(false)
      setError(err)
      return
    }
    // Re-fetch form config with auth
    fetchEventFormConfig(event!.id).then(config => {
      setFormFields(config.fields ?? [])
      setFormPages(config.pages ?? [])
    })
    const student = await lookupSelf()
    if (student) {
      setExistingStudent(student)
      prefill(student)
      const applied = await hasExistingApplication(event!.id)
      if (applied) { setAlreadyApplied(true); await restoreApplication(event!.id); setLoading(false); setStep('applied'); return }
    }
    setLoading(false)
    setStep('details')
  }

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) return
    setLoading(true)
    setError(null)
    const { error: err } = await verifyOtp(email, otpCode)
    if (err) { setLoading(false); setError(err); return }

    // Re-fetch form config now that student is authenticated
    fetchEventFormConfig(event!.id).then(config => {
      setFormFields(config.fields ?? [])
      setFormPages(config.pages ?? [])
    })
    const student = await lookupSelf()
    if (student) {
      setExistingStudent(student)
      prefill(student)
      const applied = await hasExistingApplication(event!.id)
      if (applied) { setAlreadyApplied(true); await restoreApplication(event!.id); setLoading(false); setStep('applied'); return }
    }
    setLoading(false)
    setStep('details')
  }

  const handleDetailsNext = () => {
    setError(null)
    if (!firstName.trim() || !lastName.trim()) { setError('Please enter your first and last name.'); return }
    if (!school.schoolId && !school.schoolNameRaw) { setError('Please select or enter your school.'); return }
    if (!yearGroup) { setError('Please select your year group.'); return }
    if (!schoolType) { setError('Please select your school type.'); return }
    if (!freeSchoolMeals) { setError('Please answer the Free School Meals question.'); return }
    if (!householdIncome) { setError('Please answer the household income question.'); return }
    setStep('application')
  }

  const handleSubmit = async () => {
    setError(null)

    // Validate GCSE
    if (!gcseResults.trim()) { setError('Please enter your GCSE results.'); return }
    if (!/^\d+$/.test(gcseResults.trim())) { setError('GCSE results should contain only numbers (e.g. 999887766).'); return }

    // Validate qualifications
    const filledQuals = qualifications.filter(q => q.subject && q.grade)
    if (filledQuals.length === 0) { setError('Please add at least one subject with a grade.'); return }
    const incompleteQuals = qualifications.filter(q => (q.subject && !q.grade) || (!q.subject && q.grade))
    if (incompleteQuals.length > 0) { setError('Please complete all subject rows — each needs both a subject and a grade.'); return }
    const ibMissingLevel = qualifications.filter(q => q.qualType === 'ib' && q.subject && !q.level)
    if (ibMissingLevel.length > 0) { setError('Please select HL or SL for each IB subject.'); return }

    // Validate custom fields
    for (const field of formFields) {
      if (!field.required) continue
      const val = customFieldValues[field.id]
      if (val === undefined || val === '' || val === null) {
        setError(`Please complete: ${field.label}`); return
      }
      // Check ranked_dropdown — all ranks must be filled
      if (field.type === 'ranked_dropdown' && typeof val === 'object' && !Array.isArray(val)) {
        const ranks = field.config?.ranks ?? 3
        const entries = val as Record<string, string>
        const rankKeys = Array.from({ length: ranks }, (_, i) =>
          i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : `choice_${i + 1}`
        )
        for (const key of rankKeys) {
          if (!entries[key]) { setError(`Please complete all choices for: ${field.label}`); return }
        }
      }
      // Check checkbox_list — at least one selected
      if (field.type === 'checkbox_list' && Array.isArray(val) && val.length === 0) {
        setError(`Please select at least one option for: ${field.label}`); return
      }
      // Check paired_dropdown — at least one complete row
      if (field.type === 'paired_dropdown' && Array.isArray(val)) {
        const completeRows = (val as { primary: string; secondary: string }[]).filter(r => r.primary && r.secondary)
        if (completeRows.length === 0) { setError(`Please complete at least one row for: ${field.label}`); return }
      }
    }

    if (!attribution) { setError('Please tell us how you heard about this opportunity.'); return }

    setStep('submitting')

    const submission: ApplicationSubmission = {
      firstName,
      lastName,
      email,
      schoolId: school.schoolId,
      schoolNameRaw: school.schoolNameRaw,
      yearGroup: yearGroup as number,
      schoolType,
      freeSchoolMeals: (freeSchoolMeals === 'yes' || freeSchoolMeals === 'previously') ? true : freeSchoolMeals === 'no' ? false : null,
      householdIncomeUnder40k: householdIncome,
      additionalContext,
      gcseResults,
      qualifications: filledQuals,
      customFields: customFieldValues,
      attributionSource: attribution,
      freeSchoolMealsRaw: freeSchoolMeals,
    }

    const result = await submitApplication(event!.id, submission)
    if (result.error) {
      setError(result.error)
      setStep('application')
      return
    }
    clearDraft(event!.id, email)
    setStep('success')
  }

  const handlePasswordUpgrade = async () => {
    setPasswordError(null)
    if (password.length < 6) { setPasswordError('Password must be at least 6 characters.'); return }
    if (password !== passwordConfirm) { setPasswordError('Passwords do not match.'); return }
    setLoading(true)
    const { error: err } = await upgradeToPassword(password)
    setLoading(false)
    if (err) { setPasswordError(err); return }
    setPasswordSaved(true)
  }

  // Full sign-out: clear auth + all form state so nothing bleeds between accounts
  const handleSignOut = async () => {
    await signOutStudent()
    setEmail('')
    setStep('email')
    setAlreadyApplied(false)
    setExistingStudent(null)
    setError(null)
    setLoginPassword('')
    setOtpCode('')
    // Reset details
    setFirstName('')
    setLastName('')
    setSchool({ schoolId: null, schoolNameRaw: null })
    setYearGroup('')
    setSchoolType('')
    setFreeSchoolMeals('')
    setHouseholdIncome('')
    setAdditionalContext('')
    // Reset application
    setGcseResults('')
    setQualifications([
      { qualType: 'a_level', subject: '', grade: '' },
      { qualType: 'a_level', subject: '', grade: '' },
      { qualType: 'a_level', subject: '', grade: '' },
    ])
    setAttribution('')
    setCustomFieldValues({})
    setCustomPageIdx(0)
    // Reset password step
    setPassword('')
    setPasswordConfirm('')
    setPasswordSaved(false)
    setPasswordError(null)
    // Reset draft refs
    draftRestoredRef.current = false
  }

  // --- Loading / 404 ---
  if (eventLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading event…</p>
        </div>
      </div>
    )
  }
  if (!event) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Event not found</h1>
          <p className="text-gray-600">This application link doesn&apos;t match any open event.</p>
        </div>
      </div>
    )
  }

  // --- Render ---
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-700 text-sm font-medium px-3 py-1 rounded-full mb-4">
          The Steps Foundation
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{event.name}</h1>
        <p className="text-gray-500 text-sm">
          {event.event_date ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
          {event.time_start ? ` \u00b7 ${event.time_start}${event.time_end ? ' \u2013 ' + event.time_end : ''}` : ''}
        </p>
        <p className="text-gray-500 text-sm">{event.location ?? ''}</p>
      </div>

      {/* Progress */}
      {step !== 'success' && step !== 'submitting' && step !== 'applied' && (
        <div className="flex items-center gap-2 mb-8 justify-center">
          {(['email', 'otp', 'details', 'application'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step === s ? 'bg-purple-600 text-white' :
                (['email', 'otp', 'details', 'application'].indexOf(step) > i)
                  ? 'bg-purple-200 text-purple-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {i + 1}
              </div>
              {i < 3 && <div className={`w-8 h-0.5 ${
                (['email', 'otp', 'details', 'application'].indexOf(step) > i)
                  ? 'bg-purple-300' : 'bg-gray-200'
              }`} />}
            </div>
          ))}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 1: Email */}
      {/* ================================================================= */}
      {step === 'email' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {loginMode === 'password' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign in</h2>
              <p className="text-gray-500 text-sm mb-6">
                Enter your email and password to continue.
                {' '}If you&apos;ve applied before, we&apos;ll pre-fill your details.
              </p>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition mb-3"
              />
              <label htmlFor="loginPw" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="loginPw"
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                placeholder="Your password"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition mb-4"
              />
              <button
                onClick={handlePasswordLogin}
                disabled={loading || !email.trim() || !loginPassword}
                className="w-full py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : null}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <button
                onClick={() => { setLoginMode('otp'); setError(null) }}
                className="w-full mt-3 py-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                First time? Send a verification code instead
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Let&apos;s get started</h2>
              <p className="text-gray-500 text-sm mb-6">
                Enter your email address. We&apos;ll send you a verification code.
                {' '}If you&apos;ve applied to a Steps event before, we&apos;ll pre-fill your details.
              </p>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                placeholder="you@example.com"
                autoFocus
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition mb-4"
              />
              <button
                onClick={handleSendOtp}
                disabled={loading || !email.trim()}
                className="w-full py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : null}
                {loading ? 'Sending code...' : 'Send verification code'}
              </button>
              <button
                onClick={() => { setLoginMode('password'); setError(null) }}
                className="w-full mt-3 py-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                Already have a password? Sign in instead
              </button>
            </>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 2: OTP Verification */}
      {/* ================================================================= */}
      {step === 'otp' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your inbox</h2>
          <p className="text-gray-500 text-sm mb-6">
            We&apos;ve sent a 6-digit code to <strong className="text-gray-700">{email}</strong>.
            {' '}Check your spam folder if you don&apos;t see it.
          </p>
          <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
            Verification code
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
            placeholder="000000"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition text-center text-2xl tracking-[0.3em] font-mono mb-4"
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otpCode.length < 6}
            className="w-full py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : null}
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            onClick={() => { setStep('email'); setOtpCode(''); setError(null) }}
            className="w-full mt-3 py-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            Use a different email
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 3: Your Details */}
      {/* ================================================================= */}
      {step === 'details' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {existingStudent && (
            <div className="mb-6 p-4 bg-purple-50 border border-purple-100 rounded-xl text-purple-700 text-sm">
              Welcome back! We&apos;ve pre-filled your details from your last application.
              Please review and update anything that&apos;s changed.
            </div>
          )}



          <h2 className="text-lg font-semibold text-gray-900 mb-6">About you</h2>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name <span className="text-red-400">*</span>
              </label>
              <input id="firstName" type="text" value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition" />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                Last name <span className="text-red-400">*</span>
              </label>
              <input id="lastName" type="text" value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition" />
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} disabled
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed" />
          </div>

          {/* School */}
          <div className="mb-4">
            <label htmlFor="school" className="block text-sm font-medium text-gray-700 mb-1">
              Current school / sixth form college <span className="text-red-400">*</span>
            </label>
            <SchoolPicker value={school} onChange={setSchool} placeholder="Search for your school…" id="school" />
          </div>

          {/* Year group */}
          <div className="mb-6">
            <label htmlFor="yearGroup" className="block text-sm font-medium text-gray-700 mb-1">
              Year group <span className="text-red-400">*</span>
            </label>
            <select id="yearGroup" value={yearGroup}
              onChange={e => setYearGroup(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition bg-white">
              <option value="">Select…</option>
              <option value={12}>Year 12</option>
              <option value={13}>Year 13</option>
              <option value={14}>Gap year</option>
            </select>
          </div>

          {/* --- Contextual & Socioeconomic --- */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Contextual information</h3>
            <p className="text-gray-500 text-xs mb-4">
              This helps us ensure our events reach students from underrepresented backgrounds.
            </p>

            {isIndependentSchool(school.typeGroup) ? (
              <fieldset className="mb-4">
                <legend className="block text-sm font-medium text-gray-700 mb-2">
                  Does your school provide you with a bursary or scholarship covering 90%+ of fees? <span className="text-red-400">*</span>
                </legend>
                <p className="text-xs text-gray-400 mb-2">
                  We detected your school is independent from the schools register.
                </p>
                {[
                  { value: 'independent', label: 'No — full or mostly fee-paying' },
                  { value: 'independent_bursary', label: 'Yes — I receive a 90%+ bursary or scholarship' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 py-1.5 cursor-pointer">
                    <input type="radio" name="schoolType" value={opt.value}
                      checked={schoolType === opt.value}
                      onChange={e => setSchoolType(e.target.value)}
                      className="mt-0.5 accent-purple-600" />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <fieldset className="mb-4">
                <legend className="block text-sm font-medium text-gray-700 mb-2">
                  What type of school do you currently attend? <span className="text-red-400">*</span>
                </legend>
                {SCHOOL_TYPE_OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 py-1.5 cursor-pointer">
                    <input type="radio" name="schoolType" value={opt.value}
                      checked={schoolType === opt.value}
                      onChange={e => setSchoolType(e.target.value)}
                      className="mt-0.5 accent-purple-600" />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <fieldset className="mb-4">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                Is your average household income less than £40,000? <span className="text-red-400">*</span>
              </legend>
              {[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }, { v: 'prefer_not_to_say', l: 'Prefer not to say' }].map(opt => (
                <label key={opt.v} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="radio" name="income" value={opt.v} checked={householdIncome === opt.v}
                    onChange={e => setHouseholdIncome(e.target.value)} className="accent-purple-600" />
                  <span className="text-sm text-gray-700">{opt.l}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="mb-4">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                Are you eligible for Free School Meals? <span className="text-red-400">*</span>
              </legend>
              {[
                { v: 'yes', l: 'Currently eligible' },
                { v: 'previously', l: 'Previously eligible' },
                { v: 'no', l: 'Not eligible' },
              ].map(opt => (
                <label key={opt.v} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="radio" name="fsm" value={opt.v}
                    checked={freeSchoolMeals === opt.v}
                    onChange={e => setFreeSchoolMeals(e.target.value)}
                    className="accent-purple-600" />
                  <span className="text-sm text-gray-700">{opt.l}</span>
                </label>
              ))}
            </fieldset>

            <div>
              <label htmlFor="additionalContext" className="block text-sm font-medium text-gray-700 mb-1">
                Any additional contextual information?
              </label>
              <p className="text-xs text-gray-400 mb-2">
                E.g. young carer, extenuating circumstances, school disruption, etc.
              </p>
              <textarea id="additionalContext" value={additionalContext}
                onChange={e => setAdditionalContext(e.target.value)} rows={3}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition resize-none" />
            </div>
          </div>

          <button onClick={handleDetailsNext}
            className="w-full py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
            Continue
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 4: Your Application */}
      {/* ================================================================= */}
      {step === 'application' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Your application</h2>

          {/* --- Academic section (fixed) --- */}
          <h3 className="text-base font-semibold text-gray-900 mb-1">Academic information</h3>
          <p className="text-gray-500 text-xs mb-4">
            Don&apos;t worry — lower grades don&apos;t hurt at all. We want to help you reach your potential.
          </p>

          {/* GCSE results — digits only */}
          <div className="mb-6">
            <label htmlFor="gcse" className="block text-sm font-medium text-gray-700 mb-1">
              Achieved GCSE results <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Enter your grades as numbers only, highest to lowest (e.g. 999887766).
            </p>
            <input
              id="gcse"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={gcseResults}
              onChange={e => setGcseResults(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 999887766"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition font-mono tracking-wider"
            />
          </div>

          {/* --- Qualifications --- */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subjects and predicted/achieved grades <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Add each subject you study. Select your qualification type, subject, and current predicted (or achieved) grade.
            </p>

            <div className="space-y-3">
              {qualifications.map((q, idx) => (
                <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500">Subject {idx + 1}</span>
                    {qualifications.length > 1 && (
                      <button type="button" onClick={() => removeQualification(idx)}
                        className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
                    )}
                  </div>

                  <select value={q.qualType}
                    onChange={e => updateQualification(idx, 'qualType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition mb-2">
                    {QUAL_TYPES.map(qt => (
                      <option key={qt.value} value={qt.value}>{qt.label}</option>
                    ))}
                  </select>

                  <div className={`grid gap-2 ${q.qualType === 'ib' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <select value={q.subject}
                      onChange={e => updateQualification(idx, 'subject', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition">
                      <option value="">Select subject…</option>
                      {(SUBJECTS[q.qualType] ?? []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="__other">Other (not listed)</option>
                    </select>

                    {q.qualType === 'ib' && (
                      <select value={q.level ?? ''}
                        onChange={e => updateQualification(idx, 'level', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition">
                        <option value="">Level…</option>
                        {IB_LEVELS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    )}

                    <select value={q.grade}
                      onChange={e => updateQualification(idx, 'grade', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition">
                      <option value="">Grade…</option>
                      {(GRADES[q.qualType] ?? []).map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  {q.subject === '__other' && (
                    <input type="text" placeholder="Type your subject name…"
                      className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                      onChange={e => {
                        const val = e.target.value
                        setQualifications(prev => prev.map((qq, i) =>
                          i === idx ? { ...qq, subject: val || '__other' } : qq
                        ))
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            <button type="button" onClick={addQualification}
              className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-purple-600 font-medium hover:border-purple-300 hover:bg-purple-50 transition">
              + Add another subject
            </button>
          </div>

          {/* --- Custom form fields from form_config --- */}
          {formPages.length > 0 ? (
            /* Multi-page mode */
            <div className="border-t border-gray-100 pt-6 mb-6">
              {/* Page indicator */}
              <div className="flex items-center gap-2 mb-4">
                {formPages.map((pg, pi) => (
                  <div key={pg.id} className={`flex items-center gap-1 text-xs ${pi === customPageIdx ? 'text-purple-600 font-semibold' : 'text-gray-400'}`}>
                    {pi > 0 && <span className="text-gray-300 mx-1">→</span>}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${pi === customPageIdx ? 'bg-purple-600 text-white' : pi < customPageIdx ? 'bg-purple-200 text-purple-700' : 'bg-gray-200 text-gray-500'}`}>{pi + 1}</span>
                    <span className="hidden sm:inline">{pg.title}</span>
                  </div>
                ))}
              </div>

              {/* Page title */}
              {formPages[customPageIdx]?.title && (
                <h3 className="text-base font-semibold text-gray-900 mb-1">{formPages[customPageIdx].title}</h3>
              )}
              {formPages[customPageIdx]?.description && (
                <p className="text-sm text-gray-500 mb-4">{formPages[customPageIdx].description}</p>
              )}

              {/* Page fields */}
              {(formPages[customPageIdx]?.fields ?? []).map(field => (
                <DynamicFormField
                  key={field.id}
                  field={field}
                  value={customFieldValues[field.id]}
                  onChange={handleCustomFieldChange}
                  allValues={customFieldValues}
                />
              ))}

              {/* Page navigation */}
              <div className="flex gap-3 mt-4">
                {customPageIdx > 0 && (
                  <button type="button" onClick={() => setCustomPageIdx(customPageIdx - 1)}
                    className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition">
                    ← Back
                  </button>
                )}
                {customPageIdx < formPages.length - 1 && (
                  <button type="button" onClick={() => {
                    // Evaluate routing rules for current page
                    const currentPage = formPages[customPageIdx]
                    if (currentPage.routing?.rules) {
                      for (const rule of currentPage.routing.rules) {
                        if (evaluateConditions(rule.conditions, customFieldValues)) {
                          if (rule.goToPageId === '__submit') {
                            setCustomPageIdx(formPages.length) // past last page = show attribution
                            return
                          }
                          const targetIdx = formPages.findIndex(p => p.id === rule.goToPageId)
                          if (targetIdx >= 0) { setCustomPageIdx(targetIdx); return }
                        }
                      }
                    }
                    setCustomPageIdx(customPageIdx + 1)
                  }}
                    className="flex-1 py-2 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition">
                    Next →
                  </button>
                )}
              </div>
            </div>
          ) : formFields.length > 0 ? (
            /* Single-page mode (backward compat) */
            <div className="border-t border-gray-100 pt-6 mb-6">
              {formFields.map(field => (
                <DynamicFormField
                  key={field.id}
                  field={field}
                  value={customFieldValues[field.id]}
                  onChange={handleCustomFieldChange}
                  allValues={customFieldValues}
                />
              ))}
            </div>
          ) : null}

          {/* --- Attribution + consent --- */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <fieldset className="mb-6">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                How did you hear about this opportunity? <span className="text-red-400">*</span>
              </legend>
              {ATTRIBUTION_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="radio" name="attribution" value={opt.value}
                    checked={attribution === opt.value}
                    onChange={e => setAttribution(e.target.value)}
                    className="accent-purple-600" />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </fieldset>


          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep('details'); setError(null) }}
              className="px-6 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
              Back
            </button>
            <button onClick={handleSubmit}
              className="flex-1 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              Submit application
            </button>
          </div>
        </div>
      )}

      {/* SUBMITTING */}
      {step === 'submitting' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <Spinner large />
          <p className="text-gray-600 mt-4">Submitting your application…</p>
        </div>
      )}

      {/* STEP 5: Success + Password Upgrade */}
      {/* ================================================================= */}
      {/* APPLIED — already submitted */}
      {/* ================================================================= */}
      {step === 'applied' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">You&apos;ve already applied!</h2>
            <p className="text-gray-500 text-sm">
              Your application for the {event.name} has been received. We&apos;ll be in touch via email with next steps.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-6 flex flex-col items-center gap-3">
            <button
              onClick={() => setStep('details')}
              className="px-6 py-2.5 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition text-sm"
            >
              Edit my application
            </button>
            <a
              href="https://thestepsfoundation.com"
              className="px-6 py-2.5 text-sm text-purple-600 hover:text-purple-800 font-medium"
            >
              Back to The Steps Foundation
            </a>
            <button
              onClick={handleSignOut}
              className="px-6 py-2.5 text-sm text-gray-400 hover:text-gray-600 font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {alreadyApplied ? 'Application updated!' : 'Application submitted!'}
            </h2>
            <p className="text-gray-500 text-sm">
              {alreadyApplied
                ? <>Your application for the {event.name} has been updated. We&apos;ll be in touch via email with next steps.</>
                : <>Thanks for applying to the {event.name}. We&apos;ll review your application and be in touch via email with next steps.</>
              }
            </p>
          </div>

          {!passwordSaved ? (
            <div className="border-t border-gray-100 pt-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Speed up future applications</h3>
              <p className="text-gray-500 text-sm mb-4">
                Create a password so you can sign in instantly next time — no verification code needed. This is completely optional.
              </p>
              {passwordError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{passwordError}</div>
              )}
              <div className="space-y-3 mb-4">
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Create a password (min 6 characters)"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition" />
                <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition" />
              </div>
              <div className="flex gap-3">
                <button onClick={handleSignOut}
                  className="px-6 py-2.5 text-sm text-gray-500 hover:text-gray-700 font-medium">No thanks</button>
                <button onClick={handlePasswordUpgrade} disabled={loading || password.length < 6}
                  className="flex-1 py-2.5 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loading ? <Spinner /> : null}
                  Save password
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-100 pt-6 text-center">
              <p className="text-green-600 font-medium mb-2">Password saved!</p>
              <p className="text-gray-500 text-sm">
                Next time, you can sign in with your email and password at{' '}
                <strong className="text-gray-700">{email}</strong>.
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-gray-400 mt-8">
        <em>Virtus non origo</em> — Character, not origin
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spinner component
// ---------------------------------------------------------------------------

function Spinner({ large }: { large?: boolean }) {
  const size = large ? 'h-8 w-8' : 'h-5 w-5'
  return (
    <svg className={`animate-spin ${size} text-current`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}
