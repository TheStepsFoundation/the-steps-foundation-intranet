import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { buildRawEmail, sanitiseAttachments } from '@/lib/email-mime'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe-token'

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
    const { to, subject, html, attachments, studentId } = body as {
      to?: string
      subject?: string
      html?: string
      attachments?: unknown
      studentId?: string
    }

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      )
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
