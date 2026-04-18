import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Gmail API route — sends individual emails via the hello@ Workspace account
// using the events@ alias as the From address.
//
// Environment variables required (set in Vercel):
//   GMAIL_CLIENT_ID      — Google Cloud OAuth2 client ID
//   GMAIL_CLIENT_SECRET   — Google Cloud OAuth2 client secret
//   GMAIL_REFRESH_TOKEN   — Offline refresh token for hello@thestepsfoundation.com
// ---------------------------------------------------------------------------

const FROM_EMAIL = 'events@thestepsfoundation.com'
const FROM_NAME = 'Events - The Steps Foundation'

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

function buildRawEmail(to: string, subject: string, htmlBody: string): string {
  const boundary = `boundary_${Date.now()}`
  const fromHeader = `${FROM_NAME} <${FROM_EMAIL}>`

  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody.replace(/<[^>]+>/g, '')).toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64'),
    '',
    `--${boundary}--`,
  ]

  const raw = lines.join('\r\n')
  // Gmail API expects URL-safe base64
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { to, subject, html } = body as {
      to?: string
      subject?: string
      html?: string
    }

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      )
    }

    const auth = getOAuth2Client()
    const gmail = google.gmail({ version: 'v1', auth })

    const raw = buildRawEmail(to, subject, html)

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
