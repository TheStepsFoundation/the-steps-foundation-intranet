import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyWithdrawToken } from '@/lib/withdraw-token'
import { fetchSettingsServer, SETTINGS_KEYS, SETTINGS_DEFAULTS, getString } from '@/lib/settings-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Public withdraw endpoint.
//
// Mirrors /api/unsubscribe — the link in event emails points here; the
// recipient lands on a confirmation page (so email security scanners that
// prefetch links don't accidentally withdraw anyone), then clicks "Confirm
// withdrawal" which POSTs the same token back.
//
//   GET  /api/withdraw?token=...   — render confirmation page with event
//                                    details + a single confirm button.
//   POST /api/withdraw?token=...   — perform the withdrawal: set
//                                    status='withdrew' + deleted_at = now()
//                                    so the student can re-apply later.
//                                    Re-renders the page as confirmed
//                                    with a "re-apply" link.
//
// Idempotent: clicking the link twice (or revisiting the email after
// already withdrawing) shows "Already withdrawn" + the re-apply link.
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type AppLookup = {
  applicationId: string
  studentId: string | null
  eventId: string | null
  eventName: string | null
  eventSlug: string | null
  eventDate: string | null
  studentFirstName: string | null
  status: string | null
  deletedAt: string | null
}

async function lookupApplication(applicationId: string): Promise<{ ok: true; data: AppLookup } | { ok: false; error: string }> {
  const sb = getServiceClient()
  // Service-role read — bypasses RLS, but we only return safe presentation
  // fields. We deliberately read soft-deleted rows too so the "already
  // withdrawn" path works.
  const { data, error } = await sb
    .from('applications')
    .select('id, student_id, event_id, status, deleted_at, students:student_id(first_name, preferred_name), events:event_id(name, slug, event_date)')
    .eq('id', applicationId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Application not found' }
  const student = (data as any).students ?? null
  const ev = (data as any).events ?? null
  return {
    ok: true,
    data: {
      applicationId: data.id as string,
      studentId: (data.student_id as string | null) ?? null,
      eventId: (data.event_id as string | null) ?? null,
      eventName: ev?.name ?? null,
      eventSlug: ev?.slug ?? null,
      eventDate: ev?.event_date ?? null,
      studentFirstName: (student?.preferred_name && String(student.preferred_name).trim()) ? student.preferred_name : (student?.first_name ?? null),
      status: (data.status as string | null) ?? null,
      deletedAt: (data.deleted_at as string | null) ?? null,
    },
  }
}

/**
 * Resolve the "operative" application for a withdraw link click.
 *
 * The token is HMAC-signed over a specific application_id, but tying the
 * action to that exact row breaks re-applicants: after a withdraw + re-
 * apply cycle a NEW application row exists, and the token still points at
 * the old (soft-deleted) one. The student would see "you've already
 * withdrawn" while their fresh application is sitting there untouched.
 *
 * Fix: use the token only to identify *who* the student is and *which*
 * event this is about — then find the current live application for that
 * (student, event) pair. If there isn't one, fall back to the token's
 * own application so the "already withdrawn + re-apply" page still works.
 *
 * Security: the token already authorises operations on this student's
 * application for this event. Letting it follow a re-applied row doesn't
 * widen the blast radius — same student, same event, just a newer row.
 */
async function resolveOperativeApplication(tokenApplicationId: string): Promise<{ ok: true; data: AppLookup } | { ok: false; error: string }> {
  const tokenLookup = await lookupApplication(tokenApplicationId)
  if (!tokenLookup.ok) return tokenLookup
  const { studentId, eventId } = tokenLookup.data
  if (!studentId || !eventId) return tokenLookup
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // Fall back to the token's row rather than failing — the worst case
    // is the legacy "already withdrawn" experience, not a hard error.
    console.warn('[withdraw] resolve fallback:', error.message)
    return tokenLookup
  }
  if (!data?.id || data.id === tokenApplicationId) return tokenLookup
  // A different live application exists for the same (student, event) —
  // that's the one the email-link should act on now.
  return lookupApplication(data.id as string)
}

