// ---------------------------------------------------------------------------
// form_config shape validator
//
// Why: form_config is stored as JSONB and consumed both server-side (RLS policy
// reads) and by a thin React renderer that trusts the shape. A typo in the
// admin tooling (or a future migration) could write malformed config that
// silently breaks the apply page for every student. We guard writes with a
// structural check so bad data never lands in the DB.
//
// This is intentionally hand-rolled rather than a dep (zod/ajv). The sandbox
// install path is flaky and the validator only needs to mirror the types in
// events-api.ts — pulling in a full schema lib would be overkill.
// ---------------------------------------------------------------------------

import type {
  FormFieldConfig,
  FormFieldType,
  FormPage,
  StandardOverride,
  StandardOverrides,
  ConditionalRule,
} from './events-api'

export class FormConfigValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`form_config.${path}: ${message}`)
    this.name = 'FormConfigValidationError'
  }
}

const FIELD_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  'text', 'textarea', 'number', 'email', 'phone', 'date', 'url',
  'dropdown', 'radio', 'checkbox_list', 'ranked_dropdown', 'yes_no',
  'scale', 'paired_dropdown', 'matrix', 'repeatable_group',
  'section_heading', 'media',
])

const COND_OPERATORS: ReadonlySet<ConditionalRule['operator']> = new Set([
  'equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty',
])

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function checkOptionList(opts: unknown, path: string): void {
  if (!Array.isArray(opts)) throw new FormConfigValidationError(path, 'must be an array')
  opts.forEach((opt, i) => {
    if (!isObject(opt)) throw new FormConfigValidationError(`${path}[${i}]`, 'must be an object')
    if (typeof opt.value !== 'string') throw new FormConfigValidationError(`${path}[${i}].value`, 'must be a string')
    if (typeof opt.label !== 'string') throw new FormConfigValidationError(`${path}[${i}].label`, 'must be a string')
  })
}

function checkConditionalRules(rules: unknown, path: string): void {
  if (!Array.isArray(rules)) throw new FormConfigValidationError(path, 'must be an array')
  rules.forEach((r, i) => {
    if (!isObject(r)) throw new FormConfigValidationError(`${path}[${i}]`, 'must be an object')
    if (typeof r.fieldId !== 'string') throw new FormConfigValidationError(`${path}[${i}].fieldId`, 'must be a string')
    if (typeof r.operator !== 'string' || !COND_OPERATORS.has(r.operator as ConditionalRule['operator'])) {
      throw new FormConfigValidationError(`${path}[${i}].operator`, 'is not a valid operator')
    }
    if (r.value !== undefined && typeof r.value !== 'string') {
      throw new FormConfigValidationError(`${path}[${i}].value`, 'must be a string if present')
    }
  })
}

function checkField(f: unknown, path: string): void {
  if (!isObject(f)) throw new FormConfigValidationError(path, 'must be an object')
  if (typeof f.id !== 'string' || f.id.length === 0) {
    throw new FormConfigValidationError(`${path}.id`, 'must be a non-empty string')
  }
  if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type as FormFieldType)) {
    throw new FormConfigValidationError(`${path}.type`, `invalid field type '${String(f.type)}'`)
  }
  if (typeof f.label !== 'string') throw new FormConfigValidationError(`${path}.label`, 'must be a string')
  if (typeof f.required !== 'boolean') throw new FormConfigValidationError(`${path}.required`, 'must be a boolean')
  if (f.description !== undefined && typeof f.description !== 'string') {
    throw new FormConfigValidationError(`${path}.description`, 'must be a string if present')
  }
  if (f.options !== undefined) checkOptionList(f.options, `${path}.options`)

  if (f.config !== undefined) {
    if (!isObject(f.config)) throw new FormConfigValidationError(`${path}.config`, 'must be an object')
    const c = f.config
    const numericKeys = ['min', 'max', 'minWords', 'maxWords', 'maxSelections', 'ranks', 'scaleMin', 'scaleMax', 'minEntries', 'maxEntries'] as const
    for (const k of numericKeys) {
      if (c[k] !== undefined && typeof c[k] !== 'number') {
        throw new FormConfigValidationError(`${path}.config.${k}`, 'must be a number if present')
      }
    }
    const stringKeys = ['placeholder', 'primaryLabel', 'secondaryLabel', 'scaleMinLabel', 'scaleMaxLabel', 'addButtonLabel', 'mediaUrl'] as const
    for (const k of stringKeys) {
      if (c[k] !== undefined && typeof c[k] !== 'string') {
        throw new FormConfigValidationError(`${path}.config.${k}`, 'must be a string if present')
      }
    }
    const optionListKeys = ['primaryOptions', 'secondaryOptions', 'matrixRows', 'matrixColumns'] as const
    for (const k of optionListKeys) {
      if (c[k] !== undefined) checkOptionList(c[k], `${path}.config.${k}`)
    }
    if (c.matrixType !== undefined && c.matrixType !== 'single' && c.matrixType !== 'multi') {
      throw new FormConfigValidationError(`${path}.config.matrixType`, `must be 'single' or 'multi'`)
    }
    if (c.mediaType !== undefined && c.mediaType !== 'image' && c.mediaType !== 'pdf') {
      throw new FormConfigValidationError(`${path}.config.mediaType`, `must be 'image' or 'pdf'`)
    }
    if (c.subFields !== undefined) {
      if (!Array.isArray(c.subFields)) throw new FormConfigValidationError(`${path}.config.subFields`, 'must be an array')
      c.subFields.forEach((sf, i) => checkField(sf, `${path}.config.subFields[${i}]`))
    }
    if (c.showIf !== undefined) checkConditionalRules(c.showIf, `${path}.config.showIf`)
  }
}

