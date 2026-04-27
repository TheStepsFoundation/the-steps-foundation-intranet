/**
 * Student hub API — functions for the student-facing dashboard.
 * All queries go through RLS (students can only read their own data + public events).
 */

import { supabase } from './supabase-student'
import type { StudentSelf, QualificationEntry } from './apply-api'
import type { EventFeedbackConfig } from './events-api'

// ---------------------------------------------------------------------------
// Auth helper (same as apply-api)
// ---------------------------------------------------------------------------

async function currentUserEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.email) return session.user.email.toLowerCase()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email?.toLowerCase() ?? null
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HubEvent = {
  id: string
  name: string
  slug: string
  event_date: string | null
  location: string | null
  location_full: string | null
  format: string | null
  description: string | null
  time_start: string | null
  time_end: string | null
  status: string
  applications_open_at: string | null
  applications_close_at: string | null
  banner_image_url: string | null
  hub_image_url: string | null
  banner_focal_x: number
  banner_focal_y: number
  hub_focal_x: number
  hub_focal_y: number
  /** Year groups eligible to apply. null = open to all year groups. */
  eligible_year_groups: number[] | null
  /** If true, gap-year students (year_group=14) are eligible regardless of eligible_year_groups. */
  open_to_gap_year: boolean
}

export type HubApplicationStatusHistoryRow = {
  status: string | null
  changed_at: string
}

export type HubApplication = {
  id: string
  event_id: string
  status: string
  created_at: string
  event: HubEvent
  /** All prior status transitions. Used to render journey-aware labels like
   *  "Shortlisted · Unsuccessful" on the hub. Never contains admin-only fields. */
  status_history: HubApplicationStatusHistoryRow[]
}

export type ProfileUpdate = {
  first_name: string
  last_name: string
  school_id: string | null
  school_name_raw: string | null
  year_group: number | null
  school_type: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  // Stage-1 profile fields (migration 0024/0025). Editable from the hub so
  // students can keep their answers current across applications.
  first_generation_uni: boolean | null
  gcse_results: string | null
  qualifications: QualificationEntry[] | null
  additional_context: string | null
}

// ---------------------------------------------------------------------------
// Fetch current student profile
// ---------------------------------------------------------------------------

const PROFILE_COLS =
  'id,first_name,last_name,personal_email,school_id,school_name_raw,year_group,school_type,free_school_meals,parental_income_band,first_generation_uni,gcse_results,qualifications,additional_context'

export async function fetchProfile(): Promise<StudentSelf | null> {
  const email = await currentUserEmail()
  if (!email) return null

  const { data } = await supabase
    .from('students')
    .select(PROFILE_COLS)
    .eq('personal_email', email)
    .maybeSingle()

  return data as StudentSelf | null
}

// ---------------------------------------------------------------------------
// Update student profile
// ---------------------------------------------------------------------------

// Enum columns with CHECK constraints or implicit enum semantics — empty
// strings from form state MUST become NULL before hitting Postgres.
// Adding a new enum-ish field? List it here so the hub save path can't
// regress on constraint violations from '' defaults.
const NULLABLE_ENUM_FIELDS: ReadonlyArray<keyof ProfileUpdate> = [
  'school_type',
  'parental_income_band',
] as const

function normalizeProfileUpdate(updates: ProfileUpdate): ProfileUpdate {
  const out: ProfileUpdate = { ...updates }
  for (const field of NULLABLE_ENUM_FIELDS) {
    if (out[field] === '') (out as Record<string, unknown>)[field] = null
  }
  return out
}

