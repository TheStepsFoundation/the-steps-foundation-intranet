import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Booking write proxy — POST /api/booking
//
// Takes { bookerId, startIso, name?, email? } from the public /book page,
// injects the server-side BOOKING_API_TOKEN (never trust a client token),
// forwards to the Apps Script backend, and returns its JSON verbatim.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const base = process.env.BOOKING_API_URL
  const token = process.env.BOOKING_API_TOKEN
  if (!base || !token) {
    return NextResponse.json(
      { ok: false, error: 'Booking is not configured yet. Please try again later.' },
      { status: 503 },
    )
  }

  let body: { bookerId?: string; startIso?: string; name?: string; email?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  // Only forward the fields the backend expects; inject the token server-side.
  const payload: Record<string, unknown> = {
    token,
    bookerId: body.bookerId,
    startIso: body.startIso,
  }
  if (body.name) payload.name = body.name
  if (body.email) payload.email = body.email

  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      redirect: 'follow',
    })
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Booking backend is unavailable. Please try again shortly.' },
        { status: 502 },
      )
    }
    // Return the backend's shape verbatim (ok:true with details, or ok:false
    // with a friendly message like "someone just booked that slot").
    return NextResponse.json(parsed)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Booking failed.' },
      { status: 502 },
    )
  }
}
