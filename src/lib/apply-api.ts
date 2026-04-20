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
  // Fallback: server-validated (slower, can fail). Wrap in a timeout so a
  // hanging refresh never blocks a submit indefinitely.
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), 8000, 'getUser')
    return data.user?.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Resilience helpers — every network call in the submit pipeline goes
// through these so a single slow round-trip can't freeze the form.
// ---------------------------------------------------------------------------

/** Rejects with a labelled error if the promise hasn't settled by `ms`. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[${label}] request timed out after ${ms}ms`)), ms)
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * Run a Supabase call with a timeout. Retry once on timeout or network error.
 * Supabase's `.from(...).select().single()` etc. return a *thenable builder*
 * that we can await directly — that's what we pass in here.
 */
async function runWithRetry<T>(
  factory: () => PromiseLike<T>,
  label: string,
  timeoutMs = 12000,
): Promise<T> {
  try {
    return await withTimeout(factory(), timeoutMs, label)
  } catch (err: any) {
    const msg = String(err?.message ?? err).toLowerCase()
    const isRetriable = msg.includes('timed out') || msg.includes('network') || msg.includes('fetch')
    if (!isRetriable) throw err
    console.warn(`[apply] ${label} failed (${err?.message}) — retrying once`)
    return await withTimeout(factory(), timeoutMs, label)
  }
}

/**
 * Proactively refresh the JWT before submitting. A user who spends several
 * minutes filling the form may have a token that's close to expiry — if it
 * expires mid-pipeline, the first write will hang. Refreshing upfront gives
 * us a clean fresh token and a fast-fail signal if the refresh token itself
 * is dead (so we can tell the student to sign in again BEFORE they lose
 * their form data).
 */
