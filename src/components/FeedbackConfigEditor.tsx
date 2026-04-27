'use client'

import React, { useMemo } from 'react'
import type { EventFeedbackConfig } from '@/lib/events-api'

// ---------------------------------------------------------------------------
// FeedbackConfigEditor
// Controlled editor over events.feedback_config (jsonb).
//
// Used inside the admin event editor under the "Post-event feedback" Section.
// Renders an empty-state CTA when value is null, otherwise an intro field +
// list of QuestionCard rows. Reorder via up/down buttons, delete via X.
// ---------------------------------------------------------------------------

type Question = EventFeedbackConfig['questions'][number]
type QType = Question['type']

type Props = {
  value: EventFeedbackConfig | null
  onChange: (next: EventFeedbackConfig | null) => void
}

function slugifyId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

function emptyQuestion(type: QType): Question {
  if (type === 'scale') {
    return {
      id: 'rating',
      type: 'scale',
      label: 'How would you rate this event?',
      required: true,
      scale: { min: 1, max: 5, minLabel: 'Poor', maxLabel: 'Excellent' },
    }
  }
  if (type === 'single_choice') {
    return {
      id: 'choice',
      type: 'single_choice',
      label: 'New question',
      required: false,
      options: ['', ''],
    }
  }
  if (type === 'long_text') {
    return {
      id: 'comments',
      type: 'long_text',
      label: 'Anything else you\u2019d like to share?',
      required: false,
      placeholder: 'Optional',
    }
  }
  // consent
  return {
    id: 'consent',
    type: 'consent',
    label: 'May we share your feedback publicly?',
    required: false,
    options: [
      { value: 'no', label: 'No, keep it private' },
      { value: 'first_name', label: 'Yes \u2014 with my first name' },
      { value: 'full_name', label: 'Yes \u2014 with my full name' },
      { value: 'anon', label: 'Yes \u2014 anonymously' },
    ],
  }
}

const QUESTION_TYPE_LABELS: Record<QType, string> = {
  scale: 'Scale (1\u20135)',
  single_choice: 'Single choice',
  long_text: 'Long text',
  consent: 'Consent / attribution',
}

