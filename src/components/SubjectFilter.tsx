'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubjectMatchMode } from '@/lib/subject-filter'

type Props = {
  /** Distinct subject options (display form), already sorted. */
  options: string[]
  /** Currently-selected subjects (display form). */
  selected: string[]
  /** any = at least one; all = every selected subject. */
  mode: SubjectMatchMode
  /** Emits the new selection + mode. */
  onChange: (selected: string[], mode: SubjectMatchMode) => void
  /** Smaller trigger for dense toolbars (event page / invite modal). */
  compact?: boolean
}

/**
 * Searchable multi-select for academic subjects with an Any/All match toggle.
 * Self-contained: owns its open state + outside-click handling. Matching logic
 * lives in @/lib/subject-filter so every surface agrees.
 */
export default function SubjectFilter({ options, selected, mode, onChange, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (subject: string) => {
    const low = subject.toLowerCase()
    const next = selectedSet.has(low)
      ? selected.filter(s => s.toLowerCase() !== low)
      : [...selected, subject]
    onChange(next, mode)
  }

  const clear = () => onChange([], mode)
  const setMode = (m: SubjectMatchMode) => onChange(selected, m)

  const triggerCls = compact
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
    : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'

  return (
    <div ref={rootRef} className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)} className={triggerCls}>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.247m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.247" />
        </svg>
        <span>Subjects</span>
        {selected.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-steps-blue-600 text-white">{selected.length}</span>
        )}
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-72 max-h-[60vh] flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-50">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                {selected.length > 0 ? `${selected.length} selected` : 'Filter by subject'}
              </span>
              {selected.length > 0 && (
                <button type="button" onClick={clear} className="text-[11px] text-steps-blue-600 dark:text-steps-blue-400 hover:underline">Clear</button>
              )}
            </div>
            {/* Any / All toggle */}
            <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
              {(['any', 'all'] as SubjectMatchMode[]).map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={m === 'any' ? 'Studies at least one of the selected subjects' : 'Studies every selected subject'}
                  className={`px-2.5 py-1 ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${
                    mode === m ? 'bg-steps-blue-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {m === 'any' ? 'Any of' : 'All of'}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search subjects…"
              className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                {options.length === 0 ? 'No subjects on file yet.' : 'No subjects match.'}
              </div>
            ) : (
              shown.map(subject => {
                const checked = selectedSet.has(subject.toLowerCase())
                return (
                  <button
                    key={subject}
                    type="button"
                    onClick={() => toggle(subject)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <span
                      aria-hidden
                      className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        checked ? 'bg-steps-blue-600 border-steps-blue-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                      }`}
                    >
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{subject}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
