// ---------------------------------------------------------------------------
// Merge-tag output formatting.
//
// Admins pick how date / time / year-group merge tags render in emails via
// Settings → Merge tag formats. Both the per-event applicants composer and
// the InviteStudentsModal read these via fillMergeFields / fillMerge.
//
// Defaults are chosen to match the pre-settings hardcoded output so existing
// behaviour is unchanged out of the box.
// ---------------------------------------------------------------------------

export type DateFormatKey =
  | 'weekday_long'          // Wednesday, 27 May 2026
  | 'weekday_ordinal'       // Wednesday 27th May 2026
  | 'weekday_ordinal_no_year' // Wednesday 27th May
  | 'short'                 // Wed 27 May
  | 'numeric'               // 27/05/2026
  | 'ordinal_no_year'       // 27th May

export type TimeFormatKey =
  | 'h24'                   // 16:00 – 17:30
  | 'h12'                   // 4:00 PM – 5:30 PM
  | 'h12_short'             // 4 PM – 5:30 PM

export type OpenToFormatKey =
  | 'short'                 // Y12, Y13
  | 'long'                  // Year 12 and Year 13

export const DATE_FORMAT_OPTIONS: { value: DateFormatKey; label: string; sample: string }[] = [
  { value: 'weekday_long',          label: 'Wednesday, 27 May 2026',  sample: 'Wednesday, 27 May 2026' },
  { value: 'weekday_ordinal',       label: 'Wednesday 27th May 2026', sample: 'Wednesday 27th May 2026' },
  { value: 'weekday_ordinal_no_year', label: 'Wednesday 27th May',    sample: 'Wednesday 27th May' },
  { value: 'short',                 label: 'Wed 27 May',              sample: 'Wed 27 May' },
  { value: 'numeric',               label: '27/05/2026',              sample: '27/05/2026' },
  { value: 'ordinal_no_year',       label: '27th May',                sample: '27th May' },
]

export const TIME_FORMAT_OPTIONS: { value: TimeFormatKey; label: string; sample: string }[] = [
  { value: 'h24',       label: '24-hour (16:00 – 17:30)',  sample: '16:00 – 17:30' },
  { value: 'h12',       label: '12-hour (4:00 PM – 5:30 PM)', sample: '4:00 PM – 5:30 PM' },
  { value: 'h12_short', label: '12-hour short (4 PM – 5:30 PM)', sample: '4 PM – 5:30 PM' },
]

export const OPENTO_FORMAT_OPTIONS: { value: OpenToFormatKey; label: string; sample: string }[] = [
  { value: 'short', label: 'Short (Y12, Y13)',           sample: 'Y12, Y13' },
  { value: 'long',  label: 'Long (Year 12, Year 13 and Gap Year Students)', sample: 'Year 12, Year 13 and Gap Year Students' },
]

export const DEFAULT_DATE_FORMAT: DateFormatKey = 'weekday_long'
export const DEFAULT_TIME_FORMAT: TimeFormatKey = 'h24'
export const DEFAULT_OPENTO_FORMAT: OpenToFormatKey = 'short'

// ---- formatting helpers --------------------------------------------------

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Format a date-only string (YYYY-MM-DD) according to the configured key.
 * Returns the supplied fallback for null / invalid input.
 */
export function formatMergeDate(value: string | null | undefined, key: DateFormatKey, fallback = 'TBC'): string {
  if (!value) return fallback
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return fallback
  const day = d.getDate()
  const month = d.getMonth()
  const weekday = d.getDay()
  const year = d.getFullYear()
  switch (key) {
    case 'weekday_long':
      return `${WEEKDAY_LONG[weekday]}, ${day} ${MONTH_NAMES[month]} ${year}`
    case 'weekday_ordinal':
      return `${WEEKDAY_LONG[weekday]} ${day}${ordinalSuffix(day)} ${MONTH_NAMES[month]} ${year}`
    case 'weekday_ordinal_no_year':
      return `${WEEKDAY_LONG[weekday]} ${day}${ordinalSuffix(day)} ${MONTH_NAMES[month]}`
    case 'short':
      return `${WEEKDAY_SHORT[weekday]} ${day} ${MONTH_SHORT[month]}`
    case 'numeric':
      return `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`
    case 'ordinal_no_year':
      return `${day}${ordinalSuffix(day)} ${MONTH_NAMES[month]}`
  }
}

/** Format a time range using the configured key. Either bound may be missing. */
export function formatMergeTime(timeStart: string | null | undefined, timeEnd: string | null | undefined, key: TimeFormatKey, fallback = 'TBC'): string {
  if (!timeStart && !timeEnd) return fallback
  const fmt = (t?: string | null) => {
    if (!t) return ''
    const [hStr, mStr] = t.split(':')
    const h = Number(hStr)
    const m = Number(mStr)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return t
    switch (key) {
      case 'h24':
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      case 'h12': {
        const period = h >= 12 ? 'PM' : 'AM'
        const h12 = ((h + 11) % 12) + 1
        return `${h12}:${String(m).padStart(2, '0')} ${period}`
      }
      case 'h12_short': {
        const period = h >= 12 ? 'PM' : 'AM'
        const h12 = ((h + 11) % 12) + 1
        return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
      }
    }
  }
  const s = fmt(timeStart)
  const e = fmt(timeEnd)
  if (s && e) return `${s} – ${e}`
  return s || e || fallback
}

/**
 * Format the 'open to' year-group label. Mirrors formatOpenTo's behaviour for
 * the 'short' key (so leaving the setting at default doesn't change existing
 * emails). Long renders 'Year X and Year Y' style prose.
 */
export function formatMergeOpenTo(yearGroups: number[] | null | undefined, openToGapYear: boolean, key: OpenToFormatKey): string {
  const ygs = Array.isArray(yearGroups) ? [...yearGroups].filter((n): n is number => typeof n === 'number').sort((a, b) => a - b) : []
  const allYears = ygs.length === 0 ? [] : [...ygs]
  if (openToGapYear && !allYears.includes(14)) allYears.push(14)
  if (allYears.length === 0) return 'any year'
  const labelFor = (yg: number) => yg === 14 ? (key === 'long' ? 'Gap Year Students' : 'Gap year') : (key === 'long' ? `Year ${yg}` : `Y${yg}`)
  const labels = allYears.map(labelFor)
  if (labels.length === 1) return labels[0]
  if (key === 'short') return labels.join(', ')
  // long
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}


/**
 * Resolve a merge-tag label against admin overrides. Returns the override if
 * one is set in app_settings.mergeTagLabels (and not empty); otherwise the
 * caller's default. Used by both composer picker chips and the inserted
 * contenteditable chips so the two stay in sync.
 */
export function resolveMergeTagLabel(tag: string, fallback: string, overrides: Record<string, string> | null | undefined): string {
  if (!overrides) return fallback
  const v = overrides[tag]
  if (typeof v === 'string' && v.trim().length > 0) return v
  return fallback
}
