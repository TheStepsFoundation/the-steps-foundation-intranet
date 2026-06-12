// ---------------------------------------------------------------------------
// MetaLine — THE way to show plain facts ("15 minutes · One attempt ·
// Calculators allowed"): quiet inline text with optional small icons,
// separated by middots. Replaces the grey fact-pills. Statuses (things with
// a state) use <Badge/> instead.
// ---------------------------------------------------------------------------

export type MetaItem = { icon?: React.ReactNode; label: React.ReactNode }

export function MetaLine({ items, className = '' }: { items: MetaItem[]; className?: string }) {
  const visible = items.filter(Boolean)
  return (
    <div className={`flex flex-wrap items-center gap-y-1 text-sm text-slate-500 dark:text-gray-400 ${className}`}>
      {visible.map((item, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="mx-2.5 text-slate-300 dark:text-gray-600">·</span>}
          <span className="inline-flex items-center gap-1.5">
            {item.icon && <span className="text-slate-400 dark:text-gray-500 [&>svg]:w-4 [&>svg]:h-4" aria-hidden>{item.icon}</span>}
            {item.label}
          </span>
        </span>
      ))}
    </div>
  )
}

export default MetaLine
