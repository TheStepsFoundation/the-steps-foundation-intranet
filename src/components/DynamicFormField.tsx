'use client'

import { useState } from 'react'
import type { FormFieldConfig } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Value types for each field type
// ---------------------------------------------------------------------------

export type FieldValue =
  | string                           // text, textarea, dropdown, radio, number
  | string[]                         // checkbox_list
  | Record<string, string>           // ranked_dropdown: { first: 'val', second: 'val', third: 'val' }
  | { primary: string; secondary: string }[]  // paired_dropdown

type Props = {
  field: FormFieldConfig
  value: FieldValue | undefined
  onChange: (fieldId: string, value: FieldValue) => void
}

const inputClass = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition bg-white text-sm'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DynamicFormField({ field, value, onChange }: Props) {
  const set = (v: FieldValue) => onChange(field.id, v)

  switch (field.type) {
    // ----- Text -----
    case 'text':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={e => set(e.target.value)}
            placeholder={field.config?.placeholder ?? ''}
            className={inputClass}
          />
        </div>
      )

    // ----- Textarea -----
    case 'textarea':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <textarea
            value={(value as string) ?? ''}
            onChange={e => set(e.target.value)}
            rows={3}
            placeholder={field.config?.placeholder ?? ''}
            className={`${inputClass} resize-none`}
          />
        </div>
      )

    // ----- Number -----
    case 'number':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <input
            type="number"
            inputMode="numeric"
            value={(value as string) ?? ''}
            onChange={e => set(e.target.value)}
            min={field.config?.min}
            max={field.config?.max}
            placeholder={field.config?.placeholder ?? ''}
            className={inputClass}
          />
        </div>
      )

    // ----- Dropdown -----
    case 'dropdown':
      return (
        <div className="mb-4">
          <FieldLabel field={field} />
          <select
            value={(value as string) ?? ''}
            onChange={e => set(e.target.value)}
            className={inputClass}
          >
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
              <input
                type="radio"
                name={`field_${field.id}`}
                value={opt.value}
                checked={(value as string) === opt.value}
                onChange={e => set(e.target.value)}
                className="accent-purple-600"
              />
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
// Checkbox list
// ---------------------------------------------------------------------------

function CheckboxListField({ field, value, onChange }: {
  field: FormFieldConfig
  value: string[] | undefined
  onChange: (v: string[]) => void
}) {
  const selected = value ?? []
  const max = field.config?.maxSelections

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val))
    } else if (!max || selected.length < max) {
      onChange([...selected, val])
    }
  }

  return (
    <fieldset className="mb-4">
      <FieldLabel field={field} asLegend />
      {max && (
        <p className="text-xs text-gray-400 mb-2">Select up to {max}.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {(field.options ?? []).map(opt => (
          <label key={opt.value} className="flex items-start gap-3 py-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              disabled={!selected.includes(opt.value) && !!max && selected.length >= max}
              className="mt-0.5 accent-purple-600"
            />
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
  field: FormFieldConfig
  value: Record<string, string> | undefined
  onChange: (v: Record<string, string>) => void
}) {
  const ranks = field.config?.ranks ?? 3
  const rankKeys = Array.from({ length: ranks }, (_, i) =>
    i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : `choice_${i + 1}`
  )
  const rankLabels = ['1st choice', '2nd choice', '3rd choice', '4th choice', '5th choice']
  const current = value ?? {}
  const options = field.options ?? []

  const getAvailable = (rank: string) => {
    const otherSelected = Object.entries(current)
      .filter(([k, v]) => k !== rank && v)
      .map(([, v]) => v)
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
          <select
            value={current[rank] ?? ''}
            onChange={e => onChange({ ...current, [rank]: e.target.value })}
            className={inputClass}
          >
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
// Paired dropdown (e.g. Subject ↔ Grade, Level ↔ Score)
// ---------------------------------------------------------------------------

function PairedDropdownField({ field, value, onChange }: {
  field: FormFieldConfig
  value: { primary: string; secondary: string }[] | undefined
  onChange: (v: { primary: string; secondary: string }[]) => void
}) {
  const rows = value ?? [{ primary: '', secondary: '' }]
  const primaryOpts = field.config?.primaryOptions ?? field.options ?? []
  const secondaryOpts = field.config?.secondaryOptions ?? []
  const primaryLabel = field.config?.primaryLabel ?? 'Select…'
  const secondaryLabel = field.config?.secondaryLabel ?? 'Select…'

  const updateRow = (idx: number, side: 'primary' | 'secondary', val: string) => {
    const updated = rows.map((r, i) => i === idx ? { ...r, [side]: val } : r)
    onChange(updated)
  }

  const addRow = () => onChange([...rows, { primary: '', secondary: '' }])

  const removeRow = (idx: number) => {
    if (rows.length <= 1) return
    onChange(rows.filter((_, i) => i !== idx))
  }

  return (
    <div className="mb-4">
      <FieldLabel field={field} />
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              value={row.primary}
              onChange={e => updateRow(idx, 'primary', e.target.value)}
              className={`flex-1 ${inputClass}`}
            >
              <option value="">{primaryLabel}</option>
              {primaryOpts.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={row.secondary}
              onChange={e => updateRow(idx, 'secondary', e.target.value)}
              className={`flex-1 ${inputClass}`}
            >
              <option value="">{secondaryLabel}</option>
              {secondaryOpts.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="text-xs text-red-400 hover:text-red-600 font-medium shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-sm text-purple-600 font-medium hover:border-purple-300 hover:bg-purple-50 transition"
      >
        + Add row
      </button>
    </div>
  )
}
