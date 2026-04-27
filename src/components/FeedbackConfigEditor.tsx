'use client'

import React, { useMemo } from 'react'
import FormBuilder from '@/components/FormBuilder'
import type { EventFeedbackConfig, FormFieldConfig, FormPage } from '@/lib/events-api'
import { getFeedbackFields } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// FeedbackConfigEditor
// Thin wrapper over FormBuilder for editing events.feedback_config (jsonb).
//
// Reuses the same field types as the apply form. Special semantics encoded
// via reserved IDs / types:
//   - field id 'consent'        → event_feedback.consent column
//   - field id 'postable_quote' → event_feedback.postable_quote column
//   - field type 'scale'        → event_feedback.ratings jsonb
//   - everything else           → event_feedback.answers jsonb
// ---------------------------------------------------------------------------

type Props = {
  value: EventFeedbackConfig | null
  onChange: (next: EventFeedbackConfig | null) => void
}

const RESERVED_IDS = new Set(['consent', 'postable_quote'])

/** Default fields seeded when admin clicks "+ Add feedback form". */
function defaultFields(): FormFieldConfig[] {
  return [
    {
      id: 'rating',
      type: 'scale',
      label: 'How would you rate this event?',
      required: true,
      config: { scaleMin: 1, scaleMax: 5, scaleMinLabel: 'Poor', scaleMaxLabel: 'Excellent' },
    },
    {
      id: 'comments',
      type: 'textarea',
      label: 'Anything else you’d like to share?',
      required: false,
      config: { placeholder: 'Optional' },
    },
    {
      id: 'postable_quote',
      type: 'textarea',
      label: 'A short quote we could share publicly',
      description: 'Optional. Saved to its own column so we can curate testimonials.',
      required: false,
      config: { placeholder: 'e.g. The mentors gave me real confidence about applying to Oxbridge.' },
    },
    {
      id: 'consent',
      type: 'radio',
      label: 'May we share your feedback publicly?',
      required: true,
      options: [
        { value: 'no', label: 'No, keep it private' },
        { value: 'first_name', label: 'Yes — with my first name' },
        { value: 'name', label: 'Yes — with my full name' },
        { value: 'anon', label: 'Yes — anonymously' },
      ],
    },
  ]
}

export default function FeedbackConfigEditor({ value, onChange }: Props) {
  const fields = getFeedbackFields(value)

  // Surface missing reserved fields so admins know what they're skipping.
  const reservedStatus = useMemo(() => {
    const ids = new Set(fields.map(f => f.id))
    return {
      hasConsent: ids.has('consent'),
      hasPostableQuote: ids.has('postable_quote'),
      hasScale: fields.some(f => f.type === 'scale'),
    }
  }, [fields])

  if (!value) {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-400">
        <p className="mb-3">
          No feedback form set up for this event yet. Add one to enable the live QR + post-event responses page.
        </p>
        <button
          type="button"
          onClick={() => onChange({ intro: '', fields: defaultFields() })}
          className="px-3 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700"
        >
          + Add feedback form
        </button>
      </div>
    )
  }

  const removeForm = () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Remove the feedback form for this event? Existing submissions stay in the database, but the QR + form will stop accepting new responses.',
      )
      if (!ok) return
    }
    onChange(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Intro (shown above the form)
        </label>
        <textarea
          value={value.intro ?? ''}
          onChange={e => onChange({ ...value, intro: e.target.value })}
          rows={2}
          placeholder="Optional. e.g. Thanks for coming! Two minutes to help us improve."
          className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
        <p className="font-medium">Reserved field IDs &amp; types</p>
        <ul className="list-disc list-inside space-y-0.5 marker:text-amber-500">
          <li>
            <code className="font-mono">id: &quot;consent&quot;</code> — radio with values <code className="font-mono">no</code> / <code className="font-mono">first_name</code> / <code className="font-mono">name</code> / <code className="font-mono">anon</code>. Stored in <code className="font-mono">event_feedback.consent</code>.
            {!reservedStatus.hasConsent && <span className="ml-1 text-red-700 dark:text-red-300">(missing — students can&apos;t opt into postable quotes)</span>}
          </li>
          <li>
            <code className="font-mono">id: &quot;postable_quote&quot;</code> — saves to its own column for testimonials.
            {!reservedStatus.hasPostableQuote && <span className="ml-1 text-gray-600 dark:text-gray-400">(optional)</span>}
          </li>
          <li>
            Any field with <code className="font-mono">type: scale</code> writes to the <code className="font-mono">ratings</code> jsonb so the live aggregation can chart it.
            {!reservedStatus.hasScale && <span className="ml-1 text-gray-600 dark:text-gray-400">(no scale fields yet)</span>}
          </li>
        </ul>
      </div>

      <FormBuilder
        fields={value.fields ?? []}
        pages={value.pages}
        onChange={(nextFields, nextPages) => onChange({
          ...value,
          fields: nextFields,
          ...(nextPages !== undefined ? { pages: nextPages } : {}),
        })}
      />

      <div className="flex items-center justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={removeForm}
          className="px-2.5 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Remove feedback form
        </button>
      </div>
    </div>
  )
}

// Exported so future code (e.g. validators) can share the reserved set.
export { RESERVED_IDS }
