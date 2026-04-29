// ---------------------------------------------------------------------------
// Application status — single source of truth for labels + badge colours.
//
// Why: we had three separate definitions (student hub, student event page,
// admin applicants table). They drifted — notably the DB stores `waitlist`
// but the hub looked up `waitlisted`, so waitlisted students rendered as
// a default gray badge on the hub. This module collapses them into one.
//
// `legacyAliases` handles any historical rows written with a different code
// so future renames don't silently fall back to gray.
// ---------------------------------------------------------------------------

export type ApplicationStatusCode =
  | 'submitted'
  | 'shortlisted'
  | 'accepted'
  | 'waitlist'
  | 'rejected'
  | 'withdrew'
  | 'ineligible'

type StatusMeta = {
  /** Canonical DB value. */
  code: ApplicationStatusCode
  /** Student-facing label (used on /my and /my/events/[id]). */
  studentLabel: string
  /** Admin-facing label (used in the applicants table). */
  adminLabel: string
  /** Light-mode Tailwind classes: `bg-* text-*`. Includes dark mode variants. */
  badgeClasses: string
}

const STATUSES: Record<ApplicationStatusCode, StatusMeta> = {
  submitted:   { code: 'submitted',   studentLabel: 'Submitted',    adminLabel: 'Submitted',    badgeClasses: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  shortlisted: { code: 'shortlisted', studentLabel: 'Shortlisted',  adminLabel: 'Shortlisted',  badgeClasses: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  accepted:    { code: 'accepted',    studentLabel: 'Accepted',     adminLabel: 'Accepted',     badgeClasses: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  waitlist:    { code: 'waitlist',    studentLabel: 'Waitlisted',   adminLabel: 'Waitlist',     badgeClasses: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  rejected:    { code: 'rejected',    studentLabel: 'Unsuccessful', adminLabel: 'Rejected',     badgeClasses: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  withdrew:    { code: 'withdrew',    studentLabel: 'Withdrawn',    adminLabel: 'Withdrew',     badgeClasses: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  ineligible:  { code: 'ineligible',  studentLabel: 'Not eligible', adminLabel: 'Ineligible',   badgeClasses: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}

// Historical or alternate spellings. Keep this list conservative — if a new
// variant shows up, add it here rather than silently defaulting to gray.
const LEGACY_ALIASES: Record<string, ApplicationStatusCode> = {
  waitlisted: 'waitlist',
}

/** Normalise a raw status string into our canonical code, or `null` if unknown. */
export function normalizeStatus(raw: string | null | undefined): ApplicationStatusCode | null {
  if (!raw) return null
  if (raw in STATUSES) return raw as ApplicationStatusCode
  return LEGACY_ALIASES[raw] ?? null
}

const UNKNOWN_META: StatusMeta = {
  code: 'submitted', // safe fallback — never actually used as a DB write value
  studentLabel: 'Unknown',
  adminLabel: 'Unknown',
  badgeClasses: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export function getStatusMeta(raw: string | null | undefined): StatusMeta {
  const code = normalizeStatus(raw)
  return code ? STATUSES[code] : UNKNOWN_META
}

/**
 * Ordered list for admin dropdowns / bulk actions.
 * `ineligible` is excluded because it's set automatically when a student is
 * auto-screened out during apply (year-group check). Admins shouldn't be able
 * to assign it manually.
 */
export const ADMIN_STATUS_OPTIONS: Array<Pick<StatusMeta, 'code' | 'adminLabel' | 'badgeClasses'> & { label: string }> =
  (Object.values(STATUSES) as StatusMeta[])
    .filter(s => s.code !== 'ineligible')
    .map(s => ({
      code: s.code,
      label: s.adminLabel,
      adminLabel: s.adminLabel,
      badgeClasses: s.badgeClasses,
    }))

/** Full meta record — for callers that want everything. */
export const APPLICATION_STATUSES = STATUSES

// ---------------------------------------------------------------------------
// Internal review state
//
// `internal_review_status` is a draft state that reviewers can set BEFORE
// actually committing a student-facing decision (which fires a notification).
// Cleared automatically when `status` is updated to the matching decision.
//
// Never shown to students — see RLS + explicit column lists in hub-api.ts.
// Pale shades to visually distinguish "we're thinking about this" from a
// committed decision (which uses the solid STATUSES colours above).
// ---------------------------------------------------------------------------

export type InternalReviewStatusCode =
  | 'accept'
  | 'shortlist'
  | 'waitlist'
  | 'reject'

type InternalReviewMeta = {
  code: InternalReviewStatusCode
  /** Admin-facing label. Never student-facing. */
  adminLabel: string
  /** Which committed status this corresponds to — used to auto-clear. */
  correspondsTo: ApplicationStatusCode
  /** Pale Tailwind classes — distinguishable from the committed solid badge. */
  badgeClasses: string
}

export const INTERNAL_REVIEW_STATUSES: Record<InternalReviewStatusCode, InternalReviewMeta> = {
  accept:    { code: 'accept',    adminLabel: 'Accept (internal)',    correspondsTo: 'accepted',    badgeClasses: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40' },
  shortlist: { code: 'shortlist', adminLabel: 'Shortlist (internal)', correspondsTo: 'shortlisted', badgeClasses: 'bg-violet-50 text-violet-600 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/40' },
  waitlist:  { code: 'waitlist',  adminLabel: 'Waitlist (internal)',  correspondsTo: 'waitlist',    badgeClasses: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40' },
  reject:    { code: 'reject',    adminLabel: 'Reject (internal)',    correspondsTo: 'rejected',    badgeClasses: 'bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40' },
}

export const INTERNAL_REVIEW_OPTIONS: Array<{ code: InternalReviewStatusCode; label: string; badgeClasses: string }> =
  Object.values(INTERNAL_REVIEW_STATUSES).map(m => ({
    code: m.code,
    label: m.adminLabel,
    badgeClasses: m.badgeClasses,
  }))

export function normalizeInternalReview(raw: string | null | undefined): InternalReviewStatusCode | null {
  if (!raw) return null
  return raw in INTERNAL_REVIEW_STATUSES ? (raw as InternalReviewStatusCode) : null
}

export function getInternalReviewMeta(raw: string | null | undefined): InternalReviewMeta | null {
  const code = normalizeInternalReview(raw)
  return code ? INTERNAL_REVIEW_STATUSES[code] : null
}

/**
 * If the committed status equals the internal mark's "corresponds to" status,
 * the internal mark should be cleared (the decision has caught up with the
 * intent). Used by the candidate overview page when writing `status`.
 */
export function internalReviewSubsumedBy(
  internal: InternalReviewStatusCode | null | undefined,
  committed: ApplicationStatusCode | null | undefined,
): boolean {
  if (!internal || !committed) return false
  const meta = INTERNAL_REVIEW_STATUSES[internal]
  return meta?.correspondsTo === committed
}

// ---------------------------------------------------------------------------
// Journey-aware student labels
//
// Tells the fuller story of someone's path through an event. Derived at
// render time from application_status_history (every transition is logged
// by an application trigger — see migrations 0007/0008).
//
// Examples:
//   - Rejected, but was ever shortlisted  → "Shortlisted · Unsuccessful"
//   - Rejected, but was ever waitlisted   → "Waitlisted · Unsuccessful"
//   - Waitlist + event has ended          → "Waitlisted · Unsuccessful"
//   - Otherwise                            → plain studentLabel
//
// Precedence: shortlisted > waitlisted (shortlisted is further along).
// ---------------------------------------------------------------------------

export type StatusHistoryRow = {
  status: string | null
  changed_at?: string | null
}

export type JourneyLabel = {
  primary: string
  /** Small-print prefix chip, e.g. "Shortlisted" when final is "Unsuccessful". */
  prefix?: string
  badgeClasses: string
}

function historyEverHad(history: StatusHistoryRow[] | null | undefined, code: ApplicationStatusCode): boolean {
  if (!history || history.length === 0) return false
  return history.some(h => normalizeStatus(h.status) === code)
}

export function getJourneyAwareLabel(
  rawStatus: string | null | undefined,
  history: StatusHistoryRow[] | null | undefined,
  eventEndDate?: string | Date | null,
): JourneyLabel {
  const meta = getStatusMeta(rawStatus)
  const code = normalizeStatus(rawStatus)

  // Soft, dignified treatment for every "didn't make it" path on the student
  // hub — slate badge instead of red. The wording stays "Unsuccessful" so we
  // don't over-soften the message; the colour does the de-escalation. The
  // underlying status code is unchanged (admin still sees red "Rejected").
  const SOFT_UNSUCCESSFUL = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'

  // Case 1: rejected, with prefix telling the story of how far they got.
  if (code === 'rejected') {
    if (historyEverHad(history, 'shortlisted')) {
      return { primary: 'Unsuccessful', prefix: 'Shortlisted', badgeClasses: SOFT_UNSUCCESSFUL }
    }
    if (historyEverHad(history, 'waitlist')) {
      return { primary: 'Unsuccessful', prefix: 'Waitlisted', badgeClasses: SOFT_UNSUCCESSFUL }
    }
    return { primary: 'Unsuccessful', badgeClasses: SOFT_UNSUCCESSFUL }
  }

  // Case 2: still on the waitlist but the event is already over — they were
  // never taken off. Tell the story: "almost made it" without the red sting.
  if (code === 'waitlist' && eventEndDate) {
    const end = eventEndDate instanceof Date ? eventEndDate : new Date(eventEndDate)
    if (!Number.isNaN(end.getTime()) && end.getTime() < Date.now()) {
      return { primary: 'Unsuccessful', prefix: 'Waitlisted', badgeClasses: SOFT_UNSUCCESSFUL }
    }
  }

  return { primary: meta.studentLabel, badgeClasses: meta.badgeClasses }
}
