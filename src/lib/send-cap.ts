// ---------------------------------------------------------------------------
// Daily marketing-email send cap.
//
// Google Workspace Business standard-tier allows 2,000 external recipients
// per rolling 24 hours. Going over that silently bounces messages. We cap
// intranet *marketing* sends (invite modal batches) at MARKETING_CAP_24H so
// some headroom is preserved for transactional flows (event decision
// emails, 6-digit codes — though OTPs go via Supabase Auth and don't
// actually count toward Gmail's quota) and Favour's manual hello@ sends.
//
// The cap is now editable from /students/settings (Send behaviour tab).
// Reads at request time via resolveMarketingCap(), with the constant
// fallback below as a safety net if app_settings is unreachable.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSettingsServer, SETTINGS_KEYS, SETTINGS_DEFAULTS } from './settings-api'

/**
 * Hard fallback used only when app_settings is unreadable. Kept exported
 * so any legacy import sites continue to compile; new callers should use
 * resolveMarketingCap() instead.
 */
export const MARKETING_CAP_24H = SETTINGS_DEFAULTS.marketingCap24h

export type CapStatus = {
  used: number
  remaining: number
  cap: number
}

/** Read the current cap from app_settings, falling back to the constant. */
export async function resolveMarketingCap(): Promise<number> {
  try {
    const settings = await fetchSettingsServer()
    const v = settings.get(SETTINGS_KEYS.marketingCap24h)
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  } catch (e: any) {
    console.warn('[send-cap] resolveMarketingCap failed, falling back:', e?.message)
  }
  return MARKETING_CAP_24H
}

export async function getMarketing24hCount(sb: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await sb
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', since)
  if (error) {
    // Fail-open — we'd rather let the send through than block on a read error.
    console.warn('[send-cap] email_log count failed:', error.message)
    return 0
  }
  return count ?? 0
}

export async function getCapStatus(sb: SupabaseClient): Promise<CapStatus> {
  const [used, cap] = await Promise.all([
    getMarketing24hCount(sb),
    resolveMarketingCap(),
  ])
  return {
    used,
    remaining: Math.max(0, cap - used),
    cap,
  }
}
