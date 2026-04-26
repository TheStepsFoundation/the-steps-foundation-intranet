/**
 * Types for post-event feedback datasets.
 *
 * One file per event (e.g. starting-point-2025.ts) exports a
 * EventFeedbackDataset that conforms to this shape. The data is curated
 * + the full appendix of raw responses (with consent flags so we know
 * which can be quoted externally vs. kept internal-only).
 */

export type Consent =
  // Free to share with full name
  | 'name'
  // Free to share with first name only
  | 'first_name'
  // Anonymous quote OK
  | 'anon'
  // Internal-only — do not share externally
  | 'no'

export type CuratedQuote = {
  /** The quote text — lightly typo-cleaned only. */
  text: string
  /** Display author given the consent flag. e.g. "Aiya O." or "Anonymous". */
  author: string
  /** Optional context badge: "Y12", "Gap year", "First-gen", etc. */
  context?: string
  consent: Consent
  /** Verbatim source response timestamp (links back to appendix row). */
  sourceTimestamp?: string
}

export type RatingBreakdown = {
  /** The question label. */
  question: string
  /** Order matters — used as bar chart row order, low→high. */
  scale: string[]
  /** Map of scale label → response count. */
  counts: Record<string, number>
  /** Optional short caption (e.g. "Likert 5-point", "Numeric 1–5"). */
  caption?: string
  /** Optional pre-computed mean for numeric scales. */
  mean?: number
}

export type FreeTextResponse = {
  timestamp: string
  /** First name + initial preferred for hub readability. May be "Anonymous". */
  name: string
  /** Authors's listed consent for testimonial sharing. */
  consent: Consent
  /** Map of column label → response text (skipped if blank). */
  fields: Record<string, string>
  /** Optional flag: this row was used as a curated quote somewhere. */
  curated?: boolean
}

export type FeedbackKpi = {
  label: string
  value: string
  /** A quietly muted secondary line under the value. */
  detail?: string
  /** Tone for visual emphasis. */
  tone?: 'positive' | 'neutral' | 'caution'
}

export type EventFeedbackDataset = {
  eventId: string
  slug: string
  eventName: string
  /** ISO event date, e.g. "2025-09-27". */
  eventDate: string
  /** Total feedback responses received (== rows in the source sheet). */
  responseCount: number
  /** Source sheet for traceability. */
  sourceSheetUrl: string

  /** Headline KPIs rendered as a row of cards at the top. */
  kpis: FeedbackKpi[]
  /** Stacked bar charts of rating distributions. */
  ratings: RatingBreakdown[]

  /** Curated picks for sharing. */
  testimonials: CuratedQuote[]
  /** Specific, actionable improvement asks. */
  constructive: CuratedQuote[]
  /** "Came in expecting X, left thinking Y" — transformation stories. */
  growth: CuratedQuote[]

  /** Full appendix of raw free-text responses, in submission order. */
  appendix: FreeTextResponse[]
}
