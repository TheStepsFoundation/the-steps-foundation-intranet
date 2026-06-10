'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import TestRunner from '@/components/TestRunner'
import { supabase } from '@/lib/supabase-student'

// ---------------------------------------------------------------------------
// /my/test/[slug] — the student-facing timed selection test for an event.
// This is the page the emailed link points at. Students must be signed in to
// the student hub; the test itself is invitation-gated server-side
// (/api/test/*), so this page only handles the auth hand-off and chrome.
// ---------------------------------------------------------------------------

export default function StudentTestPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug ?? ''
  const [authState, setAuthState] = useState<'checking' | 'signed-in' | 'signed-out'>('checking')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!cancelled) setAuthState(session?.user?.email ? 'signed-in' : 'signed-out')
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthState(session?.user?.email ? 'signed-in' : 'signed-out')
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [])

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav homeHref="/my" />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {authState === 'checking' && (
          <div className="flex items-center justify-center py-24" role="status">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-steps-blue-600" />
            <span className="sr-only">Checking your session…</span>
          </div>
        )}
        {authState === 'signed-out' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8 max-w-xl mx-auto text-center">
            <h1 className="font-display text-2xl font-bold text-steps-dark mb-2">Sign in to take your test</h1>
            <p className="text-slate-600 mb-6">
              This test is linked to your Steps Foundation account, so we need to know it&apos;s you.
              Sign in with the same email you used to apply.
            </p>
            <Link
              href={`/my/sign-in?next=${encodeURIComponent(`/my/test/${slug}`)}`}
              className="inline-flex items-center px-6 py-3 rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition-colors"
            >
              Sign in to continue
            </Link>
          </div>
        )}
        {authState === 'signed-in' && (
          <TestRunner slug={slug} mode="student" getToken={getToken} />
        )}
      </main>
    </div>
  )
}