function checkStandardOverride(o: unknown, path: string): void {
  if (!isObject(o)) throw new FormConfigValidationError(path, 'must be an object')
  if (o.label !== undefined && typeof o.label !== 'string') {
    throw new FormConfigValidationError(`${path}.label`, 'must be a string if present')
  }
  if (o.description !== undefined && typeof o.description !== 'string') {
    throw new FormConfigValidationError(`${path}.description`, 'must be a string if present')
  }
  if (o.hidden !== undefined && typeof o.hidden !== 'boolean') {
    throw new FormConfigValidationError(`${path}.hidden`, 'must be a boolean if present')
  }
  if (o.minWords !== undefined && typeof o.minWords !== 'number') {
    throw new FormConfigValidationError(`${path}.minWords`, 'must be a number if present')
  }
  if (o.maxWords !== undefined && typeof o.maxWords !== 'number') {
    throw new FormConfigValidationError(`${path}.maxWords`, 'must be a number if present')
  }
  if (o.options !== undefined) checkOptionList(o.options, `${path}.options`)
  if (o.retiredOptions !== undefined) checkOptionList(o.retiredOptions, `${path}.retiredOptions`)
}

function checkPage(p: unknown, path: string): void {
  if (!isObject(p)) throw new FormConfigValidationError(path, 'must be an object')
  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new FormConfigValidationError(`${path}.id`, 'must be a non-empty string')
  }
  if (typeof p.title !== 'string') throw new FormConfigValidationError(`${path}.title`, 'must be a string')
  if (p.description !== undefined && typeof p.description !== 'string') {
    throw new FormConfigValidationError(`${path}.description`, 'must be a string if present')
  }
  if (!Array.isArray(p.fields)) throw new FormConfigValidationError(`${path}.fields`, 'must be an array')
  p.fields.forEach((f, i) => checkField(f, `${path}.fields[${i}]`))

  if (p.routing !== undefined) {
    if (!isObject(p.routing)) throw new FormConfigValidationError(`${path}.routing`, 'must be an object')
    if (!Array.isArray(p.routing.rules)) throw new FormConfigValidationError(`${path}.routing.rules`, 'must be an array')
    p.routing.rules.forEach((rule, i) => {
      if (!isObject(rule)) throw new FormConfigValidationError(`${path}.routing.rules[${i}]`, 'must be an object')
      if (typeof rule.goToPageId !== 'string') {
        throw new FormConfigValidationError(`${path}.routing.rules[${i}].goToPageId`, 'must be a string')
      }
      checkConditionalRules(rule.conditions, `${path}.routing.rules[${i}].conditions`)
    })
    if (p.routing.defaultNextPageId !== undefined && typeof p.routing.defaultNextPageId !== 'string') {
      throw new FormConfigValidationError(`${path}.routing.defaultNextPageId`, 'must be a string if present')
    }
  }
}

export type FormConfigShape = {
  fields?: FormFieldConfig[]
  pages?: FormPage[]
  standard_overrides?: StandardOverrides
}

/**
 * Validate the shape of an events.form_config payload before writing it to
 * the database. Throws FormConfigValidationError on the first violation;
 * caller should surface the message to the admin who triggered the write.
 *
 * Accepts null/undefined as a signal of "no custom form" and returns early.
 */
export function validateFormConfig(config: unknown): void {
  if (config === null || config === undefined) return
  if (!isObject(config)) throw new FormConfigValidationError('', 'must be an object')

  if (config.fields !== undefined) {
    if (!Array.isArray(config.fields)) throw new FormConfigValidationError('fields', 'must be an array')
    config.fields.forEach((f, i) => checkField(f, `fields[${i}]`))
  }

  if (config.pages !== undefined) {
    if (!Array.isArray(config.pages)) throw new FormConfigValidationError('pages', 'must be an array')
    config.pages.forEach((p, i) => checkPage(p, `pages[${i}]`))
  }

  if (config.standard_overrides !== undefined) {
    if (!isObject(config.standard_overrides)) {
      throw new FormConfigValidationError('standard_overrides', 'must be an object')
    }
    for (const [key, override] of Object.entries(config.standard_overrides)) {
      checkStandardOverride(override, `standard_overrides[${key}]`)
    }
  }
}
