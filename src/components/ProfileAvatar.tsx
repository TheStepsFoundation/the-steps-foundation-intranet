'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'

// Profile photo control for team members. Shows the uploaded photo when
// team_members.avatar_url is set, otherwise the initials (avatar column).
// Clicking opens a site-styled modal to upload / replace / remove the photo.
// The modal is portalled to <body> so it centres on the viewport even when an
// ancestor (e.g. the sticky header's backdrop-blur) would otherwise trap it.
// Photos live in the existing public `event-banners` bucket under `avatars/`.

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

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
}

export default function ProfileAvatar({
  size = 36,
  ringClassName = 'ring-1 ring-slate-200 hover:ring-steps-blue-400',
}: Props) {
  const { user, teamMember } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [initials, setInitials] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const email = user?.email
    if (!email) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('team_members')
        .select('avatar, avatar_url, name')
        .eq('email', email.toLowerCase())
        .maybeSingle()
      if (cancelled || !data) return
      setAvatarUrl(data.avatar_url ?? null)
      setInitials(initialsFrom(data.name, data.avatar))
    })()
    return () => { cancelled = true }
  }, [user?.email])

  const memberId = teamMember?.id

  const handleFile = async (file: File) => {
    setError(null)
    if (!IMAGE_MIMES.includes(file.type)) { setError('Use a JPG, PNG, WebP or GIF.'); return }
    if (file.size > MAX_BYTES) { setError('Max file size is 5 MB.'); return }
    if (!memberId) { setError('Could not find your team profile.'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const rand = Math.random().toString(36).slice(2, 8)
      const objectKey = `avatars/${memberId}-${Date.now()}-${rand}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('event-banners')
        .upload(objectKey, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('event-banners').getPublicUrl(objectKey)
      const url = pub?.publicUrl
      if (!url) throw new Error('Could not resolve image URL')
      const { error: updErr } = await supabase.from('team_members').update({ avatar_url: url }).eq('id', memberId)
      if (updErr) throw updErr
      setAvatarUrl(url)
      setOpen(false)
    } catch (err: unknown) {
      console.error('Avatar upload failed', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = async () => {
    if (!memberId) return
    setError(null); setUploading(true)
    try {
      const { error: updErr } = await supabase.from('team_members').update({ avatar_url: null }).eq('id', memberId)
      if (updErr) throw updErr
      setAvatarUrl(null)
      setOpen(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not remove photo')
    } finally {
      setUploading(false)
    }
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
  }

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Profile photo"
      onClick={() => { if (!uploading) setOpen(false) }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-steps-dark">Profile photo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Upload a photo for your team profile. JPG, PNG, WebP or GIF, up to 5&nbsp;MB.
        </p>

        <div className="mt-5 flex flex-col items-center gap-4">
          <div className="h-24 w-24 rounded-full overflow-hidden ring-1 ring-slate-200">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Current profile photo" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-steps-blue-100 text-steps-blue-700 text-2xl font-semibold">
                {initials || '·'}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-lg bg-steps-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-steps-blue-700 disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
          >
            {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
          </button>

          {avatarUrl && !uploading && (
            <button
              type="button"
              onClick={removePhoto}
              className="text-sm text-rose-600 hover:text-rose-700 hover:underline"
            >
              Remove photo
            </button>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => { if (!uploading) setOpen(false) }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
          >
            Done
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={onFileInput}
          className="hidden"
        />
      </div>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Profile photo"
        title="Profile photo"
        style={{ height: size, width: size }}
        className={`rounded-full overflow-hidden ${ringClassName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition shrink-0`}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="Your profile photo" className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center bg-steps-blue-100 text-steps-blue-700 font-semibold ${initialsTextClass(size)}`}>
            {initials || '·'}
          </span>
        )}
      </button>

      {open && mounted && createPortal(modal, document.body)}
    </>
  )
}
