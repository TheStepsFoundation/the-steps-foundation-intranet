/**
 * Public-facing API for the student application flow.
 *
 * Uses Supabase OTP auth — students verify their email with a one-time code,
 * then read/write their own student record and create applications.
 * RLS policies (0006) enforce that students can only access their own data.
 */

import { supabase } from './supabase'
// ---------------------------------------------------------------------------
// Auth helper — prefer getSession() (local, instant) over getUser() (network).
// getUser() can fail if the JWT hasn't refreshed yet or the network hiccups.
// ---------------------------------------------------------------------------

async function currentUserEmail(): Promise<string | null> {
  // Try local session first (no network call)
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.email) return session.user.email.toLowerCase()
  // Fallback: server-validated (slower, can fail)
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email?.toLowerCase() ?? null
}


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StudentSelf = {
  id: string
  first_name: string | null
  last_name: string | null
  personal_email: string | null
  school_id: string | null
  school_name_raw: string | null
  year_group: number | null
  school_type: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
}

export type QualificationEntry = {
  qualType: string        // 'a_level' | 'ib' | 'btec' | 't_level' | 'pre_u'
  subject: string
  level?: string          // IB: 'HL' | 'SL'; BTEC size, etc.
  grade: string           // A*–U for A-Level, 7–1 for IB, D*/D/M/P for BTEC, etc.
}

export type ApplicationSubmission = {
  // Student identity (upserted)
  firstName: string
  lastName: string
  email: string
  schoolId: string | null
  schoolNameRaw: string | null
  yearGroup: number
  // Socioeconomic
  schoolType: string       // state | grammar | independent | independent_bursary
  freeSchoolMeals: boolean | null
  householdIncomeUnder40k: string  // yes | no | prefer_not_to_say
  additionalContext: string
  // Academics
  gcseResults: string
  qualifications: QualificationEntry[]
  // Custom form fields (configured per event via form_config)
  customFields: Record<string, unknown>
  // Attribution
  attributionSource: string
  // Raw form values for raw_response (preserves granularity lost in boolean mapping)
  freeSchoolMealsRaw: string  // 'yes' | 'previously' | 'no'
}

// Non-sensitive columns we fetch for the pre-fill
const STUDENT_SELF_COLUMNS =
  'id,first_name,last_name,personal_email,school_id,school_name_raw,year_group,school_type,free_school_meals,parental_income_band'

// ---------------------------------------------------------------------------
// OTP Auth
// ---------------------------------------------------------------------------

export async function sendOtp(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.toLowerCase().trim(),
    options: {
      shouldCreateUser: true,
    },
  })
  if (error) return { error: error.message }
  return { error: null }
}

export async function verifyOtp(
  email: string,
  token: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.toLowerCase().trim(),
    token,
    type: 'email',
  })
  if (error) return { error: error.message }
  return { error: null }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  })
  if (error) return { error: error.message }
  return { error: null }
}

export async function upgradeToPassword(
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }
  // Force a session refresh so the new JWT (with updated user object) is
  // persisted to localStorage before the UI moves on. Without this, the
  // next page load can find no session and bounce back to sign-in.
  await supabase.auth.refreshSession()
  return { error: null }
}

export async function signOutStudent(): Promise<void> {
  await supabase.auth.signOut()
}

export async function getExistingSession(): Promise<{ email: string } | null> {
  const email = await currentUserEmail()
  if (!email) return null
  return { email }
}


// Check if current user has a password set (vs OTP-only)
export async function userHasPassword(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return false
  // Supabase stores identities — if email identity exists with provider 'email',
  // and user has logged in with password before, they have one.
  // Simplest check: try the user's identities for 'email' provider
  const identities = session.user.identities ?? []
  const emailIdentity = identities.find(i => i.provider === 'email')
  if (!emailIdentity) return false
  // If the user was created via OTP only, identity_data won't have a password hash.
  // But we can't see the hash client-side. Best heuristic: check AMR claims.
  const amr = (session as any).amr ?? []
  // If they've ever signed in with password, 'password' will be in AMR
  if (amr.some((a: any) => a.method === 'password')) return true
  // Fallback: if last_sign_in_at exists on identity and provider is email,
  // they likely have a password. But we can't be 100% sure without AMR.
  // So also check if the user object has a confirmed_at (password users do)
  return false
}

// ---------------------------------------------------------------------------
// Student Lookup (post-OTP, reads own row via RLS)
// ---------------------------------------------------------------------------

export async function lookupSelf(): Promise<StudentSelf | null> {
  const email = await currentUserEmail()
  if (!email) return null

  const { data, error } = await supabase
    .from('students')
    .select(STUDENT_SELF_COLUMNS)
    .eq('personal_email', email)
    .maybeSingle()

  if (error) {
    console.error('lookupSelf error:', error)
    return null
  }
  return data as StudentSelf | null
}

// Check if student already applied to a specific event
export async function hasExistingApplication(eventId: string): Promise<boolean> {
  const email = await currentUserEmail()
  if (!email) return false

  // First get the student id
  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()

  if (!student) return false

  const { data } = await supabase
    .from('applications')
    .select('id')
    .eq('student_id', student.id)
    .eq('event_id', eventId)
    .maybeSingle()

  return !!data
}




// ---------------------------------------------------------------------------
// Fetch Existing Application (for edit mode)
// ---------------------------------------------------------------------------

