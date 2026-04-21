/**
 * Student hub API — functions for the student-facing dashboard.
 * All queries go through RLS (students can only read their own data + public events).
 */

import { supabase } from './supabase'
import type { StudentSelf } from './apply-api'

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
}

export type HubApplication = {
  id: string
  event_id: string
  status: string
  created_at: string
  event: HubEvent
}

export type ProfileUpdate = {
  first_name: string
  last_name: string
  school_id: string | null
  school_name_raw: string | null
  year_group: number | null
  school_type: string
  free_school_meals: boolean | null
  parental_income_band: string
}

// ---------------------------------------------------------------------------
// Fetch current student profile
// ---------------------------------------------------------------------------

const PROFILE_COLS =
  'id,first_name,last_name,personal_email,school_id,school_name_raw,year_group,school_type,free_school_meals,parental_income_band'

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

export async function updateProfile(
  studentId: string,
  updates: ProfileUpdate,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('students')
    .update(updates)
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
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y')
    .in('id', eventIds)

  const eventMap = new Map((events ?? []).map(e => [e.id, e]))

  return data
    .filter(a => eventMap.has(a.event_id))
    .map(a => ({
      ...a,
      event: eventMap.get(a.event_id)! as HubEvent,
    }))
}

// ---------------------------------------------------------------------------
// Fetch events open for applications
// ---------------------------------------------------------------------------

export async function fetchOpenEvents(): Promise<HubEvent[]> {
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y')
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
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y')
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
    free_school_meals: boolean | null
    parental_income_band: string | null
  } | null
}

export async function fetchEventOverview(eventId: string): Promise<EventOverview> {
  const email = await currentUserEmail()

  // Event
  const { data: event } = await supabase
    .from('events')
    .select('id, name, slug, event_date, location, location_full, format, description, time_start, time_end, dress_code, capacity, status, applications_open_at, applications_close_at, interest_options, form_config, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!email) return { event: (event as EventOverview['event']) ?? null, application: null, profile: null }

  // Profile
  const { data: profile } = await supabase
    .from('students')
    .select('id, first_name, last_name, free_school_meals, parental_income_band')
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

  return {
    event: (event as EventOverview['event']) ?? null,
    application: (app as HubApplicationDetail | null) ?? null,
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
