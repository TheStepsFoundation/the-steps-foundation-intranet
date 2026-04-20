'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import SchoolPicker, { SchoolPickerValue } from '@/components/SchoolPicker'
import DynamicFormField, { type FieldValue, evaluateConditions } from '@/components/DynamicFormField'
import type { FormFieldConfig, FormPage, EventRow } from '@/lib/events-api'
import { fetchEventBySlug } from '@/lib/events-api'
import {
  sendOtp, verifyOtp, signInWithPassword, lookupSelf, hasExistingApplication, fetchExistingApplication, getExistingSession,
  submitApplication, upgradeToPassword, signOutStudent, userHasPassword,
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

type Step = 'loading' | 'email' | 'otp' | 'details' | 'application' | 'submitting' | 'success' | 'applied'

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

// Progressive reassurance during submit — if the network is slow, students
// start to suspect the form has frozen after ~4s. Showing "still working…"
// at 4s and "almost there…" at 10s keeps them calm instead of reloading.
function SubmittingHints(): JSX.Element | null {
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 4000)
    const t2 = setTimeout(() => setStage(2), 10000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])
  if (stage === 0) return null
  return (
    <p className="text-sm text-gray-500 mt-2">
      {stage === 1 ? 'Still working — this usually takes just a moment.' : 'Almost there. Please keep this page open.'}
    </p>
  )
}

