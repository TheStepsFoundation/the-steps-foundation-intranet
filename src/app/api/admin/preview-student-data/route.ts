import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/admin/preview-student-data?student_id=<uuid>
//
// Returns the data shape /my would fetch for a given student, but accessed
// via the service-role client so admins can see what any student sees on
// their hub. Used by the iframe-based Hub Preview overlay on
// /students/[id].
//
// Returns: { profile, applications, openEvents }
//   - profile     : StudentSelf shape
//   - applications: HubApplication[] (each with status_history + event)
//   - openEvents  : HubEvent[] (excluding events the student has applied to)
//
// Auth: same team_members gate as other admin routes.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function requireTeamMember(req: NextRequest): Promise<{ email: string } | { error: string; status: number }> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header', status: 401 }
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return { error: 'Empty access token', status: 401 }

  const svc = getServiceClient()
  const { data: userData, error: userErr } = await svc.auth.getUser(token)
  if (userErr || !userData?.user?.email) {
    return { error: 'Invalid access token', status: 401 }
  }
  const email = userData.user.email.toLowerCase()
  const { data: tm, error: tmErr } = await svc
    .from('team_members')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (tmErr) return { error: 'Membership lookup failed', status: 500 }
  if (!tm) return { error: 'Not authorised', status: 403 }
  return { email }
}

const HUB_EVENT_COLUMNS =
  'id, name, slug, event_date, location, location_full, format, description, time_start, time_end, status, applications_open_at, applications_close_at, banner_image_url, hub_image_url, banner_focal_x, banner_focal_y, hub_focal_x, hub_focal_y, eligible_year_groups, open_to_gap_year'

export async function GET(req: NextRequest) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('student_id')
  if (!studentId) {
    return NextResponse.json({ error: 'student_id is required' }, { status: 400 }) }

  const svc = getServiceClient()

  // 1) Profile
  const { data: profile, error: pErr } = await svc
    .from('students')
    .select('id, first_name, last_name, personal_email, school_id, school_name_raw, year_group, school_type, free_school_meals, parental_income_band, first_generation_uni, gcse_results, qualifications, additional_context')
    .eq('id', studentId)
    .maybeSingle()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  if (!profile) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  // 2) Applications + their event rows + status history
  const { data: appsRaw, error: aErr } = await svc
    .from('applications')
    .select('id, event_id, status, submitted_at, deleted_at')
    .eq('student_id', studentId)
    .is('deleted_at', null)
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const appIds = (appsRaw ?? []).map((a: { id: string }) => a.id)
  const eventIds = Array.from(new Set((appsRaw ?? []).map((a: { event_id: string }) => a.event_id)))

  const [{ data: events }, { data: history }] = await Promise.all([
    eventIds.length > 0
      ? svc.from('events').select(HUB_EVENT_COLUMNS).in('id', eventIds).is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    appIds.length > 0
      ? svc.from('application_status_history').select('application_id, new_status, created_at').in('application_id', appIds).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])

  const eventById = new Map<string, Record<string, unknown>>()
  for (const e of (events ?? []) as Array<Record<string, unknown>>) {
    eventById.set(e.id as string, e)
  }
  const historyByApp = new Map<string, Array<{ status: string; changed_at: string }>>()
  for (const h of (history ?? []) as Array<{ application_id: string; new_status: string; created_at: string }>) {
    const arr = historyByApp.get(h.application_id) ?? []
    arr.push({ status: h.new_status, changed_at: h.created_at })
    historyByApp.set(h.application_id, arr)
  }

  const applications = (appsRaw ?? [])
    .filter((a: { event_id: string }) => eventById.has(a.event_id))
    .map((a: { id: string; event_id: string; status: string; submitted_at: string | null }) => ({
      id: a.id,
      event_id: a.event_id,
      status: a.status,
      created_at: a.submitted_at ?? new Date().toISOString(),
      event: eventById.get(a.event_id),
      status_history: historyByApp.get(a.id) ?? [],
    }))

  // 3) Open events the student hasn't applied to
  const now = new Date().toISOString()
  const { data: open } = await svc
    .from('events')
    .select(HUB_EVENT_COLUMNS)
    .is('deleted_at', null)
    .is('archived_at', null)
    .neq('status', 'draft')
    .neq('status', 'cancelled')
    .lte('applications_open_at', now)
    .gte('applications_close_at', now)
    .order('event_date', { ascending: true })

  const appliedSet = new Set(eventIds)
  const openEvents = ((open ?? []) as Array<Record<string, unknown>>).filter(e => !appliedSet.has(e.id as string))

  return NextResponse.json({ profile, applications, openEvents })
}
