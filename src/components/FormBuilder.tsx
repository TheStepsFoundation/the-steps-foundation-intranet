'use client'

import { useState } from 'react'
import type { FormFieldConfig } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// Field type menu
// ---------------------------------------------------------------------------

const FIELD_TYPES: { value: FormFieldConfig['type']; label: string; desc: string }[] = [
  { value: 'text', label: 'Short text', desc: 'Single line text input' },
  { value: 'textarea', label: 'Long text', desc: 'Multi-line text area' },
  { value: 'number', label: 'Number', desc: 'Numeric input' },
  { value: 'dropdown', label: 'Dropdown', desc: 'Single select from a list' },
  { value: 'radio', label: 'Radio buttons', desc: 'Single select, all options visible' },
  { value: 'checkbox_list', label: 'Checkbox list', desc: 'Multi-select from a list' },
  { value: 'ranked_dropdown', label: 'Ranked choice', desc: '1st, 2nd, 3rd choice from a list' },
  { value: 'paired_dropdown', label: 'Paired dropdowns', desc: 'Two linked dropdowns side by side (e.g. Subject ↔ Grade)' },
]

const NEEDS_OPTIONS: FormFieldConfig['type'][] = ['dropdown', 'radio', 'checkbox_list', 'ranked_dropdown']
const NEEDS_PAIRED: FormFieldConfig['type'][] = ['paired_dropdown']

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  fields: FormFieldConfig[]
  onChange: (fields: FormFieldConfig[]) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormBuilder({ fields, onChange }: Props) {
  const [addingType, setAddingType] = useState<FormFieldConfig['type'] | null>(null)

  const inputClass = 'w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

  // Helpers
  const updateField = (index: number, patch: Partial<FormFieldConfig>) => {
    onChange(fields.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index))
  }

  const moveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return
    const updated = [...fields]
    ;[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]
    onChange(updated)
  }

  const addField = (type: FormFieldConfig['type']) => {
    const id = `field_${Date.now()}`
    const newField: FormFieldConfig = {
      id,
      type,
      label: '',
      required: false,
      ...(NEEDS_OPTIONS.includes(type) ? { options: [{ value: '', label: '' }] } : {}),
      ...(type === 'ranked_dropdown' ? { config: { ranks: 3 }, options: [{ value: '', label: '' }] } : {}),
      ...(type === 'paired_dropdown' ? {
        config: {
          primaryLabel: 'Select…',
          secondaryLabel: 'Select…',
          primaryOptions: [{ value: '', label: '' }],
          secondaryOptions: [{ value: '', label: '' }],
        },
      } : {}),
      ...(type === 'checkbox_list' ? { config: { maxSelections: undefined } } : {}),
    }
    onChange([...fields, newField])
    setAddingType(null)
  }

  // Option list editor
  const OptionListEditor = ({ options, onOptionsChange }: {
    options: { value: string; label: string }[]
    onOptionsChange: (opts: { value: string; label: string }[]) => void
  }) => (
    <div className="ml-2 space-y-1.5">
      {options.map((opt, oi) => (
        <div key={oi} className="flex items-center gap-2">
          <input
            value={opt.label}
            onChange={e => {
              const updated = [...options]
              const label = e.target.value
              // Auto-generate value from label
              updated[oi] = { value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label }
              onOptionsChange(updated)
            }}
            placeholder={`Option ${oi + 1}`}
            className={`flex-1 ${inputClass}`}
          />
          {options.length > 1 && (
            <button onClick={() => onOptionsChange(options.filter((_, i) => i !== oi))}
              className="text-red-400 hover:text-red-600 text-sm font-bold px-1">×</button>
          )}
        </div>
      ))}
      <button onClick={() => onOptionsChange([...options, { value: '', label: '' }])}
        className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
        + Add option
      </button>
    </div>
  )

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        Custom Form Fields
      </h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        These fields appear on the student application form after the standard questions (details, contextual info, GCSE, qualifications).
      </p>

      {/* Existing fields */}
      {fields.length === 0 && (
        <p className="text-xs text-gray-400 italic mb-4">No custom fields yet. Add one below.</p>
      )}

      <div className="space-y-3 mb-4">
        {fields.map((field, idx) => {
          const typeMeta = FIELD_TYPES.find(t => t.value === field.type)

          return (
            <div key={field.id} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded">
                    {typeMeta?.label ?? field.type}
                  </span>
                  <span className="text-xs text-gray-400">ID: {field.id}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => moveField(idx, 'up')} disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1">↑</button>
                  <button onClick={() => moveField(idx, 'down')} disabled={idx === fields.length - 1}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1">↓</button>
                  <button onClick={() => removeField(idx)}
                    className="text-red-400 hover:text-red-600 text-sm font-bold px-1 ml-1">×</button>
                </div>
              </div>

              {/* Label */}
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-0.5">Label</label>
                <input value={field.label} onChange={e => updateField(idx, { label: e.target.value })}
                  placeholder="e.g. Which areas interest you most?"
                  className={inputClass} />
              </div>

              {/* Description */}
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-0.5">Description (optional)</label>
                <input value={field.description ?? ''} onChange={e => updateField(idx, { description: e.target.value || undefined })}
                  placeholder="Helper text shown below the label"
                  className={inputClass} />
              </div>

              {/* Required toggle */}
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={field.required}
                  onChange={e => updateField(idx, { required: e.target.checked })}
                  className="accent-indigo-600" />
                <span className="text-xs text-gray-600 dark:text-gray-400">Required</span>
              </label>

              {/* Options editor (for dropdown, radio, checkbox_list, ranked_dropdown) */}
              {NEEDS_OPTIONS.includes(field.type) && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-1">Options</label>
                  <OptionListEditor
                    options={field.options ?? []}
                    onOptionsChange={opts => updateField(idx, { options: opts })}
                  />
                </div>
              )}

              {/* Ranked dropdown config */}
              {field.type === 'ranked_dropdown' && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Number of ranked choices</label>
                  <input type="number" min={1} max={10}
                    value={field.config?.ranks ?? 3}
                    onChange={e => updateField(idx, { config: { ...field.config, ranks: Number(e.target.value) || 3 } })}
                    className={`w-20 ${inputClass}`} />
                </div>
              )}

              {/* Checkbox list config */}
              {field.type === 'checkbox_list' && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Max selections (leave empty for unlimited)</label>
                  <input type="number" min={1}
                    value={field.config?.maxSelections ?? ''}
                    onChange={e => updateField(idx, { config: { ...field.config, maxSelections: Number(e.target.value) || undefined } })}
                    className={`w-20 ${inputClass}`} />
                </div>
              )}

              {/* Paired dropdown config */}
              {NEEDS_PAIRED.includes(field.type) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Left dropdown label</label>
                      <input value={field.config?.primaryLabel ?? ''}
                        onChange={e => updateField(idx, { config: { ...field.config, primaryLabel: e.target.value } })}
                        placeholder="e.g. Subject" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Right dropdown label</label>
                      <input value={field.config?.secondaryLabel ?? ''}
                        onChange={e => updateField(idx, { config: { ...field.config, secondaryLabel: e.target.value } })}
                        placeholder="e.g. Grade" className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Left options</label>
                      <OptionListEditor
                        options={field.config?.primaryOptions ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, primaryOptions: opts } })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Right options</label>
                      <OptionListEditor
                        options={field.config?.secondaryOptions ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, secondaryOptions: opts } })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Placeholder for text/textarea/number */}
              {['text', 'textarea', 'number'].includes(field.type) && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Placeholder</label>
                  <input value={field.config?.placeholder ?? ''}
                    onChange={e => updateField(idx, { config: { ...field.config, placeholder: e.target.value } })}
                    className={inputClass} />
                </div>
              )}

              {/* Number min/max */}
              {field.type === 'number' && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" value={field.config?.min ?? ''}
                      onChange={e => updateField(idx, { config: { ...field.config, min: Number(e.target.value) || undefined } })}
                      className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" value={field.config?.max ?? ''}
                      onChange={e => updateField(idx, { config: { ...field.config, max: Number(e.target.value) || undefined } })}
                      className={inputClass} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add field button / type picker */}
      {addingType === null ? (
        <button onClick={() => setAddingType('text')}
          className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition">
          + Add custom field
        </button>
      ) : (
        <div className="p-3 border border-indigo-200 dark:border-indigo-800 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Choose a field type:</p>
          <div className="grid grid-cols-2 gap-2">
            {FIELD_TYPES.map(ft => (
              <button key={ft.value} onClick={() => addField(ft.value)}
                className="text-left p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition">
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{ft.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{ft.desc}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setAddingType(null)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 font-medium">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