export default function ApplyPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const editMode = searchParams.get('edit') === '1'
  const slug = params.slug as string
  const [event, setEvent] = useState<EventRow | null>(null)
  const [eventLoading, setEventLoading] = useState(true)

  const [step, setStep] = useState<Step>('loading')
  const [email, setEmail] = useState('')
  // Default to OTP since most applicants are new — existing accounts get a
  // prominent 'Sign in with password' link below the Send-code button.
  const [loginMode, setLoginMode] = useState<'password' | 'otp'>('otp')
  const [loginPassword, setLoginPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [existingStudent, setExistingStudent] = useState<StudentSelf | null>(null)
  const [alreadyApplied, setAlreadyApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
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
  const originalFormSnapshot = useRef<string>('')
  const [showExitPrompt, setShowExitPrompt] = useState(false)

  // Success step
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
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
  // Snapshot of form values to detect changes when editing
  const getFormSnapshot = useCallback(() => {
    return JSON.stringify({
      firstName, lastName, school, yearGroup, schoolType, freeSchoolMeals,
      householdIncome, additionalContext, gcseResults, qualifications,
      attribution, customFieldValues,
    })
  }, [firstName, lastName, school, yearGroup, schoolType, freeSchoolMeals,
      householdIncome, additionalContext, gcseResults, qualifications,
      attribution, customFieldValues])

  const hasFormChanges = alreadyApplied && originalFormSnapshot.current
    ? getFormSnapshot() !== originalFormSnapshot.current
    : true  // new applications always allow submit

  // Take a snapshot of the form state once application data is fully restored
  // This runs after React has re-rendered with the restored values
  const snapshotTaken = useRef(false)
  useEffect(() => {
    if (alreadyApplied && !snapshotTaken.current && (firstName || gcseResults || qualifications[0]?.subject)) {
      snapshotTaken.current = true
      // Wait one more tick for any final state updates to settle
      requestAnimationFrame(() => {
        originalFormSnapshot.current = getFormSnapshot()
      })
    }
  }, [alreadyApplied, firstName, gcseResults, qualifications, getFormSnapshot])

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
    if (app.channel) setAttribution(app.channel)
    else if (app.attribution_source) setAttribution(app.attribution_source)
  }, [])

  // Check for existing Supabase session on mount (e.g. page refresh after OTP)
  useEffect(() => {
    if (!event?.id) return
    let cancelled = false
    getExistingSession().then(async (session) => {
      if (cancelled || !session) { setStep('email'); return }
      setEmail(session.email)
      // Check if user already has a password (skip prompt on success screen)
      userHasPassword().then(has => { if (!cancelled) setHasPassword(has) })
      // Re-fetch form config with auth
      fetchEventFormConfig(event!.id).then(config => {
        setFormFields(config.fields ?? [])
      })
      const student = await lookupSelf()
      if (student) {
        setExistingStudent(student)
        prefill(student)
        const applied = await hasExistingApplication(event!.id)
        if (applied) {
          setAlreadyApplied(true)
          await restoreApplication(event!.id)
          draftRestoredRef.current = true
          if (!cancelled) setStep(editMode ? 'details' : 'applied')
          return
        }
      }
      if (student) draftRestoredRef.current = true
      if (!cancelled) setStep(student ? 'application' : 'details')
    })
    return () => { cancelled = true }
  }, [event?.id, prefill, editMode])


  // Restore draft from localStorage after auth is established (runs once)
  useEffect(() => {
    if (!event?.id || !email || step === 'loading' || step === 'email' || step === 'otp' || step === 'success' || step === 'applied') return
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
  // Per-field error helpers: inline messages + scroll to the first one.
  const clearFieldError = (key: string) => {
    setFieldErrors(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const scrollToFirstError = (errs: Record<string, string>, order?: string[]) => {
    const keys = order ? order.filter(k => errs[k]) : Object.keys(errs)
    const firstKey = keys[0]
    if (!firstKey) return
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-error-key="${firstKey}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const focusable = el.querySelector<HTMLElement>('input, select, textarea, button')
        if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 350)
      }
    })
  }

  const handleCustomFieldChange = (fieldId: string, value: FieldValue) => {
    setCustomFieldValues(prev => ({ ...prev, [fieldId]: value }))
    clearFieldError(`customField:${fieldId}`)
  }



  // Auto-save draft to localStorage on field changes (debounced)
  useEffect(() => {
    if (!event?.id || !email || restoringRef.current) return
    if (step === 'loading' || step === 'email' || step === 'otp' || step === 'success' || step === 'applied' || step === 'submitting') return

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
      if (applied) {
          setAlreadyApplied(true); await restoreApplication(event!.id); draftRestoredRef.current = true
          setLoading(false); setStep(editMode ? 'details' : 'applied'); return
        }
    }
    if (student) draftRestoredRef.current = true
    setLoading(false)
    setStep(student ? 'application' : 'details')
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
      if (applied) {
          setAlreadyApplied(true); await restoreApplication(event!.id); draftRestoredRef.current = true
          setLoading(false); setStep(editMode ? 'details' : 'applied'); return
        }
    }
    if (student) draftRestoredRef.current = true
    setLoading(false)
    setStep(student ? 'application' : 'details')
  }

  const handleDetailsNext = () => {
    const errs: Record<string, string> = {}
    if (!firstName.trim()) errs.firstName = 'Please enter your first name.'
    if (!lastName.trim()) errs.lastName = 'Please enter your last name.'
    if (!school.schoolId && !school.schoolNameRaw) errs.school = 'Please select or enter your school.'
    if (!yearGroup) errs.yearGroup = 'Please select your year group.'
    if (!schoolType) errs.schoolType = 'Please answer this question.'
    if (!freeSchoolMeals) errs.freeSchoolMeals = 'Please answer the Free School Meals question.'
    if (!householdIncome) errs.householdIncome = 'Please answer the household income question.'
    setFieldErrors(errs)
    const n = Object.keys(errs).length
    if (n > 0) {
      setError(`Please fix ${n} issue${n > 1 ? 's' : ''} below before continuing.`)
      scrollToFirstError(errs, ['firstName','lastName','school','yearGroup','schoolType','freeSchoolMeals','householdIncome'])
      return
    }
    setError(null)
    setStep('application')
  }

  const handleSubmit = async () => {
    const errs: Record<string, string> = {}
    const order: string[] = []

    // GCSE
    if (!gcseResults.trim()) { errs.gcseResults = 'Please enter your GCSE results.'; order.push('gcseResults') }
    else if (!/^\d+$/.test(gcseResults.trim())) { errs.gcseResults = 'GCSE results should contain only numbers (e.g. 999887766).'; order.push('gcseResults') }

    // Qualifications
    const filledQuals = qualifications.filter(q => q.subject && q.grade)
    const incompleteQuals = qualifications.filter(q => (q.subject && !q.grade) || (!q.subject && q.grade))
    const ibMissingLevel = qualifications.filter(q => q.qualType === 'ib' && q.subject && !q.level)
    if (filledQuals.length === 0) { errs.qualifications = 'Please add at least one subject with a grade.'; order.push('qualifications') }
    else if (incompleteQuals.length > 0) { errs.qualifications = 'Please complete all subject rows — each needs both a subject and a grade.'; order.push('qualifications') }
    else if (ibMissingLevel.length > 0) { errs.qualifications = 'Please select HL or SL for each IB subject.'; order.push('qualifications') }

    // Custom fields
    for (const field of formFields) {
      if (!field.required) continue
      const val = customFieldValues[field.id]
      const key = `customField:${field.id}`
      if (val === undefined || val === '' || val === null) {
        errs[key] = `Please complete: ${field.label}`
        order.push(key)
        continue
      }
      if (field.type === 'ranked_dropdown' && typeof val === 'object' && !Array.isArray(val)) {
        const ranks = field.config?.ranks ?? 3
        const entries = val as Record<string, string>
        const rankKeys = Array.from({ length: ranks }, (_, i) =>
          i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : `choice_${i + 1}`
        )
        for (const rk of rankKeys) {
          if (!entries[rk]) { errs[key] = `Please complete all choices for: ${field.label}`; order.push(key); break }
        }
      }
      if (field.type === 'checkbox_list' && Array.isArray(val) && val.length === 0) {
        errs[key] = `Please select at least one option for: ${field.label}`
        order.push(key)
      }
      if (field.type === 'paired_dropdown' && Array.isArray(val)) {
        const completeRows = (val as { primary: string; secondary: string }[]).filter(r => r.primary && r.secondary)
        if (completeRows.length === 0) { errs[key] = `Please complete at least one row for: ${field.label}`; order.push(key) }
      }
    }

    // Attribution
    if (!attribution) { errs.attribution = 'Please tell us how you heard about this opportunity.'; order.push('attribution') }

    setFieldErrors(errs)
    const n = Object.keys(errs).length
    if (n > 0) {
      setError(`Please fix ${n} issue${n > 1 ? 's' : ''} below to submit your application.`)
      scrollToFirstError(errs, order)
      return
    }

    setError(null)
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
          <div className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
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
    <>
      {event.banner_image_url && (
        <div className="w-full bg-white">
          <div className="max-w-5xl mx-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.banner_image_url}
              alt={event.name}
              className="w-full aspect-[4/1] object-cover"
              style={{ objectPosition: `${event.banner_focal_x ?? 50}% ${event.banner_focal_y ?? 50}%` }}
            />
          </div>
        </div>
      )}
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-steps-blue-100 text-steps-blue-700 text-sm font-medium px-3 py-1 rounded-full mb-4">
          The Steps Foundation
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black text-steps-dark tracking-tight mb-2">{event.name}</h1>
        <p className="text-gray-500 text-sm">
          {event.event_date ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
          {event.time_start ? ` \u00b7 ${event.time_start}${event.time_end ? ' \u2013 ' + event.time_end : ''}` : ''}
        </p>
        <p className="text-gray-500 text-sm">{event.location ?? ''}</p>
      </div>

      {/* Progress */}
      {step !== 'loading' && step !== 'success' && step !== 'submitting' && step !== 'applied' && (
        <div className="flex items-center gap-2 mb-8 justify-center">
          {(['email', 'otp', 'details', 'application'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step === s ? 'bg-steps-blue-600 text-white' :
                (['email', 'otp', 'details', 'application'].indexOf(step) > i)
                  ? 'bg-steps-blue-200 text-steps-blue-700' : 'bg-gray-200 text-gray-500'
              }`}>
                {i + 1}
              </div>
              {i < 3 && <div className={`w-8 h-0.5 ${
                (['email', 'otp', 'details', 'application'].indexOf(step) > i)
                  ? 'bg-steps-blue-300' : 'bg-gray-200'
              }`} />}
            </div>
          ))}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border-2 border-red-300 rounded-xl text-red-800 text-sm flex items-start gap-3 shadow-sm" role="alert" aria-live="polite">
          <svg className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
          <div><strong className="block mb-0.5">There’s a problem with your form</strong>{error}</div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 1: Email */}
      {/* ================================================================= */}

      {/* Back to Student Hub — shown on all form steps */}
      {(step === 'details' || step === 'application') && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => {
              if ((step === 'details' || step === 'application') && alreadyApplied && hasFormChanges) {
                setShowExitPrompt(true)
              } else {
                window.location.href = '/my'
              }
            }}
            className="text-sm text-gray-400 hover:text-steps-blue-600 transition"
          >
            ← Back to Student Hub
          </button>
        </div>
      )}

      {/* Exit prompt modal */}
      {showExitPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Unsaved changes</h3>
            <p className="text-sm text-gray-600 mb-5">
              You have unsaved changes to your application. Are you sure you want to leave?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowExitPrompt(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
              >
                Keep editing
              </button>
              <button
                onClick={() => { window.location.href = '/my' }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition"
              >
                Discard & leave
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'loading' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 flex items-center justify-center min-h-[200px]">
          <Spinner large />
        </div>
      )}

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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition mb-3"
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition mb-4"
              />
              <button
                onClick={handlePasswordLogin}
                disabled={loading || !email.trim() || !loginPassword}
                className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : null}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <div className="mt-6 pt-5 border-t border-gray-100">
                <p className="text-xs text-gray-500 text-center mb-3">
                  Don&rsquo;t have an account yet?
                </p>
                <button
                  onClick={() => { setLoginMode('otp'); setError(null) }}
                  className="w-full py-3 px-4 bg-white text-steps-blue-700 font-semibold rounded-xl border-2 border-steps-blue-500 hover:bg-steps-blue-50 focus:ring-2 focus:ring-steps-blue-500 focus:ring-offset-2 transition"
                >
                  Create one now
                </button>
                <p className="text-[11px] text-gray-400 text-center mt-2">
                  We&rsquo;ll email you a verification code to get started.
                </p>
              </div>
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition mb-4"
              />
              <button
                onClick={handleSendOtp}
                disabled={loading || !email.trim()}
                className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : null}
                {loading ? 'Sending code...' : 'Send verification code'}
              </button>
              <div className="mt-6 pt-5 border-t border-gray-100">
                <p className="text-xs text-gray-500 text-center mb-3">
                  Already have a Steps account?
                </p>
                <button
                  onClick={() => { setLoginMode('password'); setError(null) }}
                  className="w-full py-3 px-4 bg-white text-steps-blue-700 font-semibold rounded-xl border-2 border-steps-blue-500 hover:bg-steps-blue-50 focus:ring-2 focus:ring-steps-blue-500 focus:ring-offset-2 transition"
                >
                  Sign in with password
                </button>
                <p className="text-[11px] text-gray-400 text-center mt-2">
                  Faster if you&rsquo;ve applied before.
                </p>
              </div>
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
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition text-center text-2xl tracking-[0.3em] font-mono mb-4"
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otpCode.length < 6}
            className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue flex items-center justify-center gap-2"
          >
            {loading ? <Spinner /> : null}
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            onClick={() => { setStep('email'); setOtpCode(''); setError(null) }}
            className="w-full mt-3 py-2 text-sm text-steps-blue-600 hover:text-steps-blue-700 font-medium"
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
            <div className="mb-6 p-4 bg-steps-blue-50 border border-steps-blue-100 rounded-xl text-steps-blue-700 text-sm">
              Welcome back! We&apos;ve pre-filled your details from your last application.
              Please review and update anything that&apos;s changed.
            </div>
          )}



          <h2 className="text-lg font-semibold text-gray-900 mb-6">About you</h2>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div data-error-key="firstName">
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name <span className="text-red-400">*</span>
              </label>
              <input id="firstName" type="text" value={firstName}
                onChange={e => { setFirstName(e.target.value); clearFieldError('firstName') }}
                className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition ${fieldErrors.firstName ? 'border-red-400 bg-red-50/30' : 'border-gray-200'}`} />
              {fieldErrors.firstName && <p className="mt-1 text-xs text-red-600">{fieldErrors.firstName}</p>}
            </div>
            <div data-error-key="lastName">
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                Last name <span className="text-red-400">*</span>
              </label>
              <input id="lastName" type="text" value={lastName}
                onChange={e => { setLastName(e.target.value); clearFieldError('lastName') }}
                className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition ${fieldErrors.lastName ? 'border-red-400 bg-red-50/30' : 'border-gray-200'}`} />
              {fieldErrors.lastName && <p className="mt-1 text-xs text-red-600">{fieldErrors.lastName}</p>}
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} disabled
              className="w-full px-4 py-2.5 border border-gray-100 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed" />
          </div>

          {/* School */}
          <div className="mb-4" data-error-key="school">
            <label htmlFor="school" className="block text-sm font-medium text-gray-700 mb-1">
              Current school / sixth form college <span className="text-red-400">*</span>
            </label>
            <SchoolPicker value={school} onChange={v => { setSchool(v); clearFieldError('school') }} placeholder="Search for your school…" id="school" />
            {fieldErrors.school && <p className="mt-1 text-xs text-red-600">{fieldErrors.school}</p>}
          </div>

          {/* Year group */}
          <div className="mb-6" data-error-key="yearGroup">
            <label htmlFor="yearGroup" className="block text-sm font-medium text-gray-700 mb-1">
              Year group <span className="text-red-400">*</span>
            </label>
            <select id="yearGroup" value={yearGroup}
              onChange={e => { setYearGroup(e.target.value ? Number(e.target.value) : ''); clearFieldError('yearGroup') }}
              className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white ${fieldErrors.yearGroup ? 'border-red-400 bg-red-50/30' : 'border-gray-200'}`}>
              <option value="">Select…</option>
              <option value={12}>Year 12</option>
              <option value={13}>Year 13</option>
              <option value={14}>Gap year</option>
            </select>
            {fieldErrors.yearGroup && <p className="mt-1 text-xs text-red-600">{fieldErrors.yearGroup}</p>}
          </div>

          {/* --- Contextual & Socioeconomic --- */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Contextual information</h3>
            <p className="text-gray-500 text-xs mb-4">
              This helps us ensure our events reach students from underrepresented backgrounds.
            </p>

            {isIndependentSchool(school.typeGroup) ? (
              <fieldset className="mb-4" data-error-key="schoolType">
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
                      onChange={e => { setSchoolType(e.target.value); clearFieldError('schoolType') }}
                      className="mt-0.5 accent-steps-blue-600" />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
                {fieldErrors.schoolType && <p className="mt-1 text-xs text-red-600">{fieldErrors.schoolType}</p>}
              </fieldset>
            ) : (
              <fieldset className="mb-4" data-error-key="schoolType">
                <legend className="block text-sm font-medium text-gray-700 mb-2">
                  What type of school do you currently attend? <span className="text-red-400">*</span>
                </legend>
                {SCHOOL_TYPE_OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 py-1.5 cursor-pointer">
                    <input type="radio" name="schoolType" value={opt.value}
                      checked={schoolType === opt.value}
                      onChange={e => { setSchoolType(e.target.value); clearFieldError('schoolType') }}
                      className="mt-0.5 accent-steps-blue-600" />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
                {fieldErrors.schoolType && <p className="mt-1 text-xs text-red-600">{fieldErrors.schoolType}</p>}
              </fieldset>
            )}

            <fieldset className="mb-4" data-error-key="householdIncome">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                Is your average household income less than £40,000? <span className="text-red-400">*</span>
              </legend>
              {[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }, { v: 'prefer_not_to_say', l: 'Prefer not to say' }].map(opt => (
                <label key={opt.v} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="radio" name="income" value={opt.v} checked={householdIncome === opt.v}
                    onChange={e => { setHouseholdIncome(e.target.value); clearFieldError('householdIncome') }} className="accent-steps-blue-600" />
                  <span className="text-sm text-gray-700">{opt.l}</span>
                </label>
              ))}
              {fieldErrors.householdIncome && <p className="mt-1 text-xs text-red-600">{fieldErrors.householdIncome}</p>}
            </fieldset>

            <fieldset className="mb-4" data-error-key="freeSchoolMeals">
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
                    onChange={e => { setFreeSchoolMeals(e.target.value); clearFieldError('freeSchoolMeals') }}
                    className="accent-steps-blue-600" />
                  <span className="text-sm text-gray-700">{opt.l}</span>
                </label>
              ))}
              {fieldErrors.freeSchoolMeals && <p className="mt-1 text-xs text-red-600">{fieldErrors.freeSchoolMeals}</p>}
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
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition resize-none" />
            </div>
          </div>

          <button onClick={handleDetailsNext}
            className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue">
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
          <div className="mb-6" data-error-key="gcseResults">
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
              onChange={e => { setGcseResults(e.target.value.replace(/\D/g, '')); clearFieldError('gcseResults') }}
              placeholder="e.g. 999887766"
              className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition font-mono tracking-wider ${fieldErrors.gcseResults ? 'border-red-400 bg-red-50/30' : 'border-gray-200'}`}
            />
            {fieldErrors.gcseResults && <p className="mt-1 text-xs text-red-600">{fieldErrors.gcseResults}</p>}
          </div>

          {/* --- Qualifications --- */}
          <div className="mb-6" data-error-key="qualifications">
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
                    onChange={e => { updateQualification(idx, 'qualType', e.target.value); clearFieldError('qualifications') }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition mb-2">
                    {QUAL_TYPES.map(qt => (
                      <option key={qt.value} value={qt.value}>{qt.label}</option>
                    ))}
                  </select>

                  <div className={`grid gap-2 ${q.qualType === 'ib' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <select value={q.subject}
                      onChange={e => { updateQualification(idx, 'subject', e.target.value); clearFieldError('qualifications') }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                      <option value="">Select subject…</option>
                      {(SUBJECTS[q.qualType] ?? []).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="__other">Other (not listed)</option>
                    </select>

                    {q.qualType === 'ib' && (
                      <select value={q.level ?? ''}
                        onChange={e => { updateQualification(idx, 'level', e.target.value); clearFieldError('qualifications') }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                        <option value="">Level…</option>
                        {IB_LEVELS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    )}

                    <select value={q.grade}
                      onChange={e => { updateQualification(idx, 'grade', e.target.value); clearFieldError('qualifications') }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                      <option value="">Grade…</option>
                      {(GRADES[q.qualType] ?? []).map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  {q.subject === '__other' && (
                    <input type="text" placeholder="Type your subject name…"
                      className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
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
              className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-steps-blue-600 font-medium hover:border-steps-blue-300 hover:bg-steps-blue-50 transition">
              + Add another subject
            </button>
            {fieldErrors.qualifications && <p className="mt-2 text-xs text-red-600">{fieldErrors.qualifications}</p>}
          </div>

          {/* --- Custom form fields from form_config --- */}
          {formPages.length > 0 ? (
            /* Multi-page mode */
            <div className="border-t border-gray-100 pt-6 mb-6">
              {/* Page indicator */}
              <div className="flex items-center gap-2 mb-4">
                {formPages.map((pg, pi) => (
                  <div key={pg.id} className={`flex items-center gap-1 text-xs ${pi === customPageIdx ? 'text-steps-blue-600 font-semibold' : 'text-gray-400'}`}>
                    {pi > 0 && <span className="text-gray-300 mx-1">→</span>}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${pi === customPageIdx ? 'bg-steps-blue-600 text-white' : pi < customPageIdx ? 'bg-steps-blue-200 text-steps-blue-700' : 'bg-gray-200 text-gray-500'}`}>{pi + 1}</span>
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
                <div key={field.id} data-error-key={`customField:${field.id}`}>
                  <DynamicFormField
                    field={field}
                    value={customFieldValues[field.id]}
                    onChange={handleCustomFieldChange}
                    allValues={customFieldValues}
                  />
                  {fieldErrors[`customField:${field.id}`] && (
                    <p className="-mt-3 mb-4 text-xs text-red-600">{fieldErrors[`customField:${field.id}`]}</p>
                  )}
                </div>
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
                    className="flex-1 py-2 bg-steps-blue-600 text-white text-sm font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150">
                    Next →
                  </button>
                )}
              </div>
            </div>
          ) : formFields.length > 0 ? (
            /* Single-page mode (backward compat) */
            <div className="border-t border-gray-100 pt-6 mb-6">
              {formFields.map(field => (
                <div key={field.id} data-error-key={`customField:${field.id}`}>
                  <DynamicFormField
                    field={field}
                    value={customFieldValues[field.id]}
                    onChange={handleCustomFieldChange}
                    allValues={customFieldValues}
                  />
                  {fieldErrors[`customField:${field.id}`] && (
                    <p className="-mt-3 mb-4 text-xs text-red-600">{fieldErrors[`customField:${field.id}`]}</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {/* --- Attribution + consent --- */}
          <div className="border-t border-gray-100 pt-6 mb-6">
            <fieldset className="mb-6" data-error-key="attribution">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                How did you hear about this opportunity? <span className="text-red-400">*</span>
              </legend>
              {ATTRIBUTION_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-3 py-1.5 cursor-pointer">
                  <input type="radio" name="attribution" value={opt.value}
                    checked={attribution === opt.value}
                    onChange={e => { setAttribution(e.target.value); clearFieldError('attribution') }}
                    className="accent-steps-blue-600" />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
              {fieldErrors.attribution && <p className="mt-1 text-xs text-red-600">{fieldErrors.attribution}</p>}
            </fieldset>


          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep('details'); setError(null) }}
              className="px-6 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
              Back
            </button>
            <button onClick={handleSubmit}
              disabled={alreadyApplied && !hasFormChanges}
              className="flex-1 py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue">
              {alreadyApplied ? (hasFormChanges ? 'Update application' : 'No changes to update') : 'Submit application'}
            </button>
          </div>
        </div>
      )}

      {/* SUBMITTING */}
      {step === 'submitting' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <Spinner large />
          <p className="text-gray-600 mt-4">Submitting your application…</p>
          <SubmittingHints />
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
              className="px-6 py-2.5 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 text-sm"
            >
              Edit my application
            </button>
            <a
              href="/my"
              className="px-6 py-2.5 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium"
            >
              Go to Student Hub
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

          {!passwordSaved && !hasPassword && !alreadyApplied ? (
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
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition" />
                <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition" />
              </div>
              <div className="flex gap-3">
                <a href="/my"
                  className="px-6 py-2.5 text-sm text-gray-500 hover:text-gray-700 font-medium">No thanks, go to hub</a>
                <button onClick={handlePasswordUpgrade} disabled={loading || password.length < 6}
                  className="flex-1 py-2.5 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue flex items-center justify-center gap-2">
                  {loading ? <Spinner /> : null}
                  Save password
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-100 pt-6 text-center">
              {passwordSaved && (
                <>
                  <p className="text-green-600 font-medium mb-2">Password saved!</p>
                  <p className="text-gray-500 text-sm mb-4">
                    Next time, you can sign in with your email and password at{' '}
                    <strong className="text-gray-700">{email}</strong>.
                  </p>
                </>
              )}
              <a
                href="/my"
                className="inline-block px-6 py-2.5 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 text-sm"
              >
                Go to Student Hub
              </a>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-slate-400 mt-10 tracking-wide uppercase">
        <em className="not-italic">Virtus non origo</em> &nbsp;·&nbsp; Character, not origin
      </p>
    </div>
    </>
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
