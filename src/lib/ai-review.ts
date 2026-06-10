// ---------------------------------------------------------------------------
// AI applicant review — shared types + helpers.
//
// The /api/events/[id]/ai-review route writes `applications.ai_review` jsonb
// in this shape; the Edit Event applicants table reads it back. Admin-only:
// never exposed to students (hub-api.ts uses explicit column lists, same as
// internal_review_status).
//
// The AI only ever *suggests* an internal mark — it never writes
// `internal_review_status` or `status` itself. Applying suggestions is an
// explicit admin action that skips anyone a human has already marked.
// ---------------------------------------------------------------------------

import type { InternalReviewStatusCode } from './application-status'

export type AiFlag =
  | 'low_effort'
  | 'likely_ai_written'
  | 'exceptional'
  | 'inconsistent'
  | 'safeguarding_concern'

export type AiReviewResult = {
  /** 1 (weak fit) – 5 (exceptional fit), judged against the event rubric. */
  score: number
  /** Two-line, admin-facing summary of the application. */
  summary: string
  /** Why the model landed on this score / suggestion. */
  reason: string
  flags: AiFlag[]
  /** Suggested internal mark; null = genuinely borderline, needs a human read. */
  suggested_internal: InternalReviewStatusCode | null
  model: string
  created_at: string
}

export const AI_FLAGS: readonly AiFlag[] = [
  'low_effort', 'likely_ai_written', 'exceptional', 'inconsistent', 'safeguarding_concern',
] as const

export const AI_FLAG_LABELS: Record<AiFlag, string> = {
  low_effort: 'Low effort',
  likely_ai_written: 'Likely AI-written',
  exceptional: 'Exceptional',
  inconsistent: 'Inconsistent',
  safeguarding_concern: 'Safeguarding',
}

const SUGGESTABLE: ReadonlyArray<InternalReviewStatusCode> = ['accept', 'shortlist', 'waitlist', 'reject']

/** Defensive parse of the jsonb payload (DB rows may predate shape changes). */
export function parseAiReview(raw: unknown): AiReviewResult | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const score = typeof o.score === 'number' ? Math.round(o.score) : NaN
  if (!(score >= 1 && score <= 5)) return null
  return {
    score,
    summary: typeof o.summary === 'string' ? o.summary : '',
    reason: typeof o.reason === 'string' ? o.reason : '',
    flags: Array.isArray(o.flags) ? (o.flags.filter(f => (AI_FLAGS as readonly string[]).includes(String(f))) as AiFlag[]) : [],
    suggested_internal: SUGGESTABLE.includes(o.suggested_internal as InternalReviewStatusCode)
      ? (o.suggested_internal as InternalReviewStatusCode)
      : null,
    model: typeof o.model === 'string' ? o.model : '',
    created_at: typeof o.created_at === 'string' ? o.created_at : '',
  }
}

/** Pale badge classes per score — same visual family as internal marks. */
export function aiScoreBadgeClasses(score: number): string {
  switch (score) {
    case 5: return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40'
    case 4: return 'bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:ring-teal-900/40'
    case 3: return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40'
    case 2: return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/40'
    default: return 'bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40'
  }
}

export const DEFAULT_REVIEW_RUBRIC = `Score each applicant on fit for this Steps Foundation event. Prioritise, in order:
1. Genuine, specific motivation — answers that engage with what THIS event offers (not generic "good opportunity" boilerplate).
2. Evidence of initiative or resilience despite limited opportunity (school context, family circumstances, things they have built or pushed for themselves).
3. Indicators of need: FSM, lower household income, first-generation, state school background. independent_bursary (fee-paying school on a 90%+ bursary) is eligible but the LOWEST priority — a top independent school provides excellent resources regardless of who pays, so these applicants must clear a higher bar.
4. Effort and care in the application itself.

Actively assess whether answers were AI-written: jargon-dense, hyper-polished prose with no personal grounding, chatbot cadence, or research that reads pasted rather than understood. Flag "likely_ai_written" on reasonable suspicion and discount the polish — an AI-written answer tells you nothing about the applicant.

Only 4s and 5s merit human review time. Suggest "shortlist" only when confident the applicant should move on to the final stage (4-5); suggest "reject" for every application scoring 3 or below; null only for genuinely borderline 4s.`
