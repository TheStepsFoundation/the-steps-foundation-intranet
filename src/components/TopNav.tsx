'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

type Variant = 'light' | 'dark'

interface TopNavProps {
  variant?: Variant
  children?: React.ReactNode
  homeHref?: string
  className?: string
}

function resolveHomeHref(pathname: string | null): string {
  if (!pathname) return '/hub'
  if (pathname.startsWith('/my') || pathname.startsWith('/apply')) {
    return '/my'
  }
  return '/hub'
}

export function TopNav({ variant = 'light', children, homeHref, className = '' }: TopNavProps) {
  const pathname = usePathname()
  const href = homeHref ?? resolveHomeHref(pathname)
  const isDark = variant === 'dark'
  const logoSrc = isDark ? '/tsf-logo-white.png' : '/tsf-logo-dark.png'

  const shellClasses = isDark
    ? 'bg-steps-dark/95 backdrop-blur-md border-b border-white/10 text-white'
    : 'bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm text-slate-900'

  return (
    <nav
      className={`sticky top-0 z-40 w-full ${shellClasses} ${className}`}
      aria-label="Primary"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            href={href}
            aria-label="The Steps Foundation — Home"
            className="group inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue focus-visible:ring-offset-2"
          >
            <Image
              src={logoSrc}
              alt="The Steps Foundation"
              width={176}
              height={44}
              priority
              className="h-11 w-auto transition-transform duration-200 group-hover:-translate-y-0.5"
            />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {children}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default TopNav
