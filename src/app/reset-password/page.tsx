'use client'

// ---------------------------------------------------------------------------
// /reset-password — landing page for the password-reset link Supabase emails
// out. Supabase consumes the recovery token from the URL hash automatically
// on mount (sets a temporary recovery session and fires the
// PASSWORD_RECOVERY auth event). From there, the user just needs to set a
// new password via auth.updateUser({ password }), which both writes the
// new hash and immediately invalidates the recovery token.
//
// Token security is delegated to Supabase: the token is hashed in
// auth.flow_state, single-use, and expires per the project's auth config
// (default 1 hour). The user-enumeration concern from the video doesn't
// apply here because the request endpoint (/login forgot-password) returns
// the same response regardless of whether the email exists.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Status = 'checking' | 'ready' | 'invalid' | 'saving' | 'saved'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // PASSWORD_RECOVERY fires after Supabase has consumed the token from the
    // URL hash and set the temporary recovery session. We listen for it so
    // we know the link is valid; if it doesn't fire within ~3s we assume the
    // token is missing/expired/invalid and show the recovery-failed state.
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready')
      }
    })

    // Also handle the case where the listener missed the event (e.g.
    // Supabase already had a session before this page mounted): if there's
    // already a session and it carries the recovery context, go straight to
    // ready. We can't directly read the token type, so we fall back to:
    // any active session = let them try, otherwise time out as invalid.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setStatus(prev => prev === 'checking' ? 'ready' : prev)
      }
    })

    const timeout = setTimeout(() => {
      if (cancelled) return
      setStatus(prev => prev === 'checking' ? 'invalid' : prev)
    }, 3000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      sub.data.subscription.unsubscribe()
    }
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (password.length < 8) {
      setErr('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match.')
      return
    }
    setStatus('saving')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setStatus('ready')
      // Friendlier mapping for Supabase's strength / re-use errors.
      const m = error.message.toLowerCase()
      if (m.includes('strong') || m.includes('weak') || m.includes('character of each')) {
        setErr('Use at least 8 characters with a mix of letters, numbers and symbols.')
      } else if (m.includes('same') || m.includes('different')) {
        setErr('Pick a different password from your last one.')
      } else {
        setErr(error.message)
      }
      return
    }
    setStatus('saved')
    setTimeout(() => router.push('/hub'), 1500)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-steps-blue-50 to-steps-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tsf-logo-dark.png" alt="The Steps Foundation" className="h-14 w-auto mb-4" />
          <h1 className="font-display text-2xl font-black text-steps-dark tracking-tight">Set a new password</h1>
        </div>

        {status === 'checking' && (
          <div role="status" aria-live="polite" className="text-center py-4">
            <div aria-hidden="true" className="animate-spin w-6 h-6 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-sm text-slate-500">Verifying your link…</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-4">
              This reset link is invalid or has expired. Reset links are single-use and expire about an hour after they&apos;re sent.
            </p>
            <Link href="/login" className="inline-block text-sm font-medium text-steps-blue-600 hover:text-steps-blue-700">
              Request a new link
            </Link>
          </div>
        )}

        {status === 'saved' && (
          <div role="status" aria-live="polite" className="text-center py-4 space-y-2">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="text-sm font-medium text-steps-dark">Password updated</p>
            <p className="text-xs text-slate-500">Taking you to the intranet…</p>
          </div>
        )}

        {(status === 'ready' || status === 'saving') && (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
                disabled={status === 'saving'}
                placeholder="At least 8 characters"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={status === 'saving'}
                placeholder="Re-enter the password"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
              />
            </div>
            {err && (
              <p role="alert" aria-live="polite" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>
            )}
            <button
              type="submit"
              disabled={status === 'saving' || !password || !confirm}
              className="w-full py-3 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue"
            >
              {status === 'saving' ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