export async function updateProfile(
  studentId: string,
  updates: ProfileUpdate,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('students')
    .update(normalizeProfileUpdate(updates))
    .eq('id', studentId)

  if (error) return { error: error.message }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Fetch student's applications (with event details)
// ---------------------------------------------------------------------------

export async function fetchMyApplications(): Promise<HubApplication[]> {
  const email = await currentUserEmail()
  if (!email) return []

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()

  if (!student) return []

  const { data } = await supabase
    .from('applications')
    .select('id, event_id, status, created_at')
    .eq('student_id', student.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (!data || data.length === 0) return []

  // Fetch event details for each application
  const eventIds = [...new Set(data.map(a => a.event_id))]
  const { data: events } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y, eligible_year_groups, open_to_gap_year')
    .in('id', eventIds)

  const eventMap = new Map((events ?? []).map(e => [e.id, e]))

  // Fetch status history for all of this student's applications in one round trip.
  // RLS policy `app_status_history_self_select` filters to the student's own rows.
  const applicationIds = data.map(a => a.id)
  const { data: history } = await supabase
    .from('application_status_history')
    .select('application_id, status, changed_at')
    .in('application_id', applicationIds)
    .order('changed_at', { ascending: true })

  const historyByApp = new Map<string, HubApplicationStatusHistoryRow[]>()
  for (const row of (history ?? []) as Array<{ application_id: string; status: string | null; changed_at: string }>) {
    const list = historyByApp.get(row.application_id) ?? []
    list.push({ status: row.status, changed_at: row.changed_at })
    historyByApp.set(row.application_id, list)
  }

  return data
    .filter(a => eventMap.has(a.event_id))
    .map(a => ({
      ...a,
      event: eventMap.get(a.event_id)! as HubEvent,
      status_history: historyByApp.get(a.id) ?? [],
    }))
}

// ---------------------------------------------------------------------------
// Fetch events open for applications
// ---------------------------------------------------------------------------

export async function fetchOpenEvents(): Promise<HubEvent[]> {
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y, eligible_year_groups, open_to_gap_year')
    .is('deleted_at', null)
    .eq('status', 'open')
    .lte('applications_open_at', now)
    .gte('applications_close_at', now)
    .order('event_date', { ascending: true })

  return (data ?? []) as HubEvent[]
}

// ---------------------------------------------------------------------------
// Fetch all visible events (for "past events" section)
// ---------------------------------------------------------------------------

export async function fetchAllEvents(): Promise<HubEvent[]> {
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y, eligible_year_groups, open_to_gap_year')
    .is('deleted_at', null)
    .order('event_date', { ascending: false })

  return (data ?? []) as HubEvent[]
}

// ---------------------------------------------------------------------------
// Withdraw an application (student-initiated)
// ---------------------------------------------------------------------------

export async function withdrawApplication(applicationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('withdraw_application', { p_application_id: applicationId })
  if (error) return { error: error.message }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Fetch event overview (event + my application if any, with raw response)
// ---------------------------------------------------------------------------

export type HubApplicationDetail = {
  id: string
  status: string
  created_at: string
  updated_at: string | null
  raw_response: Record<string, unknown> | null
  /** Prior transitions for this application — used by /my/events/[id] for
   *  journey-aware labelling ("Shortlisted · Unsuccessful" etc.). */
  status_history: HubApplicationStatusHistoryRow[]
}

export type EventOverview = {
  event: (HubEvent & {
    form_config: Record<string, unknown> | null
    interest_options: string[] | null
    dress_code: string | null
    capacity: number | null
  }) | null
  application: HubApplicationDetail | null
  /** Current student profile — used as a fallback for card fields that the
   *  application snapshot didn't capture (e.g. FSM/income added after the
   *  student first applied). Only the fallback-eligible columns are fetched. */
  profile: {
    id: string
    first_name: string | null
    last_name: string | null
    // year_group is needed by the detail page to decide whether the Apply
    // button should be enabled (vs replaced with a restricted-to message).
    year_group: number | null
    free_school_meals: boolean | null
    parental_income_band: string | null
    // Profile fields surfaced on the student-side event detail page so we can
    // prefer the current profile value over the application snapshot (raw_response).
    // Added in the two-stage apply refactor (migrations 0024, 0025).
    gcse_results: string | null
    qualifications: unknown[] | null
    additional_context: string | null
    first_generation_uni: boolean | null
  } | null
}

export async function fetchEventOverview(eventId: string): Promise<EventOverview> {
  const email = await currentUserEmail()

  // Event
  const { data: event } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, dress_code, capacity, status, applications_open_at, applications_close_at, interest_options, form_config, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y, eligible_year_groups, open_to_gap_year')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!email) return { event: (event as EventOverview['event']) ?? null, application: null, profile: null }

  // Profile
  const { data: profile } = await supabase
    .from('students')
    .select('id, first_name, last_name, year_group, free_school_meals, parental_income_band, gcse_results, qualifications, additional_context, first_generation_uni')
    .eq('personal_email', email)
    .maybeSingle()

  if (!profile) return { event: (event as EventOverview['event']) ?? null, application: null, profile: null }

  // Application (most recent non-deleted for this event+student)
  const { data: app } = await supabase
    .from('applications')
    .select('id, status, created_at, updated_at, raw_response')
    .eq('student_id', profile.id)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Status history for this single application (if any).
  let statusHistory: HubApplicationStatusHistoryRow[] = []
  if (app) {
    const { data: history } = await supabase
      .from('application_status_history')
      .select('status, changed_at')
      .eq('application_id', (app as { id: string }).id)
      .order('changed_at', { ascending: true })
    statusHistory = ((history ?? []) as HubApplicationStatusHistoryRow[])
  }

  return {
    event: (event as EventOverview['event']) ?? null,
    application: app
      ? ({ ...(app as Omit<HubApplicationDetail, 'status_history'>), status_history: statusHistory } as HubApplicationDetail)
      : null,
    profile,
  }
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ---------------------------------------------------------------------------
// Check auth
// ---------------------------------------------------------------------------

export async function getAuthEmail(): Promise<string | null> {
  return currentUserEmail()
}

// ---------------------------------------------------------------------------
// Event feedback (post-event survey from the student hub)
// ---------------------------------------------------------------------------

/**
 * Live feedback form schema, stored on events.feedback_config.
 * Re-exported from events-api so admin + student code share one source of truth.
 *
 * Schema uses FormFieldConfig (same as the apply form). Special semantics:
 *   - reserved field id 'consent'         → event_feedback.consent column
 *   - reserved field id 'postable_quote'  → event_feedback.postable_quote column
 *   - reserved field type 'scale'         → event_feedback.ratings jsonb (keyed by field.id)
 *   - everything else                      → event_feedback.answers jsonb (keyed by field.id)
 */
export type FeedbackConfig = EventFeedbackConfig

export type FeedbackEventInfo = {
  id: string
  name: string
  slug: string
  event_date: string | null
  feedback_config: FeedbackConfig | null
}

export type MyFeedbackSubmission = {
  id: string
  event_id: string
  student_id: string
  ratings: Record<string, number>
  answers: Record<string, string | string[]>
  postable_quote: string | null
  consent: 'name' | 'first_name' | 'anon' | 'no'
  submitted_at: string
  updated_at: string
}

export async function fetchFeedbackEvent(eventId: string): Promise<FeedbackEventInfo | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, slug, event_date, feedback_config')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return null
  return (data as FeedbackEventInfo | null)
}

export async function fetchMyFeedback(eventId: string): Promise<MyFeedbackSubmission | null> {
  const email = await currentUserEmail()
  if (!email) return null
  // Resolve student_id first via RLS-safe self select.
  const { data: profile } = await supabase
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()
  if (!profile) return null
  const { data } = await supabase
    .from('event_feedback')
    .select('id, event_id, student_id, ratings, answers, postable_quote, consent, submitted_at, updated_at')
    .eq('event_id', eventId)
    .eq('student_id', (profile as { id: string }).id)
    .maybeSingle()
  return (data as MyFeedbackSubmission | null) ?? null
}

export type SubmitFeedbackInput = {
  ratings: Record<string, number>
  answers: Record<string, string | string[]>
  postable_quote: string | null
  consent: 'name' | 'first_name' | 'anon' | 'no'
}

/**
 * Upsert feedback for the signed-in student against this event.
 * Returns { error: string | null }. RLS restricts inserts/updates to the
 * caller's own student row.
 */
export async function submitFeedback(
  eventId: string,
  input: SubmitFeedbackInput,
): Promise<{ error: string | null }> {
  const email = await currentUserEmail()
  if (!email) return { error: 'You need to be signed in to submit feedback.' }

  const { data: profile } = await supabase
    .from('students')
    .select('id')
    .eq('personal_email', email)
    .maybeSingle()
  if (!profile) return { error: 'We could not find a student profile for your account.' }

  const studentId = (profile as { id: string }).id
  const payload = {
    event_id: eventId,
    student_id: studentId,
    ratings: input.ratings,
    answers: input.answers,
    postable_quote: input.postable_quote,
    consent: input.consent,
    submitted_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('event_feedback')
    .upsert(payload, { onConflict: 'event_id,student_id' })
  if (error) return { error: error.message }
  return { error: null }
}
