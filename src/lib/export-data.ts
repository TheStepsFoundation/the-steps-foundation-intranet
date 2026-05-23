'use client'

// ---------------------------------------------------------------------------
// Shared export utilities — turn an array of typed rows + a column definition
// into a CSV download, an .xlsx download, or a brand-new Google Sheet.
//
// Used by the student database, the per-event applicants table, and the
// invite/email modal candidate list. Each call-site supplies its own
// ExportColumn<T>[] (id + human label + accessor) so the matrix builder stays
// generic and the per-page value formatting lives next to the table it mirrors.
// ---------------------------------------------------------------------------

export type ExportCellValue = string | number | boolean | null | undefined

export type ExportColumn<T> = {
  /** Stable id — matched against the column-picker selection. */
  id: string
  /** Human-readable header written to the first row of the export. */
  label: string
  /** Pull the cell value out of a row. Booleans render as Yes/No, null as ''. */
  accessor: (row: T) => ExportCellValue
}

export type ExportFormat = 'csv' | 'xlsx' | 'sheets'

/** Normalise an accessor result into a primitive a spreadsheet cell accepts. */
function normalizeCell(v: ExportCellValue): string | number {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Number.isFinite(v) ? v : ''
  return v
}

/**
 * Build the header row + 2D data matrix for the chosen columns, in the order
 * the caller passes `selectedIds` (so column reordering is respected too).
 */
export function buildExportMatrix<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  selectedIds: string[],
): { headers: string[]; data: (string | number)[][] } {
  const byId = new Map(columns.map(c => [c.id, c]))
  const cols = selectedIds
    .map(id => byId.get(id))
    .filter((c): c is ExportColumn<T> => !!c)
  const headers = cols.map(c => c.label)
  const data = rows.map(row => cols.map(c => normalizeCell(c.accessor(row))))
  return { headers, data }
}

function csvEscape(v: string | number): string {
  const s = String(v)
  // Quote anything containing the delimiter, quotes, or newlines (RFC 4180).
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(headers: string[], data: (string | number)[][]): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of data) lines.push(row.map(csvEscape).join(','))
  return lines.join('\r\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke a beat later so the download has time to start in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** Sanitise a string for use as a download filename. */
export function safeFilename(base: string): string {
  return base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'export'
}

export function downloadCsv(filenameBase: string, headers: string[], data: (string | number)[][]) {
  // Lead with a UTF-8 BOM so Excel opens accented names / £ signs correctly.
  const csv = '﻿' + toCsv(headers, data)
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `${safeFilename(filenameBase)}.csv`,
  )
}

// SheetJS is loaded on demand from a CDN the first time someone exports to
// .xlsx — keeps it out of the main bundle and avoids adding a build-time
// dependency (and the lockfile churn that comes with it).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    XLSX?: any
  }
}
const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
let xlsxLoader: Promise<any> | null = null
function loadXlsx(): Promise<any> {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX)
  if (xlsxLoader) return xlsxLoader
  xlsxLoader = new Promise<any>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = XLSX_CDN
    script.async = true
    script.onload = () =>
      window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel library loaded but was unavailable.'))
    script.onerror = () => {
      xlsxLoader = null
      reject(new Error('Could not load the Excel library — check your connection, or use CSV instead.'))
    }
    document.head.appendChild(script)
  })
  return xlsxLoader
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function downloadXlsx(
  filenameBase: string,
  headers: string[],
  data: (string | number)[][],
  sheetName = 'Export',
) {
  const XLSX = await loadXlsx()
  const aoa = [headers, ...data]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Auto-ish column widths: clamp between 10 and 60 chars.
  ws['!cols'] = headers.map((h, i) => {
    const widest = Math.max(
      String(h).length,
      ...data.map(r => String(r[i] ?? '').length),
    )
    return { wch: Math.min(60, Math.max(10, widest + 2)) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(filenameBase)}.xlsx`,
  )
}

export type SheetsResult = { url: string; title: string; shared: boolean }

/**
 * Create a new Google Sheet from the matrix via /api/export-sheet. The server
 * holds the OAuth refresh token; if `shareWith` is a valid email the new sheet
 * is shared with that admin so the returned link opens without a hello@ login.
 */
export async function exportToGoogleSheets(
  title: string,
  headers: string[],
  data: (string | number)[][],
  shareWith?: string | null,
): Promise<SheetsResult> {
  const res = await fetch('/api/export-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, headers, rows: data, shareWith: shareWith || null }),
  })
  const json = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    const msg = typeof json?.error === 'string' ? json.error : `Export failed (${res.status})`
    throw new Error(msg)
  }
  return {
    url: String(json.url ?? ''),
    title: typeof json.title === 'string' ? json.title : title,
    shared: json.shared === true,
  }
}
