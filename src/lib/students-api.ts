import { supabase } from './supabase'

export const EVENTS: { id: string; name: string; short: string; date: string }[] = [
  { id: 'e1467ac9-6742-48b2-aafc-81ab58a31ea0', name: 'Starting Point', short: 'SP', date: '2025-09-13' },
  { id: '303a13ff-b33a-41d5-bdd0-8e5b5538b5a3', name: 'Oxbridge Interview Workshop', short: 'Oxb', date: '2025-12-07' },
  { id: 'd29dc7cf-2336-44ee-994e-9a917bc837d3', name: 'Degree Apprenticeship Masterclass', short: 'DA', date: '2026-02-07' },
  { id: 'dbcaf8b1-8bb0-4e09-8c73-43f1b75c7094', name: 'The Great Lock-In', short: 'Lock-In', date: '2026-03-21' },
]

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]))

export const ATTRIBUTION_SOURCES: { value: string; label: string }[] = [
  { value: 'word_of_mouth',     label: 'Word of mouth' },
  { value: 'tiktok',            label: 'TikTok' },
  { value: 'linkedin',          label: 'LinkedIn' },
  { value: 'instagram',         label: 'Instagram direct' },
  { value: 'email',             label: 'Email' },
  { value: 'teacher_newsletter',label: 'Teacher newsletter' },
  { value: 'other',             label: 'Other' },
  { value: 'unknown',           label: 'Unknown' },
]

export type SchoolType = 'state' | 'grammar' | 'private'
export type Eligibility = 'eligible' | 'ineligible' | 'unknown'

export type StudentRow = {
  id: string
  first_name: string | null
  last_name: string | null
  personal_email: string | null
  school_name_raw: string | null
  year_group: string | null
  free_school_meals: boolean | null
  parental_income_band: string | null
  first_generation_uni: boolean | null
  subscribed_to_mailing: boolean | null
  school_type: SchoolType | null
  bursary_90plus: boolean | null
  notes: string | null
  created_at: string
}

export type ApplicationRow = {
  id: string
  student_id: string
  event_id: string
  status: string
  attended: boolean | null
  submitted_at: string | null
  attribution_source: string | null
  bonus_points: number | null
  bonus_reason: string | null
}

export type EnrichedStudent = StudentRow & {
  applications: ApplicationRow[]
  attended_count: number
  accepted_count: number
  no_show_count: number
  submitted_count: number
  rejected_count: number
  engagement_score: number
  bonus_total: number
  smi_count: number
  eligibility: Eligibility
}

export function enrich(s: StudentRow, apps: ApplicationRow[]): EnrichedStudent {
  const mine = apps.filter(a => a.student_id === s.id)
  const today = new Date()
  let attended_count = 0, accepted_count = 0, no_show_count = 0, submitted_count = 0, rejected_count = 0
  let bonus_total = 0
  for (const a of mine) {
    if (a.attended) attended_count++
    if (a.status === 'accepted') accepted_count++
    if (a.status === 'submitted') submitted_count++
    if (a.status === 'rejected') rejected_count++
    bonus_total += a.bonus_points || 0
    const ev = EVENT_BY_ID[a.event_id]
    const passed = ev ? new Date(ev.date) < today : false
    if (passed && a.status === 'accepted' && !a.attended) no_show_count++
  }
  let engagement_score = 0
  for (const a of mine) {
    const ev = EVENT_BY_ID[a.event_id]
    const passed = ev ? new Date(ev.date) < today : false
    if (a.attended) engagement_score += 2
    else if (a.status === 'accepted' && passed) engagement_score -= 1
    else if (a.status === 'accepted' && !passed) engagement_score += 1
    engagement_score += a.bonus_points || 0
  }
  const smi_count =
    (s.free_school_meals === true ? 1 : 0) +
    (s.first_generation_uni === true ? 1 : 0) +
    (s.parental_income_band === 'under_40k' ? 1 : 0)
  const eligibility: Eligibility =
    s.school_type === 'state' || s.school_type === 'grammar'
      ? 'eligible'
      : s.school_type === 'private' && s.bursary_90plus === true && smi_count >= 1
        ? 'eligible'
        : s.school_type === 'private'
          ? 'ineligible'
          : 'unknown'
  return {
    ...s,
    applications: mine,
    attended_count,
    accepted_count,
    no_show_count,
    submitted_count,
    rejected_count,
    engagement_score,
    bonus_total,
    smi_count,
    eligibility,
  }
}

