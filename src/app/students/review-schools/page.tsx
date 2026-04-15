'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchUnlinkedReview,
  linkStudentsByRaw,
  dismissUnlinkedRaw,
  ReviewRow,
  ReviewCandidate,
} from '@/lib/students-api'
import SchoolPicker from '@/components/SchoolPicker'

const PAGE_SIZE = 25
const PER_RAW = 6

type RowState = 'idle' | 'linking' | 'dismissing' | 'done'

export default function ReviewSchoolsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageOffset, setPageOffset] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [resolvedCount, setResolvedCount] = useState(0)

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchUnlinkedReview({
        perRaw: PER_RAW,
        pageSize: PAGE_SIZE,
        pageOffset: offset,
      })
      setRows(data)
      setTotalCount(data[0]?.total_count ?? 0)
      setRowState({})
      setPickerOpenFor(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(pageOffset)
  }, [load, pageOffset])

  function markDone(raw: string) {
    setRowState(s => ({ ...s, [raw]: 'done' }))
    setResolvedCount(c => c + 1)
  }

  async function handleLink(raw: string, schoolId: string) {
    setRowState(s => ({ ...s, [raw]: 'linking' }))
    try {
      await linkStudentsByRaw(raw, schoolId)
      markDone(raw)
    } catch (e) {
      setRowState(s => ({ ...s, [raw]: 'idle' }))
      alert(`Failed to link: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function handleDismiss(raw: string) {
    setRowState(s => ({ ...s, [raw]: 'dismissing' }))
    try {
      await dismissUnlinkedRaw(raw)
      markDone(raw)
    } catch (e) {
      setRowState(s => ({ ...s, [raw]: 'idle' }))
      alert(`Failed to dismiss: ${e instanceof Error ? e.message : e}`)
    }
  }

  const pageNum = Math.floor(pageOffset / PAGE_SIZE) + 1
  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const visibleRows = rows.filter(r => rowState[r.raw] !== 'done')

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/students" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
            &larr; Back to students
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
            School matching review
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {totalCount} unmatched school name{totalCount === 1 ? '' : 's'} grouped by raw value.
            Pick a candidate to link every student sharing that raw, or dismiss if the school
            isn&rsquo;t in GIAS (e.g. overseas).
          </p>
          {resolvedCount > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              {resolvedCount} resolved this session.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={pageOffset === 0 || loading}
            onClick={() => setPageOffset(o => Math.max(0, o - PAGE_SIZE))}
            className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            &larr; Prev
          </button>
          <span className="text-gray-600 dark:text-gray-400">
            Page {pageNum} / {lastPage}
          </span>
          <button
            type="button"
            disabled={pageNum >= lastPage || loading}
            onClick={() => setPageOffset(o => o + PAGE_SIZE)}
            className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded border border-rose-300 bg-rose-50 text-rose-800 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm">Loading&hellip;</div>
      ) : visibleRows.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400 text-sm">
          Nothing left to review on this page. Use Next &rarr;.
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map(row => (
            <ReviewCard
              key={row.raw}
              row={row}
              state={rowState[row.raw] ?? 'idle'}
              pickerOpen={pickerOpenFor === row.raw}
              onPickerToggle={open => setPickerOpenFor(open ? row.raw : null)}
              onLink={handleLink}
              onDismiss={handleDismiss}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ReviewCard({
  row,
  state,
  pickerOpen,
  onPickerToggle,
  onLink,
  onDismiss,
}: {
  row: ReviewRow
  state: RowState
  pickerOpen: boolean
  onPickerToggle: (open: boolean) => void
  onLink: (raw: string, schoolId: string) => void | Promise<void>
  onDismiss: (raw: string) => void | Promise<void>
}) {
  const busy = state === 'linking' || state === 'dismissing'
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">{row.raw}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {row.student_count} student{row.student_count === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPickerToggle(!pickerOpen)}
            className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {pickerOpen ? 'Cancel search' : 'Search GIAS\u2026'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDismiss(row.raw)}
            className="px-2 py-1 text-xs rounded-md border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 disabled:opacity-50"
            title="Mark as not in GIAS (e.g. overseas school)."
          >
            {state === 'dismissing' ? 'Dismissing\u2026' : 'Not in GIAS'}
          </button>
        </div>
      </div>

      {pickerOpen ? (
        <div className="mt-3">
          <SchoolPicker
            value={{ schoolId: null, schoolNameRaw: null }}
            placeholder={`Search for "${row.raw}"\u2026`}
            onChange={v => {
              if (v.schoolId) void onLink(row.raw, v.schoolId)
            }}
          />
        </div>
      ) : row.candidates.length === 0 ? (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          No fuzzy matches. Use &ldquo;Search GIAS\u2026&rdquo; to look manually, or &ldquo;Not in GIAS&rdquo;.
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {row.candidates.map(c => (
            <CandidateButton key={c.id} candidate={c} disabled={busy} onPick={() => onLink(row.raw, c.id)} />
          ))}
        </ul>
      )}
    </li>
  )
}

function CandidateButton({
  candidate,
  disabled,
  onPick,
}: {
  candidate: ReviewCandidate
  disabled: boolean
  onPick: () => void
}) {
  const sim = candidate.similarity
  const tone =
    sim >= 0.95
      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
      : sim >= 0.8
        ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
  const meta = [candidate.town, candidate.postcode, candidate.phase, candidate.type_group].filter(Boolean).join(' \u00b7 ')
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className={`w-full text-left px-3 py-2 rounded-md border ${tone} disabled:opacity-50`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{candidate.name}</div>
          <div
            className={`text-xs shrink-0 ${
              sim >= 0.95
                ? 'text-emerald-700 dark:text-emerald-300'
                : sim >= 0.8
                  ? 'text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {(sim * 100).toFixed(0)}%
          </div>
        </div>
        {meta && <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{meta}</div>}
      </button>
    </li>
  )
}
