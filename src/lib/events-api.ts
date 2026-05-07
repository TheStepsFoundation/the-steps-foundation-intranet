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
  status: 'draft' | 'open' | 'closed' | 'completed' | 'cancelled'
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
  archived_at: string | null
  lead_team_member_id: string | null
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
  'id,name,slug,event_date,location,location_full,format,description,capacity,time_start,time_end,dress_code,status,applications_open_at,applications_close_at,interest_options,form_config,banner_image_url,hub_image_url,banner_focal_x,banner_focal_y,hub_focal_x,hub_focal_y,dashboard_columns,eligible_year_groups,open_to_gap_year,feedback_config,archived_at,lead_team_member_id,created_at'

/**
 * Fetch all events (non-deleted) ordered by date descending.
 *
 * Archived events are hidden by default. Pass `{ includeArchived: true }`
 * to surface them — used by the events list page when admins toggle
 * "Show archived" on.
 */
export async function fetchAllEvents(opts: { includeArchived?: boolean } = {}): Promise<EventRow[]> {
  let q = supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .is('deleted_at', null)
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data, error } = await q.order('event_date', { ascending: false })
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
export async function fetchEventsWithStats(opts: { includeArchived?: boolean } = {}): Promise<EventWithStats[]> {
  // Parallel: events + aggregated counts via RPC
  const [events, statsResult] = await Promise.all([
    fetchAllEvents(opts),
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
 * Required fields gate for publishing an event (any status other than 'draft').
 * Pure function — no side effects, used by both the editor UI (live checklist)
 * and updateEvent (server-side gate when status changes from 'draft' to anything).
 *
 * What's required, and why:
 *   - name, slug          : DB NOT NULL — also surfaced here so the checklist
 *                           tells the admin even before the row is saved.
 *   - event_date          : Students need to know when. Without it, the
 *                           apply form has nothing to anchor expectations.
 *   - time_start/time_end : Same — students plan their day around these.
 *   - location            : Rough city/area is required. Full street address
 *                           is intentionally NOT required (often last-minute)
 *                           and only revealed to accepted students anyway.
 *   - format              : In person / online / hybrid — material to whether
 *                           a student can attend at all.
 *   - capacity            : Honest expectation-setting on competitiveness.
 *   - description         : What the event actually is.
 *   - eligible_year_groups: At least one year group (or open_to_gap_year=true)
 *                           — students need to know if they can apply.
 *   - applications_open_at, applications_close_at: Define the publish window.
 *                           Without close, the event would be open forever.
 *   - banner_image_url, hub_image_url: Both required — banner anchors the
 *                           event detail page, hub_image anchors the card on
 *                           /my. A published event without imagery looks
 *                           half-built to students.
 *   - At least one custom field on the application form. The standard fields
 *     (name/email/school/year/etc.) collect identity but don't tell us why
 *     this student in particular wants this event. Forces admins to think
 *     about what they're actually trying to learn from applicants.
 *
 * Not required (intentionally):
 *   - location_full        : Often last-minute; gated to accepted students.
 *   - dress_code           : Communicated post-acceptance.
 *   - interest_options     : Optional taxonomy.
 *   - feedback_config      : Built after the event runs.
 */

export type PublishValidationError = {
  field: string
  /** Short label used in the checklist UI (e.g. 'Event date'). */
  label: string
  /** Why it's missing — surfaced as a tooltip / inline hint. */
  reason: string
}

const STD_FIELD_IDS = new Set(['std_name', 'std_email', 'std_school', 'std_year_group'])

export function validateForPublish(e: Partial<EventRow>): PublishValidationError[] {
  const errs: PublishValidationError[] = []
  const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim().length === 0)

  if (blank(e.name))                  errs.push({ field: 'name',                  label: 'Event name',          reason: 'Required.' })
  if (blank(e.slug))                  errs.push({ field: 'slug',                  label: 'URL slug',            reason: 'Required.' })
  if (blank(e.event_date))            errs.push({ field: 'event_date',            label: 'Event date',          reason: 'Set the date students should plan around.' })
  if (blank(e.time_start))            errs.push({ field: 'time_start',            label: 'Start time',          reason: 'Required so students know when to show up.' })
  if (blank(e.time_end))              errs.push({ field: 'time_end',              label: 'End time',            reason: 'Required so students can plan their day.' })
  if (blank(e.location))              errs.push({ field: 'location',              label: 'Rough location',      reason: 'Like "Central London". Full address can wait.' })
  if (blank(e.format))                errs.push({ field: 'format',                label: 'Format',              reason: 'In person, online, or hybrid.' })
  if (e.capacity == null)             errs.push({ field: 'capacity',              label: 'Capacity',            reason: 'Honest expectation-setting on competitiveness.' })
  if (blank(e.description))           errs.push({ field: 'description',           label: 'Description',         reason: "Tells students what they're applying to." })
  if (blank(e.applications_open_at))  errs.push({ field: 'applications_open_at',  label: 'Applications open',   reason: 'When the form goes live to students.' })
  if (blank(e.applications_close_at)) errs.push({ field: 'applications_close_at', label: 'Applications close',  reason: 'Without this, the form would never auto-close.' })
  if (blank(e.banner_image_url))      errs.push({ field: 'banner_image_url',      label: 'Banner image',        reason: 'Top of the event detail page on the student hub.' })
  if (blank(e.hub_image_url))         errs.push({ field: 'hub_image_url',         label: 'Hub card image',      reason: 'Side image on each card on /my.' })

  // Eligible year groups: NOT required. The form-builder convention is
  // "leave all unchecked = open to any student" (and formatOpenTo / the
  // eligibility check both honour that). So an event with no boxes ticked
  // is a valid "open to all" configuration and should publish cleanly.

  // At least three custom (non-standard) fields on the application form.
  // Three rather than one because: a single question rarely tells you enough
  // about who's a fit, and forcing a small bank of questions encourages admins
  // to think through what they actually want to learn from applicants.
  const fc = (e.form_config ?? {}) as { fields?: { id: string }[]; pages?: { fields?: { id: string }[] }[] }
  const allFields = [
    ...(Array.isArray(fc.fields) ? fc.fields : []),
    ...((fc.pages ?? []).flatMap(p => Array.isArray(p?.fields) ? p.fields : [])),
  ]
  const customFields = allFields.filter(f => f && typeof f.id === 'string' && !STD_FIELD_IDS.has(f.id))
  if (customFields.length < 3) {
    const remaining = 3 - customFields.length
    errs.push({
      field: 'form_config',
      label: 'At least three custom questions',
      reason: `Add ${remaining} more application question${remaining === 1 ? '' : 's'} beyond the standard identity fields.`,
    })
  }

  return errs
}

/**
 * Update an event's editable fields.
 */
/** Thrown by updateEvent when a publish-status patch fails validation.
 *  Carries the structured errors so the editor can render a checklist. */
export class EventPublishValidationError extends Error {
  errors: PublishValidationError[]
  constructor(errors: PublishValidationError[]) {
    super(`Cannot publish: ${errors.map(e => e.label).join(', ')}`)
    this.name = 'EventPublishValidationError'
    this.errors = errors
  }
}

export async function updateEvent(
  id: string,
  patch: Partial<Pick<EventRow,
    'name' | 'slug' | 'location' | 'location_full' | 'format' | 'time_start' | 'time_end' | 'dress_code' |
    'status' | 'capacity' | 'description' | 'event_date' | 'applications_open_at' | 'applications_close_at' | 'interest_options' | 'form_config' | 'feedback_config' | 'banner_image_url' | 'hub_image_url' | 'banner_focal_x' | 'banner_focal_y' | 'hub_focal_x' | 'hub_focal_y' | 'dashboard_columns' | 'eligible_year_groups' | 'open_to_gap_year' | 'lead_team_member_id'
  >>,
): Promise<EventRow> {
  // Guard against malformed form_config landing in the DB.
  if (Object.prototype.hasOwnProperty.call(patch, 'form_config')) {
    validateFormConfig(patch.form_config)
  }

  // Publish gate: if the patch tries to move status away from 'draft', validate
  // the *projected* row (current values + patch) and refuse if anything's
  // missing. Surfaces structured errors via EventPublishValidationError so the
  // editor can render the checklist of what's still needed.
  if (patch.status && patch.status !== 'draft' && patch.status !== 'cancelled') {
    // Fetch the current row so the validator sees the projected state, not
    // just the patch (admin might be only flipping status, not the rest).
    // 'cancelled' is exempt from the publish gate — cancelling can happen
    // from any state, including draft.
    const current = await fetchEvent(id)
    const projected: Partial<EventRow> = { ...(current ?? {}), ...patch } as Partial<EventRow>
    const errs = validateForPublish(projected)
    if (errs.length > 0) throw new EventPublishValidationError(errs)
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
 * Create a draft event with sensible defaults. Returns the new event row.
 * Slug is a placeholder timestamp (untitled-<ms>) so the row satisfies the
 * NOT NULL constraint; the admin renames it in the editor before going live.
 *
 * RLS: insert is gated to team members (matches the existing events policy
 * set). Surfaces the Supabase error verbatim so the caller can show it inline.
 */
export async function createDraftEvent(): Promise<EventRow> {
  const placeholderName = 'Untitled event'
  const placeholderSlug = `untitled-${Date.now().toString(36)}`
  const { data, error } = await supabase
    .from('events')
    .insert({
      name: placeholderName,
      slug: placeholderSlug,
      status: 'draft',
    })
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}

/**
 * Clone a draft event from an existing source event. Copies fields the
 * admin opted in to (form_config, eligibility, banner, hub image, dashboard
 * columns, capacity, format, dress code, description, application window
 * relative offsets, interest options). Always RESETS:
 *   - id (new uuid)
 *   - status (draft)
 *   - slug (placeholder; admin renames during edit)
 *   - name (prefixed "[Cloned] " unless overridden)
 *   - event_date / applications_open_at / applications_close_at (NULL — admin must set new)
 *   - archived_at, deleted_at, created_at (NULL / now)
 *
 * Dates are reset rather than offset because cloning typically happens N
 * months/years after the source event — there's no sensible default offset.
 */
export type CloneFieldKey =
  | 'description' | 'banner' | 'hub_image' | 'capacity' | 'format' | 'location'
  | 'dress_code' | 'eligibility' | 'form_config' | 'feedback_config'
  | 'dashboard_columns' | 'interest_options' | 'time_window'

export const CLONE_FIELD_LABELS: Record<CloneFieldKey, { label: string; description: string }> = {
  description:        { label: 'Description',         description: 'About-this-event blurb.' },
  banner:             { label: 'Banner image',        description: 'Hero image at the top of the apply page.' },
  hub_image:          { label: 'Hub card image',      description: 'Side image on /my cards.' },
  capacity:           { label: 'Capacity',            description: 'Number of places.' },
  format:             { label: 'Format',              description: 'In person / online / hybrid.' },
  location:           { label: 'Location',            description: 'Rough + full address (full reset to NULL on a new venue).' },
  dress_code:         { label: 'Dress code',          description: 'Dress code instructions for accepted students.' },
  eligibility:        { label: 'Eligibility',         description: 'Year groups + gap-year flag.' },
  form_config:        { label: 'Application form',    description: 'All custom questions + ordering.' },
  feedback_config:    { label: 'Feedback form',       description: 'Post-event feedback questions.' },
  dashboard_columns:  { label: 'Dashboard columns',   description: 'Saved column layout for the applicants table.' },
  interest_options:   { label: 'Interest options',    description: 'Interest taxonomy (legacy field).' },
  time_window:        { label: 'Time of day',         description: 'Start/end times (not the date).' },
}

export async function cloneEventFrom(sourceId: string, fields: CloneFieldKey[]): Promise<EventRow> {
  const source = await fetchEvent(sourceId)
  if (!source) throw new Error('Source event not found')

  const placeholderSlug = `untitled-${Date.now().toString(36)}`
  const insert: Record<string, unknown> = {
    name: `[Cloned] ${source.name}`,
    slug: placeholderSlug,
    status: 'draft',
    // Always reset dates / open-close window — admin must set new ones.
    event_date: null,
    applications_open_at: null,
    applications_close_at: null,
  }
  if (fields.includes('description'))       insert.description = source.description
  if (fields.includes('banner'))            { insert.banner_image_url = source.banner_image_url; insert.banner_focal_x = source.banner_focal_x; insert.banner_focal_y = source.banner_focal_y }
  if (fields.includes('hub_image'))         { insert.hub_image_url = source.hub_image_url;       insert.hub_focal_x = source.hub_focal_x;       insert.hub_focal_y = source.hub_focal_y }
  if (fields.includes('capacity'))          insert.capacity = source.capacity
  if (fields.includes('format'))            insert.format = source.format
  if (fields.includes('location'))          { insert.location = source.location; insert.location_full = source.location_full }
  if (fields.includes('dress_code'))        insert.dress_code = source.dress_code
  if (fields.includes('eligibility'))       { insert.eligible_year_groups = source.eligible_year_groups; insert.open_to_gap_year = source.open_to_gap_year }
  if (fields.includes('form_config'))       insert.form_config = source.form_config
  if (fields.includes('feedback_config'))   insert.feedback_config = source.feedback_config
  if (fields.includes('dashboard_columns')) insert.dashboard_columns = source.dashboard_columns
  if (fields.includes('interest_options'))  insert.interest_options = source.interest_options
  if (fields.includes('time_window'))       { insert.time_start = source.time_start; insert.time_end = source.time_end }

  const { data, error } = await supabase
    .from('events')
    .insert(insert)
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}

/**
 * Archive an event — hides it from the default events list. Reversible
 * via unarchiveEvent. Sets archived_at = now() (or null to undo).
 */
export async function archiveEvent(id: string): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}

export async function unarchiveEvent(id: string): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update({ archived_at: null })
    .eq('id', id)
    .select(EVENT_COLUMNS)
    .single()
  if (error) throw error
  return data as EventRow
}

/**
 * Soft-delete an event. Sets deleted_at = now() so the row disappears
 * from every default query but is preserved in the DB for audit / restore.
 *
 * The applications.event_id FK is ON DELETE RESTRICT, so a hard delete
 * would fail for any event with applications. Soft-delete sidesteps that
 * — applications continue to reference the row, but neither admin nor
 * student-facing queries surface it (all use `.is('deleted_at', null)`).
 */
export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
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

/**
 * Live feedback form schema, stored on events.feedback_config.
 *
 * Reuses FormFieldConfig (the same shape that powers the apply form) for parity:
 *   - `fields` is an array of FormFieldConfig
 *   - reserved field IDs map to dedicated event_feedback columns:
 *       * id 'consent'         → event_feedback.consent (text)
 *       * id 'postable_quote'  → event_feedback.postable_quote (text)
 *   - reserved field type 'scale' → event_feedback.ratings (jsonb keyed by field.id)
 *   - everything else → event_feedback.answers (jsonb keyed by field.id)
 */
export type EventFeedbackConfig = {
  intro?: string
  /** Canonical flat field list. May be empty if FormBuilder is using pages. */
  fields: FormFieldConfig[]
  /** Optional multi-page wrapping (FormBuilder always pages internally). */
  pages?: FormPage[]
}

/** Flatten a feedback config to the canonical field list, regardless of pages. */
export function getFeedbackFields(cfg: EventFeedbackConfig | null | undefined): FormFieldConfig[] {
  if (!cfg) return []
  if (cfg.pages && cfg.pages.length > 0) return cfg.pages.flatMap(p => p.fields)
  return cfg.fields ?? []
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

// ---------------------------------------------------------------------------
// Admin edit/delete on live feedback rows. RLS gates these to admins.
// updateFeedback uses a partial patch — only the fields the admin actually
// changed are written, so editing one quote doesn't blow away ratings.
// ---------------------------------------------------------------------------

export type FeedbackPatch = Partial<{
  ratings: Record<string, number>
  answers: Record<string, string | string[]>
  postable_quote: string | null
  consent: 'name' | 'first_name' | 'anon' | 'no'
}>

/** Patch a single live-feedback row. Only writes the keys present in `patch`. */
export async function updateFeedback(id: string, patch: FeedbackPatch): Promise<EventFeedbackRow> {
  const { data, error } = await supabase
    .from('event_feedback')
    .update(patch)
    .eq('id', id)
    .select('id, event_id, student_id, ratings, answers, postable_quote, consent, submitted_at, updated_at, student:students(id, first_name, last_name, preferred_name, personal_email, year_group, school_name_raw)')
    .single()
  if (error) throw error
  return data as unknown as EventFeedbackRow
}

/** Hard-delete a live feedback row. Only used from the admin overview. */
export async function deleteFeedback(id: string): Promise<void> {
  const { error } = await supabase.from('event_feedback').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Effective status
//
// The DB stores admin *intent* in the `status` column (draft / open / closed /
// completed). The effective state for any given moment also depends on the
// applications_open_at / applications_close_at / event_date timestamps. So an
// admin-set 'open' event with apps_close_at in the past is *effectively*
// closed; an 'open' event with open_at in the future is *effectively*
// scheduled. The student hub already filters by date window — this helper
// exposes the same logic to the admin UI so badges and counts agree with
// what students actually see.
// ---------------------------------------------------------------------------

export type EffectiveStatus =
  | 'draft'      // Admin hasn't published yet — never visible to students
  | 'scheduled'  // Published but applications_open_at is still in the future
  | 'live'       // Within the application window
  | 'closed'     // Past applications_close_at, but event hasn't run yet
  | 'completed'  // Event date has passed
  | 'cancelled'  // Admin pulled the plug — event was supposed to run, isn't

export function computeEventEffectiveStatus(e: Pick<EventRow,
  'status' | 'applications_open_at' | 'applications_close_at' | 'event_date'
>): EffectiveStatus {
  if (e.status === 'cancelled') return 'cancelled'
  if (e.status === 'draft') return 'draft'
  const now = Date.now()
  const eventTime = e.event_date ? new Date(e.event_date + 'T00:00:00').getTime() : null
  // Past the event date itself → completed regardless of apps window.
  if (eventTime != null && eventTime < now) return 'completed'
  const closeTime = e.applications_close_at ? new Date(e.applications_close_at).getTime() : null
  const openTime = e.applications_open_at ? new Date(e.applications_open_at).getTime() : null
  if (closeTime != null && closeTime <= now) return 'closed'
  if (openTime != null && openTime > now) return 'scheduled'
  // Default within window (or with NULL timestamps, which are non-published-grade configs)
  return 'live'
}

export const EFFECTIVE_STATUS_META: Record<EffectiveStatus, { label: string; classes: string; tone: 'slate' | 'blue' | 'emerald' | 'amber' | 'violet' }> = {
  draft:     { label: 'Draft',     tone: 'slate',   classes: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300' },
  scheduled: { label: 'Scheduled', tone: 'blue',    classes: 'bg-steps-blue-50 text-steps-blue-700 border-steps-blue-200 dark:bg-steps-blue-900/30 dark:text-steps-blue-300' },
  live:      { label: 'Live',      tone: 'emerald', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300' },
  closed:    { label: 'Closed',    tone: 'amber',   classes: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' },
  completed: { label: 'Completed', tone: 'violet',  classes: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300' },
  cancelled: { label: 'Cancelled', tone: 'slate',   classes: 'bg-slate-100 text-slate-700 border-slate-200 line-through dark:bg-slate-800 dark:text-slate-300' },
}