async function ensureFreshSession(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, reason: 'no_session' }

    // Refresh if the access token expires within the next 60 seconds, OR
    // always refresh after a long idle gap (user probably had the tab open
    // a while — cheap insurance).
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0
    const secondsLeft = Math.floor((expiresAt - Date.now()) / 1000)
    if (secondsLeft > 300) return { ok: true }  // > 5 min left, skip refresh

    const { error } = await withTimeout(
      supabase.auth.refreshSession(),
      8000,
      'refreshSession',
    )
    if (error) return { ok: false, reason: error.message }
    return { ok: true }
  } catch (err: any) {
    console.warn('[apply] ensureFreshSession failed:', err?.message)
    return { ok: false, reason: err?.message ?? 'unknown' }
  }
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
  anythingElse: string
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
    anything_else?: string
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
): Promise<{
  fields: import('@/lib/events-api').FormFieldConfig[]
  pages?: import('@/lib/events-api').FormPage[]
  standard_overrides?: import('@/lib/events-api').StandardOverrides
}> {
  const { data, error } = await supabase
    .from('events')
    .select('form_config')
    .eq('id', eventId)
    .maybeSingle()

  if (error || !data || !data.form_config) return { fields: [] }
  return data.form_config as {
    fields: import('@/lib/events-api').FormFieldConfig[]
    pages?: import('@/lib/events-api').FormPage[]
    standard_overrides?: import('@/lib/events-api').StandardOverrides
  }
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
  // -------------------------------------------------------------------------
  // Pre-flight: make sure we have a fresh, valid session before we start
  // hitting the DB. A student who spent 5 minutes on the form may have a
  // token that's minutes from expiry; refreshing up front prevents a
  // mid-pipeline hang and gives us an early-exit signal if the refresh token
  // is itself dead.
  // -------------------------------------------------------------------------
  const session = await ensureFreshSession()
  if (!session.ok) {
    return { error: 'Your session has expired. Please sign out and sign back in, then resubmit. Your answers are saved on this device.' }
  }

  const email = await currentUserEmail()
  if (!email) {
    return { error: 'Your session has expired. Please sign out and sign back in, then resubmit. Your answers are saved on this device.' }
  }

  // Map the household income answer to an income band code
  const incomeBand = submission.householdIncomeUnder40k === 'yes'
    ? 'under_40k'
    : submission.householdIncomeUnder40k === 'no'
      ? 'over_40k'
      : 'prefer_na'

  // -------------------------------------------------------------------------
  // Step 1: Upsert student.
  // independent_bursary is now a first-class school_type (migrated 2026-04-19);
  // no more collapsing it into 'independent' + bursary_90plus=true.
  // -------------------------------------------------------------------------
  const studentPayload = {
    first_name: submission.firstName.trim(),
    last_name: submission.lastName.trim(),
    personal_email: email,
    school_id: submission.schoolId,
    school_name_raw: submission.schoolNameRaw,
    year_group: submission.yearGroup,
    school_type: submission.schoolType,
    bursary_90plus: submission.schoolType === 'independent_bursary' ? true : null,
    free_school_meals: submission.freeSchoolMeals,
    parental_income_band: incomeBand,
  }

  let studentId: string
  try {
    // One round-trip: UPDATE ... WHERE personal_email=? RETURNING id.
    // If the student doesn't exist yet, rows=[], so we INSERT on the next
    // step. Previously this was a SELECT then UPDATE — two trips instead of one.
    const upd = await runWithRetry(
      () => supabase
        .from('students')
        .update(studentPayload)
        .eq('personal_email', email)
        .select('id'),
      'students.update',
    )
    if (upd.error) {
      return { error: `Failed to save your details: ${upd.error.message}` }
    }

    if (upd.data && upd.data.length > 0) {
      studentId = upd.data[0].id
    } else {
      // No existing row — INSERT.
      const ins = await runWithRetry(
        () => supabase
          .from('students')
          .insert(studentPayload)
          .select('id')
          .single(),
        'students.insert',
      )
      if (ins.error || !ins.data) {
        return { error: `Failed to create your record: ${ins.error?.message ?? 'unknown error'}` }
      }
      studentId = ins.data.id
    }
  } catch (err: any) {
    // Timeout / network error after retry
    return {
      error: err?.message?.includes('timed out')
        ? 'The server is responding slowly. Please check your connection and try again — your answers are saved on this device.'
        : `Could not save your details: ${err?.message ?? 'network error'}`,
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Upsert application.
  // -------------------------------------------------------------------------
  const rawResponse = {
    gcse_results: submission.gcseResults,
    qualifications: submission.qualifications,
    custom_fields: submission.customFields,
    additional_context: submission.additionalContext,
    anything_else: submission.anythingElse,
    household_income_under_40k: submission.householdIncomeUnder40k,
    free_school_meals_raw: submission.freeSchoolMealsRaw,
  }

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

  try {
    // Check for an existing LIVE application (edit mode). Soft-deleted rows
    // (deleted_at IS NOT NULL) must be ignored so a student who previously
    // withdrew / was soft-deleted can submit a fresh application. Matching
    // partial unique index: applications_student_event_live_uniq (0019).
    const existingLookup = await runWithRetry(
      () => supabase
        .from('applications')
        .select('id')
        .eq('student_id', studentId)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .maybeSingle(),
      'applications.lookup',
    )
    const existingApp = existingLookup.data

    if (existingApp) {
      const upd = await runWithRetry(
        () => supabase
          .from('applications')
          .update({
            raw_response: rawResponse,
            channel: submission.attributionSource,
            attribution_source: attributionMap[submission.attributionSource] || 'other',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingApp.id),
        'applications.update',
      )
      if (upd.error) return { error: `Failed to update application: ${upd.error.message}` }
      return { error: null, studentId, applicationId: existingApp.id }
    }

    // INSERT new application
    const ins = await runWithRetry(
      () => supabase
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
        .single(),
      'applications.insert',
    )
    if (ins.error || !ins.data) {
      const m = ins.error?.message ?? ''
      if (m.includes('unique') || m.includes('duplicate')) {
        return { error: 'You have already submitted an application for this event.' }
      }
      return { error: `Failed to submit application: ${m || 'unknown error'}` }
    }
    return { error: null, studentId, applicationId: ins.data.id }
  } catch (err: any) {
    return {
      error: err?.message?.includes('timed out')
        ? 'The server is responding slowly. Please check your connection and try again — your answers are saved on this device.'
        : `Could not submit your application: ${err?.message ?? 'network error'}`,
    }
  }
}
