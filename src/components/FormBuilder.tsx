"use client"

import { useState, useEffect } from "react"
import type { FormFieldConfig, FormFieldType, FormPage, ConditionalRule, StandardOverrides, StandardOverride } from "@/lib/events-api"
import { QUESTION_LIBRARY, LIBRARY_CATEGORY_LABELS, type LibraryEntry } from "@/lib/question-library"
import LinkableInput from "./LinkableInput"
import MediaUploader from "./MediaUploader"
import { stripToText } from "@/lib/sanitize-html"

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
  { value: "media",           label: "Image or PDF",    desc: "Show a photo or embedded PDF to students", icon: "🖼️", category: "layout" },
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

export type StandardQuestion = {
  id: string
  label: string
  type: string
  description?: string
  /** Content-based grouping in the builder UI. 'finishing' questions render on
   *  the applicant form after event-specific questions. */
  group: 'about' | 'context' | 'finishing'
  /** Reference-only options (for radio/dropdown) so admins can see what students will see. */
  defaultOptions?: { value: string; label: string }[]
  /**
   * Can admins edit the options for this field?
   * Only true for fields whose values aren't wired to business logic (eligibility, year calcs).
   * Currently: only std_attribution.
   */
  editableOptions?: boolean
  /** Fine-grained sub-section label shown next to the question in the builder. */
  section?: string
}

const FIELD_TYPE_ICON: Record<string, string> = {
  ...Object.fromEntries(FIELD_TYPES.map(ft => [ft.value, ft.icon])),
  search: "🔍",  // school picker — standard only
}

// Default options for standard fields — must stay in lock-step with the apply
// form (src/app/apply/[slug]/page.tsx). When admins override, we store the
// override in form_config.standard_overrides; the apply form prefers the
// override and falls back to these.
export const STD_YEAR_GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "12", label: "Year 12" },
  { value: "13", label: "Year 13" },
  { value: "14", label: "Gap year" },
]
export const STD_SCHOOL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "state",               label: "State non-selective school" },
  { value: "grammar",              label: "State selective / grammar school" },
  { value: "independent",          label: "Independent (fee-paying) school" },
  { value: "independent_bursary",  label: "Independent (fee-paying) school with >90% bursary/scholarship" },
]
export const STD_INCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "yes",                 label: "Yes" },
  { value: "no",                  label: "No" },
  { value: "prefer_not_to_say",   label: "Prefer not to say" },
]
export const STD_FSM_OPTIONS: { value: string; label: string }[] = [
  { value: "yes",         label: "Currently eligible" },
  { value: "previously",  label: "Previously eligible" },
  { value: "no",          label: "Not eligible" },
]
export const STD_FIRST_GEN_OPTIONS: { value: string; label: string }[] = [
  { value: "yes",                label: "Yes" },
  { value: "no",                 label: "No" },
  { value: "prefer_not_to_say",  label: "Prefer not to say" },
]
export const STD_ATTRIBUTION_OPTIONS: { value: string; label: string }[] = [
  { value: "email_invite",                 label: "Email invite" },
  { value: "school_teacher",                label: "School / teacher" },
  { value: "previous_steps_event",          label: "Attended a previous Steps Foundation event" },
  { value: "previous_steps_application",    label: "Applied to a previous Steps Foundation event" },
  { value: "linkedin",                      label: "LinkedIn" },
  { value: "instagram",                     label: "Instagram" },
  { value: "tiktok",                        label: "TikTok" },
  { value: "friend_word_of_mouth",          label: "Friend / word of mouth" },
  { value: "other",                         label: "Other" },
]

