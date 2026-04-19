'use client'

import { useState } from 'react'
import type { FormFieldConfig, ConditionalRule } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Value types for each field type
// ---------------------------------------------------------------------------

export type FieldValue =
  | string                                       // text, textarea, dropdown, radio, number, email, phone, date, url, yes_no
  | string[]                                     // checkbox_list
  | Record<string, string>                       // ranked_dropdown, matrix (rowId -> colValue), scale
  | { primary: string; secondary: string }[]     // paired_dropdown
  | Record<string, unknown>[]                    // repeatable_group

type Props = {
  field: FormFieldConfig
  value: FieldValue | undefined
  onChange: (fieldId: string, value: FieldValue) => void
  allValues?: Record<string, FieldValue>  // for conditional visibility
}

const inputClass = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition bg-white text-sm'

// ---------------------------------------------------------------------------
// Conditional visibility evaluator
// ---------------------------------------------------------------------------

export function evaluateConditions(
  rules: ConditionalRule[] | undefined,
  allValues: Record<string, FieldValue> | undefined,
): boolean {
  if (!rules || rules.length === 0) return true
  if (!allValues) return true

  return rules.every(rule => {
    const val = allValues[rule.fieldId]
    const strVal = typeof val === 'string' ? val : Array.isArray(val) ? val.join(',') : JSON.stringify(val ?? '')

    switch (rule.operator) {
      case 'equals': return strVal === (rule.value ?? '')
      case 'not_equals': return strVal !== (rule.value ?? '')
      case 'contains': return strVal.includes(rule.value ?? '')
      case 'is_empty': return !strVal || strVal === '' || strVal === '[]' || strVal === '{}'
      case 'is_not_empty': return !!strVal && strVal !== '' && strVal !== '[]' && strVal !== '{}'
      default: return true
    }
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DynamicFormField({ field, value, onChange, allValues }: Props) {
  const set = (v: FieldValue) => onChange(field.id, v)

  // Check conditional visibility
  if (!evaluateConditions(field.config?.showIf, allValues)) {
    return null
  }

  switch (field.type) {
    // ----- Section Heading -----
    case 'section_heading':
      return (
        <div className="mb-4 pt-4">
          <h3 className="text-base font-semibold text-gray-900 mb-1">{field.label}</h3>
          {field.description && (
            <p className="text-sm text-gray-500">{field.description}</p>
          )}
        </div>
      )

    // ----- Text -----
    case 'text':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="text" value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            placeholder={field.config?.placeholder ?? ''} className={inputClass} />
        </div>
      )

    // ----- Textarea -----
    case 'textarea':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <textarea value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            rows={3} placeholder={field.config?.placeholder ?? ''} className={`${inputClass} resize-none`} />
        </div>
      )

    // ----- Number -----
    case 'number':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="number" inputMode="numeric" value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            min={field.config?.min} max={field.config?.max} placeholder={field.config?.placeholder ?? ''} className={inputClass} />
        </div>
      )

    // ----- Email -----
    case 'email':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="email" inputMode="email" value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            placeholder={field.config?.placeholder ?? 'name@example.com'} className={inputClass} />
        </div>
      )

    // ----- Phone -----
    case 'phone':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="tel" inputMode="tel" value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            placeholder={field.config?.placeholder ?? '+44 7xxx xxxxxx'} className={inputClass} />
        </div>
      )

    // ----- Date -----
    case 'date':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="date" value={(value as string) ?? ''} onChange={e => set(e.target.value)} className={inputClass} />
        </div>
      )

    // ----- URL -----
    case 'url':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input type="url" inputMode="url" value={(value as string) ?? ''} onChange={e => set(e.target.value)}
            placeholder={field.config?.placeholder ?? 'https://'} className={inputClass} />
        </div>
      )

    // ----- Yes / No -----
    case 'yes_no':
      return (
        <div className="mb-4">
          <FieldLabel field={field} asLegend />
          <div className="flex gap-3">
            {[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }].map(opt => (
              <button key={opt.v} type="button"
                onClick={() => set(opt.v)}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition ${
                  (value as string) === opt.v
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>
      )

    // ----- Scale -----
    case 'scale':
      return <ScaleField field={field} value={value as string | undefined} onChange={set} />

    // ----- Dropdown -----
    case 'dropdown':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <select value={(value as string) ?? ''} onChange={e => set(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {(field.options ?? []).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )

    // ----- Radio -----
    case 'radio':
      return (
        <div className="mb-4">
          <FieldLabel field={field} asLegend />
          {(field.options ?? []).map(opt => (
            <label key={opt.value} className="flex items-center gap-3 py-1.5 cursor-pointer">
              <input type="radio" name={`field_${field.id}`} value={opt.value}
                checked={(value as string) === opt.value} onChange={e => set(e.target.value)}
                className="accent-purple-600" />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      )

    // ----- Checkbox list -----
    case 'checkbox_list':
      return <CheckboxListField field={field} value={value as string[] | undefined} onChange={set} />

    // ----- Ranked dropdown -----
    case 'ranked_dropdown':
      return <RankedDropdownField field={field} value={value as Record<string, string> | undefined} onChange={set} />

    // ----- Paired dropdown -----
    case 'paired_dropdown':
      return <PairedDropdownField field={field} value={value as { primary: string; secondary: string }[] | undefined} onChange={set} />

    // ----- Matrix -----
    case 'matrix':
      return <MatrixField field={field} value={value as Record<string, string> | undefined} onChange={set} />

    // ----- Repeatable group -----
    case 'repeatable_group':
      return <RepeatableGroupField field={field} value={value as Record<string, unknown>[] | undefined} onChange={set} />

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Label helper
// ---------------------------------------------------------------------------

function FieldLabel({ field, asLegend }: { field: FormFieldConfig; asLegend?: boolean }) {
  const Tag = asLegend ? 'legend' : 'label'
  return (
    <>
      <Tag className="block text-sm font-medium text-gray-700 mb-1">
        {field.label} {field.required && <span className="text-red-400">*</span>}
      </Tag>
      {field.description && (
        <p className="text-xs text-gray-400 mb-2">{field.description}</p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Scale (1–5, 1–10 etc.)
// ---------------------------------------------------------------------------

function ScaleField({ field, value, onChange }: {
  field: FormFieldConfig; value: string | undefined; onChange: (v: string) => void
}) {
  const min = field.config?.scaleMin ?? 1
  const max = field.config?.scaleMax ?? 5
  const minLabel = field.config?.scaleMinLabel
  const maxLabel = field.config?.scaleMaxLabel
  const points = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
        {minLabel && <span className="text-xs text-gray-400 mr-1 hidden sm:inline">{minLabel}</span>}
        {points.map(p => (
          <button key={p} type="button" onClick={() => onChange(String(p))}
            className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition ${
              value === String(p)
                ? 'border-purple-500 bg-purple-50 text-purple-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}>
            {p}
          </button>
        ))}
        {maxLabel && <span className="text-xs text-gray-400 ml-1 hidden sm:inline">{maxLabel}</span>}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between text-xs text-gray-400 mt-1 sm:hidden">
          <span>{minLabel}</span><span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checkbox list
// ---------------------------------------------------------------------------

function CheckboxListField({ field, value, onChange }: {
  field: FormFieldConfig; value: string[] | undefined; onChange: (v: string[]) => void
}) {
  const selected = value ?? []
  const max = field.config?.maxSelections

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else if (!max || selected.length < max) onChange([...selected, val])
  }

  return (
    <fieldset className="mb-4">
      <FieldLabel field={field} asLegend />
      {max && <p className="text-xs text-gray-400 mb-2">Select up to {max}.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {(field.options ?? []).map(opt => (
          <label key={opt.value} className="flex items-start gap-3 py-1.5 cursor-pointer">
            <input type="checkbox" checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              disabled={!selected.includes(opt.value) && !!max && selected.length >= max}
              className="mt-0.5 accent-purple-600" />
            <span className="text-sm text-gray-700">{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Ranked dropdown (1st, 2nd, 3rd choice)
// ---------------------------------------------------------------------------

function RankedDropdownField({ field, value, onChange }: {
  field: FormFieldConfig; value: Record<string, string> | undefined; onChange: (v: Record<string, string>) => void
}) {
  const ranks = field.config?.ranks ?? 3
  const rankKeys = Array.from({ length: ranks }, (_, i) =>
    i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : `choice_${i + 1}`
  )
  const rankLabels = ['1st choice', '2nd choice', '3rd choice', '4th choice', '5th choice',
    '6th choice', '7th choice', '8th choice', '9th choice', '10th choice']
  const current = value ?? {}
  const options = field.options ?? []

  const getAvailable = (rank: string) => {
    const otherSelected = Object.entries(current).filter(([k, v]) => k !== rank && v).map(([, v]) => v)
    return options.filter(opt => !otherSelected.includes(opt.value))
  }

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      {rankKeys.map((rank, i) => (
        <div key={rank} className="mb-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {rankLabels[i] ?? `Choice ${i + 1}`} {field.required && <span className="text-red-400">*</span>}
          </label>
          <select value={current[rank] ?? ''} onChange={e => onChange({ ...current, [rank]: e.target.value })} className={inputClass}>
            <option value="">Select…</option>
            {getAvailable(rank).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Paired dropdown (e.g. Subject ↔ Grade)
// ---------------------------------------------------------------------------

function PairedDropdownField({ field, value, onChange }: {
  field: FormFieldConfig; value: { primary: string; secondary: string }[] | undefined
  onChange: (v: { primary: string; secondary: string }[]) => void
}) {
  const rows = value ?? [{ primary: '', secondary: '' }]
  const primaryOpts = field.config?.primaryOptions ?? field.options ?? []
  const secondaryOpts = field.config?.secondaryOptions ?? []
  const primaryLabel = field.config?.primaryLabel ?? 'Select…'
  const secondaryLabel = field.config?.secondaryLabel ?? 'Select…'

  const updateRow = (idx: number, side: 'primary' | 'secondary', val: string) => {
    onChange(rows.map((r, i) => i === idx ? { ...r, [side]: val } : r))
  }
  const addRow = () => onChange([...rows, { primary: '', secondary: '' }])
  const removeRow = (idx: number) => { if (rows.length > 1) onChange(rows.filter((_, i) => i !== idx)) }

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select value={row.primary} onChange={e => updateRow(idx, 'primary', e.target.value)} className={`flex-1 ${inputClass}`}>
              <option value="">{primaryLabel}</option>
              {primaryOpts.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={row.secondary} onChange={e => updateRow(idx, 'secondary', e.target.value)} className={`flex-1 ${inputClass}`}>
              <option value="">{secondaryLabel}</option>
              {secondaryOpts.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            {rows.length > 1 && (
              <button type="button" onClick={() => removeRow(idx)} className="text-xs text-red-400 hover:text-red-600 font-medium shrink-0">✕</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow}
        className="mt-2 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-sm text-purple-600 font-medium hover:border-purple-300 hover:bg-purple-50 transition">
        + Add row
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Matrix / Grid
// ---------------------------------------------------------------------------

function MatrixField({ field, value, onChange }: {
  field: FormFieldConfig; value: Record<string, string> | undefined; onChange: (v: Record<string, string>) => void
}) {
  const rows = field.config?.matrixRows ?? []
  const cols = field.config?.matrixColumns ?? []
  const isMulti = field.config?.matrixType === 'multi'
  const current = value ?? {}

  const handleSingle = (rowVal: string, colVal: string) => {
    onChange({ ...current, [rowVal]: colVal })
  }

  const handleMulti = (rowVal: string, colVal: string) => {
    const existing = (current[rowVal] ?? '').split(',').filter(Boolean)
    const next = existing.includes(colVal)
      ? existing.filter(v => v !== colVal)
      : [...existing, colVal]
    onChange({ ...current, [rowVal]: next.join(',') })
  }

  if (rows.length === 0 || cols.length === 0) return null

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 min-w-[120px]"></th>
              {cols.map(col => (
                <th key={col.value} className="text-center py-2 px-2 text-xs font-medium text-gray-500 min-w-[60px]">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.value} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 text-sm text-gray-700">{row.label}</td>
                {cols.map(col => (
                  <td key={col.value} className="text-center py-2.5 px-2">
                    {isMulti ? (
                      <input type="checkbox"
                        checked={(current[row.value] ?? '').split(',').includes(col.value)}
                        onChange={() => handleMulti(row.value, col.value)}
                        className="accent-purple-600" />
                    ) : (
                      <input type="radio" name={`matrix_${field.id}_${row.value}`}
                        checked={current[row.value] === col.value}
                        onChange={() => handleSingle(row.value, col.value)}
                        className="accent-purple-600" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Repeatable group
// ---------------------------------------------------------------------------

function RepeatableGroupField({ field, value, onChange }: {
  field: FormFieldConfig; value: Record<string, unknown>[] | undefined
  onChange: (v: Record<string, unknown>[]) => void
}) {
  const subFields = field.config?.subFields ?? []
  const minEntries = field.config?.minEntries ?? 1
  const maxEntries = field.config?.maxEntries ?? 10
  const addLabel = field.config?.addButtonLabel ?? '+ Add another'
  const entries = value ?? Array.from({ length: minEntries }, () => ({}))

  const updateEntry = (entryIdx: number, subFieldId: string, val: unknown) => {
    const updated = entries.map((entry, i) =>
      i === entryIdx ? { ...entry, [subFieldId]: val } : entry
    )
    onChange(updated)
  }

  const addEntry = () => {
    if (entries.length < maxEntries) onChange([...entries, {}])
  }

  const removeEntry = (idx: number) => {
    if (entries.length > minEntries) onChange(entries.filter((_, i) => i !== idx))
  }

  if (subFields.length === 0) return null

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      <div className="space-y-3">
        {entries.map((entry, idx) => (
          <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">Entry {idx + 1}</span>
              {entries.length > minEntries && (
                <button type="button" onClick={() => removeEntry(idx)}
                  className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
              )}
            </div>
            {subFields.map(sf => (
              <div key={sf.id} className="mb-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {sf.label} {sf.required && <span className="text-red-400">*</span>}
                </label>
                {sf.type === 'text' || sf.type === 'email' || sf.type === 'phone' || sf.type === 'url' ? (
                  <input type={sf.type === 'email' ? 'email' : sf.type === 'phone' ? 'tel' : sf.type === 'url' ? 'url' : 'text'}
                    value={(entry[sf.id] as string) ?? ''}
                    onChange={e => updateEntry(idx, sf.id, e.target.value)}
                    placeholder={sf.config?.placeholder ?? ''}
                    className={inputClass} />
                ) : sf.type === 'textarea' ? (
                  <textarea value={(entry[sf.id] as string) ?? ''}
                    onChange={e => updateEntry(idx, sf.id, e.target.value)}
                    rows={2} placeholder={sf.config?.placeholder ?? ''} className={`${inputClass} resize-none`} />
                ) : sf.type === 'dropdown' ? (
                  <select value={(entry[sf.id] as string) ?? ''}
                    onChange={e => updateEntry(idx, sf.id, e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {(sf.options ?? []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : sf.type === 'number' ? (
                  <input type="number" value={(entry[sf.id] as string) ?? ''}
                    onChange={e => updateEntry(idx, sf.id, e.target.value)}
                    min={sf.config?.min} max={sf.config?.max}
                    placeholder={sf.config?.placeholder ?? ''} className={inputClass} />
                ) : sf.type === 'date' ? (
                  <input type="date" value={(entry[sf.id] as string) ?? ''}
                    onChange={e => updateEntry(idx, sf.id, e.target.value)} className={inputClass} />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {entries.length < maxEntries && (
        <button type="button" onClick={addEntry}
          className="mt-2 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-sm text-purple-600 font-medium hover:border-purple-300 hover:bg-purple-50 transition">
          {addLabel}
        </button>
      )}
    </div>
  )
}
