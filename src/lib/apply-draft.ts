// ---------------------------------------------------------------------------
// Draft persistence — auto-save apply-form state to localStorage.
//
// Drafts are keyed by (event, email) so multiple applications on the same
// device don't collide, and so sign-out cleanly drops what was in progress
// without affecting other stored app state.
//
// Bump DRAFT_VERSION when the shape below changes in a backwards-incompatible
// way — loadDraft returns null for stale versions, which surfaces a fresh
// form rather than silently crashing on unexpected fields.
// ---------------------------------------------------------------------------

import type { QualificationEntry } from '@/lib/apply-api'

export const DRAFT_VERSION = 2
export const DRAFT_KEY_PREFIX = 'steps_draft_'

export type DraftData = {
  v: number
  step: string
  // Details
  firstName: string
  lastName: string
  school: {
    schoolId: string | null
    schoolNameRaw: string | null
    typeGroup?: string | null
    schoolName?: string | null
  }
  yearGroup: number | ''
  schoolType: string
  freeSchoolMeals: string
  householdIncome: string
  firstGenerationUni: string  // 'yes' | 'no' | '' — see apply page for semantics
  additionalContext: string
  anythingElse: string
  // Application
  gcseResults: string
  qualifications: QualificationEntry[]
  attribution: string
  // Custom fields
  customFieldValues: Record<string, unknown>
}

export function draftKey(eventId: string, email: string): string {
  return `${DRAFT_KEY_PREFIX}${eventId}_${email.toLowerCase().trim()}`
}

export function saveDraft(eventId: string, email: string, data: Omit<DraftData, 'v'>): void {
  try {
    localStorage.setItem(draftKey(eventId, email), JSON.stringify({ ...data, v: DRAFT_VERSION }))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function loadDraft(eventId: string, email: string): DraftData | null {
  try {
    const raw = localStorage.getItem(draftKey(eventId, email))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftData
    if (parsed.v !== DRAFT_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function clearDraft(eventId: string, email: string): void {
  try {
    localStorage.removeItem(draftKey(eventId, email))
  } catch {
    // noop
  }
}

// Wipes every apply-form draft on this device. Called on sign-out so nothing
// lingers on a shared/public device once the student signs out.
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // noop
  }
}
