import { supabase } from './supabase'
import { validateFormConfig } from './form-config-validator'

// =============================================================================
// Types
// =============================================================================

// Form builder field config type
export type FormFieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'date' | 'url'
  | 'dropdown' | 'radio' | 'checkbox_list' | 'ranked_dropdown' | 'yes_no'
  | 'scale' | 'paired_dropdown' | 'matrix' | 'repeatable_group'
  | 'section_heading' | 'media'

export type ConditionalRule = {
  fieldId: string
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty'
  value?: string
}

export type StandardOverride = {
  /** Custom label to replace the default for this event. */
  label?: string
  /** Custom helper/description text shown below the label. */
  description?: string
  /** Custom options (only applies to fields with editable options, currently std_attribution). */
  options?: { value: string; label: string }[]
  /**
   * Options that used to be active but were retired. Not shown to new
   * applicants, but their `value` is preserved so historical answers retain
   * their label and a future admin can revive them without creating a new
   * duplicate value.
   */
  retiredOptions?: { value: string; label: string }[]
  /**
   * If true, the applicant-facing form skips this standard question entirely
   * and its required-field validation is bypassed. Identity-critical fields
   * (name, email, school) ignore this flag and stay visible.
   */
  hidden?: boolean
  /** Word-count bounds for textarea-style standard questions (std_additional, std_anything_else). */
  minWords?: number
  maxWords?: number
}

/** Per-event overrides for standard (auto-included) questions. Keyed by standard-question id (std_*). */
export type StandardOverrides = Record<string, StandardOverride>

export type FormPage = {
  id: string
  title: string
  description?: string
  fields: FormFieldConfig[]
  routing?: {
    rules: {
      conditions: ConditionalRule[]
      goToPageId: string
    }[]
    defaultNextPageId?: string
  }
}

export type FormFieldConfig = {
  id: string
  type: FormFieldType
  label: string
  description?: string
  required: boolean
  options?: { value: string; label: string }[]
  config?: {
    // Text / number
    placeholder?: string
    min?: number
    max?: number
    // Textarea word bounds
    minWords?: number
    maxWords?: number
    // Checkbox list
    maxSelections?: number
    // Ranked dropdown
    ranks?: number
    // Paired dropdown
    primaryOptions?: { value: string; label: string }[]
    secondaryOptions?: { value: string; label: string }[]
    primaryLabel?: string
    secondaryLabel?: string
    // Scale
    scaleMin?: number
    scaleMax?: number
    scaleMinLabel?: string
    scaleMaxLabel?: string
    // Matrix
    matrixRows?: { value: string; label: string }[]
    matrixColumns?: { value: string; label: string }[]
    matrixType?: 'single' | 'multi'  // single = radio per row, multi = checkbox per row
    // Repeatable group
    subFields?: FormFieldConfig[]
    minEntries?: number
    maxEntries?: number
    addButtonLabel?: string
    // Conditional visibility
    showIf?: ConditionalRule[]
    // Media field
    mediaUrl?: string
    mediaType?: 'image' | 'pdf'
  }
}

export type EventRow = {
  id: string
  name: string
  slug: string
  event_date: string | null
  location: string | null
  location_full: string | null
  format: string | null
  description: string | null
  capacity: number | null
  time_start: string | null
  time_end: string | null
  dress_code: string | null
  status: 'draft' | 'open' | 'closed' | 'completed'
  applications_open_at: string | null
  applications_close_at: string | null
  interest_options: { value: string; label: string }[]
  form_config: { fields: FormFieldConfig[]; pages?: FormPage[]; standard_overrides?: StandardOverrides }
  banner_image_url: string | null
  hub_image_url: string | null
  banner_focal_x: number
  banner_focal_y: number
  hub_focal_x: number
  hub_focal_y: number
  dashboard_columns: DashboardColumnsConfig | null
  eligible_year_groups: number[] | null
  open_to_gap_year: boolean
  feedback_config: EventFeedbackConfig | null
  created_at: string
}

