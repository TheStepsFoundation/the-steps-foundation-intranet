'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-provider'

// ---------------------------------------------------------------------------
// SetPasswordModal — first-time password setup for OAuth/OTP team members.
//
// When a user signs in via Google or an email code, they have no password
// on file. This modal nudges them to set one so they can use email +
// password normally next session. Dismissible per session via sessionStorage
// (re-asks on next sign-in until they actually set a password).
//
// Mounted inside Providers so it can render on top of any admin page.
// Gated on:
//   - signed-in user
//   - is a team member
//   - needsPasswordSetup (no has_password flag on user_metadata)
//   - not on a public route (/login, /reset-password, /my, /apply)
//   - not dismissed this session
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'tsf_setpw_dismissed_this_session'

const PUBLIC_PREFIXES = ['/login', '/reset-password', '/my', '/apply', '/auth']

export function SetPasswordModal() {
  const pathname = usePathname()
  const { user, isTeamMember, needsPasswordSetup, setPassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Decide whether to open. Run on every relevant change.
  useEffect(() => {
    if (!user || !isTeamMember || !needsPasswordSetup) {
      setOpen(false)
      return
    }
    if (PUBLIC_PREFIXES.some(p => pathname?.startsWith(p))) {
      setOpen(false)
      return
    }
    if (typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1') {
      setOpen(false)
      return
    }
    setOpen(true)
  }, [user, isTeamMember, needsPasswordSetup, pathname])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await setPassword(password)
    setSaving(false)
    if (err) {
      setError(err)
      return
    }
    setOpen(false)
    setPwd('')
    setConfirm('')
  }

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1')
    }
    setOpen(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="setpw-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-tsf-fade"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-7 animate-tsf-fade-up">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-steps-blue-100 text-steps-blue-600 flex items-center justify-center">
            <svg aria-hidden className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 0v3m-7 7h14a2 2 0 002-2v-5a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 id="setpw-title" className="font-display text-xl font-black text-steps-dark tracking-tight">Set a password for faster sign-in</h2>
            <p className="text-sm text-slate-500 mt-1">
              You signed in without a password this time. Set one now so you can use email + password normally next session.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div>
            <label htmlFor="setpw-new" className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
            <input
              id="setpw-new"
              type="password"
              value={password}
              onChange={e => setPwd(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={saving}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label htmlFor="setpw-confirm" className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
            <input
              id="setpw-confirm"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={saving}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
              placeholder="Re-enter the same password"
            />
          </div>

          {error && (
            <div role="alert" aria-live="polite" className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleDismiss}
              disabled={saving}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="submit"
              disabled={saving || password.length < 8 || password !== confirm}
              className="px-5 py-2.5 bg-steps-blue-600 text-white font-semibold rounded-xl shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue inline-flex items-center justify-center gap-2"
            >
              {saving ? 'Saving…' : 'Set password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
