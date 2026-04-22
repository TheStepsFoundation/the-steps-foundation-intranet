import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Public unsubscribe endpoint.
//
// Two entry points:
//   GET  /api/unsubscribe?token=...   — user clicks the footer link in their
//                                        email; we render a confirmation HTML
//                                        page and flip subscribed_to_mailing.
//   POST /api/unsubscribe?token=...   — Gmail/Yahoo "one-click" unsubscribe
//                                        per RFC 8058. Body is
//                                        `List-Unsubscribe=One-Click`;
//                                        we return 200 and flip the flag.
//
// The token is an HMAC-signed student_id (see lib/unsubscribe-token.ts); no
// DB lookup is needed to verify it, so even a stale token from a two-year-
// old newsletter still works.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function applyUnsubscribe(studentId: string): Promise<{ ok: boolean; email: string | null; error?: string }> {
  const sb = getServiceClient()
  // Idempotent: if already unsubscribed, the second call is a no-op at DB
  // level (update is a no-op when values match) but still 200 to the caller.
  const { data, error } = await sb
    .from('students')
    .update({ subscribed_to_mailing: false })
    .eq('id', studentId)
    .select('personal_email')
    .maybeSingle()
  if (error) return { ok: false, email: null, error: error.message }
  return { ok: true, email: data?.personal_email ?? null }
}

function renderConfirmationHtml(email: string | null, error: string | null): string {
  const body = error
    ? `<h1 style="margin:0 0 12px 0;font-size:24px;color:#b91c1c">Something went wrong</h1>
       <p style="margin:0 0 16px 0;color:#555">${escapeHtml(error)}</p>
       <p style="margin:0;color:#555">If this keeps happening, email <a href="mailto:hello@thestepsfoundation.com" style="color:#1e40af">hello@thestepsfoundation.com</a> and we'll remove you manually.</p>`
    : `<h1 style="margin:0 0 12px 0;font-size:24px;color:#111">You're unsubscribed</h1>
       <p style="margin:0 0 16px 0;color:#555">${email ? `<strong>${escapeHtml(email)}</strong> has been removed` : 'You have been removed'} from The Steps Foundation mailing list. You won't receive any further event invites or newsletters.</p>
       <p style="margin:0 0 16px 0;color:#555">If this was a mistake, reply to any previous email from us and we'll put you back on.</p>
       <p style="margin:0;color:#555">— <i>Virtus, non Origo.</i></p>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Unsubscribe — The Steps Foundation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
</head>
<body style="margin:0;padding:48px 16px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111;line-height:1.5">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <img src="https://the-steps-foundation-intranet.vercel.app/tsf-logo.png" width="64" height="64" alt="The Steps Foundation" style="display:block;margin:0 0 24px 0">
    ${body}
  </div>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) {
    return new NextResponse(renderConfirmationHtml(null, `Invalid or expired unsubscribe link (${verified.reason}).`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const result = await applyUnsubscribe(verified.studentId)
  return new NextResponse(renderConfirmationHtml(result.email, result.ok ? null : (result.error ?? 'Could not update your preferences')), {
    status: result.ok ? 200 : 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: NextRequest) {
  // Gmail/Yahoo one-click POSTs token in the query string (RFC 8058).
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) {
    return NextResponse.json({ error: `invalid token: ${verified.reason}` }, { status: 400 })
  }
  const result = await applyUnsubscribe(verified.studentId)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
