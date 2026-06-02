'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'

// Team-member profile photo. Shows the uploaded photo (team_members.avatar_url)
// when set, otherwise the initials (avatar column). Clicking navigates to the
// personal profile page (/profile), where the photo is changed. Used in the
// header (small) and on the hub hero (large, with job title underneath).

function initialsFrom(name?: string | null, fallback?: string | null): string {
  if (fallback && fallback.trim()) return fallback.trim().slice(0, 2).toUpperCase()
  if (!name) return '·'
  return name.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '·'
}

function initialsTextClass(size: number): string {
  if (size >= 140) return 'text-5xl'
  if (size >= 96) return 'text-3xl'
  if (size >= 64) return 'text-xl'
  return 'text-xs'
}

type Props = {
  /** Diameter in px. Default 36 (header size). */
  size?: number
  /** Tailwind ring classes for the outline. */
  ringClassName?: string
  /** Show the member's job_title beneath the avatar. */
  showTitle?: boolean
  /** Navigation target. Defaults to the personal profile page. */
  href?: string
}

export default function ProfileAvatar({
  size = 36,
  ringClassName = 'ring-1 ring-slate-200 hover:ring-steps-blue-400',
  showTitle = false,
  href = '/profile',
}: Props) {
  const { user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [initials, setInitials] = useState<string>('')
  const [jobTitle, setJobTitle] = useState<string | null>(null)

  useEffect(() => {
    const email = user?.email
    if (!email) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('team_members')
        .select('avatar, avatar_url, name, job_title')
        .eq('email', email.toLowerCase())
        .maybeSingle()
      if (cancelled || !data) return
      setAvatarUrl(data.avatar_url ?? null)
      setInitials(initialsFrom(data.name, data.avatar))
      setJobTitle(data.job_title ?? null)
    })()
    return () => { cancelled = true }
  }, [user?.email])

  return (
    <div className="flex flex-col items-center gap-2">
      <Link
        href={href}
        aria-label="Your profile"
        title="Your profile"
        style={{ height: size, width: size }}
        className={`block rounded-full overflow-hidden ${ringClassName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition shrink-0`}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="Your profile photo" className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center bg-steps-blue-100 text-steps-blue-700 font-semibold ${initialsTextClass(size)}`}>
            {initials || '·'}
          </span>
        )}
      </Link>
      {showTitle && jobTitle && (
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">{jobTitle}</p>
      )}
    </div>
  )
}