export const STANDARD_QUESTIONS: StandardQuestion[] = [
  // About you
  { id: "std_name",          label: "First name / Last name",      type: "text",            group: "about",     section: "About you" },
  { id: "std_email",         label: "Email address",               type: "email",           group: "about",     section: "About you", description: "Verified via OTP — read-only" },
  { id: "std_school",        label: "Current school / sixth form college", type: "search",   group: "about",     section: "About you" },
  { id: "std_year_group",    label: "Year group",                  type: "dropdown",        group: "about",     section: "About you", defaultOptions: STD_YEAR_GROUP_OPTIONS },
  // Contextual and academic information
  { id: "std_school_type",   label: "What type of school do you currently attend?", type: "radio", group: "context", section: "Contextual", defaultOptions: STD_SCHOOL_TYPE_OPTIONS },
  { id: "std_income",        label: "Is your average household income less than £40,000?", type: "radio", group: "context", section: "Contextual", defaultOptions: STD_INCOME_OPTIONS },
  { id: "std_fsm",           label: "Are you eligible for Free School Meals?", type: "radio", group: "context", section: "Contextual", defaultOptions: STD_FSM_OPTIONS },
  { id: "std_first_gen",     label: "Did you grow up in a household where at least one parent went to university?", type: "radio", group: "context", section: "Contextual", defaultOptions: STD_FIRST_GEN_OPTIONS },
  { id: "std_additional",    label: "Any additional contextual information you’d like us to know", type: "textarea", group: "context", section: "Contextual", description: "E.g. young carer, care-experienced, extenuating circumstances, school disruption, anything else contextual." },
  { id: "std_gcse",          label: "Achieved GCSE results",        type: "number",           group: "context", section: "Academic", description: "Enter your grades as numbers only, highest to lowest (e.g. 999887766)." },
  { id: "std_qualifications",label: "Subjects and predicted/achieved grades", type: "paired_dropdown", group: "context", section: "Academic", description: "Add each subject you study. Select your qualification type, subject, and current predicted (or achieved) grade." },
  // Finishing questions — shown after event-specific questions on the same page
  { id: "std_anything_else", label: "Anything else you’d like us to know?", type: "textarea", group: "finishing", section: "Finishing", description: "Optional — share anything else you’d like the team to know about you or your application." },
  { id: "std_attribution",   label: "How did you hear about this opportunity?", type: "radio", group: "finishing", section: "Finishing", defaultOptions: STD_ATTRIBUTION_OPTIONS, editableOptions: true },
]

const LOCKED_STD_IDS = new Set(['std_name', 'std_email', 'std_school'])

const STANDARD_GROUP_LABELS: Record<'about' | 'context' | 'finishing', { title: string; hint?: string }> = {
  about: { title: "About you" },
  context: { title: "Contextual and academic information" },
  finishing: { title: "Finishing questions", hint: "These appear after the event-specific questions on the applicant form." },
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level styles + sub-editors
// These are hoisted out of the FormBuilder component body so React doesn't
// recreate the component types on every render — that was unmounting inputs
// on each keystroke and dropping focus from option/condition editors.
// ---------------------------------------------------------------------------

const inputClass = "w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"

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
      className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">+ Add option</button>
  </div>
)

// ---------------------------------------------------------------------------
// Stable option editor — values are immutable IDs, decoupled from labels.
// Used for standard-question options where historical answers reference the
// value and must not be silently re-keyed when labels change.
//
// Deleting an option retires it (not dropped) so past applications keep
// their label, and readding a label that collides with a retired value
// auto-revives rather than creating a duplicate.
// ---------------------------------------------------------------------------

