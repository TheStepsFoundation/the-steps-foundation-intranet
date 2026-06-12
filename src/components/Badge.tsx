// ---------------------------------------------------------------------------
// Badge — THE status indicator. One component, one look: rounded-md (not a
// full pill), tinted background + 1px inset ring + darker text of the same
// hue. Use ONLY for things with a state (statuses, phases, flags). Plain
// facts ("15 minutes", "Calculators allowed") belong in <MetaLine/>, never
// in a badge — that distinction is the house style.
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'blue' | 'teal' | 'emerald' | 'violet' | 'amber' | 'red'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:ring-gray-700',
  blue:    'bg-steps-blue-50 text-steps-blue-700 ring-steps-blue-200 dark:bg-steps-blue-900/30 dark:text-steps-blue-300 dark:ring-steps-blue-800',
  teal:    'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-800',
  amber:   'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
  red:     'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',
}

export function Badge({ tone = 'neutral', children, title, className = '' }: {
  tone?: BadgeTone
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export default Badge
