'use client'

import { useAuth } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import AdminHeader from '@/components/AdminHeader'

export default function StudentsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isTeamMember } = useAuth()
  const router = useRouter()

  // Auth guard — session-only. A non-team-member cannot reach an authenticated
  // state on the admin Supabase client: AuthProvider signs them out during
  // the SIGNED_IN handler before they ever land here. So once `user` is set,
  // we trust it. Checking isTeamMember here as well was the source of the
  // bounce-back-to-login bug — a transient cache miss or race between
  // competing INITIAL_SESSION events would flip isTeamMember to false
  // momentarily and redirect the admin away before the provider could recover.
  // Revocation is handled by the background verify in AuthProvider: if a
  // previously-validated admin is removed from team_members, the next
  // verify that comes back conclusively not_member signs them out globally.
  useEffect(() => {
    if (loading) {
      console.log('[students-layout] loading=true, waiting')
      return
    }
    if (!user) {
      console.log('[students-layout] redirecting to /login — no user')
      router.push('/login')
      return
    }
    console.log('[students-layout] guard passed (isTeamMember=', isTeamMember, ')')
  }, [user, loading, isTeamMember, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-500 dark:text-gray-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminHeader />
      {children}
    </div>
  )
}