/**
 * Per-event applicant-dashboard column config. Stored in events.dashboard_columns
 * as JSONB. NULL means fall back to canonical defaults.
 *
 * - `order`: column ids in display order. Ids not in this list use canonical
 *   position at the end. Custom-field ids are prefixed `cf_`.
 * - `hidden`: column ids currently hidden from the applicants table.
 */
export type DashboardColumnsConfig = {
  order?: string[]
  hidden?: string[]
}

export type EventWithStats = EventRow & {
  total_applicants: number
  submitted_count: number
  accepted_count: number
  rejected_count: number
  waitlisted_count: number
  attended_count: number
}

// =============================================================================
// Queries
// =============================================================================

const EVENT_COLUMNS =
  'id,name,slug,event_date,location,location_full,format,description,capacity,time_start,time_end,dress_code,status,applications_open_at,applications_close_at,interest_options,form_config,banner_image_url,hub_image_url,banner_focal_x,banner_focal_y,hub_focal_x,hub_focal_y,dashboard_columns,eligible_year_groups,open_to_gap_year,feedback_config,created_at'

/**
 * Fetch all events (non-deleted) ordered by date descending.
 */
export async function fetchAllEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .is('deleted_at', null)
    .order('event_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as EventRow[]
}

/**
 * Fetch a single event by ID.
 */
export async function fetchEvent(id: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as EventRow) ?? null
}

/**
 * Fetch all events with per-event application status counts.
 * Uses the event_application_stats() RPC to get counts server-side
 * instead of pulling all application rows to the client.
 */
export async function fetchEventsWithStats(): Promise<EventWithStats[]> {
  // Parallel: events + aggregated counts via RPC
  const [events, statsResult] = await Promise.all([
    fetchAllEvents(),
    supabase.rpc('event_application_stats'),
  ])

  if (statsResult.error) throw statsResult.error

  const statsMap: Record<string, {
    total: number; submitted: number; accepted: number
    rejected: number; waitlisted: number; attended: number
  }> = {}

  for (const row of statsResult.data ?? []) {
    statsMap[row.event_id] = {
      total: row.total_count,
      submitted: row.submitted_count,
      accepted: row.accepted_count,
      rejected: row.rejected_count,
      waitlisted: row.waitlisted_count,
      attended: row.attended_count,
    }
  }

  return events.map(e => ({
    ...e,
    total_applicants: statsMap[e.id]?.total ?? 0,
    submitted_count: statsMap[e.id]?.submitted ?? 0,
    accepted_count: statsMap[e.id]?.accepted ?? 0,
    rejected_count: statsMap[e.id]?.rejected ?? 0,
    waitlisted_count: statsMap[e.id]?.waitlisted ?? 0,
    attended_count: statsMap[e.id]?.attended ?? 0,
  }))
}

/**
 * Update an event's editable fields.
 */
export async function updateEvent(
  id: string,
  patch: Partial<Pick<EventRow,
    'name' | 'slug' | 'location' | 'location_full' | 'format' | 'time_start' | 'time_end' | 'dress_code' |
    'status' | 'capacity' | 'description' | 'event_date' | 'applications_open_at' | 'applications_close_at' | 'interest_options' | 'form_config' | 'banner_image_url' | 'hub_image_url' | 'banner_focal_x' | 'banner_focal_y' | 'hub_focal_x' | 'hub_focal_y' | 'dashboard_columns' | 'eligible_year_groups' | 'open_to_gap_year'
  >>,
): Promise<EventRow> {
  // Guard against malformed form_config landing in the DB — a bad shape would
  // break the apply page for every student on this event. Throws a descriptive
  // error the admin UI can surface; leaves non-form patches untouched.
  if (Object.prototype.hasOwnProperty.call(patch, 'form_config')) {
    validateFormConfig(patch.form_config)
  }
  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', id)
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}

/**
 * Fetch a single event by slug (public / anon-friendly).
 * Returns only the columns needed for the student-facing apply page.
 */
export async function fetchEventBySlug(slug: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as EventRow) ?? null
}

/**
 * Fetch only the form_config for an event (by slug).
 */
export async function fetchEventFormConfigBySlug(slug: string): Promise<{ fields: FormFieldConfig[]; pages?: FormPage[] } | null> {
  const { data, error } = await supabase
    .from('events')
    .select('form_config')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as { form_config: { fields: FormFieldConfig[]; pages?: FormPage[]; standard_overrides?: StandardOverrides } })?.form_config ?? null
}


