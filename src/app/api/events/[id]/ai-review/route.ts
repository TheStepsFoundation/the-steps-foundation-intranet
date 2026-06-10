import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseAiReview, DEFAULT_REVIEW_RUBRIC, type AiReviewResult } from '@/lib/ai-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// POST /api/events/[id]/ai-review
//
// Scores one chunk of unscored submitted applications against the event's
// review rubric using the Anthropic API, writing results to
// applications.ai_review. The client calls this in a loop until
// `remaining` hits 0 (chunked to stay inside the Vercel function window).
//
// Deliberately NEVER writes `status` or `internal_review_status` — the AI
// only annotates. Applying suggestions is a separate, explicit admin action
// done client-side.
//
// Auth: same team_members gate as other admin routes.
// Env: ANTHROPIC_API_KEY (Vercel), optional AI_REVIEW_MODEL.
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 5
const MODEL = process.env.AI_REVIEW_MODEL || 'claude-fable-5'

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

// --- Prompt assembly --------------------------------------------------------

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

type FieldDef = { id: string; label?: string; type?: string }

/** id -> label map across single-page and paged form configs. */
function fieldLabels(formConfig: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const cfg = (formConfig ?? {}) as { fields?: FieldDef[]; pages?: { fields?: FieldDef[] }[] }
  const all = [...(cfg.fields ?? []), ...((cfg.pages ?? []).flatMap(p => p.fields ?? []))]
  for (const f of all) {
    if (f?.id) out[f.id] = stripHtml(String(f.label ?? f.id))
  }
  return out
}

function fmtValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(fmtValue).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x != null && x !== '')
      .map(([k, x]) => `${k}: ${fmtValue(x)}`)
      .join('; ')
  }
  return String(v)
}

const INCOME_LABELS: Record<string, string> = {
  under_25k: 'Under £25k',
  under_40k: '£25k–£40k',
  under_60k: '£40k–£60k',
  over_60k: 'Over £60k',
}

function buildSystemPrompt(eventName: string, eventDescription: string | null, rubric: string): string {
  return [
    'You review applications for events run by the Steps Foundation, a UK social-mobility charity for low-income and first-generation students ("virtus non origo" — virtue, not origin). Admins use your output to triage large applicant pools; a human makes every final decision.',
    '',
    `EVENT: ${eventName}`,
    eventDescription ? `EVENT DESCRIPTION: ${stripHtml(eventDescription).slice(0, 1500)}` : '',
    '',
    'RUBRIC (set by the event admins — score against this):',
    rubric,
    '',
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{',
    '  "score": <integer 1-5; 5 = exceptional fit for the rubric, 1 = weak fit>,',
    '  "summary": "<max 2 sentences an admin can read in the table — concrete, specific to this applicant>",',
    '  "reason": "<1-3 sentences justifying the score and suggestion>",',
    '  "flags": [<zero or more of: "low_effort", "likely_ai_written", "exceptional", "inconsistent", "safeguarding_concern">],',
    '  "suggested_internal": <"accept" | "shortlist" | "waitlist" | "reject" | null>',
    '}',
    '',
    'Rules:',
    '- Judge free-text answers on substance and specificity, not polish — many applicants are 14-18 and writing quickly. Do not penalise informal writing.',
    '- "likely_ai_written" only for strong signals (generic chatbot cadence, em-dash-heavy boilerplate, no personal detail).',
    '- "safeguarding_concern" if an answer mentions harm, abuse, or distress a charity should act on — and explain in "reason".',
    '- suggested_internal "accept"/"reject" ONLY when confident; "shortlist"/"waitlist" for the middle; null when there is too little signal.',
    '- Missing or empty free-text answers: score from what exists, flag "low_effort" only if questions were asked and dodged.',
  ].filter(Boolean).join('\n')
}

type CandidateRow = {
  id: string
  student_id: string
  raw_response: Record<string, unknown> | null
  students: {
    first_name: string | null
    last_name: string | null
    year_group: number | null
    school_type: string | null
    bursary_90plus: boolean | null
    free_school_meals: boolean | null
    parental_income_band: string | null
    first_generation_uni: boolean | null
    gcse_results: string | null
    qualifications: unknown
    additional_context: string | null
    schools: { name: string | null } | null
  }
}

function buildUserPrompt(
  row: CandidateRow,
  labels: Record<string, string>,
  enriched: { engagement_score: number; attended_count: number; total_applications: number } | undefined,
): string {
  const s = row.students
  const raw = row.raw_response ?? {}
  const lines: string[] = ['APPLICANT PROFILE:']
  lines.push(`- Year group: ${s.year_group != null ? (s.year_group === 14 ? 'Gap year' : `Year ${s.year_group}`) : 'unknown'}`)
  lines.push(`- School: ${s.schools?.name ?? 'unknown'} (type: ${s.school_type ?? 'unknown'}${s.bursary_90plus ? ', 90%+ bursary' : ''})`)
  lines.push(`- Free school meals: ${s.free_school_meals === true ? 'yes' : s.free_school_meals === false ? 'no' : 'unknown'}`)
  lines.push(`- Household income: ${s.parental_income_band ? (INCOME_LABELS[s.parental_income_band] ?? s.parental_income_band) : 'unknown'}`)
  lines.push(`- First-generation university: ${s.first_generation_uni === true ? 'yes' : s.first_generation_uni === false ? 'no' : 'unknown'}`)
  if (s.gcse_results) lines.push(`- GCSE results: ${String(s.gcse_results).slice(0, 300)}`)
  const quals = Array.isArray(s.qualifications) ? s.qualifications as Array<Record<string, unknown>> : []
  if (quals.length > 0) {
    lines.push(`- Current qualifications: ${quals.map(q => `${q.type ?? q.qualType ?? ''} ${q.subject ?? ''}: ${q.grade ?? '?'}`.trim()).join('; ').slice(0, 400)}`)
  }
  if (enriched) {
    lines.push(`- Steps history: ${enriched.total_applications} application(s) incl. this one, ${enriched.attended_count} event(s) attended, engagement score ${enriched.engagement_score}`)
  }

  lines.push('', 'APPLICATION ANSWERS:')
  let any = false
  const push = (label: string, v: unknown) => {
    const text = fmtValue(v).trim()
    if (!text) return
    any = true
    lines.push(`Q: ${label}`, `A: ${text.slice(0, 2500)}`, '')
  }
  const custom = (raw.custom_fields ?? {}) as Record<string, unknown>
  for (const [id, v] of Object.entries(custom)) {
    push(labels[id] ?? id, v)
  }
  push('Any additional contextual information?', s.additional_context ?? (raw as Record<string, unknown>).additional_context)
  push('Anything else you would like us to know?', (raw as Record<string, unknown>).anything_else)
  if (!any) lines.push('(no free-text answers provided)')

  return lines.join('\n').slice(0, 12000)
}

// --- Anthropic call ---------------------------------------------------------

async function scoreOne(systemPrompt: string, userPrompt: string, apiKey: string): Promise<AiReviewResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        // Shared system prompt is cache-marked: within a run, every applicant
        // after the first reads it at the cached-input rate.
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
    const text = (data.content ?? []).find(b => b.type === 'text')?.text ?? ''
    // Tolerate stray prose/fences: parse the outermost JSON object.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('No JSON object in model response')
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const result = parseAiReview({ ...parsed, model: MODEL, created_at: new Date().toISOString() })
    if (!result) throw new Error('Model response failed validation')
    return result
  } finally {
    clearTimeout(timer)
  }
}

