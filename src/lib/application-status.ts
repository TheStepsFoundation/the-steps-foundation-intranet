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
  rejected:    { code: 'rejected',    studentLabel: 'Not selected', adminLabel: 'Rejected',     badgeClasses: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
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