const StableOptionListEditor = ({ active, retired, onChange }: {
  active: { value: string; label: string }[]
  retired: { value: string; label: string }[]
  onChange: (active: { value: string; label: string }[], retired: { value: string; label: string }[]) => void
}) => {
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState("")

  const deriveValue = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")

  const retire = (idx: number) => {
    const opt = active[idx]
    if (!opt) return
    onChange(
      active.filter((_, i) => i !== idx),
      [...retired.filter(r => r.value !== opt.value), opt],
    )
  }

  const revive = (value: string) => {
    const opt = retired.find(r => r.value === value)
    if (!opt) return
    if (active.find(a => a.value === value)) return
    onChange([...active, opt], retired.filter(r => r.value !== value))
  }

  const addNew = () => {
    const label = newLabel.trim()
    if (!label) return
    const value = deriveValue(label)
    if (!value) return
    // Collision with an active value — ignore silently; UX hint below.
    if (active.find(a => a.value === value)) return
    // Collision with retired → auto-revive (use the admin's new label).
    const retiredMatch = retired.find(r => r.value === value)
    if (retiredMatch) {
      onChange([...active, { value, label }], retired.filter(r => r.value !== value))
    } else {
      onChange([...active, { value, label }], retired)
    }
    setNewLabel("")
    setAdding(false)
  }

  const derivedForNew = deriveValue(newLabel)
  const collidesActive = !!active.find(a => a.value === derivedForNew)
  const wouldRevive = !!retired.find(r => r.value === derivedForNew)

  return (
    <div className="ml-2 space-y-1.5">
      {active.map((opt, oi) => (
        <div key={opt.value} className="flex items-center gap-2">
          <input value={opt.label}
            onChange={e => {
              const updated = [...active]
              updated[oi] = { ...updated[oi], label: e.target.value }
              onChange(updated, retired)
            }}
            placeholder={`Option ${oi + 1}`} className={`flex-1 ${inputClass}`} />
          <span className="text-[10px] font-mono text-gray-400 shrink-0 px-1" title="Stable ID — never changes, so historical answers stay linked">
            {opt.value}
          </span>
          {active.length > 1 && (
            <button onClick={() => retire(oi)}
              className="text-red-400 hover:text-red-600 text-sm font-bold px-1"
              title="Retire this option (kept in history — past answers keep their label)">×</button>
          )}
        </div>
      ))}

      {adding ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNew() } if (e.key === "Escape") { setNewLabel(""); setAdding(false) } }}
              placeholder="New option label"
              autoFocus
              className={`flex-1 ${inputClass}`} />
            <button onClick={addNew}
              disabled={!newLabel.trim() || collidesActive}
              className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline disabled:opacity-40 disabled:cursor-not-allowed">
              Add
            </button>
            <button onClick={() => { setNewLabel(""); setAdding(false) }}
              className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
          {newLabel.trim() && collidesActive && (
            <p className="text-[10px] text-red-500">An active option already uses the value <span className="font-mono">{derivedForNew}</span>.</p>
          )}
          {newLabel.trim() && !collidesActive && wouldRevive && (
            <p className="text-[10px] text-amber-600 dark:text-amber-500">This will revive the retired <span className="font-mono">{derivedForNew}</span> (past answers stay linked).</p>
          )}
          {newLabel.trim() && !collidesActive && !wouldRevive && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400">New stable ID: <span className="font-mono">{derivedForNew || "—"}</span></p>
          )}
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">
          + Add option
        </button>
      )}

      {retired.length > 0 && (
        <div className="mt-3 pt-2 border-t border-amber-200 dark:border-amber-800/60">
          <p className="text-[10px] text-amber-700 dark:text-amber-500 mb-1 font-medium">
            Retired options ({retired.length}) — hidden from new applicants, but still link past answers
          </p>
          <div className="space-y-1">
            {retired.map(opt => (
              <div key={opt.value} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex-1 italic">{opt.label}</span>
                <span className="text-[10px] font-mono text-gray-400">{opt.value}</span>
                <button onClick={() => revive(opt.value)}
                  className="text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline text-[11px]">
                  Revive
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conditional visibility editor
// ---------------------------------------------------------------------------

const ConditionEditor = ({ conditions, onConditionsChange, allFields }: {
  conditions: ConditionalRule[]
  onConditionsChange: (c: ConditionalRule[]) => void
  allFields: FormFieldConfig[]
}) => (
  <div className="space-y-2">
    {conditions.map((cond, ci) => (
      <div key={ci} className="flex items-center gap-2 flex-wrap">
        <select value={cond.fieldId}
          onChange={e => { const u = [...conditions]; u[ci] = { ...u[ci], fieldId: e.target.value }; onConditionsChange(u) }}
          className={`flex-1 min-w-[120px] ${inputClass}`}>
          <option value="">Select field…</option>
          {allFields.filter(f => f.type !== "section_heading" && f.type !== "media").map(f => (
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
      className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">+ Add condition</button>
  </div>
)


// Props
// ---------------------------------------------------------------------------

type Props = {
  fields: FormFieldConfig[]
  pages?: FormPage[]
  standardOverrides?: StandardOverrides
  onChange: (fields: FormFieldConfig[], pages?: FormPage[], standardOverrides?: StandardOverrides) => void
  /**
   * Show the "Standard questions" block (name / school / year group / contextual data).
   * Defaults to true for the apply form. Pass false when the form is used in a context
   * where the student is already authenticated and that profile data is known
   * (e.g. post-event feedback).
   */
  showStandardQuestions?: boolean
  /** Header label. Defaults to "Application Form Builder". */
  headerTitle?: string
  /** Hint text shown above the per-page field list. */
  perPageHint?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FormBuilder({ fields, pages, standardOverrides, onChange, showStandardQuestions = true, headerTitle = 'Application Form Builder', perPageHint }: Props) {
  const [showTypePicker, setShowTypePicker] = useState(false)
  // Picker mode toggle: 'types' (the existing 16 field-types grid) or
  // 'library' (canonical Steps questions, fully pre-typed).
  const [pickerMode, setPickerMode] = useState<'types' | 'library'>('types')
  const [librarySearch, setLibrarySearch] = useState('')
  const addFromLibrary = (entry: LibraryEntry) => {
    const id = `field_${Date.now()}`
    const f = entry.field
    const newField: FormFieldConfig = {
      id,
      type: f.type,
      label: f.label,
      required: f.required ?? false,
      ...(f.description ? { description: f.description } : {}),
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.options && (NEEDS_OPTIONS.includes(f.type) || f.type === 'ranked_dropdown')
        ? { options: f.options.map(opt => ({ value: opt, label: opt })) }
        : {}),
      ...(f.type === "ranked_dropdown" ? { config: { ranks: Math.min(3, (f.options ?? []).length || 3) } } : {}),
    } as FormFieldConfig
    setActiveFields([...activeFields, newField])
    setShowTypePicker(false)
    setPickerMode('types')
  }
  const [activePage, setActivePage] = useState(0)
  const [openStandardGroups, setOpenStandardGroups] = useState<Record<'about' | 'context' | 'finishing', boolean>>({
    about: true, context: true, finishing: true,
  })
  const [editingRouting, setEditingRouting] = useState<number | null>(null)

  const stdOverrides: StandardOverrides = standardOverrides ?? {}
  const updateStandardOverride = (stdId: string, next: StandardOverride | undefined) => {
    const copy: StandardOverrides = { ...stdOverrides }
    if (!next || (
      next.label === undefined &&
      next.description === undefined &&
      next.options === undefined &&
      next.retiredOptions === undefined &&
      next.hidden === undefined &&
      next.minWords === undefined &&
      next.maxWords === undefined
    )) {
      delete copy[stdId]
    } else {
      copy[stdId] = next
    }
    onChange(fields, pages, Object.keys(copy).length > 0 ? copy : undefined)
  }


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


  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {headerTitle}
        </h4>
        <button onClick={addPage}
          className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">
          + Add page
        </button>
      </div>

      {/* ---- Standard questions (grouped by form position) ---- */}
      {showStandardQuestions && (
      <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
        <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-800">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Standard questions
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
            These fields appear on every form in the order shown. You can rename them or tweak descriptions
            for this event only; the options for most are locked because they drive eligibility logic.
            The "How did you hear about this?" options are fully editable.
          </p>
        </div>

        {(['about', 'context', 'finishing'] as const).map(group => {
          const groupQs = STANDARD_QUESTIONS.filter(q => q.group === group)
          const isOpen = openStandardGroups[group]
          const groupMeta = STANDARD_GROUP_LABELS[group]
          return (
            <div key={group} className="border-b border-amber-200 dark:border-amber-800 last:border-b-0">
              <button
                onClick={() => setOpenStandardGroups(s => ({ ...s, [group]: !s[group] }))}
                className="w-full px-3 py-2 text-left text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 flex items-center justify-between">
                <span className="flex flex-col items-start">
                  <span>{groupMeta.title}</span>
                  {groupMeta.hint && <span className="text-[10px] font-normal text-amber-600 dark:text-amber-500">{groupMeta.hint}</span>}
                </span>
                <span className="text-[10px] text-amber-600 dark:text-amber-500">{isOpen ? '▲ Hide' : '▼ Show'} ({groupQs.length})</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2">
                  {groupQs.map(sq => {
                    const override = stdOverrides[sq.id] ?? {}
                    const effLabel = override.label ?? sq.label
                    const effDescription = override.description ?? sq.description ?? ''
                    const effOptions = override.options ?? sq.defaultOptions ?? []
                    const isHidden = override.hidden === true
                    const isLocked = LOCKED_STD_IDS.has(sq.id)

                    // Compact row when this std question has been removed from the form.
                    if (isHidden) {
                      return (
                        <div key={sq.id}
                          className="p-2.5 rounded-md bg-gray-50 dark:bg-gray-900/30 border border-dashed border-gray-300 dark:border-gray-700 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium">Removed</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{effLabel}</span>
                          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{sq.id}</span>
                          <button
                            type="button"
                            onClick={() => updateStandardOverride(sq.id, { ...override, hidden: undefined })}
                            className="ml-auto text-[11px] text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline"
                          >
                            + Add back
                          </button>
                        </div>
                      )
                    }

                    return (
                      <div key={sq.id}
                        className="p-2.5 rounded-md bg-white/70 dark:bg-gray-900/40 border border-amber-200/70 dark:border-amber-800/60 space-y-2">
                        {/* Header row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-[10px] shrink-0 w-8 text-center" title={sq.type}>
                            {FIELD_TYPE_ICON[sq.type] ?? sq.type}
                          </span>
                          <span className="text-[10px] font-mono text-gray-400">{sq.id}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium">
                            🔒 Standard
                          </span>
                          {sq.section && (
                            <span className="text-[10px] text-gray-500 dark:text-gray-400 mx-auto">
                              {sq.section}
                            </span>
                          )}
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() => updateStandardOverride(sq.id, { ...override, hidden: true })}
                              title="Remove this question from the applicant form for this event."
                              className="ml-auto text-[10px] text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                            >
                              Remove
                            </button>
                          )}
                          {isLocked && (
                            <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500" title="Identity fields can't be removed">Always included</span>
                          )}
                        </div>

                        {/* Label */}
                        <div>
                          <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Question label</label>
                          <LinkableInput
                            value={effLabel}
                            onChange={(v) => updateStandardOverride(sq.id, {
                              ...override,
                              label: v === sq.label ? undefined : v,
                            })}
                            placeholder={sq.label}
                            className={inputClass}
                          />
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                            Help text {sq.id === 'std_email' && <span className="text-amber-600">(students always see "verified via OTP")</span>}
                          </label>
                          <LinkableInput
                            value={effDescription}
                            onChange={(v) => updateStandardOverride(sq.id, {
                              ...override,
                              description: v === (sq.description ?? '') ? undefined : v,
                            })}
                            placeholder={sq.description ?? 'Optional help text shown below the question'}
                            className={inputClass}
                          />
                        </div>

                        {/* Options */}
                        {sq.defaultOptions && (
                          <div>
                            <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">
                              Options {sq.editableOptions
                                ? '(editable — rename labels, add, or retire. IDs stay stable so past answers keep their label)'
                                : '(locked — wired to eligibility / year-group logic)'}
                            </label>
                            {sq.editableOptions ? (
                              <StableOptionListEditor
                                active={effOptions}
                                retired={override.retiredOptions ?? []}
                                onChange={(opts, retiredOpts) => {
                                  // Drop the override entirely if nothing differs from defaults AND nothing is retired.
                                  const activeMatchesDefault = sq.defaultOptions
                                    && opts.length === sq.defaultOptions.length
                                    && opts.every((o, i) => o.value === sq.defaultOptions![i].value && o.label === sq.defaultOptions![i].label)
                                  const noRetired = retiredOpts.length === 0
                                  updateStandardOverride(sq.id, {
                                    ...override,
                                    options: activeMatchesDefault ? undefined : opts,
                                    retiredOptions: noRetired ? undefined : retiredOpts,
                                  })
                                }}
                              />
                            ) : (
                              <ul className="ml-2 space-y-0.5">
                                {effOptions.map((o, i) => (
                                  <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
                                    <span className="text-gray-400">•</span>
                                    <span>{o.label}</span>
                                    <span className="text-[10px] font-mono text-gray-400">({o.value})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Word bounds — only for textarea-style std questions */}
                        {sq.type === 'textarea' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Min words (optional)</label>
                              <input type="number" min={0} value={override.minWords ?? ''}
                                onChange={e => updateStandardOverride(sq.id, {
                                  ...override,
                                  minWords: Number(e.target.value) || undefined,
                                })}
                                placeholder="e.g. 50"
                                className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Max words (optional)</label>
                              <input type="number" min={0} value={override.maxWords ?? ''}
                                onChange={e => updateStandardOverride(sq.id, {
                                  ...override,
                                  maxWords: Number(e.target.value) || undefined,
                                })}
                                placeholder="e.g. 250"
                                className={inputClass} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* ---- Page tabs ---- */}
      <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
          {effectivePages.map((page, pi) => (
            <button key={page.id}
              onClick={() => setActivePage(pi)}
              className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition flex items-center gap-1.5 ${
                pi === activePage
                  ? "bg-steps-blue-100 dark:bg-steps-blue-900/30 text-steps-blue-700 dark:text-steps-blue-300 border border-steps-blue-200 dark:border-steps-blue-800"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent"
              }`}>
              {stripToText(page.title) || `Page ${pi + 1}`}
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
              <LinkableInput
                value={activePageObj.title ?? ""}
                onChange={html => updatePageMeta(activePage, { title: html })}
                ariaLabel="Page title"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Page description (optional)</label>
              <LinkableInput
                value={activePageObj.description ?? ""}
                onChange={html => updatePageMeta(activePage, { description: html || undefined })}
                placeholder="e.g. Watch an Introduction to Man Group before you apply"
                ariaLabel="Page description"
              />
            </div>
          </div>

          {/* Conditional routing */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
            <button onClick={() => setEditingRouting(editingRouting === activePage ? null : activePage)}
              className="text-[10px] text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline flex items-center gap-1">
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
                      allFields={allFields}
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
                          <option key={p.id} value={p.id}>{stripToText(p.title) || p.id}</option>
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
                  className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">+ Add routing rule</button>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {perPageHint ?? `Fields on "${stripToText(activePageObj?.title ?? "") || "this page"}" — students see these after the standard questions.`}
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
                  <span className="text-xs w-8 h-6 flex items-center justify-center font-bold text-steps-blue-600 dark:text-steps-blue-400 bg-steps-blue-50 dark:bg-steps-blue-900/20 rounded">
                    {typeMeta?.icon ?? "?"}
                  </span>
                  <span className="text-xs font-medium text-steps-blue-600 dark:text-steps-blue-400">
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
                  {field.type === "section_heading" ? "Heading text" : field.type === "media" ? "Caption (optional)" : "Label"}
                </label>
                <LinkableInput
                  value={field.label ?? ""}
                  onChange={html => updateField(idx, { label: html })}
                  placeholder={
                    field.type === "section_heading"
                      ? "e.g. About your academics"
                      : field.type === "media"
                        ? "e.g. Introduction to Man Group"
                        : "e.g. Which areas interest you most?"
                  }
                  ariaLabel="Field label"
                />
              </div>

              {/* Description */}
              <div className="mb-2">
                <label className="block text-xs text-gray-500 mb-0.5">Description (optional)</label>
                <LinkableInput
                  value={field.description ?? ""}
                  onChange={html => updateField(idx, { description: html || undefined })}
                  placeholder="Helper text shown below the label"
                  ariaLabel="Field description"
                />
              </div>

              {/* Required toggle (not for section_heading or media — both are display-only) */}
              {field.type !== "section_heading" && field.type !== "media" && (
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={field.required}
                    onChange={e => updateField(idx, { required: e.target.checked })}
                    className="accent-steps-blue-600" />
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
                              className="accent-steps-blue-600" />
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
                      }} className="text-xs text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:underline">+ Add sub-field</button>
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

              {/* Textarea word min/max */}
              {field.type === "textarea" && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Min words</label>
                    <input type="number" min={0} value={field.config?.minWords ?? ""}
                      onChange={e => updateField(idx, { config: { ...field.config, minWords: Number(e.target.value) || undefined } })}
                      placeholder="e.g. 50"
                      className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Max words</label>
                    <input type="number" min={0} value={field.config?.maxWords ?? ""}
                      onChange={e => updateField(idx, { config: { ...field.config, maxWords: Number(e.target.value) || undefined } })}
                      placeholder="e.g. 250"
                      className={inputClass} />
                  </div>
                </div>
              )}

              {/* Media uploader (image or PDF) */}
              {field.type === "media" && (
                <div className="mb-2">
                  <MediaUploader
                    url={field.config?.mediaUrl ?? ""}
                    mediaType={field.config?.mediaType ?? "image"}
                    onChange={(mediaUrl, mediaType) =>
                      updateField(idx, {
                        config: { ...field.config, mediaUrl: mediaUrl || undefined, mediaType },
                      })
                    }
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    Tip: keep files under 10 MB. Students see images inline and PDFs in an embedded viewer.
                  </p>
                </div>
              )}

              {/* Conditional visibility */}
              {field.type !== "section_heading" && field.type !== "media" && (
                <details className="mb-1">
                  <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">
                    🔀 Conditional visibility ({(field.config?.showIf ?? []).length} rules)
                  </summary>
                  <div className="mt-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] text-gray-400 mb-2">Only show this field when all conditions are met.</p>
                    <ConditionEditor
                      allFields={allFields}
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
          className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-steps-blue-600 dark:text-steps-blue-400 font-medium hover:border-steps-blue-400 hover:bg-steps-blue-50 dark:hover:bg-steps-blue-900/10 transition">
          + Add custom field
        </button>
      ) : (
        <div className="p-3 border border-steps-blue-200 dark:border-steps-blue-800 rounded-lg bg-steps-blue-50 dark:bg-steps-blue-900/20">
          {/* Mode toggle: blank field-types vs canonical question library */}
          <div role="tablist" aria-label="Add field source" className="grid grid-cols-2 gap-1 p-1 bg-white dark:bg-gray-800 rounded-md mb-3">
            <button role="tab" aria-selected={pickerMode === 'types'} onClick={() => setPickerMode('types')}
              className={`text-xs font-semibold py-1.5 rounded ${pickerMode === 'types' ? 'bg-steps-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              Blank field
            </button>
            <button role="tab" aria-selected={pickerMode === 'library'} onClick={() => setPickerMode('library')}
              className={`text-xs font-semibold py-1.5 rounded ${pickerMode === 'library' ? 'bg-steps-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              From question library
            </button>
          </div>

          {pickerMode === 'types' && (
            <>
              {(["basic", "choice", "advanced", "layout"] as const).map(cat => {
                const types = FIELD_TYPES.filter(ft => ft.category === cat)
                return (
                  <div key={cat} className="mb-3 last:mb-0">
                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{CATEGORY_LABELS[cat]}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {types.map(ft => (
                        <button key={ft.value} onClick={() => addField(ft.value)}
                          className="text-left p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-steps-blue-400 dark:hover:border-steps-blue-500 transition flex items-start gap-2">
                          <span className="w-9 h-9 shrink-0 flex items-center justify-center text-sm font-bold text-steps-blue-600 dark:text-steps-blue-400 bg-steps-blue-50 dark:bg-steps-blue-900/30 rounded">
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
            </>
          )}

          {pickerMode === 'library' && (
            <div>
              <input
                type="search"
                value={librarySearch}
                onChange={e => setLibrarySearch(e.target.value)}
                placeholder="Search the library…"
                className="w-full mb-3 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
              />
              {(Object.keys(LIBRARY_CATEGORY_LABELS) as Array<keyof typeof LIBRARY_CATEGORY_LABELS>).map(cat => {
                const q = librarySearch.trim().toLowerCase()
                const entries = QUESTION_LIBRARY.filter(e => e.category === cat).filter(e => {
                  if (!q) return true
                  return e.name.toLowerCase().includes(q)
                    || e.field.label.toLowerCase().includes(q)
                    || (e.field.description ?? '').toLowerCase().includes(q)
                })
                if (entries.length === 0) return null
                return (
                  <div key={cat} className="mb-3 last:mb-0">
                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{LIBRARY_CATEGORY_LABELS[cat]}</p>
                    <div className="space-y-1.5">
                      {entries.map(entry => {
                        const ftMeta = FIELD_TYPES.find(t => t.value === entry.field.type)
                        return (
                          <button
                            key={entry.id}
                            onClick={() => addFromLibrary(entry)}
                            className="w-full text-left p-2.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-steps-blue-400 dark:hover:border-steps-blue-500 transition"
                          >
                            <div className="flex items-start justify-between gap-2 mb-0.5">
                              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{entry.name}</span>
                              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-400 rounded">
                                {ftMeta?.label ?? entry.field.type}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">{entry.field.label}</p>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <button onClick={() => { setShowTypePicker(false); setPickerMode('types'); setLibrarySearch('') }}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
        </div>
      )}
    </div>
  )
}