async function applyWithdraw(applicationId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient()
  const nowIso = new Date().toISOString()
  // Under the one-row-per-student-event model the row stays live; status is
  // the sole signal. Filter on `deleted_at IS NULL` so admin-soft-deleted
  // rows (rare escape hatch for erroneous submissions) aren't resurrected.
  // status != 'withdrew' makes the call idempotent.
  const { error } = await sb
    .from('applications')
    .update({
      status: 'withdrew',
      updated_at: nowIso,
    } as any)
    .eq('id', applicationId)
    .is('deleted_at', null)
    .neq('status', 'withdrew')
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function eventDateLabel(date: string | null): string {
  if (!date) return ''
  try {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '' }
}

function shellHtml(title: string, body: string): string {
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

function renderConfirmPage(token: string, lookup: AppLookup, promptCopy: string): string {
  const greeting = lookup.studentFirstName ? `Hi ${escapeHtml(lookup.studentFirstName)},` : 'Hi,'
  const eventName = lookup.eventName ? escapeHtml(lookup.eventName) : 'this event'
  const dateLine = lookup.eventDate ? `<p style="margin:0 0 16px 0;color:#555">Event date: <strong>${escapeHtml(eventDateLabel(lookup.eventDate))}</strong></p>` : ''
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#111">Withdraw your application?</h1>
    <p style="margin:0 0 8px 0;color:#555">${greeting}</p>
    <p style="margin:0 0 16px 0;color:#555">${escapeHtml(promptCopy)}</p>
    ${dateLine}
    <form method="POST" action="/api/withdraw?token=${encodeURIComponent(token)}" style="margin:24px 0 0 0">
      <button type="submit" style="background:#111;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">Yes, withdraw my application</button>
    </form>
    <p style="margin:24px 0 0 0;color:#777;font-size:13px">Changed your mind? Just close this tab — nothing has changed yet.</p>`
  return shellHtml('Withdraw application', body)
}

function renderConfirmedPage(lookup: AppLookup): string {
  const eventName = lookup.eventName ? escapeHtml(lookup.eventName) : 'the event'
  const reapplyUrl = lookup.eventSlug ? `https://the-steps-foundation-intranet.vercel.app/apply/${encodeURIComponent(lookup.eventSlug)}` : 'https://the-steps-foundation-intranet.vercel.app/my'
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#111">You're withdrawn</h1>
    <p style="margin:0 0 16px 0;color:#555">Your application to <strong>${eventName}</strong> has been withdrawn. Thanks for letting us know.</p>
    <p style="margin:0 0 24px 0;color:#555">Changed your mind, or did you click this by mistake? You can re-apply and we'll bring back the answers you gave the first time so you don't have to start over.</p>
    <a href="${reapplyUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600">Re-apply to ${eventName}</a>
    <p style="margin:24px 0 0 0;color:#777;font-size:13px">— <i>Virtus, non Origo.</i></p>`
  return shellHtml('Application withdrawn', body)
}

function renderErrorPage(message: string): string {
  const body = `
    <h1 style="margin:0 0 12px 0;font-size:24px;color:#b91c1c">Something went wrong</h1>
    <p style="margin:0 0 16px 0;color:#555">${escapeHtml(message)}</p>
    <p style="margin:0;color:#555">If this keeps happening, email <a href="mailto:hello@thestepsfoundation.com" style="color:#1e40af">hello@thestepsfoundation.com</a> and we'll withdraw you manually.</p>`
  return shellHtml('Withdraw application', body)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyWithdrawToken(token)
  if (!verified.ok) {
    return new NextResponse(renderErrorPage(`Invalid or expired withdraw link (${verified.reason}).`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const lookup = await resolveOperativeApplication(verified.applicationId)
  if (!lookup.ok) {
    return new NextResponse(renderErrorPage(lookup.error), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  // Already withdrawn — go straight to the confirmed page (still safe,
  // shows the re-apply link). Note `lookup` here is the *resolved*
  // application: if the student re-applied since the email was sent,
  // it's the current live row, not the original withdrew one.
  if (lookup.data.deletedAt || lookup.data.status === 'withdrew') {
    return new NextResponse(renderConfirmedPage(lookup.data), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const settings = await fetchSettingsServer()
  const tpl = getString(settings, SETTINGS_KEYS.copyWithdrawConfirm, SETTINGS_DEFAULTS.copyWithdrawConfirm)
  const promptCopy = tpl
    .replace(/\{\{event_name\}\}/g, lookup.data.eventName ?? 'this event')
    .replace(/\{\{first_name\}\}/g, lookup.data.studentFirstName ?? '')
  return new NextResponse(renderConfirmPage(token!, lookup.data, promptCopy), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const verified = verifyWithdrawToken(token)
  if (!verified.ok) {
    return new NextResponse(renderErrorPage(`Invalid or expired withdraw link (${verified.reason}).`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const lookup = await resolveOperativeApplication(verified.applicationId)
  if (!lookup.ok) {
    return new NextResponse(renderErrorPage(lookup.error), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  // Already withdrawn — render confirmed without touching the row. The
  // resolved application is the *current* state for this (student, event):
  // if the student re-applied, we act on the new row; if they didn't, we
  // see the original withdrew row and show the re-apply page.
  const operativeId = lookup.data.applicationId
  if (!(lookup.data.deletedAt || lookup.data.status === 'withdrew')) {
    const res = await applyWithdraw(operativeId)
    if (!res.ok) {
      return new NextResponse(renderErrorPage(res.error ?? 'Could not withdraw your application'), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    // Log the transition for the activity timeline, mirroring the bulk
    // status-change flow in students/events/[id]/page.tsx. Best-effort —
    // we don't fail the user-facing withdrawal if this insert errors.
    try {
      const sb = getServiceClient()
      await sb.from('application_status_history').insert({
        application_id: operativeId,
        old_status: lookup.data.status,
        new_status: 'withdrew',
        changed_by: null, // student-initiated via email link
      } as any)
    } catch (e) {
      console.warn('[withdraw] failed to write status history:', e)
    }
  }
  // Re-fetch the *operative* row so the confirmed page reflects the row
  // we just touched (and so eventSlug is populated for re-apply).
  const after = await lookupApplication(operativeId)
  const display = after.ok ? after.data : lookup.data
  return new NextResponse(renderConfirmedPage(display), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
