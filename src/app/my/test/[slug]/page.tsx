'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { TopNav } from '@/components/TopNav'
import TestRunner from '@/components/TestRunner'
import { supabase as studentSupabase } from '@/lib/supabase-student'
import { supabase as adminSupabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// /my/test/[slug] — the student-facing timed selection test for an event.
// This is the page the emailed link points at. Students must be signed in to
// the student hub; the test itself is invitation-gated server-side
// (/api/test/*), so this page only handles the auth hand-off and chrome.
//
// ?preview=admin — ADMIN PREVIEW: a signed-in team member experiences this
// exact page as a student would (same intro, warm-ups, runner, done screen,
// no totals or score), but the attempt runs in team practice mode — keyed to
// their team email, never linked to any applicant, rerunnable — under an
// unmissable banner. Launched from /students/events/[id]/test.
// ---------------------------------------------------------------------------

function StudentTestPageInner() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const slug = params?.slug ?? ''
  const isAdminPreview = searchParams?.get('preview') === 'admin'
  const [authState, setAuthState] = useState<'checking' | 'signed-in' | 'signed-out'>('checking')

  // In preview we authenticate against the ADMIN session; otherwise the
  // student session. The two clients are deliberately separate storage keys.
  const client = isAdminPreview ? adminSupabase : studentSupabase

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await client.auth.getSession()
      if (!cancelled) setAuthState(session?.user?.email ? 'signed-in' : 'signed-out')
    })()
    const { data: sub } = client.auth.onAuthStateChange((_e, session) => {
      setAuthState(session?.user?.email ? 'signed-in' : 'signed-out')
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [client])

  const getToken = useCallback(async () => {
    const { data: { session } } = await client.auth.getSession()
    return session?.access_token ?? null
  }, [client])

  return (
    <div className="min-h-screen bg-slate-50">
      {isAdminPreview && (
        <div className="sticky top-0 z-50 bg-amber-400 text-amber-950 px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 text-center shadow-sm">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Admin preview — this is the full student experience in practice mode. Nothing is recorded against any applicant.
        </div>
      )}
      <TopNav homeHref="/my" />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {!isAdminPreview && (
          <Link
            href="/my"
            className="inline-flex items-center gap-1.5 mb-5 text-sm font-medium text-slate-500 hover:text-steps-dark transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to my hub
          </Link>
        )}
        {authState === 'checking' && (
          <div className="max-w-2xl mx-auto skeleton-fade" role="status">
            <span className="sr-only">Checking your session…</span>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="skeleton h-4 w-32 rounded mb-3" />
              <div className="skeleton h-7 w-2/3 rounded mb-4" />
              <div className="skeleton h-4 w-full rounded mb-2" />
              <div className="skeleton h-4 w-5/6 rounded" />
            </div>
          </div>
        )}
        {authState === 'signed-out' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8 max-w-xl mx-auto text-center">
            {isAdminPreview ? (
              <>
                <h1 className="font-display text-2xl font-bold text-steps-dark mb-2">Admin preview</h1>
                <p className="text-slate-600 mb-6">
                  You need to be signed in to the intranet (in this browser) to preview the student experience.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center px-6 py-3 rounded-xl bg-steps-blue-600 text-white font-semibold hover:bg-steps-blue-700 transition-colors"
                >
                  Sign in to the intranet
                </Link>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}
        {authState === 'signed-in' && (
          <TestRunner
            slug={slug}
            mode={isAdminPreview ? 'team' : 'student'}
            studentView={isAdminPreview}
            getToken={getToken}
          />
        )}
      </main>
    </div>
  )
}

export default function StudentTestPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <StudentTestPageInner />
    </Suspense>
  )
}
