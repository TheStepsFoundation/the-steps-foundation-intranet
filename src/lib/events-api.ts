import { supabase } from './supabase'

// =============================================================================
// Types
// =============================================================================

// Form builder field config type
export type FormFieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'date' | 'url'
  | 'dropdown' | 'radio' | 'checkbox_list' | 'ranked_dropdown' | 'yes_no'
  | 'scale' | 'paired_dropdown' | 'matrix' | 'repeatable_group'
  | 'section_heading'

export type ConditionalRule = {
  fieldId: string
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty'
  value?: string
}

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
  }
}

export type EventRow = {
  id: string
  name: string
  slug: string
  event_date: string | null
  location: string | null
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
  form_config: { fields: FormFieldConfig[]; pages?: FormPage[] }
  banner_image_url: string | null
  hub_image_url: string | null
  banner_focal_x: number
  banner_focal_y: number
  hub_focal_x: number
  hub_focal_y: number
  created_at: string
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
  'id,name,slug,event_date,location,format,description,capacity,time_start,time_end,dress_code,status,applications_open_at,applications_close_at,interest_options,form_config,banner_image_url,hub_image_url,banner_focal_x,banner_focal_y,hub_focal_x,hub_focal_y,created_at'

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
    'name' | 'slug' | 'location' | 'format' | 'time_start' | 'time_end' | 'dress_code' |
    'status' | 'capacity' | 'description' | 'event_date' | 'applications_open_at' | 'applications_close_at' | 'interest_options' | 'form_config' | 'banner_image_url' | 'hub_image_url' | 'banner_focal_x' | 'banner_focal_y' | 'hub_focal_x' | 'hub_focal_y'
  >>,
): Promise<EventRow> {
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
  return (data as { form_config: { fields: FormFieldConfig[]; pages?: FormPage[] } })?.form_config ?? null
}
