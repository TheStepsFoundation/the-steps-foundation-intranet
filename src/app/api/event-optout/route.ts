import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyEventOptoutToken } from '@/lib/event-optout-token'
import { fetchSettingsServer, SETTINGS_KEYS, SETTINGS_DEFAULTS, getString } from '@/lib/settings-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Per-event email opt-out endpoint.
//
// Recipient clicks {{event_optout_link}} in an invite email → land on a
// confirmation page naming the event ("Opt out of further emails about
// Step Inside: Man Group?"). Single confirm button POSTs back; we INSERT
// a row into event_email_optouts. From then on the queue worker skips any
// send where (student_id, event_id) matches.
//
// Idempotent: a second click after opting out renders the confirmed page.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Lookup = {
  studentId: string
  eventId: string
  eventName: string | null
  eventSlug: string | null
  studentFirstName: string | null
  alreadyOptedOut: boolean
}

async function lookup(studentId: string, eventId: string): Promise<{ ok: true; data: Lookup } | { ok: false; error: string }> {
  const sb = getServiceClient()
  const [{ data: student, error: sErr }, { data: ev, error: eErr }, { data: existing }] = await Promise.all([
    sb.from('students').select('first_name, preferred_name').eq('id', studentId).maybeSingle(),
    sb.from('events').select('name, slug').eq('id', eventId).maybeSingle(),
    sb.from('event_email_optouts').select('opted_out_at').eq('student_id', studentId).eq('event_id', eventId).maybeSingle(),
  ])
  if (sErr) return { ok: false, error: sErr.message }
  if (eErr) return { ok: false, error: eErr.message }
  if (!student) return { ok: false, error: 'Student not found' }
  if (!ev) return { ok: false, error: 'Event not found' }
  const firstName = (student.preferred_name && String(student.preferred_name).trim()) ? student.preferred_name : student.first_name
  return {
    ok: true,
    data: {
      studentId,
      eventId,
      eventName: ev.name ?? null,
      eventSlug: ev.slug ?? null,
      studentFirstName: firstName ?? null,
      alreadyOptedOut: !!existing,
    },
  }
}

async function applyOptout(studentId: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient()
  // Idempotent: PRIMARY KEY (student_id, event_id) makes the second click
  // a no-op via ON CONFLICT.
  const { error } = await sb
    .from('event_email_optouts')
    .upsert({ student_id: studentId, event_id: eventId, source: 'email_link' }, { onConflict: 'student_id,event_id' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} — The Steps Foundation</title>
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

function renderConfirmPage(token: string, lk: Lookup, promptCopy: string): string {
  const greeting = lk.studentFirstName ? `Hi ${escapeHtml(lk.studentFirstName)},` : 'Hi,'
  const eventName = lk.eventName ? escapeHtml(lk.eventName) : 'this event'
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#111">Opt out of emails about ${eventName}?</h1>
    <p style="margin:0 0 8px 0;color:#555">${greeting}</p>
    <p style="margin:0 0 16px 0;color:#555">${escapeHtml(promptCopy)}</p>
    <p style="margin:0 0 24px 0;color:#777;font-size:13px">You'll stay on the general Steps Foundation mailing list and continue to get invites to other events.</p>
    <form method="POST" action="/api/event-optout?token=${encodeURIComponent(token)}" style="margin:0">
      <button type="submit" style="background:#111;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">Yes, opt me out of ${eventName}</button>
    </form>
    <p style="margin:24px 0 0 0;color:#777;font-size:13px">Changed your mind? Just close this tab — nothing has changed yet.</p>`
  return shell(`Opt out of ${lk.eventName ?? 'event'}`, body)
}

function renderConfirmedPage(lk: Lookup): string {
  const eventName = lk.eventName ? escapeHtml(lk.eventName) : 'the event'
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#111">You're opted out of ${eventName}</h1>
    <p style="margin:0 0 16px 0;color:#555">We won't email you again about <strong>${eventName}</strong>. Thanks for letting us know.</p>
    <p style="margin:0 0 24px 0;color:#555">You're still on the general Steps Foundation mailing list — you'll keep getting invites to other events and our newsletter.</p>
    <p style="margin:24px 0 0 0;color:#777;font-size:13px">— <i>Virtus, non Origo.</i></p>`
  return shell(`Opted out of ${lk.eventName ?? 'event'}`, body)
}

function renderErrorPage(message: string): string {
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#b91c1c">Something went wrong</h1>
    <p style="margin:0 0 16px 0;color:#555">${escapeHtml(message)}</p>
    <p style="margin:0;color:#555">If this keeps happening, email <a href="mailto:hello@thestepsfoundation.com" style="color:#1e40af">hello@thestepsfoundation.com</a> and we'll opt you out manually.</p>`
  return shell('Opt out', body)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyEventOptoutToken(token)
  if (!verified.ok) {
    return new NextResponse(renderErrorPage(`Invalid or expired opt-out link (${verified.reason}).`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const lk = await lookup(verified.studentId, verified.eventId)
  if (!lk.ok) {
    return new NextResponse(renderErrorPage(lk.error), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if (lk.data.alreadyOptedOut) {
    return new NextResponse(renderConfirmedPage(lk.data), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const settings = await fetchSettingsServer()
  const tpl = getString(settings, SETTINGS_KEYS.copyEventOptoutConfirm, SETTINGS_DEFAULTS.copyEventOptoutConfirm)
  const promptCopy = tpl
    .replace(/\{\{event_name\}\}/g, lk.data.eventName ?? 'this event')
    .replace(/\{\{first_name\}\}/g, lk.data.studentFirstName ?? '')
  return new NextResponse(renderConfirmPage(token!, lk.data, promptCopy), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyEventOptoutToken(token)
  if (!verified.ok) {
    return new NextResponse(renderErrorPage(`Invalid or expired opt-out link (${verified.reason}).`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const lk = await lookup(verified.studentId, verified.eventId)
  if (!lk.ok) {
    return new NextResponse(renderErrorPage(lk.error), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if (!lk.data.alreadyOptedOut) {
    const res = await applyOptout(verified.studentId, verified.eventId)
    if (!res.ok) {
      return new NextResponse(renderErrorPage(res.error ?? 'Could not apply your opt-out'), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
  }
  return new NextResponse(renderConfirmedPage(lk.data), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
