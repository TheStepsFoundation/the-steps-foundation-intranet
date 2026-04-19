"use client"

import { useState, useEffect } from "react"
import type { FormFieldConfig, FormFieldType, FormPage, ConditionalRule } from "@/lib/events-api"

// ---------------------------------------------------------------------------
// Field type categories with icons
// ---------------------------------------------------------------------------

type FieldTypeMeta = {
  value: FormFieldType
  label: string
  desc: string
  icon: string // mini visual preview
  category: "basic" | "choice" | "advanced" | "layout"
}

const FIELD_TYPES: FieldTypeMeta[] = [
  // Basic
  { value: "text",     label: "Short text",    desc: "Single line input",            icon: "Aa",  category: "basic" },
  { value: "textarea", label: "Long text",     desc: "Multi-line paragraph",         icon: "≡",   category: "basic" },
  { value: "number",   label: "Number",        desc: "Numeric value",                icon: "#",   category: "basic" },
  { value: "email",    label: "Email",         desc: "Email with @ validation",      icon: "@",   category: "basic" },
  { value: "phone",    label: "Phone",         desc: "Phone number input",           icon: "📞",  category: "basic" },
  { value: "date",     label: "Date",          desc: "Calendar date picker",         icon: "📅",  category: "basic" },
  { value: "url",      label: "URL / Link",    desc: "Website or profile link",      icon: "🔗",  category: "basic" },
  // Choice
  { value: "dropdown",        label: "Dropdown",        desc: "Pick one from a list",              icon: "▼",    category: "choice" },
  { value: "radio",           label: "Single select",   desc: "Pick one, all options visible",     icon: "◎",    category: "choice" },
  { value: "checkbox_list",   label: "Checkbox list",   desc: "Pick multiple from a list",         icon: "☑️",    category: "choice" },
  { value: "yes_no",          label: "Yes / No",        desc: "Binary toggle buttons",             icon: "Y/N",  category: "choice" },
  { value: "ranked_dropdown", label: "Ranked choice",   desc: "1st, 2nd, 3rd preference",          icon: "1·2·3",   category: "choice" },
  // Advanced
  { value: "scale",           label: "Scale",           desc: "Rate on a 1–5 or 1–10 scale",      icon: "①—⑤",  category: "advanced" },
  { value: "paired_dropdown", label: "Paired dropdowns", desc: "Two linked dropdowns (e.g. Subject ↔ Grade)", icon: "▾▾",    category: "advanced" },
  { value: "matrix",          label: "Matrix / Grid",   desc: "Rows × columns rating grid",       icon: "⊞",    category: "advanced" },
  { value: "repeatable_group",label: "Repeatable group", desc: "Set of fields students can repeat", icon: "↻",   category: "advanced" },
  // Layout
  { value: "section_heading", label: "Section heading", desc: "Visual break with title + description", icon: "H",  category: "layout" },
]

const CATEGORY_LABELS: Record<string, string> = {
  basic: "Basic",
  choice: "Choice",
  advanced: "Advanced",
  layout: "Layout",
}

const NEEDS_OPTIONS: FormFieldType[] = ["dropdown", "radio", "checkbox_list", "ranked_dropdown"]
const NEEDS_PAIRED: FormFieldType[] = ["paired_dropdown"]

// ---------------------------------------------------------------------------
// Standard questions definition
// ---------------------------------------------------------------------------

type StandardQuestion = {
  id: string
  label: string
  type: string
  description?: string
}

const FIELD_TYPE_ICON: Record<string, string> = {
  ...Object.fromEntries(FIELD_TYPES.map(ft => [ft.value, ft.icon])),
  search: "🔍",  // school picker — standard only
}

