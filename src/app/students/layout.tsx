'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-provider'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'

export default function StudentsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, isTeamMember, teamMember } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

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

  const displayName = teamMember?.name || user.email?.split('@')[0] || 'Unknown'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/hub" aria-label="Steps Foundation — Hub" className="inline-flex items-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue focus-visible:ring-offset-2">
              <img src="/tsf-logo-dark.png" alt="The Steps Foundation" className="h-10 w-auto dark:hidden" />
              <img src="/tsf-logo-white.png" alt="The Steps Foundation" className="h-10 w-auto hidden dark:block" />
            </Link>
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-steps-blue-50 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-300">
              Students
            </span>
            <nav className="hidden sm:flex items-center gap-1 text-sm">
              <Link href="/hub" className="px-3 py-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Hub</Link>
              <Link href="/" className="px-3 py-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Task Tracker</Link>
              <Link href="/tracker/strategy" className="px-3 py-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">Strategy</Link>
              <NavDropdown label="Students" active={pathname.startsWith('/students')} items={[
                { href: '/students', label: 'Dashboard' },
                { href: '/students/events', label: 'Events' },
              ]} />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400">{displayName}</span>
            <Link
              href="/students/settings"
              aria-label="Settings"
              title="Settings"
              className="inline-flex w-9 h-9 items-center justify-center rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
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

function NavDropdown({ label, active, items }: {
  label: string
  active: boolean
  items: { href: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-3 py-1.5 rounded-md flex items-center gap-1 ${
          active
            ? 'text-gray-700 dark:text-gray-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        {label}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-40 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-50">
          {items.map(item => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