const CACHE_TTL_MS = 60_000
let enrichedCache: { data: EnrichedStudent[]; at: number } | null = null

export function invalidateStudentsCache() {
  enrichedCache = null
}

export async function fetchAllStudentsEnriched(opts?: { forceRefresh?: boolean }): Promise<EnrichedStudent[]> {
  if (!opts?.forceRefresh && enrichedCache && Date.now() - enrichedCache.at < CACHE_TTL_MS) {
    return enrichedCache.data
  }
  const rows: EnrichedStudent[] = []
  let from = 0
  const size = 1000
  while (true) {
    const { data, error } = await supabase
      .from('students_enriched')
      .select('*')
      .range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as EnrichedStudent[]))
    if (data.length < size) break
    from += size
  }
  enrichedCache = { data: rows, at: Date.now() }
  return rows
}

export async function fetchAllStudentsAndApps(): Promise<{ students: StudentRow[]; applications: ApplicationRow[] }> {
  const enriched = await fetchAllStudentsEnriched()
  const students: StudentRow[] = enriched.map(({ applications: _a, attended_count: _ac, accepted_count: _acc, no_show_count: _n, submitted_count: _s, rejected_count: _r, engagement_score: _es, bonus_total: _bt, smi_count: _sm, eligibility: _el, ...s }) => s)
  const applications: ApplicationRow[] = enriched.flatMap(e => e.applications)
  return { students, applications }
}

export type StudentUpdate = Partial<Omit<StudentRow, 'id' | 'created_at'>>
export type ApplicationUpdate = Partial<Pick<ApplicationRow,
  'status' | 'attended' | 'submitted_at' | 'attribution_source' | 'bonus_points' | 'bonus_reason'
>>

export async function updateStudent(id: string, patch: StudentUpdate): Promise<StudentRow> {
  const { data, error } = await supabase
    .from('students')
    .update(patch)
    .eq('id', id)
    .select('id,first_name,last_name,personal_email,school_name_raw,year_group,free_school_meals,parental_income_band,first_generation_uni,subscribed_to_mailing,school_type,bursary_90plus,notes,created_at')
    .single()
  if (error) throw error
  invalidateStudentsCache()
  return data as StudentRow
}

export async function upsertApplication(
  studentId: string,
  eventId: string,
  patch: ApplicationUpdate,
  existingId?: string,
): Promise<ApplicationRow> {
  if (existingId) {
    const { data, error } = await supabase
      .from('applications')
      .update(patch)
      .eq('id', existingId)
      .select('id,student_id,event_id,status,attended,submitted_at,attribution_source,bonus_points,bonus_reason')
      .single()
    if (error) throw error
    invalidateStudentsCache()
    return data as ApplicationRow
  }
  const { data, error } = await supabase
    .from('applications')
    .insert({ student_id: studentId, event_id: eventId, status: patch.status ?? 'submitted', ...patch })
    .select('id,student_id,event_id,status,attended,submitted_at,attribution_source,bonus_points,bonus_reason')
    .single()
  if (error) throw error
  invalidateStudentsCache()
  return data as ApplicationRow
}

export async function deleteApplication(id: string): Promise<void> {
  const { error } = await supabase.from('applications').delete().eq('id', id)
  if (error) throw error
  invalidateStudentsCache()
}

export async function fetchEnrichedStudent(id: string): Promise<EnrichedStudent | null> {
  const { data, error } = await supabase
    .from('students_enriched')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as EnrichedStudent
  if (!row.applications) row.applications = []
  return row
}

export async function fetchStudent(id: string): Promise<{ student: StudentRow | null; applications: ApplicationRow[] }> {
  const { data: sData, error: sErr } = await supabase
    .from('students')
    .select('id,first_name,last_name,personal_email,school_name_raw,year_group,free_school_meals,parental_income_band,first_generation_uni,subscribed_to_mailing,school_type,bursary_90plus,notes,created_at')
    .eq('id', id)
    .maybeSingle()
  if (sErr) throw sErr
  const { data: aData, error: aErr } = await supabase
    .from('applications')
    .select('id,student_id,event_id,status,attended,submitted_at,attribution_source,bonus_points,bonus_reason')
    .eq('student_id', id)
    .order('submitted_at', { ascending: true })
  if (aErr) throw aErr
  return { student: (sData as StudentRow) ?? null, applications: (aData as ApplicationRow[]) ?? [] }
}