export default function FeedbackConfigEditor({ value, onChange }: Props) {
  const config = value
  const questions = config?.questions ?? []

  // Surface duplicate IDs (server treats id as the answer key, so collisions
  // silently drop one of the answers).
  const duplicateIds = useMemo(() => {
    const seen = new Map<string, number>()
    questions.forEach(q => {
      seen.set(q.id, (seen.get(q.id) ?? 0) + 1)
    })
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [questions])

  if (!config) {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-400">
        <p className="mb-3">
          No feedback form set up for this event yet. Add one to enable the live QR + post-event responses page.
        </p>
        <button
          type="button"
          onClick={() =>
            onChange({
              intro: '',
              questions: [emptyQuestion('scale'), emptyQuestion('long_text'), emptyQuestion('consent')],
            })
          }
          className="px-3 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700"
        >
          + Add feedback form
        </button>
      </div>
    )
  }

  const updateQuestion = (idx: number, patch: Partial<Question>) => {
    const next = [...questions]
    next[idx] = { ...next[idx], ...patch } as Question
    onChange({ ...config, questions: next })
  }

  const replaceQuestion = (idx: number, q: Question) => {
    const next = [...questions]
    next[idx] = q
    onChange({ ...config, questions: next })
  }

  const removeQuestion = (idx: number) => {
    const next = questions.filter((_, i) => i !== idx)
    onChange({ ...config, questions: next })
  }

  const moveQuestion = (idx: number, delta: -1 | 1) => {
    const target = idx + delta
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange({ ...config, questions: next })
  }

  const addQuestion = (type: QType) => {
    onChange({ ...config, questions: [...questions, emptyQuestion(type)] })
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
          value={config.intro ?? ''}
          onChange={e => onChange({ ...config, intro: e.target.value })}
          rows={2}
          placeholder="Optional. e.g. Thanks for coming! Two minutes to help us improve."
          className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="space-y-3">
        {questions.map((q, idx) => (
          <QuestionCard
            key={`${idx}-${q.id}`}
            index={idx}
            total={questions.length}
            question={q}
            duplicateId={duplicateIds.has(q.id)}
            onUpdate={patch => updateQuestion(idx, patch)}
            onReplace={next => replaceQuestion(idx, next)}
            onRemove={() => removeQuestion(idx)}
            onMoveUp={() => moveQuestion(idx, -1)}
            onMoveDown={() => moveQuestion(idx, 1)}
          />
        ))}
        {questions.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            No questions yet. Add one below.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mr-1">Add question:</span>
        {(Object.keys(QUESTION_TYPE_LABELS) as QType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => addQuestion(t)}
            className="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            + {QUESTION_TYPE_LABELS[t]}
          </button>
        ))}
        <button
          type="button"
          onClick={removeForm}
          className="ml-auto px-2.5 py-1 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Remove feedback form
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuestionCard
// ---------------------------------------------------------------------------

function QuestionCard({
  index,
  total,
  question,
  duplicateId,
  onUpdate,
  onReplace,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number
  total: number
  question: Question
  duplicateId: boolean
  onUpdate: (patch: Partial<Question>) => void
  onReplace: (next: Question) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const t = question.type

  const onTypeChange = (next: QType) => {
    if (next === t) return
    // Re-seed defaults for the new type but preserve the existing id + label.
    const seed = emptyQuestion(next)
    onReplace({
      ...seed,
      id: question.id || seed.id,
      label: question.label || seed.label,
      required: question.required ?? seed.required,
    } as Question)
  }

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 text-xs font-mono text-gray-500 dark:text-gray-400">#{index + 1}</span>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Question</label>
            <input
              value={question.label}
              onChange={e => onUpdate({ label: e.target.value })}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={t}
              onChange={e => onTypeChange(e.target.value as QType)}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              {(Object.keys(QUESTION_TYPE_LABELS) as QType[]).map(opt => (
                <option key={opt} value={opt}>{QUESTION_TYPE_LABELS[opt]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove question"
            className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 ml-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            ID <span className="text-gray-400">(answer key)</span>
          </label>
          <input
            value={question.id}
            onChange={e => onUpdate({ id: slugifyId(e.target.value) })}
            placeholder="e.g. rating"
            className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md border bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 ${
              duplicateId
                ? 'border-red-400 dark:border-red-700'
                : 'border-gray-300 dark:border-gray-700'
            }`}
          />
          {duplicateId ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{`Duplicate ID — answers will collide.`}</p>
          ) : null}
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer pb-1.5">
            <input
              type="checkbox"
              checked={question.required ?? false}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-700"
            />
            Required
          </label>
        </div>
        {(t === 'scale' || t === 'single_choice') ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Caption <span className="text-gray-400">(optional)</span>
            </label>
            <input
              value={question.caption ?? ''}
              onChange={e => onUpdate({ caption: e.target.value || undefined })}
              placeholder="Helper text shown under the question"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
        ) : null}
      </div>

      <div className="ml-6">
        {t === 'scale' ? <ScaleFields q={question} onUpdate={onUpdate} /> : null}
        {t === 'single_choice' ? <ChoiceFields q={question} onUpdate={onUpdate} /> : null}
        {t === 'long_text' ? <LongTextFields q={question} onUpdate={onUpdate} /> : null}
        {t === 'consent' ? <ConsentFields q={question} onUpdate={onUpdate} /> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Type-specific editors
// ---------------------------------------------------------------------------

function ScaleFields({ q, onUpdate }: { q: Question; onUpdate: (patch: Partial<Question>) => void }) {
  const scale = q.scale ?? { min: 1, max: 5 }
  const set = (patch: Partial<NonNullable<Question['scale']>>) => onUpdate({ scale: { ...scale, ...patch } })
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Min</label>
        <input
          type="number"
          value={scale.min}
          onChange={e => set({ min: parseInt(e.target.value, 10) || 0 })}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max</label>
        <input
          type="number"
          value={scale.max}
          onChange={e => set({ max: parseInt(e.target.value, 10) || 0 })}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Min label</label>
        <input
          value={scale.minLabel ?? ''}
          onChange={e => set({ minLabel: e.target.value || undefined })}
          placeholder="e.g. Poor"
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max label</label>
        <input
          value={scale.maxLabel ?? ''}
          onChange={e => set({ maxLabel: e.target.value || undefined })}
          placeholder="e.g. Excellent"
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>
    </div>
  )
}

function normaliseOption(o: string | { value: string; label: string }): { value: string; label: string } {
  if (typeof o === 'string') return { value: slugifyId(o) || o, label: o }
  return o
}

function ChoiceFields({ q, onUpdate }: { q: Question; onUpdate: (patch: Partial<Question>) => void }) {
  const opts = q.options ?? []
  const setOpts = (next: Question['options']) => onUpdate({ options: next })
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Options</label>
      <div className="space-y-1.5">
        {opts.map((raw, i) => {
          const o = normaliseOption(raw)
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                value={o.label}
                onChange={e => {
                  const next = [...opts]
                  next[i] = { value: o.value || slugifyId(e.target.value), label: e.target.value }
                  setOpts(next)
                }}
                placeholder="Option label"
                className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              <input
                value={o.value}
                onChange={e => {
                  const next = [...opts]
                  next[i] = { value: slugifyId(e.target.value), label: o.label }
                  setOpts(next)
                }}
                placeholder="value"
                className="w-32 px-2.5 py-1.5 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => setOpts(opts.filter((_, j) => j !== i))}
                className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                title="Remove option"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpts([...opts, { value: '', label: '' }])}
        className="mt-2 px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        + Add option
      </button>
    </div>
  )
}

function LongTextFields({ q, onUpdate }: { q: Question; onUpdate: (patch: Partial<Question>) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Placeholder</label>
      <input
        value={q.placeholder ?? ''}
        onChange={e => onUpdate({ placeholder: e.target.value || undefined })}
        placeholder="Optional"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      />
    </div>
  )
}

function ConsentFields({ q, onUpdate }: { q: Question; onUpdate: (patch: Partial<Question>) => void }) {
  // Consent uses the same option shape as single_choice. We share the editor.
  return <ChoiceFields q={q} onUpdate={onUpdate} />
}
