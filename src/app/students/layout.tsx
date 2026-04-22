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

  // Auth guard. AuthProvider now keeps `loading=true` until the team check
  // is conclusive (with internal retries), so by the time we see loading=false
  // the `isTeamMember` signal is trustworthy. No grace period needed —
  // previously the 1.2s timer was masking an AuthProvider race where 'unknown'
  // team-check results let loading flip to false with teamMember still null,
  // which then caused /students/events → /login → /hub bounces.
  useEffect(() => {
    if (loading) {
      console.log('[students-layout] loading=true, waiting')
      return
    }
    if (!user || !isTeamMember) {
      console.log('[students-layout] redirecting to /login — user=', !!user, 'isTeamMember=', isTeamMember)
      router.push('/login')
      return
    }
    console.log('[students-layout] guard passed')
  }, [user, loading, isTeamMember, router])

  if (loading || !user || !isTeamMember) {
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
              <NavDropdown label="Students" active={pathname.startsWith('/students')} items={[
                { href: '/students', label: 'Dashboard' },
                { href: '/students/events', label: 'Events' },
              ]} />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400">{displayName}</span>
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
