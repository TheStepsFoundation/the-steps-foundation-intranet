import { supabase } from './supabase'

export const EVENTS: { id: string; name: string; short: string; date: string }[] = [
  { id: 'e1467ac9-6742-48b2-aafc-81ab58a31ea0', name: 'Starting Point', short: 'SP', date: '2025-09-13' },
  { id: '303a13ff-b33a-41d5-bdd0-8e5b5538b5a3', name: 'Oxbridge Interview Workshop', short: 'Oxb', date: '2025-12-07' },
  { id: 'd29dc7cf-2336-44ee-994e-9a917bc837d3', name: 'Degree Apprenticeship Masterclass', short: 'DA', date: '2026-02-07' },
  { id: 'dbcaf8b1-8bb0-4e09-8c73-43f1b75c7094', name: 'The Great Lock-In', short: 'Lock-In', date: '2026-03-21' },
]

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]))

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
}

export type EnrichedStudent = StudentRow & {
  applications: ApplicationRow[]
  attended_count: number
  accepted_count: number
  no_show_count: number
  submitted_count: number
  rejected_count: number
  engagement_score: number
}

export function enrich(s: StudentRow, apps: ApplicationRow[]): EnrichedStudent {
  const mine = apps.filter(a => a.student_id === s.id)
  const today = new Date()
  let attended_count = 0, accepted_count = 0, no_show_count = 0, submitted_count = 0, rejected_count = 0
  for (const a of mine) {
    if (a.attended) attended_count++
    if (a.status === 'accepted') accepted_count++
    if (a.status === 'submitted') submitted_count++
    if (a.status === 'rejected') rejected_count++
    const ev = EVENT_BY_ID[a.event_id]
    const passed = ev ? new Date(ev.date) < today : false
    if (passed && a.status === 'accepted' && !a.attended) no_show_count++
  }
  // score = attended*2 + (accepted actually-attended would be double-counted, so score it per application:
  // attended -> +2, accepted-not-attended (past) -> -1, accepted-not-attended (future) -> +1, else 0
  let engagement_score = 0
  for (const a of mine) {
    const ev = EVENT_BY_ID[a.event_id]
    const passed = ev ? new Date(ev.date) < today : false
    if (a.attended) engagement_score += 2
    else if (a.status === 'accepted' && passed) engagement_score -= 1
    else if (a.status === 'accepted' && !passed) engagement_score += 1
  }
  return {
    ...s,
    applications: mine,
    attended_count,
    accepted_count,
    no_show_count,
    submitted_count,
    rejected_count,
    engagement_score,
  }
}

export async function fetchAllStudentsAndApps(): Promise<{ students: StudentRow[]; applications: ApplicationRow[] }> {
  // paginate students
  const students: StudentRow[] = []
  let from = 0
  const size = 1000
  while (true) {
    const { data, error } = await supabase
      .from('students')
      .select('id,first_name,last_name,personal_email,school_name_raw,year_group,free_school_meals,parental_income_band,first_generation_uni,subscribed_to_mailing,notes,created_at')
      .range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    students.push(...(data as StudentRow[]))
    if (data.length < size) break
    from += size
  }
  const applications: ApplicationRow[] = []
  from = 0
  while (true) {
    const { data, error } = await supabase
      .from('applications')
      .select('id,student_id,event_id,status,attended,submitted_at,attribution_source')
      .range(from, from + size - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    applications.push(...(data as ApplicationRow[]))
    if (data.length < size) break
    from += size
  }
  return { students, applications }
}

export async function fetchStudent(id: string): Promise<{ student: StudentRow | null; applications: ApplicationRow[] }> {
  const { data: sData, error: sErr } = await supabase
    .from('students')
    .select('id,first_name,last_name,personal_email,school_name_raw,year_group,free_school_meals,parental_income_band,first_generation_uni,subscribed_to_mailing,notes,created_at')
    .eq('id', id)
    .maybeSingle()
  if (sErr) throw sErr
  const { data: aData, error: aErr } = await supabase
    .from('applications')
    .select('id,student_id,event_id,status,attended,submitted_at,attribution_source')
    .eq('student_id', id)
    .order('submitted_at', { ascending: true })
  if (aErr) throw aErr
  return { student: (sData as StudentRow) ?? null, applications: (aData as ApplicationRow[]) ?? [] }
}
