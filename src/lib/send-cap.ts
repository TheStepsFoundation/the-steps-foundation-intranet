// ---------------------------------------------------------------------------
// Daily marketing-email send cap.
//
// Google Workspace Business standard-tier allows 2,000 external recipients
// per rolling 24 hours. Going over that silently bounces messages. We cap
// intranet *marketing* sends (invite modal batches) at 1,700/24h so:
//
//   - ~300 headroom is preserved for transactional flows (event decision
//     emails, 6-digit codes — though OTPs go via Supabase Auth and don't
//     actually count toward Gmail's quota) and Favour's manual hello@
//     sends (~4/day based on current activity).
//
// The counter is the `email_log` table — every invite-modal send logs a
// row with status transitioning pending → sent|failed. We count status
// 'sent' in the last 24h (rolling, NOT calendar-day).
//
// Transactional event-dashboard emails (accept/reject/RSVP) go via
// `email_outbox` → /api/process-email-queue, NOT this path, and are not
// subject to the cap. They still consume Gmail's 2,000 ceiling, which is
// what the 300-email buffer protects.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

export const MARKETING_CAP_24H = 1700

export type CapStatus = {
  used: number
  remaining: number
  cap: number
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
    // The UI will show "(count unavailable)" and the hard ceiling is still
    // Gmail's 2,000 so we don't lose data integrity by soft-failing here.
    console.warn('[send-cap] email_log count failed:', error.message)
    return 0
  }
  return count ?? 0
}

export async function getCapStatus(sb: SupabaseClient): Promise<CapStatus> {
  const used = await getMarketing24hCount(sb)
  return {
    used,
    remaining: Math.max(0, MARKETING_CAP_24H - used),
    cap: MARKETING_CAP_24H,
  }
}