// --- Route ------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CANDIDATE_FILTERS = (q: any, eventId: string) =>
  q.eq('event_id', eventId)
    .eq('status', 'submitted')
    .is('deleted_at', null)
    .is('ai_review', null)
    .or('is_test.is.null,is_test.eq.false')

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTeamMember(req)
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured in the Vercel environment.' }, { status: 500 })
  }

  const eventId = params.id
  const svc = getServiceClient()

  const { data: event, error: evErr } = await svc
    .from('events')
    .select('id, name, description, review_rubric, form_config')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // Chunk of unscored, still-undecided, non-test applications.
  const { data: rows, error: rowsErr } = await CANDIDATE_FILTERS(
    svc.from('applications').select(`
      id, student_id, raw_response,
      students!inner(first_name, last_name, year_group, school_type, bursary_90plus,
        free_school_meals, parental_income_band, first_generation_uni, gcse_results,
        qualifications, additional_context, schools(name))
    `), eventId)
    .order('submitted_at', { ascending: true })
    .limit(CHUNK_SIZE)
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })

  const candidates = (rows ?? []) as unknown as CandidateRow[]

  if (candidates.length === 0) {
    return NextResponse.json({ total: 0, processed: 0, failed: 0, remaining: 0, done: true })
  }

  // Engagement context for the chunk.
  const studentIds = [...new Set(candidates.map(r => r.student_id))]
  const enrichedMap: Record<string, { engagement_score: number; attended_count: number; total_applications: number }> = {}
  const { data: enriched } = await svc
    .from('students_enriched')
    .select('id, engagement_score, attended_count, total_applications')
    .in('id', studentIds)
  for (const e of enriched ?? []) {
    enrichedMap[e.id] = {
      engagement_score: e.engagement_score ?? 0,
      attended_count: e.attended_count ?? 0,
      total_applications: e.total_applications ?? 0,
    }
  }

  const labels = fieldLabels(event.form_config)
  const rubric = (typeof event.review_rubric === 'string' && event.review_rubric.trim())
    ? event.review_rubric.trim()
    : DEFAULT_REVIEW_RUBRIC
  const systemPrompt = buildSystemPrompt(event.name, event.description, rubric)

  // Score the chunk concurrently; write each result independently so one
  // failure doesn't lose the rest. Failed rows keep ai_review NULL and are
  // retried on the next loop iteration.
  const results = await Promise.allSettled(candidates.map(async row => {
    const review = await scoreOne(systemPrompt, buildUserPrompt(row, labels, enrichedMap[row.student_id]), apiKey)
    const { error: upErr } = await svc
      .from('applications')
      .update({ ai_review: review })
      .eq('id', row.id)
    if (upErr) throw new Error(upErr.message)
  }))

  const processed = results.filter(r => r.status === 'fulfilled').length
  const failed = results.length - processed
  const firstError = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason
  const errorMsg = failed > 0 ? String(firstError instanceof Error ? firstError.message : firstError ?? 'unknown error') : null

  // Remaining AFTER this chunk.
  const { count } = await CANDIDATE_FILTERS(
    svc.from('applications').select('id', { count: 'exact', head: true }), eventId)

  return NextResponse.json({
    processed,
    failed,
    remaining: count ?? 0,
    done: (count ?? 0) === 0,
    ...(errorMsg ? { error: errorMsg } : {}),
  })
}
