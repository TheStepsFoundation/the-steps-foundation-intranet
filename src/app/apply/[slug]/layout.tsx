import type { Metadata } from 'next'

// -----------------------------------------------------------------------------
// Per-event metadata for /apply/[slug] — renders the rich unfurl card when
// someone shares the apply link on LinkedIn, Slack, email, iMessage, etc.
//
// The parent /apply layout wraps all children in the same chrome (TopNav +
// background gradient). This file adds NO visual wrapper of its own — it
// exists purely to host the server-side `generateMetadata` function, since
// the page itself is `'use client'` and cannot export metadata.
// -----------------------------------------------------------------------------

type EventMeta = {
  name: string
  description: string | null
  banner_image_url: string | null
  hub_image_url: string | null
  event_date: string | null
  location: string | null
}

async function fetchEventForMeta(slug: string): Promise<EventMeta | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return null

  try {
    const url = `${supabaseUrl}/rest/v1/events?slug=eq.${encodeURIComponent(slug)}`
      + '&select=name,description,banner_image_url,hub_image_url,event_date,location'
      + '&limit=1'
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      // Cache briefly so repeated social-card fetches don't hammer the DB.
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    const rows = (await res.json()) as EventMeta[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

// Truncate rich descriptions to something social-card friendly (~200 chars).
// LinkedIn truncates anyway but a clean break reads better than a mid-word cut.
function shortenForCard(text: string | null, max = 200): string {
  if (!text) return 'Apply for this Steps Foundation event.'
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…'
}

function formatDateUK(d: string | null): string | null {
  if (!d) return null
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return null
  }
}

export async function generateMetadata(
  { params }: { params: { slug: string } },
): Promise<Metadata> {
  const event = await fetchEventForMeta(params.slug)
  if (!event) {
    // Fallback — inherits the apply layout's generic metadata.
    return {
      title: 'Apply — The Steps Foundation',
      description: 'Apply for Steps Foundation events and opportunities.',
    }
  }

  const title = `${event.name} — Apply · The Steps Foundation`
  // Prefix the short description with date/location context when available.
  const dateStr = formatDateUK(event.event_date)
  const contextBits = [dateStr, event.location].filter(Boolean).join(' · ')
  const rawDesc = event.description ?? ''
  const description = shortenForCard(
    contextBits ? `${contextBits}. ${rawDesc}` : rawDesc,
  )
  // Prefer the wide banner for social cards; fall back to hub image.
  const imageUrl = event.banner_image_url ?? event.hub_image_url ?? null

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'The Steps Foundation',
      ...(imageUrl ? { images: [{ url: imageUrl, alt: event.name }] } : {}),
    },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  }
}

export default function ApplySlugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