export type ExistingApplicationData = {
  id: string
  raw_response: {
    gcse_results?: string
    qualifications?: { qualType: string; subject: string; grade: string; level?: string }[]
    custom_fields?: Record<string, unknown>
    additional_context?: string
    household_income_under_40k?: string
    free_school_meals_raw?: string
  } | null
  attribution_source?: string | null
  channel?: string | null
}

export async function fetchExistingApplication(eventId: string): Promise<ExistingApplicationData | null> {
  const email = await currentUserEmail()
  if (!email) return null

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()

  if (!student) return null

  const { data } = await supabase
    .from('applications')
    .select('id, raw_response, attribution_source, channel')
    .eq('student_id', student.id)
    .eq('event_id', eventId)
    .maybeSingle()

  if (!data) return null
  return data as ExistingApplicationData
}

// ---------------------------------------------------------------------------
// Fetch Event Form Config (public — for application form)
// ---------------------------------------------------------------------------

export async function fetchEventFormConfig(
  eventId: string,
): Promise<{ fields: import('@/lib/events-api').FormFieldConfig[]; pages?: import('@/lib/events-api').FormPage[] }> {
  const { data, error } = await supabase
    .from('events')
    .select('form_config')
    .eq('id', eventId)
    .maybeSingle()

  if (error || !data || !data.form_config) return { fields: [] }
  return data.form_config as { fields: import('@/lib/events-api').FormFieldConfig[]; pages?: import('@/lib/events-api').FormPage[] }
}

// ---------------------------------------------------------------------------
// Submit Application
// ---------------------------------------------------------------------------

/**
 * Upserts the student record and creates an application in two steps.
 * Both operations go through RLS (student can only write their own row).
 */
export async function submitApplication(
  eventId: string,
  submission: ApplicationSubmission,
): Promise<{ error: string | null; studentId?: string; applicationId?: string }> {
  const email = await currentUserEmail()
  if (!email) return { error: 'Your session has expired. Please sign out and sign back in.' }

  // Map the household income answer to an income band code
  const incomeBand = submission.householdIncomeUnder40k === 'yes'
    ? 'under_40k'
    : submission.householdIncomeUnder40k === 'no'
      ? 'over_40k'
      : 'prefer_na'

  // Map school type to bursary flag for backward compat
  const bursary90plus = submission.schoolType === 'independent_bursary'

  // --- Step 1: Upsert student ---
  const studentPayload = {
    first_name: submission.firstName.trim(),
    last_name: submission.lastName.trim(),
    personal_email: email,
    school_id: submission.schoolId,
    school_name_raw: submission.schoolNameRaw,
    year_group: submission.yearGroup,
    school_type: submission.schoolType === 'independent_bursary'
      ? 'independent' as const
      : submission.schoolType,
    bursary_90plus: bursary90plus,
    free_school_meals: submission.freeSchoolMeals,
    parental_income_band: incomeBand,
  }

  // Check if student exists
  const existing = await lookupSelf()
  let studentId: string

  if (existing) {
    const { data, error } = await supabase
      .from('students')
      .update(studentPayload)
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error) return { error: `Failed to update your details: ${error.message}` }
    studentId = data.id
  } else {
    const { data, error } = await supabase
      .from('students')
      .insert(studentPayload)
      .select('id')
      .single()
    if (error) return { error: `Failed to create your record: ${error.message}` }
    studentId = data.id
  }

  // --- Step 2: Create application ---
  const rawResponse = {
    gcse_results: submission.gcseResults,
    qualifications: submission.qualifications,
    custom_fields: submission.customFields,
    additional_context: submission.additionalContext,
    household_income_under_40k: submission.householdIncomeUnder40k,
    free_school_meals_raw: submission.freeSchoolMealsRaw,
  }

  // Map attribution to our standard codes
  const attributionMap: Record<string, string> = {
    'email_invite': 'email',
    'school_teacher': 'teacher_newsletter',
    'linkedin': 'linkedin',
    'instagram': 'instagram',
    'tiktok': 'tiktok',
    'friend_word_of_mouth': 'word_of_mouth',
    'previous_steps_event': 'word_of_mouth',
    'previous_steps_application': 'word_of_mouth',
    'other': 'other',
  }

  // Check for existing application (edit mode)
  const { data: existingApp } = await supabase
    .from('applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('event_id', eventId)
    .maybeSingle()

  if (existingApp) {
    // UPDATE existing application
    const { error: updateErr } = await supabase
      .from('applications')
      .update({
        raw_response: rawResponse,
        channel: submission.attributionSource,
        attribution_source: attributionMap[submission.attributionSource] || 'other',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingApp.id)

    if (updateErr) return { error: `Failed to update application: ${updateErr.message}` }
    return { error: null, studentId, applicationId: existingApp.id }
  }

  // INSERT new application
  const { data: app, error: appError } = await supabase
    .from('applications')
    .insert({
      student_id: studentId,
      event_id: eventId,
      status: 'submitted',
      raw_response: rawResponse,
      channel: submission.attributionSource,
      attribution_source: attributionMap[submission.attributionSource] || 'other',
    })
    .select('id')
    .single()

  if (appError) {
    if (appError.message.includes('unique') || appError.message.includes('duplicate')) {
      return { error: 'You have already submitted an application for this event.' }
    }
    return { error: `Failed to submit application: ${appError.message}` }
  }

  return { error: null, studentId, applicationId: app.id }
}