/**
 * Render the "Open to" audience for an event as a short human-readable string
 * that fits inside sentences. Examples:
 *   []          open_to_gap_year=false -> "all students"
 *   [13]        open_to_gap_year=false -> "Year 13 students"
 *   [12, 13]    open_to_gap_year=false -> "Year 12 and Year 13 students"
 *   [13]        open_to_gap_year=true  -> "Year 13 and gap year students"
 *   [12, 13]    open_to_gap_year=true  -> "Year 12, Year 13 and gap year students"
 *   []          open_to_gap_year=true  -> "Gap year students"
 *
 * Year numbers are sorted ascending. Only the first audience part is capitalised,
 * matching how it reads inside running prose (e.g. "This event is open to ...").
 */
export function formatOpenTo(
  years: number[] | null | undefined,
  openToGapYear: boolean,
): string {
  const yrParts =
    Array.isArray(years) && years.length > 0
      ? [...years].sort((a, b) => a - b).map(y => `Year ${y}`)
      : []
  const parts: string[] = [...yrParts]
  if (openToGapYear) parts.push('gap year')
  if (parts.length === 0) return 'all students'
  parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1)
  let joined: string
  if (parts.length === 1) joined = parts[0]
  else if (parts.length === 2) joined = `${parts[0]} and ${parts[1]}`
  else joined = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${joined} students`
}

// =============================================================================
// Event feedback (live submissions from /my/events/[id]/feedback)
// =============================================================================

export type EventFeedbackRow = {
  id: string
  event_id: string
  student_id: string
  ratings: Record<string, number>
  answers: Record<string, string | string[]>
  postable_quote: string | null
  consent: 'name' | 'first_name' | 'anon' | 'no'
  submitted_at: string
  updated_at: string
  // Joined student detail for admin views.
  student?: {
    id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
    personal_email: string | null
    year_group: number | null
    school_name_raw: string | null
  } | null
}

export type EventFeedbackConfig = {
  intro?: string
  questions: {
    id: string
    type: 'scale' | 'single_choice' | 'long_text' | 'consent'
    label: string
    caption?: string
    required?: boolean
    placeholder?: string
    scale?: { min: number; max: number; minLabel?: string; maxLabel?: string }
    options?: (string | { value: string; label: string })[]
  }[]
}

/** Fetch the live feedback config for an event (used by admin QR + admin feedback page). */
export async function fetchFeedbackConfig(eventId: string): Promise<EventFeedbackConfig | null> {
  const { data, error } = await supabase
    .from('events')
    .select('feedback_config')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return ((data as { feedback_config: EventFeedbackConfig | null }).feedback_config) ?? null
}

/** Fetch all live feedback submissions for an event, joined to student detail. */
export async function fetchFeedbackSubmissions(eventId: string): Promise<EventFeedbackRow[]> {
  const { data, error } = await supabase
    .from('event_feedback')
    .select('id, event_id, student_id, ratings, answers, postable_quote, consent, submitted_at, updated_at, student:students(id, first_name, last_name, preferred_name, personal_email, year_group, school_name_raw)')
    .eq('event_id', eventId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as EventFeedbackRow[]
}

/** Cheap count for the live admin QR display (poll every few seconds). */
export async function countFeedbackSubmissions(eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('event_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
  if (error) return 0
  return count ?? 0
}

/** Fetch live feedback rows for one specific student across all events (joined to event name + date). */
export async function fetchFeedbackForStudent(studentId: string): Promise<(EventFeedbackRow & { event: { id: string; name: string; slug: string; event_date: string | null; feedback_config: EventFeedbackConfig | null } | null })[]> {
  const { data, error } = await supabase
    .from('event_feedback')
    .select('id, event_id, student_id, ratings, answers, postable_quote, consent, submitted_at, updated_at, event:events(id, name, slug, event_date, feedback_config)')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as (EventFeedbackRow & { event: { id: string; name: string; slug: string; event_date: string | null; feedback_config: EventFeedbackConfig | null } | null })[]
}
