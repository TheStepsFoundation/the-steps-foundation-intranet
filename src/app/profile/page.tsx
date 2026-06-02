'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 5 * 1024 * 1024

function initialsFrom(name?: string | null, fallback?: string | null): string {
  if (fallback && fallback.trim()) return fallback.trim().slice(0, 2).toUpperCase()
  if (!name) return '·'
  return name.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '·'
}

export default function ProfilePage() {
  const { user, teamMember } = useAuth()
  const memberId = teamMember?.id

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [initials, setInitials] = useState('')
  const [name, setName] = useState('')
  const [jobTitle, setJobTitle] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneSaved, setPhoneSaved] = useState<string | null>(null)
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const email = user?.email
    if (!email) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('team_members')
        .select('avatar, avatar_url, name, job_title, phone')
        .eq('email', email.toLowerCase())
        .maybeSingle()
      if (cancelled || !data) return
      setAvatarUrl(data.avatar_url ?? null)
      setInitials(initialsFrom(data.name, data.avatar))
      setName(data.name ?? '')
      setJobTitle(data.job_title ?? null)
      setPhone(data.phone ?? '')
      setPhoneSaved(data.phone ?? null)
    })()
    return () => { cancelled = true }
  }, [user?.email])

  const handleFile = async (file: File) => {
    setError(null); setNotice(null)
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
      setNotice('Photo updated.')
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
    setError(null); setNotice(null); setUploading(true)
    try {
      const { error: updErr } = await supabase.from('team_members').update({ avatar_url: null }).eq('id', memberId)
      if (updErr) throw updErr
      setAvatarUrl(null)
      setNotice('Photo removed.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not remove photo')
    } finally {
      setUploading(false)
    }
  }

  const savePhone = async () => {
    setPhoneError(null); setPhoneNotice(null); setSavingPhone(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Your session has expired — please sign in again.')
      const res = await fetch('/api/profile/update-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: phone.trim() === '' ? null : phone }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save your phone number')
      const saved = (json?.phone ?? null) as string | null
      setPhone(saved ?? '')
      setPhoneSaved(saved)
      setPhoneNotice('Phone number saved.')
    } catch (err: unknown) {
      setPhoneError(err instanceof Error ? err.message : 'Could not save your phone number')
    } finally {
      setSavingPhone(false)
    }
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="font-display text-2xl font-black text-steps-dark dark:text-white tracking-tight">Your profile</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">Manage your team profile photo and details.</p>

      {/* Profile photo */}
      <section className="mt-8 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="text-sm font-semibold text-steps-dark dark:text-gray-100">Profile photo</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">JPG, PNG, WebP or GIF, up to 5&nbsp;MB.</p>
        <div className="mt-5 flex items-center gap-6">
          <div className="h-24 w-24 rounded-full overflow-hidden ring-1 ring-slate-200 dark:ring-gray-700 shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Your profile photo" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-steps-blue-100 text-steps-blue-700 text-2xl font-semibold">{initials || '·'}</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-steps-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-steps-blue-700 disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
            >
              {uploading ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
            </button>
            {avatarUrl && !uploading && (
              <button type="button" onClick={removePhoto} className="text-sm text-rose-600 hover:text-rose-700 hover:underline text-left">Remove photo</button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
        {notice && <p className="mt-3 text-xs text-emerald-600">{notice}</p>}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onFileInput} className="hidden" />
      </section>

      {/* Details */}
      <section className="mt-6 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="text-sm font-semibold text-steps-dark dark:text-gray-100">Details</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-gray-400">Name</dt>
            <dd className="text-steps-dark dark:text-gray-100 font-medium">{name || '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-gray-400">Email</dt>
            <dd className="text-steps-dark dark:text-gray-100 font-medium">{user?.email ?? '—'}</dd>
          </div>
          {jobTitle && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-gray-400">Role</dt>
              <dd className="text-steps-dark dark:text-gray-100 font-medium">{jobTitle}</dd>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1">
            <dt className="text-slate-500 dark:text-gray-400">Contact phone</dt>
            <dd>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setPhoneNotice(null); setPhoneError(null) }}
                  placeholder="e.g. +44 7700 900000"
                  maxLength={32}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-steps-dark dark:text-gray-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500"
                />
                <button
                  type="button"
                  onClick={savePhone}
                  disabled={savingPhone || phone === (phoneSaved ?? '')}
                  className="rounded-lg bg-steps-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-steps-blue-700 disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
                >
                  {savingPhone ? 'Saving…' : 'Save'}
                </button>
              </div>
              {phoneError && <p className="mt-2 text-xs text-rose-600">{phoneError}</p>}
              {phoneNotice && <p className="mt-2 text-xs text-emerald-600">{phoneNotice}</p>}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
