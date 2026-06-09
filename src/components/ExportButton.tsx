'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  buildExportMatrix,
  downloadCsv,
  downloadXlsx,
  exportToGoogleSheets,
  type ExportColumn,
  type ExportFormat,
  type SheetsResult,
} from '@/lib/export-data'

type Props<T> = {
  /** Rows to export — pass the *filtered* list so "export what you see" holds. */
  rows: T[]
  /** Every column the user is allowed to export, in canonical order. */
  columns: ExportColumn<T>[]
  /** Column ids ticked by default (usually the currently-visible columns). */
  defaultSelectedIds?: string[]
  /** Base filename (no extension) for CSV/XLSX downloads. */
  filenameBase: string
  /** Title for the created Google Sheet. */
  sheetTitle: string
  /** Optional override for the trigger button label. */
  buttonLabel?: string
  /** Optional extra classes for the trigger button. */
  buttonClassName?: string
  disabled?: boolean
}

const DEFAULT_BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const FORMAT_META: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'csv', label: 'CSV', hint: 'Opens in Excel, Numbers & Google Sheets' },
  { id: 'xlsx', label: 'Excel (.xlsx)', hint: 'Formatted workbook with a bold header row' },
  { id: 'sheets', label: 'Google Sheets', hint: 'Creates a new sheet and shares it with you' },
]

export default function ExportButton<T>({
  rows,
  columns,
  defaultSelectedIds,
  filenameBase,
  sheetTitle,
  buttonLabel,
  buttonClassName,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false)

  const initialSelected = useMemo(() => {
    const ids = (defaultSelectedIds && defaultSelectedIds.length)
      ? defaultSelectedIds.filter(id => columns.some(c => c.id === id))
      : columns.map(c => c.id)
    return new Set(ids)
  }, [defaultSelectedIds, columns])

  const [selected, setSelected] = useState<Set<string>>(initialSelected)
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SheetsResult | null>(null)

  // Re-seed the tick state whenever the modal is (re)opened so it always
  // reflects the latest visible-columns default rather than a stale snapshot.
  useEffect(() => {
    if (open) {
      setSelected(initialSelected)
      setError(null)
      setResult(null)
    }
  }, [open, initialSelected])

  // Honour the caller's canonical order when emitting selected ids.
  const selectedInOrder = useMemo(
    () => columns.filter(c => selected.has(c.id)).map(c => c.id),
    [columns, selected],
  )

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectAll = () => setSelected(new Set(columns.map(c => c.id)))
  const selectNone = () => setSelected(new Set())
  const resetToDefault = () => setSelected(initialSelected)

  async function runExport() {
    if (selectedInOrder.length === 0) {
      setError('Pick at least one column to export.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const { headers, data } = buildExportMatrix(rows, columns, selectedInOrder)
      if (format === 'csv') {
        downloadCsv(filenameBase, headers, data)
        setOpen(false)
      } else if (format === 'xlsx') {
        await downloadXlsx(filenameBase, headers, data, 'Data')
        setOpen(false)
      } else {
        // Resolve the signed-in admin's email so the new sheet is shared back
        // to them — keeps sensitive student data out of an "anyone with link".
        let shareWith: string | null = null
        try {
          const { data: u } = await supabase.auth.getUser()
          shareWith = u.user?.email ?? null
        } catch {
          /* non-fatal: sheet still gets created in the org Drive */
        }
        const res = await exportToGoogleSheets(sheetTitle, headers, data, shareWith)
        setResult(res)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || rows.length === 0}
        className={buttonClassName ?? DEFAULT_BTN}
        title={rows.length === 0 ? 'Nothing to export' : 'Export to CSV, Excel or Google Sheets'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        <span>{buttonLabel ?? 'Export'}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onMouseDown={e => { if (e.target === e.currentTarget && !busy) setOpen(false) }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Export data</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''} · {selected.size} of {columns.length} columns selected
              </p>
            </div>

            {result ? (
              <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-4">
                  <p className="font-medium text-emerald-900 dark:text-emerald-200">Google Sheet created</p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                    {result.shared
                      ? 'Shared with your account — open it below.'
                      : 'Created in the Steps Google Drive. Ask an admin to share it if the link asks for access.'}
                  </p>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    Open “{result.title}”
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* Columns */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Columns</span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button type="button" onClick={selectAll} className="text-steps-blue-600 dark:text-steps-blue-400 hover:underline">All</button>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <button type="button" onClick={selectNone} className="text-steps-blue-600 dark:text-steps-blue-400 hover:underline">None</button>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <button type="button" onClick={resetToDefault} className="text-steps-blue-600 dark:text-steps-blue-400 hover:underline">Visible</button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 max-h-56 overflow-y-auto">
                    {columns.map(col => {
                      const checked = selected.has(col.id)
                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => toggle(col.id)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <span
                            aria-hidden
                            className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                              checked
                                ? 'bg-steps-blue-600 border-steps-blue-600'
                                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                            }`}
                          >
                            {checked && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <span className="truncate">{col.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Format */}
                  <div className="mt-4 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Format</span>
                  </div>
                  <div className="space-y-2">
                    {FORMAT_META.map(f => (
                      <label
                        key={f.id}
                        className={`flex items-start gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          format === f.id
                            ? 'border-steps-blue-500 bg-steps-blue-50/60 dark:bg-steps-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="export-format"
                          checked={format === f.id}
                          onChange={() => setFormat(f.id)}
                          className="mt-0.5 accent-steps-blue-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{f.label}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{f.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {error && (
                    <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runExport}
                    disabled={busy || selected.size === 0}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-steps-blue-600 text-white hover:bg-steps-blue-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {busy && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {busy
                      ? (format === 'sheets' ? 'Creating sheet…' : 'Exporting…')
                      : (format === 'sheets' ? 'Create sheet' : 'Download')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
