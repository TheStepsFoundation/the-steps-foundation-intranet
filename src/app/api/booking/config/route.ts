import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Booking config proxy — GET /api/booking/config
//
// Fetches the Steps booking backend (a Google Apps Script web app running as
// hello@thestepsfoundation.com) server-to-server and returns { meta, days }
// to the public /book page. The Apps Script URL + shared token live ONLY in
// server-side env vars, so the browser never sees them and never has to
// navigate to script.google.com (which triggers Google's multi-account
// "unable to open the file" bug).
//
// Env vars (set in Vercel, server-side only — NOT NEXT_PUBLIC_*):
//   BOOKING_API_URL    — the Apps Script /exec URL
//   BOOKING_API_TOKEN  — shared secret sent as ?token=… / body.token
// ---------------------------------------------------------------------------

type Meta = {
  pageTitle: string
  blurb: string
  withLabel: string
  timezone: string
  slotMinutes: number
  bookers: { id: string; name: string }[]
}
type Slot = { startIso: string; label: string }
type Day = { date: string; weekday: string; nice: string; slots: Slot[] }

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  const text = await res.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    // A stale/misconfigured deployment serves the HTML page instead of JSON.
    throw new Error('Booking backend did not return JSON — the Apps Script deployment may be on an old version.')
  }
  if (!parsed || parsed.ok !== true) {
    throw new Error((parsed && (parsed.error as string)) || 'Booking backend returned an error.')
  }
  return parsed
}

export async function GET() {
  const base = process.env.BOOKING_API_URL
  const token = process.env.BOOKING_API_TOKEN
  if (!base || !token) {
    return NextResponse.json(
      { error: 'Booking is not configured yet. Set BOOKING_API_URL and BOOKING_API_TOKEN.' },
      { status: 503 },
    )
  }

  const q = `token=${encodeURIComponent(token)}`
  try {
    const [metaRes, availRes] = await Promise.all([
      fetchJson(`${base}?api=meta&${q}`),
      fetchJson(`${base}?api=availability&${q}`),
    ])
    const meta = metaRes.meta as Meta
    const days = (availRes.days as Day[]) || []
    return NextResponse.json(
      { meta, days },
      { headers: { 'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=60' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load availability.' },
      { status: 502 },
    )
  }
}
