// ---------------------------------------------------------------------------
// Year-group eligibility helpers, shared between /my (hub) and /my/events/[id]
// so the list page and the detail page cannot disagree about whether a given
// student can apply to a given event.
// ---------------------------------------------------------------------------

export type EligibilityInputs = {
  eligible_year_groups: number[] | null
  open_to_gap_year: boolean | null | undefined
}

/**
 * Given a student's year_group and an event's open-to config, returns whether
 * the student is eligible.
 *
 * Rules:
 *  - No filter at all (empty year list + no gap-year opt-in) → open to everyone.
 *  - Student hasn't set a year_group yet → treat as eligible so the hub nudges
 *    them to fill it in rather than hiding the event.
 *  - year_group=14 is the gap-year sentinel, eligible iff the event opts in.
 *  - Otherwise the student's year must be in eligible_year_groups.
 */
export function isEligibleForYearGroup(
  event: EligibilityInputs,
  yearGroup: number | null | undefined,
): boolean {
  const allowed = event.eligible_year_groups ?? []
  const openToGap = !!event.open_to_gap_year
  if (allowed.length === 0 && !openToGap) return true
  if (yearGroup == null) return true
  if (yearGroup === 14 && openToGap) return true
  return allowed.includes(yearGroup)
}
