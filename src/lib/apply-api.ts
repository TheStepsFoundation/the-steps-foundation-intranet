/**
 * Public-facing API for the student application flow.
 *
 * Uses Supabase OTP auth — students verify their email with a one-time code,
 * then read/write their own student record and create applications.
 * RLS policies (0006) enforce that students can only access their own data.
 */

import { supabase } from './supabase-student'
import { formatOpenTo } from './events-api'
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
  // Profile fields promoted from application raw_response in migration 0024/0025.
  // These persist across applications so students don't re-enter them each time.
  first_generation_uni: boolean | null
  gcse_results: string | null
  qualifications: QualificationEntry[] | null
  additional_context: string | null
}

export type QualificationEntry = {
  qualType: string        // 'a_level' | 'ib' | 'btec' | 't_level' | 'pre_u'
  subject: string
  level?: string          // IB: 'HL' | 'SL'; BTEC size, etc.
  grade: string           // A*–U for A-Level, 7–1 for IB, D*/D/M/P for BTEC, etc.
}



// ---------------------------------------------------------------------------
// Name normalisation — strips invisible marks (LTR/RTL, zero-width), replaces
// curly apostrophes with straight, collapses whitespace. Applied on submit so
// the student DB stays clean regardless of what keyboard the student used.
// ---------------------------------------------------------------------------
export function normalizeName(raw: string): string {
  return (raw ?? '')
    // Strip LTR/RTL/embedding marks + zero-width chars that sneak in from phone keyboards
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    // Curly single quotes -> straight
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    // Curly double quotes -> straight (rare in names but normalise anyway)
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    // Collapse internal whitespace runs to a single space
    .replace(/\s+/g, ' ')
    .trim()
}

// Non-sensitive columns we fetch for the pre-fill
const STUDENT_SELF_COLUMNS =
  'id,first_name,last_name,personal_email,school_id,school_name_raw,year_group,school_type,free_school_meals,parental_income_band,first_generation_uni,gcse_results,qualifications,additional_context'

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
): Promise<{ error: string | null; hasSession: boolean }> {
  const normalizedEmail = email.toLowerCase().trim()
  console.log('[verifyOtp] calling with email=', normalizedEmail)
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizedEmail,
    token,
    type: 'email',
  })
  console.log('[verifyOtp] response: error=', error, 'hasSession=', !!data?.session, 'hasUser=', !!data?.user)
  if (error) return { error: error.message, hasSession: false }
  if (!data?.session) {
    return { error: 'Verified, but sign-in did not complete. Please try again.', hasSession: false }
  }
  // Belt-and-braces: explicitly set the session into the client so the tokens
  // are both persisted to storage AND held in memory. Without this, there was
  // a race where verifyOtp's internal persist hadn't flushed before the next
  // page mount tried to read it via getSession.
  const setRes = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
  console.log('[verifyOtp] setSession: error=', setRes.error, 'hasSession=', !!setRes.data?.session)
  if (typeof window !== 'undefined') {
    const keys = Object.keys(window.localStorage)
    const sbKeys = keys.filter(k => k.startsWith('sb-'))
    console.log('[verifyOtp] localStorage sb-* keys AFTER setSession:', sbKeys)
  }
  // Immediately verify the session is readable back from the client.
  const checkSession = await supabase.auth.getSession()
  console.log('[verifyOtp] getSession readback: hasSession=', !!checkSession.data?.session, 'error=', checkSession.error)
  return { error: null, hasSession: true }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null; hasSession: boolean }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  })
  if (error) return { error: error.message, hasSession: false }
  if (!data?.session) {
    return { error: 'Signed in, but session did not persist. Please try again.', hasSession: false }
  }
  await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
  return { error: null, hasSession: true }
}

export async function upgradeToPassword(
  password: string,
): Promise<{ error: string | null }> {
  // Flag user_metadata.password_set = true in the same call so the hub can
  // stop prompting them. This is advisory only — the real source of truth
  // for "has a password" is whether signInWithPassword works.
  const { error } = await supabase.auth.updateUser({
    password,
    data: { password_set: true },
  })
  if (error) return { error: error.message }
  // Force a session refresh so the new JWT (with updated user object) is
  // persisted to localStorage before the UI moves on. Without this, the
  // next page load can find no session and bounce back to sign-in.
  await supabase.auth.refreshSession()
  return { error: null }
}

/**
 * Has the signed-in user already set a password? Read from user_metadata
 * rather than inspecting AMR (AMR is not reliably exposed on the client).
 * This is only used to decide whether to show the "Set a password" prompt —
 * it's fine if it's occasionally wrong; the password form will just appear.
 */
