import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { buildRawEmail, sanitiseAttachments } from '@/lib/email-mime'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe-token'
import { createClient } from '@supabase/supabase-js'
import { getMarketing24hCount, MARKETING_CAP_24H } from '@/lib/send-cap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Gmail API route — sends individual emails via the hello@ Workspace account
// using the events@ alias as the From address. Attachments (if any) travel
// as multipart/mixed parts; the MIME builder lives in @/lib/email-mime so
// both this route and the queue worker stay byte-compatible.
//
// Environment variables required (set in Vercel):
//   GMAIL_CLIENT_ID       — Google Cloud OAuth2 client ID
//   GMAIL_CLIENT_SECRET   — Google Cloud OAuth2 client secret
//   GMAIL_REFRESH_TOKEN   — Offline refresh token for hello@thestepsfoundation.com
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth credentials not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Vercel environment variables.')
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground')
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  return oauth2Client
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { to, subject, html, attachments, studentId, kind } = body as {
      to?: string
      subject?: string
      html?: string
      attachments?: unknown
      studentId?: string
      kind?: 'marketing' | 'transactional'
    }

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      )
    }

    // ---------------------------------------------------------------------
    // Safety net: if this is a marketing send and we have a studentId,
    // refuse to send to someone who has unsubscribed. The invite modal
    // already filters at recipient selection, but we guard server-side too
    // so a stale client-side list (or direct API misuse) can't leak.
    //
    // Transactional sends (kind === 'transactional') bypass the check —
    // e.g. event decision emails where the recipient deserves the reply
    // regardless of their newsletter preference.
    // ---------------------------------------------------------------------
    if (kind !== 'transactional') {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && serviceKey) {
        const sb = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })

        // Unsubscribe check (per-recipient)
        if (studentId) {
          const { data: s } = await sb
            .from('students')
            .select('subscribed_to_mailing')
            .eq('id', studentId)
            .maybeSingle()
          if (s && s.subscribed_to_mailing === false) {
            return NextResponse.json(
              { error: 'Recipient has unsubscribed from the mailing list.', skipped: true },
              { status: 409 }
            )
          }
        }

        // Rolling-24h marketing cap (global)
        const used = await getMarketing24hCount(sb)
        if (used >= MARKETING_CAP_24H) {
          return NextResponse.json(
            {
              error: `Daily marketing cap reached (${used}/${MARKETING_CAP_24H} sent in last 24h). Try again later — the window is rolling, not midnight-based.`,
              capReached: true,
              used,
              cap: MARKETING_CAP_24H,
            },
            { status: 429 }
          )
        }
      }
    }


    const auth = getOAuth2Client()
    const gmail = google.gmail({ version: 'v1', auth })

    const raw = await buildRawEmail({
      to,
      subject,
      htmlBody: html,
      attachments: sanitiseAttachments(attachments),
      unsubscribeUrl: studentId ? buildUnsubscribeUrl(studentId) : undefined,
    })

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    })

    return NextResponse.json({
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('send-email error:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
