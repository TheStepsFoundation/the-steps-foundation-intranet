// ---------------------------------------------------------------------------
// Shared helpers for filtering people by the subjects in their qualifications.
//
// Qualifications are stored as a JSONB array of { qualType, subject, grade, … }
// on the students table (and surfaced on the per-event Applicant rows). These
// helpers are deliberately tolerant of null / non-array / malformed entries so
// a single bad row can never throw mid-filter.
//
// Matching is case-insensitive throughout; the "__other" free-text sentinel is
// dropped so it never clutters the picker.
// ---------------------------------------------------------------------------

export type SubjectMatchMode = 'any' | 'all'

function readSubject(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = (entry as { subject?: unknown }).subject
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.toLowerCase().startsWith('__')) return null
  return s
}

/** Lower-cased, trimmed set of subjects for one row's qualifications JSON. */
export function extractSubjectsLower(qualifications: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(qualifications)) return out
  for (const q of qualifications) {
    const s = readSubject(q)
    if (s) out.add(s.toLowerCase())
  }
  return out
}

function titleCaseSubject(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Distinct subject options across many rows, sorted A→Z. Dedupes
 * case-insensitively and returns a tidy display form so the picker reads
 * consistently regardless of how each student typed it.
 */
export function collectSubjectOptions(rows: { qualifications?: unknown }[]): string[] {
  const byLower = new Map<string, string>()
  for (const r of rows) {
    const quals = r?.qualifications
    if (!Array.isArray(quals)) continue
    for (const q of quals) {
      const s = readSubject(q)
      if (!s) continue
      const low = s.toLowerCase()
      if (!byLower.has(low)) byLower.set(low, titleCaseSubject(s))
    }
  }
  return Array.from(byLower.values()).sort((a, b) => a.localeCompare(b))
}

/**
 * Comma-separated, deduped, sorted display list of a row's subjects — for
 * the "Subjects" export column. Empty string when there are none.
 */
export function subjectsForExport(qualifications: unknown): string {
  return collectSubjectOptions([{ qualifications }]).join(', ')
}

/**
 * Does this row's subject set satisfy the selected subjects under the mode?
 * `selected` is an array of display values (matched case-insensitively).
 *   - 'any'  → row studies at least one selected subject
 *   - 'all'  → row studies every selected subject
 * Empty selection always matches (no filter applied).
 */
export function matchesSubjects(
  rowSubjectsLower: Set<string>,
  selected: string[],
  mode: SubjectMatchMode,
): boolean {
  const sel = selected.map(s => s.trim().toLowerCase()).filter(Boolean)
  if (sel.length === 0) return true
  return mode === 'all'
    ? sel.every(s => rowSubjectsLower.has(s))
    : sel.some(s => rowSubjectsLower.has(s))
}