export async function hasPasswordSet(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  const meta = session?.user?.user_metadata as Record<string, unknown> | undefined
  return Boolean(meta?.password_set)
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
// Two-stage apply flow (2026-04-23)
// ---------------------------------------------------------------------------
//
// Stage 1 captures profile data that persists across applications (stored on
// the students row). Stage 2 captures event-specific data (custom form fields,
// attribution) and writes the applications row.
//
// Eligibility is checked between stages: ineligible students complete a
// shortened stage 2 (attribution only) and their application row is written
// with status 'ineligible'. No email is sent.
// ---------------------------------------------------------------------------

export type ProfileSubmission = {
  // Identity
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
  freeSchoolMealsRaw: string
  // New profile fields (students columns)
  firstGenerationUni: boolean | null
  additionalContext: string
  gcseResults: string
  qualifications: QualificationEntry[]
}

export type Stage2Submission = {
  customFields: Record<string, unknown>
  anythingElse: string
  attributionSource: string
}

export type ProfileResult = {
  error: string | null
  studentId?: string
  isEligible?: boolean
  openToLabel?: string   // "year 13 and gap year students" — for the ineligibility message
}

/**
 * Stage 1: upsert the student profile and return eligibility for the event.
 * No application row is written here — the caller decides which stage-2
 * flow to show based on isEligible.
 */
export async function submitProfile(
  eventId: string,
  profile: ProfileSubmission,
): Promise<ProfileResult> {
  const session = await ensureFreshSession()
  if (!session.ok) {
    return { error: 'Your session has expired. Please sign out and sign back in, then resubmit. Your answers are saved on this device.' }
  }

  const email = await currentUserEmail()
  if (!email) {
    return { error: 'Your session has expired. Please sign out and sign back in, then resubmit. Your answers are saved on this device.' }
  }

  // Fetch event eligibility criteria upfront (same call shape as submitApplication)
  const eligibilityCheck = await runWithRetry(
    () => supabase.from('events').select('eligible_year_groups, open_to_gap_year').eq('id', eventId).maybeSingle(),
    'events.eligibility',
  )
  if (eligibilityCheck.error) {
    return { error: `Could not verify event eligibility: ${eligibilityCheck.error.message}` }
  }
  const allowedYears = (eligibilityCheck.data?.eligible_year_groups ?? null) as number[] | null
  const openToGapYear = !!eligibilityCheck.data?.open_to_gap_year
  const openToLabel = formatOpenTo(allowedYears, openToGapYear)

  const hasFilter = (allowedYears && allowedYears.length > 0) || openToGapYear
  let isEligible = true
  if (hasFilter) {
    const yg = profile.yearGroup
    const inYears = yg != null && !!allowedYears && allowedYears.includes(yg)
    const isEligibleGap = yg === 14 && openToGapYear
    isEligible = yg != null && (inYears || isEligibleGap)
  }

  // Map household income answer to income band code
  const incomeBand = profile.householdIncomeUnder40k === 'yes'
    ? 'under_40k'
    : profile.householdIncomeUnder40k === 'no'
      ? 'over_40k'
      : 'prefer_na'

  // Build student payload — includes the new profile columns (gcse_results,
  // qualifications, additional_context, first_generation_uni). RLS allows the
  // student to write their own row. `coalesce(... , null)` semantics via
  // `?? null` keep empty strings out of text columns.
  const studentPayload = {
    first_name: normalizeName(profile.firstName),
    last_name: normalizeName(profile.lastName),
    personal_email: email,
    school_id: profile.schoolId,
    school_name_raw: profile.schoolNameRaw,
    year_group: profile.yearGroup,
    school_type: profile.schoolType,
    bursary_90plus: profile.schoolType === 'independent_bursary' ? true : null,
    free_school_meals: profile.freeSchoolMeals,
    parental_income_band: incomeBand,
    first_generation_uni: profile.firstGenerationUni,
    gcse_results: profile.gcseResults?.trim() || null,
    qualifications: profile.qualifications?.length ? profile.qualifications : null,
    additional_context: profile.additionalContext?.trim() || null,
  }

  let studentId: string
  try {
    const upd = await runWithRetry(
      () => supabase.from('students').update(studentPayload).eq('personal_email', email).select('id'),
      'students.update',
    )
    if (upd.error) return { error: `Failed to save your details: ${upd.error.message}` }

    if (upd.data && upd.data.length > 0) {
      studentId = upd.data[0].id
    } else {
      const ins = await runWithRetry(
        () => supabase.from('students').insert(studentPayload).select('id').single(),
        'students.insert',
      )
      if (ins.error || !ins.data) {
        return { error: `Failed to create your record: ${ins.error?.message ?? 'unknown error'}` }
      }
      studentId = ins.data.id
    }
  } catch (err: any) {
    return {
      error: err?.message?.includes('timed out')
        ? 'The server is responding slowly. Please check your connection and try again — your answers are saved on this device.'
        : `Could not save your details: ${err?.message ?? 'network error'}`,
    }
  }

  return { error: null, studentId, isEligible, openToLabel }
}

/**
 * Stage 2: upsert the application row. Status is 'submitted' if eligible and
 * 'ineligible' otherwise. For ineligible rows the raw_response is minimal
 * (no custom fields, no anythingElse) — we just record the attempt so admins
 * can see who tried and where they heard about the event.
 */
export async function submitEventApplication(
  eventId: string,
  studentId: string,
  stage2: Stage2Submission,
  options: { eligible: boolean; isTest?: boolean },
): Promise<{ error: string | null; applicationId?: string }> {
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

  const status = options.eligible ? 'submitted' : 'ineligible'

  // For ineligible applicants we only persist attribution. Custom fields and
  // `anythingElse` are event-specific + only shown to eligible applicants.
  const rawResponse = options.eligible
    ? {
        custom_fields: stage2.customFields,
        anything_else: stage2.anythingElse,
      }
    : {
        // Flag the row so future admin UIs can distinguish auto-screened
        // attempts from manual ineligibility edits.
        ineligible_attempt: true,
      }

  try {
    const existingLookup = await runWithRetry(
      () => supabase
        .from('applications')
        .select('id, status')
        .eq('student_id', studentId)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .maybeSingle(),
      'applications.lookup',
    )
    const existingApp = existingLookup.data as { id: string; status: string } | null

    if (existingApp) {
      // Don't overwrite a meaningful status (e.g. accepted/shortlisted) just
      // because the student re-submitted. Only promote 'ineligible' → 'submitted'
      // if they've become eligible, or keep existing status otherwise.
      const nextStatus =
        existingApp.status === 'ineligible' && options.eligible ? 'submitted' :
        existingApp.status === 'submitted' && !options.eligible ? 'ineligible' :
        existingApp.status
      const upd = await runWithRetry(
        () => supabase
          .from('applications')
          .update({
            status: nextStatus,
            raw_response: rawResponse,
            channel: stage2.attributionSource,
            attribution_source: attributionMap[stage2.attributionSource] || 'other',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingApp.id),
        'applications.update',
      )
      if (upd.error) return { error: `Failed to update application: ${upd.error.message}` }
      return { error: null, applicationId: existingApp.id }
    }

    const ins = await runWithRetry(
      () => supabase
        .from('applications')
        .insert({
          student_id: studentId,
          event_id: eventId,
          status,
          raw_response: rawResponse,
          channel: stage2.attributionSource,
          attribution_source: attributionMap[stage2.attributionSource] || 'other',
          is_test: options.isTest ? true : false,
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
    return { error: null, applicationId: ins.data.id }
  } catch (err: any) {
    return {
      error: err?.message?.includes('timed out')
        ? 'The server is responding slowly. Please check your connection and try again — your answers are saved on this device.'
        : `Could not submit your application: ${err?.message ?? 'network error'}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Server-side application drafts (apply_drafts table)
//
// Companion to the localStorage drafts in apply-draft.ts — but persisted
// server-side so the same email can resume on another device, and so the
// scheduled stale-reminder cron has something to query against. Writes
// are debounced from the apply page; reads happen on apply-page mount
// to merge any newer server state into the local draft.
// ---------------------------------------------------------------------------

export type ApplyDraftPayload = Record<string, unknown>

export async function upsertApplyDraft(eventId: string, email: string, payload: ApplyDraftPayload): Promise<void> {
  if (!email) return
  const normEmail = email.toLowerCase().trim()
  if (!normEmail) return
  const { error } = await supabase
    .from('apply_drafts')
    .upsert({
      event_id: eventId,
      email: normEmail,
      payload,
      last_touched_at: new Date().toISOString(),
      reminded_at: null,
    }, { onConflict: 'event_id,email' })
  if (error) {
    // Soft-fail — drafts are a nicety, not core path
    // eslint-disable-next-line no-console
    console.warn('[apply_drafts.upsert]', error.message)
  }
}

export async function fetchApplyDraft(eventId: string, email: string): Promise<ApplyDraftPayload | null> {
  if (!email) return null
  const normEmail = email.toLowerCase().trim()
  if (!normEmail) return null
  const { data, error } = await supabase
    .from('apply_drafts')
    .select('payload')
    .eq('event_id', eventId)
    .eq('email', normEmail)
    .is('completed_at', null)
    .maybeSingle()
  if (error) return null
  return ((data as { payload: ApplyDraftPayload } | null)?.payload) ?? null
}

export async function markApplyDraftComplete(eventId: string, email: string): Promise<void> {
  if (!email) return
  const normEmail = email.toLowerCase().trim()
  if (!normEmail) return
  await supabase
    .from('apply_drafts')
    .update({ completed_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .eq('email', normEmail)
}
