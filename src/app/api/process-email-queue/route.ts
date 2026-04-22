import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { buildRawEmail, sanitiseAttachments } from '@/lib/email-mime'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60  // seconds — enough to send a full batch of 50

// ---------------------------------------------------------------------------
// Email queue worker.
//
// Called every minute by Supabase pg_cron. Claims up to BATCH_SIZE rows from
// email_outbox (via claim_email_batch SQL function, which uses FOR UPDATE
// SKIP LOCKED so parallel workers never double-send), sends each via Gmail
// API, and writes the permanent record to email_log. Transient failures are
// retried with exponential backoff; permanent failures are recorded.
//
// Environment variables:
//   GMAIL_CLIENT_ID           — (existing) Google OAuth2 client
//   GMAIL_CLIENT_SECRET       — (existing)
//   GMAIL_REFRESH_TOKEN       — (existing) offline refresh token for hello@
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS; queue access)
//   EMAIL_QUEUE_CRON_SECRET   — shared secret checked against x-cron-secret
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50
const FROM_EMAIL = 'events@thestepsfoundation.com'

type OutboxRow = {
  id: string
  event_id: string | null
  application_id: string | null
  student_id: string | null
  template_id: string | null
  to_email: string
  subject: string
  body_html: string
  status: string
  attempts: number
  max_attempts: number
  queued_by: string | null
  attachments: unknown
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth credentials not configured')
  }
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground',
  )
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  return oauth2Client
}

/**
 * Classify an error to decide retry strategy.
 * Transient (retriable): 429 rate limit, 5xx, network, timeout.
 * Permanent (no retry): 400 bad email, 403 forbidden, auth failure.
 */
function isTransientError(err: any): boolean {
  const code = err?.code ?? err?.response?.status
  if (code === 429) return true
  if (code >= 500 && code < 600) return true
  const msg = String(err?.message ?? '').toLowerCase()
  if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('etimedout')) return true
  return false
}

/** Exponential backoff in minutes, capped. attempts=1 → 1min, 2 → 4min, 3 → 9min. */
function backoffMinutes(attempts: number): number {
  return Math.min(attempts * attempts, 30)
}

export async function POST(req: NextRequest) {
  // Auth gate — only pg_cron (holding the shared secret) can trigger a run
  const secret = req.headers.get('x-cron-secret')
  const expected = process.env.EMAIL_QUEUE_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'EMAIL_QUEUE_CRON_SECRET not configured' }, { status: 500 })
  }
  if (secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()

  // Safety net: anything stuck in 'sending' for >15min gets reset to 'queued'
  await supabase.rpc('recover_stuck_email_sends')

  // Claim a batch
  const { data: batch, error: claimErr } = await supabase
    .rpc('claim_email_batch', { p_limit: BATCH_SIZE })
  if (claimErr) {
    console.error('claim_email_batch error:', claimErr)
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }

  const rows = (batch ?? []) as OutboxRow[]
  if (rows.length === 0) {
    return NextResponse.json({ claimed: 0, sent: 0, failed: 0, retried: 0 })
  }

  let auth
  try {
    auth = getOAuth2Client()
  } catch (err: any) {
    // No creds — release the batch back to queued and bail
    await supabase.from('email_outbox')
      .update({ status: 'queued', last_error: `Gmail auth not configured: ${err.message}` })
      .in('id', rows.map(r => r.id))
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
  const gmail = google.gmail({ version: 'v1', auth })

  const now = new Date().toISOString()
  let sent = 0, failed = 0, retried = 0

  // Send in-flight; small concurrency to be kind to Gmail's per-sender quota.
  // Gmail's burst cap is ~20-50 sends/sec for Workspace, but 429s kick in fast.
  // Serial within a batch + BATCH_SIZE=50 per minute = 50/min cruise.
  for (const row of rows) {
    try {
      const raw = await buildRawEmail({
        to: row.to_email,
        subject: row.subject,
        htmlBody: row.body_html,
        attachments: sanitiseAttachments(row.attachments),
        unsubscribeUrl: row.student_id ? buildUnsubscribeUrl(row.student_id) : undefined,
      })
      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })

      // Write the permanent email_log entry
      let emailLogId: string | null = null
      if (row.student_id) {
        const { data: logRow } = await supabase.from('email_log').insert({
          student_id: row.student_id,
          event_id: row.event_id,
          template_id: row.template_id,
          to_email: row.to_email,
          from_email: FROM_EMAIL,
          subject: row.subject,
          body_html: row.body_html,
          status: 'sent',
          gmail_message_id: result.data.id ?? null,
          sent_at: now,
          sent_by: row.queued_by,
        }).select('id').single()
        emailLogId = logRow?.id ?? null
      }

      await supabase.from('email_outbox').update({
        status: 'sent',
        sent_at: now,
        gmail_message_id: result.data.id ?? null,
        email_log_id: emailLogId,
        last_error: null,
      }).eq('id', row.id)

      sent++
    } catch (err: any) {
      const msg = String(err?.message ?? 'Unknown send error').slice(0, 1000)
      const transient = isTransientError(err)
      const canRetry = transient && row.attempts < row.max_attempts

      if (canRetry) {
        const nextAt = new Date(Date.now() + backoffMinutes(row.attempts) * 60_000).toISOString()
        await supabase.from('email_outbox').update({
          status: 'queued',
          next_attempt_at: nextAt,
          last_error: msg,
        }).eq('id', row.id)
        retried++
      } else {
        // Permanent failure — log it so there's a trail
        if (row.student_id) {
          await supabase.from('email_log').insert({
            student_id: row.student_id,
            event_id: row.event_id,
            template_id: row.template_id,
            to_email: row.to_email,
            from_email: FROM_EMAIL,
            subject: row.subject,
            body_html: row.body_html,
            status: 'failed',
            error_message: msg,
            sent_by: row.queued_by,
          })
        }
        await supabase.from('email_outbox').update({
          status: 'failed',
          last_error: msg,
        }).eq('id', row.id)
        failed++
      }
    }
  }

  return NextResponse.json({
    claimed: rows.length,
    sent,
    failed,
    retried,
  })
}

// GET: read-only health check / stats
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.EMAIL_QUEUE_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = getServiceClient()
  const { data } = await supabase.from('email_outbox')
    .select('status', { count: 'exact' })
  // quick tally
  const tally: Record<string, number> = {}
  for (const r of data ?? []) tally[r.status] = (tally[r.status] ?? 0) + 1
  return NextResponse.json({ tally })
}
