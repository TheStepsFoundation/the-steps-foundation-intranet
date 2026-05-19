import { supabase } from './supabase'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// app_settings store — key/JSONB rows surfaced via the admin /settings page.
//
// Each setting has:
//   • a canonical key (the SETTINGS_KEYS constants below)
//   • a TypeScript type the value is shaped as
//   • a fallback default used when the row is missing (so emptying the table
//     doesn't break the app)
//
// Reads from client code use the regular admin-bound supabase client (RLS
// allows admin SELECT). Reads from server-only code (queue worker, send-email
// route) should use the service-role client so they work without an auth
// session.
// ---------------------------------------------------------------------------

export const SETTINGS_KEYS = {
  signatureHtml: 'brand.signature_html',
  fromEmail: 'brand.from_email',
  fromName: 'brand.from_name',
  replyToEmail: 'brand.reply_to_email',
  marketingCap24h: 'send.marketing_cap_24h',
  eventOptoutScope: 'send.event_optout_scope', // 'all' | 'marketing_only'
  defaultEligibleYearGroups: 'events.default_eligible_year_groups',
  defaultApplicationsOpenLeadDays: 'events.default_applications_open_lead_days',
  minCustomQuestions: 'events.min_custom_questions',
  studentDashboardPageSize: 'students.dashboard_page_size',
  enabledAutomationTypes: 'events.enabled_automation_types',
  publishRequiredFields: 'events.publish_required_fields',
} as const

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS]

// ---- Defaults — used when the DB row is missing -------------------------

export const SETTINGS_DEFAULTS = {
  fromEmail: 'events@thestepsfoundation.com',
  fromName: 'Events - The Steps Foundation',
  replyToEmail: 'events@thestepsfoundation.com',
  marketingCap24h: 1700,
  eventOptoutScope: 'all' as 'all' | 'marketing_only',
  defaultEligibleYearGroups: [12, 13] as number[],
  defaultApplicationsOpenLeadDays: 14,
  minCustomQuestions: 3,
  studentDashboardPageSize: 100,
  enabledAutomationTypes: [
    'rsvp_reminder',
    'event_day_rsvped',
    'event_day_no_rsvp',
    'post_event_feedback',
    'applications_closing',
    'application_draft_stale',
  ] as string[],
  publishRequiredFields: [
    'name',
    'slug',
    'event_date',
    'time_start',
    'time_end',
    'location',
    'format',
    'capacity',
    'description',
    'applications_open_at',
    'applications_close_at',
    'banner_image_url',
    'hub_image_url',
  ] as string[],
} as const

// ---- Client-side helpers (admin-only via RLS) ---------------------------

export async function fetchAllSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('app_settings').select('key, value')
  if (error) {
    console.warn('[settings] fetchAll error:', error.message)
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    out[row.key] = row.value
  }
  return out
}

export async function setSetting(key: string, value: unknown): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { error: error.message }
  return { error: null }
}

// ---- Server-side helper (service role) ----------------------------------
//
// Used by routes that don't have an auth session (queue worker etc.).
// Returns a Map for cheap per-request reads when multiple keys are needed.

export async function fetchSettingsServer(): Promise<Map<string, unknown>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return new Map()
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.from('app_settings').select('key, value')
  if (error) {
    console.warn('[settings] fetchSettingsServer error:', error.message)
    return new Map()
  }
  const m = new Map<string, unknown>()
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    m.set(row.key, row.value)
  }
  return m
}

// Convenience getters with type-narrowing + defaults built in.
export function getString(settings: Map<string, unknown>, key: string, fallback: string): string {
  const v = settings.get(key)
  return (typeof v === 'string' && v.length > 0) ? v : fallback
}
export function getNumber(settings: Map<string, unknown>, key: string, fallback: number): number {
  const v = settings.get(key)
  return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback
}
export function getStringEnum<T extends string>(settings: Map<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const v = settings.get(key)
  return (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? v as T : fallback
}
export function getNumberArray(settings: Map<string, unknown>, key: string, fallback: number[]): number[] {
  const v = settings.get(key)
  if (Array.isArray(v) && v.every(n => typeof n === 'number')) return v as number[]
  return fallback
}
