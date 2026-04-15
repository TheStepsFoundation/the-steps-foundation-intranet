import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-side client using the anon key — search_schools is SECURITY DEFINER
// and GRANTed to anon/authenticated, so this is safe and avoids leaking
// the service-role key.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const limRaw = Number(req.nextUrl.searchParams.get('limit') ?? '15')
  const lim = Number.isFinite(limRaw) ? Math.min(50, Math.max(1, Math.floor(limRaw))) : 15

  if (!q) return NextResponse.json({ results: [] })

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.rpc('search_schools', { q, lim })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ results: data ?? [] })
}
