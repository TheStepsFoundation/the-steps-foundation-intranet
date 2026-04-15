'use client'

import Link from 'next/link'
import { useAuth, getUserDisplayName } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function StudentsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, isAllowedEmail } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    if (user.email && !isAllowedEmail(user.email)) {
      router.push('/login')
    }
  }, [user, loading, isAllowedEmail, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-500 dark:text-gray-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/students" className="font-semibold text-gray-900 dark:text-gray-100">
              Steps <span className="text-indigo-600 dark:text-indigo-400">Students</span>
            </Link>
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <Link href="/students" className="px-3 py-1.5 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Dashboard</Link>
              <Link href="/" className="px-3 py-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Task Tracker</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400">{getUserDisplayName(user.email)}</span>
            <button
              onClick={() => signOut().then(() => router.push('/login'))}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
