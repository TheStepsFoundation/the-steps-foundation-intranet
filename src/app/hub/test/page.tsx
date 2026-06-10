'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import AdminHeader from '@/components/AdminHeader'
import TestRunner from '@/components/TestRunner'
import { useAuth } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// /hub/test — team practice mode for event selection tests.
// Any team member can sit the real question bank under the real timer.
// Attempts are stored as kind='team' (keyed by team email) and NEVER touch
// student/application data; rerunning is allowed.
// ---------------------------------------------------------------------------

type TestPick = { slug: string; eventName: string; title: string; status: string }

export default function HubTestPracticePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tests, setTests] = useState<TestPick[] | null>(null)
  const [picked, setPicked] = useState<TestPick | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [loading, user, router])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('tests')
        .select('title, status, events!inner(name, slug)')
        .order('created_at', { ascending: false })
      if (cancelled) return
      const rows: TestPick[] = (data ?? []).map((t: any) => ({
        slug: t.events.slug, eventName: t.events.name, title: t.title, status: t.status,
      }))
      setTests(rows)
      if (rows.length === 1) setPicked(rows[0])
    })()
    return () => { cancelled = true }
  }, [user])

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  if (loading || !user) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-steps-dark">Try the selection test</h1>
            <p className="text-sm text-slate-500 mt-1">
              The real questions, the real timer — but practice mode: nothing is linked to applicants and you can rerun it.
            </p>
          </div>
          {picked && tests && tests.length > 1 && (
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-sm font-medium text-steps-blue-600 hover:text-steps-blue-700"
            >
              Switch test
            </button>
          )}
        </div>

        {!picked && (
          <div className="grid gap-3">
            {tests === null && (
              <div className="flex items-center justify-center py-16" role="status">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-steps-blue-600" />
                <span className="sr-only">Loading tests…</span>
              </div>
            )}
            {tests !== null && tests.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-slate-600">
                No tests exist yet. Create one from an event page (<Link href="/students/events" className="text-steps-blue-600 hover:underline">All events</Link>).
              </div>
            )}
            {(tests ?? []).map(t => (
              <button
                key={t.slug}
                type="button"
                onClick={() => setPicked(t)}
                className="text-left bg-white rounded-2xl border border-slate-100 p-5 hover:border-steps-blue-200 hover:shadow-sm transition"
              >
                <div className="font-semibold text-steps-dark">{t.title}</div>
                <div className="text-sm text-slate-500 mt-0.5">{t.eventName} · status: {t.status}</div>
              </button>
            ))}
          </div>
        )}

        {picked && <TestRunner slug={picked.slug} mode="team" getToken={getToken} />}
      </main>
    </div>
  )
}