const STANDARD_QUESTIONS: StandardQuestion[] = [
  { id: "std_name",          label: "First name / Last name",      type: "text" },
  { id: "std_email",         label: "Email address",               type: "email", description: "Verified via OTP — read-only" },
  { id: "std_school",        label: "Current school / sixth form", type: "search" },
  { id: "std_year_group",    label: "Year group",                  type: "dropdown" },
  { id: "std_school_type",   label: "School type",                 type: "radio" },
  { id: "std_first_gen",     label: "First generation to attend university?", type: "yes_no" },
  { id: "std_income",        label: "Household income under £40k?", type: "radio" },
  { id: "std_fsm",           label: "Free School Meals eligibility", type: "radio" },
  { id: "std_additional",    label: "Additional contextual information", type: "textarea" },
  { id: "std_gcse",          label: "GCSE results (digits)",        type: "number" },
  { id: "std_qualifications",label: "Subjects & predicted grades",  type: "paired_dropdown" },
  { id: "std_attribution",   label: "How did you hear about this?", type: "radio" },
  { id: "std_anything_else", label: "Anything else you’d like us to know?", type: "textarea" },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  fields: FormFieldConfig[]
  pages?: FormPage[]
  onChange: (fields: FormFieldConfig[], pages?: FormPage[]) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormBuilder({ fields, pages, onChange }: Props) {
  const [showTypePicker, setShowTypePicker] = useState(false)
  const [activePage, setActivePage] = useState(0)
  const [showStandard, setShowStandard] = useState(false)
  const [editingRouting, setEditingRouting] = useState<number | null>(null)

  const inputClass = "w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"

  // ---------------------------------------------------------------------------
  // Multi-page helpers — always ensure at least page 1 exists
  // ---------------------------------------------------------------------------

  // Auto-initialize page 1 on mount if no pages exist yet
  const hasPages = !!pages && pages.length > 0
  useEffect(() => {
    if (!hasPages) {
      const page1: FormPage = {
        id: `page_${Date.now()}`,
        title: "Page 1",
        fields: fields,
      }
      onChange([], [page1])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPages])

  const effectivePages = hasPages ? pages! : [{ id: "page_init", title: "Page 1", fields }]

  // Get fields for active context
  const activeFields = effectivePages[activePage]?.fields ?? []
  const activePageObj = effectivePages[activePage] ?? null

  const setActiveFields = (newFields: FormFieldConfig[]) => {
    const updated = effectivePages.map((p, i) => i === activePage ? { ...p, fields: newFields } : p)
    onChange([], updated)
  }

  const addPage = () => {
    const newPage: FormPage = {
      id: `page_${Date.now()}`,
      title: `Page ${effectivePages.length + 1}`,
      fields: [],
    }
    const updated = [...effectivePages, newPage]
    onChange([], updated)
    setActivePage(updated.length - 1)
  }

  const removePage = (idx: number) => {
    if (effectivePages.length <= 1) return
    const updated = effectivePages.filter((_, i) => i !== idx)
    onChange([], updated)
    setActivePage(Math.min(activePage, updated.length - 1))
  }

  const updatePageMeta = (idx: number, patch: Partial<FormPage>) => {
    const updated = effectivePages.map((p, i) => i === idx ? { ...p, ...patch } : p)
    onChange([], updated)
  }

  // ---------------------------------------------------------------------------
  // Field CRUD
  // ---------------------------------------------------------------------------

  const updateField = (index: number, patch: Partial<FormFieldConfig>) => {
    setActiveFields(activeFields.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  const removeField = (index: number) => {
    setActiveFields(activeFields.filter((_, i) => i !== index))
  }

  const moveField = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= activeFields.length) return
    const updated = [...activeFields]
    ;[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]
    setActiveFields(updated)
  }

  const addField = (type: FormFieldType) => {
    const id = `field_${Date.now()}`
    const newField: FormFieldConfig = {
      id,
      type,
      label: "",
      required: false,
      ...(NEEDS_OPTIONS.includes(type) ? { options: [{ value: "", label: "" }] } : {}),
      ...(type === "ranked_dropdown" ? { config: { ranks: 3 }, options: [{ value: "", label: "" }] } : {}),
      ...(type === "paired_dropdown" ? {
        config: {
          primaryLabel: "Select…",
          secondaryLabel: "Select…",
          primaryOptions: [{ value: "", label: "" }],
          secondaryOptions: [{ value: "", label: "" }],
        },
      } : {}),
      ...(type === "checkbox_list" ? { config: { maxSelections: undefined } } : {}),
      ...(type === "scale" ? { config: { scaleMin: 1, scaleMax: 5 } } : {}),
      ...(type === "matrix" ? { config: { matrixRows: [{ value: "", label: "" }], matrixColumns: [{ value: "", label: "" }], matrixType: "single" as const } } : {}),
      ...(type === "repeatable_group" ? { config: { subFields: [{ id: `sf_${Date.now()}`, type: "text" as const, label: "", required: false }], minEntries: 1, maxEntries: 5 } } : {}),
    }
    setActiveFields([...activeFields, newField])
    setShowTypePicker(false)
  }

  // ---------------------------------------------------------------------------
  // All fields across all pages (for conditional routing references)
  // ---------------------------------------------------------------------------

  const allFields: FormFieldConfig[] = effectivePages.flatMap(p => p.fields)

  // ---------------------------------------------------------------------------
  // Option list editor (reusable)
  // ---------------------------------------------------------------------------

  const OptionListEditor = ({ options, onOptionsChange }: {
    options: { value: string; label: string }[]
    onOptionsChange: (opts: { value: string; label: string }[]) => void
  }) => (
    <div className="ml-2 space-y-1.5">
      {options.map((opt, oi) => (
        <div key={oi} className="flex items-center gap-2">
          <input value={opt.label}
            onChange={e => {
              const updated = [...options]
              const label = e.target.value
              updated[oi] = { value: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label }
              onOptionsChange(updated)
            }}
            placeholder={`Option ${oi + 1}`} className={`flex-1 ${inputClass}`} />
          {options.length > 1 && (
            <button onClick={() => onOptionsChange(options.filter((_, i) => i !== oi))}
              className="text-red-400 hover:text-red-600 text-sm font-bold px-1">×</button>
          )}
        </div>
      ))}
      <button onClick={() => onOptionsChange([...options, { value: "", label: "" }])}
        className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">+ Add option</button>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Conditional visibility editor
  // ---------------------------------------------------------------------------

  const ConditionEditor = ({ conditions, onConditionsChange }: {
    conditions: ConditionalRule[]
    onConditionsChange: (c: ConditionalRule[]) => void
  }) => (
    <div className="space-y-2">
      {conditions.map((cond, ci) => (
        <div key={ci} className="flex items-center gap-2 flex-wrap">
          <select value={cond.fieldId}
            onChange={e => { const u = [...conditions]; u[ci] = { ...u[ci], fieldId: e.target.value }; onConditionsChange(u) }}
            className={`flex-1 min-w-[120px] ${inputClass}`}>
            <option value="">Select field…</option>
            {allFields.filter(f => f.type !== "section_heading").map(f => (
              <option key={f.id} value={f.id}>{f.label || f.id}</option>
            ))}
          </select>
          <select value={cond.operator}
            onChange={e => { const u = [...conditions]; u[ci] = { ...u[ci], operator: e.target.value as ConditionalRule["operator"] }; onConditionsChange(u) }}
            className={`w-32 ${inputClass}`}>
            <option value="equals">equals</option>
            <option value="not_equals">not equals</option>
            <option value="contains">contains</option>
            <option value="is_empty">is empty</option>
            <option value="is_not_empty">is not empty</option>
          </select>
          {!["is_empty", "is_not_empty"].includes(cond.operator) && (
            <input value={cond.value ?? ""}
              onChange={e => { const u = [...conditions]; u[ci] = { ...u[ci], value: e.target.value }; onConditionsChange(u) }}
              placeholder="value" className={`flex-1 min-w-[80px] ${inputClass}`} />
          )}
          <button onClick={() => onConditionsChange(conditions.filter((_, i) => i !== ci))}
            className="text-red-400 hover:text-red-600 text-sm font-bold px-1">×</button>
        </div>
      ))}
      <button onClick={() => onConditionsChange([...conditions, { fieldId: "", operator: "equals", value: "" }])}
        className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">+ Add condition</button>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Application Form Builder
        </h4>
        <button onClick={addPage}
          className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
          + Add page
        </button>
      </div>

      {/* ---- Standard questions toggle ---- */}
      <button onClick={() => setShowStandard(!showStandard)}
        className="w-full mb-3 px-3 py-2 text-left text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition flex items-center justify-between">
        <span>⚠️ Standard questions (auto-included on every form)</span>
        <span className="text-[10px]">{showStandard ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {showStandard && (
        <div className="mb-4 space-y-1.5 p-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-lg">
          <p className="text-[10px] text-amber-600 dark:text-amber-500 mb-2 font-medium">
            These fields appear automatically. Editing them here changes labels for this event only. Proceed with caution.
          </p>
          {STANDARD_QUESTIONS.map(sq => (
            <div key={sq.id} className="flex items-center gap-2 py-1">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-[10px] shrink-0 w-8 text-center" title={sq.type}>
                {FIELD_TYPE_ICON[sq.type] ?? sq.type}
              </span>
              <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{sq.label}</span>
              {sq.description && <span className="text-[10px] text-gray-400 italic">{sq.description}</span>}
            </div>
          ))}
        </div>
      )}

      {/* ---- Page tabs ---- */}
      <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
          {effectivePages.map((page, pi) => (
            <button key={page.id}
              onClick={() => setActivePage(pi)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition flex items-center gap-1.5 ${
                pi === activePage
                  ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent"
              }`}>
              {page.title}
              {effectivePages.length > 1 && (
                <span onClick={e => { e.stopPropagation(); removePage(pi) }}
                  className="text-red-400 hover:text-red-600 font-bold ml-0.5 text-[10px]">×</span>
              )}
            </button>
          ))}
        </div>

      {/* ---- Page title/description ---- */}
      {activePageObj && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Page title</label>
              <input value={activePageObj.title}
                onChange={e => updatePageMeta(activePage, { title: e.target.value })}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Page description (optional)</label>
              <input value={activePageObj.description ?? ""}
                onChange={e => updatePageMeta(activePage, { description: e.target.value || undefined })}
                className={inputClass} />
            </div>
          </div>

          {/* Conditional routing */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
            <button onClick={() => setEditingRouting(editingRouting === activePage ? null : activePage)}
              className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center gap-1">
              🔀 Page routing rules
              <span className="text-gray-400">{editingRouting === activePage ? "▲" : "▼"}</span>
            </button>
            {editingRouting === activePage && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-gray-400">If conditions match, skip to a specific page instead of the next one.</p>
                {(activePageObj.routing?.rules ?? []).map((rule, ri) => (
                  <div key={ri} className="p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-gray-500">Rule {ri + 1}</span>
                      <button onClick={() => {
                        const rules = [...(activePageObj.routing?.rules ?? [])]
                        rules.splice(ri, 1)
                        updatePageMeta(activePage, { routing: { ...activePageObj.routing, rules } })
                      }} className="text-red-400 hover:text-red-600 text-[10px] font-bold">×</button>
                    </div>
                    <ConditionEditor
                      conditions={rule.conditions}
                      onConditionsChange={c => {
                        const rules = [...(activePageObj.routing?.rules ?? [])]
                        rules[ri] = { ...rules[ri], conditions: c }
                        updatePageMeta(activePage, { routing: { ...activePageObj.routing, rules } })
                      }}
                    />
                    <div>
                      <label className="text-[10px] text-gray-500">Then go to:</label>
                      <select value={rule.goToPageId}
                        onChange={e => {
                          const rules = [...(activePageObj.routing?.rules ?? [])]
                          rules[ri] = { ...rules[ri], goToPageId: e.target.value }
                          updatePageMeta(activePage, { routing: { ...activePageObj.routing, rules } })
                        }}
                        className={`mt-0.5 ${inputClass}`}>
                        <option value="">Select page…</option>
                        {effectivePages.filter((_, i) => i !== activePage).map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                        <option value="__submit">→ Skip to submit</option>
                      </select>
                    </div>
                  </div>
                ))}
                <button onClick={() => {
                  const rules = [...(activePageObj.routing?.rules ?? []), { conditions: [{ fieldId: "", operator: "equals" as const, value: "" }], goToPageId: "" }]
                  updatePageMeta(activePage, { routing: { ...activePageObj.routing, rules } })
                }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">+ Add routing rule</button>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {
          ? `Fields on "${activePageObj?.title ?? "this page"}" — students see these after the standard questions.`
          : "These fields appear on the application form after the standard questions."
        }
      </p>

      {/* Existing fields */}
      {activeFields.length === 0 && (
        <p className="text-xs text-gray-400 italic mb-4">No custom fields on this page yet. Add one below.</p>
      )}

      <div className="space-y-3 mb-4">
        {activeFields.map((field, idx) => {
          const typeMeta = FIELD_TYPES.find(t => t.value === field.type)

          return (
            <div key={field.id} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs w-8 h-6 flex items-center justify-center font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded">
                    {typeMeta?.icon ?? "?"}
                  </span>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {typeMeta?.label ?? field.type}
                  </span>
                  <span className="text-[10px] text-gray-400">{field.id}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => moveField(idx, "up")} disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1">↑</button>
                  <button onClick={() => moveField(idx, "down")} disabled={idx === activeFields.length - 1}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1">↓</button>
                  <button onClick={() => removeField(idx)}
                    className="text-red-400 hover:text-red-600 text-sm font-bold px-1 ml-1">×</button>
                </div>
              </div>

              {/* Label (section_heading uses it as the heading text) */}
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-0.5">
                  {field.type === "section_heading" ? "Heading text" : "Label"}
                </label>
                <input value={field.label} onChange={e => updateField(idx, { label: e.target.value })}
                  placeholder={field.type === "section_heading" ? "e.g. About your academics" : "e.g. Which areas interest you most?"}
                  className={inputClass} />
              </div>

              {/* Description */}
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-0.5">Description (optional)</label>
                <input value={field.description ?? ""} onChange={e => updateField(idx, { description: e.target.value || undefined })}
                  placeholder="Helper text shown below the label" className={inputClass} />
              </div>

              {/* Required toggle (not for section_heading) */}
              {field.type !== "section_heading" && (
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={field.required}
                    onChange={e => updateField(idx, { required: e.target.checked })}
                    className="accent-indigo-600" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">Required</span>
                </label>
              )}

              {/* ----- Type-specific config ----- */}

              {/* Options editor (dropdown, radio, checkbox_list, ranked_dropdown) */}
              {NEEDS_OPTIONS.includes(field.type) && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-1">Options</label>
                  <OptionListEditor options={field.options ?? []}
                    onOptionsChange={opts => updateField(idx, { options: opts })} />
                </div>
              )}

              {/* Ranked dropdown config */}
              {field.type === "ranked_dropdown" && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Number of ranked choices</label>
                  <input type="number" min={1} max={10} value={field.config?.ranks ?? 3}
                    onChange={e => updateField(idx, { config: { ...field.config, ranks: Number(e.target.value) || 3 } })}
                    className={`w-20 ${inputClass}`} />
                </div>
              )}

              {/* Checkbox list max */}
              {field.type === "checkbox_list" && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Max selections (empty = unlimited)</label>
                  <input type="number" min={1} value={field.config?.maxSelections ?? ""}
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
                      <input value={field.config?.primaryLabel ?? ""}
                        onChange={e => updateField(idx, { config: { ...field.config, primaryLabel: e.target.value } })}
                        placeholder="e.g. Subject" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Right dropdown label</label>
                      <input value={field.config?.secondaryLabel ?? ""}
                        onChange={e => updateField(idx, { config: { ...field.config, secondaryLabel: e.target.value } })}
                        placeholder="e.g. Grade" className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Left options</label>
                      <OptionListEditor options={field.config?.primaryOptions ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, primaryOptions: opts } })} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Right options</label>
                      <OptionListEditor options={field.config?.secondaryOptions ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, secondaryOptions: opts } })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Scale config */}
              {field.type === "scale" && (
                <div className="space-y-2 mb-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Min value</label>
                      <input type="number" value={field.config?.scaleMin ?? 1}
                        onChange={e => updateField(idx, { config: { ...field.config, scaleMin: Number(e.target.value) } })}
                        className={`w-20 ${inputClass}`} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Max value</label>
                      <input type="number" value={field.config?.scaleMax ?? 5}
                        onChange={e => updateField(idx, { config: { ...field.config, scaleMax: Number(e.target.value) } })}
                        className={`w-20 ${inputClass}`} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Min label (optional)</label>
                      <input value={field.config?.scaleMinLabel ?? ""}
                        onChange={e => updateField(idx, { config: { ...field.config, scaleMinLabel: e.target.value || undefined } })}
                        placeholder="e.g. Not at all" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Max label (optional)</label>
                      <input value={field.config?.scaleMaxLabel ?? ""}
                        onChange={e => updateField(idx, { config: { ...field.config, scaleMaxLabel: e.target.value || undefined } })}
                        placeholder="e.g. Extremely" className={inputClass} />
                    </div>
                  </div>
                </div>
              )}

              {/* Matrix config */}
              {field.type === "matrix" && (
                <div className="space-y-2 mb-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Selection type</label>
                    <select value={field.config?.matrixType ?? "single"}
                      onChange={e => updateField(idx, { config: { ...field.config, matrixType: e.target.value as "single" | "multi" } })}
                      className={`w-40 ${inputClass}`}>
                      <option value="single">Single per row (radio)</option>
                      <option value="multi">Multiple per row (checkbox)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Row labels</label>
                      <OptionListEditor options={field.config?.matrixRows ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, matrixRows: opts } })} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Column labels</label>
                      <OptionListEditor options={field.config?.matrixColumns ?? []}
                        onOptionsChange={opts => updateField(idx, { config: { ...field.config, matrixColumns: opts } })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Repeatable group config */}
              {field.type === "repeatable_group" && (
                <div className="space-y-2 mb-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Min entries</label>
                      <input type="number" min={0} value={field.config?.minEntries ?? 1}
                        onChange={e => updateField(idx, { config: { ...field.config, minEntries: Number(e.target.value) || 1 } })}
                        className={`w-full ${inputClass}`} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Max entries</label>
                      <input type="number" min={1} value={field.config?.maxEntries ?? 5}
                        onChange={e => updateField(idx, { config: { ...field.config, maxEntries: Number(e.target.value) || 5 } })}
                        className={`w-full ${inputClass}`} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Add button label</label>
                      <input value={field.config?.addButtonLabel ?? ""}
                        onChange={e => updateField(idx, { config: { ...field.config, addButtonLabel: e.target.value || undefined } })}
                        placeholder="+ Add another" className={`w-full ${inputClass}`} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Sub-fields (each entry will have these)</label>
                    <div className="space-y-1.5 ml-2">
                      {(field.config?.subFields ?? []).map((sf, si) => (
                        <div key={si} className="flex items-center gap-2">
                          <select value={sf.type}
                            onChange={e => {
                              const subs = [...(field.config?.subFields ?? [])]
                              subs[si] = { ...subs[si], type: e.target.value as FormFieldType }
                              updateField(idx, { config: { ...field.config, subFields: subs } })
                            }}
                            className={`w-24 ${inputClass}`}>
                            {["text", "textarea", "number", "email", "phone", "url", "date", "dropdown"].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <input value={sf.label}
                            onChange={e => {
                              const subs = [...(field.config?.subFields ?? [])]
                              subs[si] = { ...subs[si], label: e.target.value }
                              updateField(idx, { config: { ...field.config, subFields: subs } })
                            }}
                            placeholder="Field label" className={`flex-1 ${inputClass}`} />
                          <label className="flex items-center gap-1 text-[10px] text-gray-500 shrink-0">
                            <input type="checkbox" checked={sf.required}
                              onChange={e => {
                                const subs = [...(field.config?.subFields ?? [])]
                                subs[si] = { ...subs[si], required: e.target.checked }
                                updateField(idx, { config: { ...field.config, subFields: subs } })
                              }}
                              className="accent-indigo-600" />
                            Req
                          </label>
                          {(field.config?.subFields?.length ?? 0) > 1 && (
                            <button onClick={() => {
                              const subs = (field.config?.subFields ?? []).filter((_, i) => i !== si)
                              updateField(idx, { config: { ...field.config, subFields: subs } })
                            }} className="text-red-400 hover:text-red-600 text-sm font-bold px-1">×</button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => {
                        const subs = [...(field.config?.subFields ?? []), { id: `sf_${Date.now()}`, type: "text" as const, label: "", required: false }]
                        updateField(idx, { config: { ...field.config, subFields: subs } })
                      }} className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline">+ Add sub-field</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Placeholder for text/textarea/number/email/phone/url */}
              {["text", "textarea", "number", "email", "phone", "url"].includes(field.type) && (
                <div className="mb-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Placeholder</label>
                  <input value={field.config?.placeholder ?? ""}
                    onChange={e => updateField(idx, { config: { ...field.config, placeholder: e.target.value } })}
                    className={inputClass} />
                </div>
              )}

              {/* Number min/max */}
              {field.type === "number" && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min</label>
                    <input type="number" value={field.config?.min ?? ""}
                      onChange={e => updateField(idx, { config: { ...field.config, min: Number(e.target.value) || undefined } })}
                      className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max</label>
                    <input type="number" value={field.config?.max ?? ""}
                      onChange={e => updateField(idx, { config: { ...field.config, max: Number(e.target.value) || undefined } })}
                      className={inputClass} />
                  </div>
                </div>
              )}

              {/* Conditional visibility */}
              {field.type !== "section_heading" && (
                <details className="mb-1">
                  <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">
                    🔀 Conditional visibility ({(field.config?.showIf ?? []).length} rules)
                  </summary>
                  <div className="mt-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] text-gray-400 mb-2">Only show this field when all conditions are met.</p>
                    <ConditionEditor
                      conditions={field.config?.showIf ?? []}
                      onConditionsChange={c => updateField(idx, { config: { ...field.config, showIf: c.length > 0 ? c : undefined } })}
                    />
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>

      {/* ---- Add field type picker ---- */}
      {!showTypePicker ? (
        <button onClick={() => setShowTypePicker(true)}
          className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition">
          + Add custom field
        </button>
      ) : (
        <div className="p-3 border border-indigo-200 dark:border-indigo-800 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
          {(["basic", "choice", "advanced", "layout"] as const).map(cat => {
            const types = FIELD_TYPES.filter(ft => ft.category === cat)
            return (
              <div key={cat} className="mb-3 last:mb-0">
                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{CATEGORY_LABELS[cat]}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {types.map(ft => (
                    <button key={ft.value} onClick={() => addField(ft.value)}
                      className="text-left p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition flex items-start gap-2">
                      <span className="w-9 h-9 shrink-0 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 rounded">
                        {ft.icon}
                      </span>
                      <div className="min-w-0">
                        <span className="block text-xs font-medium text-gray-800 dark:text-gray-200 leading-tight">{ft.label}</span>
                        <span className="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">{ft.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <button onClick={() => setShowTypePicker(false)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
        </div>
      )}
    </div>
  )
}
