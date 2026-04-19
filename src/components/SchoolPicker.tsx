'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchSchools, School } from '@/lib/schools-api'

export type SchoolPickerValue = {
  schoolId: string | null
  schoolNameRaw: string | null
  typeGroup?: string | null
  schoolName?: string | null
}

type Props = {
  value: SchoolPickerValue
  /** Pre-resolved display info for the already-linked school, if any.
   *  Saves an extra round-trip when a parent page already has the data. */
  initialSchool?: Pick<School, 'id' | 'name' | 'town'> | null
  onChange: (v: SchoolPickerValue) => void
  disabled?: boolean
  /** Placeholder shown when no school is selected. */
  placeholder?: string
  /** Id for <label htmlFor> if the caller wants to wire a label. */
  id?: string
  className?: string
}

const DEBOUNCE_MS = 180

export default function SchoolPicker({
  value,
  initialSchool,
  onChange,
  disabled,
  placeholder = 'Search GIAS…',
  id,
  className = '',
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<School[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [displayLabel, setDisplayLabel] = useState<string>('')
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const reqIdRef = useRef(0)

  // Figure out what to show as the current value label.
  useEffect(() => {
    if (value.schoolId && initialSchool && initialSchool.id === value.schoolId) {
      setDisplayLabel(initialSchool.town ? `${initialSchool.name} — ${initialSchool.town}` : initialSchool.name)
    } else if (value.schoolId) {
      // Linked but we don't have display info — keep any prior label or fall back to raw.
      setDisplayLabel(prev => prev || value.schoolNameRaw || '(linked school)')
    } else if (value.schoolNameRaw) {
      setDisplayLabel(`${value.schoolNameRaw} (manual)`)
    } else {
      setDisplayLabel('')
    }
  }, [value.schoolId, value.schoolNameRaw, initialSchool])

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Debounced search.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const myId = ++reqIdRef.current
    const t = setTimeout(() => {
      searchSchools(q, 15)
        .then(r => {
          if (myId !== reqIdRef.current) return
          setResults(r)
          setActive(0)
        })
        .catch(() => {
          if (myId !== reqIdRef.current) return
          setResults([])
        })
        .finally(() => {
          if (myId === reqIdRef.current) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, open])

  function commitSchool(s: School) {
    onChange({ schoolId: s.id, schoolNameRaw: s.name, typeGroup: s.type_group ?? null, schoolName: s.name })
    setDisplayLabel(s.town ? `${s.name} — ${s.town}` : s.name)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function commitManual() {
    const raw = query.trim()
    if (!raw) return
    onChange({ schoolId: null, schoolNameRaw: raw, typeGroup: null, schoolName: null })
    setDisplayLabel(`${raw} (manual)`)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function clear() {
    onChange({ schoolId: null, schoolNameRaw: null, typeGroup: null, schoolName: null })
    setDisplayLabel('')
    setQuery('')
    setResults([])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => Math.min(a + 1, Math.max(results.length, 1) - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) commitSchool(results[active])
      else if (query.trim()) commitManual()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showManualRow = useMemo(() => query.trim().length > 0, [query])

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {!open && displayLabel ? (
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 hover:border-indigo-400 disabled:opacity-60"
          >
            <span className="block truncate">{displayLabel}</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="px-2 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
            aria-label="Clear school"
          >
            Clear
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={id ? `${id}-listbox` : undefined}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-60"
        />
      )}

      {open && (
        <div
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg text-sm"
        >
          {loading && (
            <div className="px-3 py-2 text-gray-500 dark:text-gray-400">Searching…</div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="px-3 py-2 text-gray-500 dark:text-gray-400">No matches</div>
          )}
          {!loading && !query.trim() && (
            <div className="px-3 py-2 text-gray-500 dark:text-gray-400">Type to search the GIAS register…</div>
          )}
          {results.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => commitSchool(s)}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
                i === active
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100'
                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {[s.town, s.postcode, s.phase, s.type_group].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
          {showManualRow && (
            <button
              type="button"
              onClick={commitManual}
              className="w-full text-left px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Not listed — use &ldquo;<span className="font-medium">{query.trim()}</span>&rdquo; as free text
            </button>
          )}
        </div>
      )}
    </div>
  )
}
