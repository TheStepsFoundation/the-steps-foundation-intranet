'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [checkingHash, setCheckingHash] = useState(true)
  const [googleLoading, setGoogleLoading] = useState(false)
  // Forgot-password mode swaps the form for a single-input reset request.
  // We use a generic always-the-same response message so an attacker can't
  // tell whether an entered email is on the team or not.
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const router = useRouter()
  const { signIn, signInWithGoogle, user, isTeamMember, loading: authLoading } = useAuth()

  // Check for OAuth tokens in URL hash (from Google redirect)
  useEffect(() => {
    const handleHashTokens = async () => {
      // If there's an access_token in the hash, Supabase should process it
      if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
        // Give Supabase a moment to process the hash
        await new Promise(resolve => setTimeout(resolve, 500))
        
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          router.push('/hub')
          return
        }
      }
      setCheckingHash(false)
    }
    
    handleHashTokens()
  }, [router])

  // If user is already logged in AND is a team member, redirect to home
  useEffect(() => {
    console.log('[login] state: authLoading=', authLoading, 'user=', !!user, 'isTeamMember=', isTeamMember, 'path=', typeof window!=='undefined'?window.location.pathname:'ssr')
    if (!authLoading && user && isTeamMember) {
      console.log('[login] redirecting to /hub — user is authed team member')
      router.push('/hub')
    }
  }, [user, authLoading, isTeamMember, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const { error } = await signIn(email, password)
    if (error) {
      setMessage({ type: 'error', text: error })
    } else {
      router.push('/hub')
    }

    setLoading(false)
  }

  // Send a password reset link via Supabase. We deliberately ignore the
  // resolved error here — the response shown to the user is the same
  // whether or not the email exists in auth.users, which prevents the
  // "Forgot password" form from being used as an email-existence oracle.
  // Supabase's recovery token is hashed in storage, single-use, and
  // expires per the project auth config (default 1 hour).
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setResetSending(true)
    setMessage(null)
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/reset-password`
      : undefined
    await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
      redirectTo,
    })
    setResetSending(false)
    setResetSent(true)
  }

  // Show loading while checking hash
  if (checkingHash) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-steps-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-gray-600">Signing you in...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-steps-blue-50 to-steps-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Logo/Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <img
            src="/tsf-logo-dark.png"
            alt="The Steps Foundation"
            className="h-16 w-auto mb-5"
          />
          <h1 className="font-display text-2xl sm:text-3xl font-black text-steps-dark tracking-tight">Team Intranet</h1>
          <p className="text-slate-500 mt-2">
            Sign in to continue
          </p>
        </div>

        {/* Login Form */}
        {!forgotMode && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              minLength={6}
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>

          {message && (
            <div className={`p-4 rounded-xl text-sm ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
          <div className="text-center mt-3">
            <button
              type="button"
              onClick={() => { setForgotMode(true); setMessage(null); setResetSent(false) }}
              className="text-sm text-steps-blue-600 hover:text-steps-blue-700 font-medium"
            >
              Forgot password?
            </button>
          </div>
        </form>
        )}

        {forgotMode && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-steps-dark mb-1">Reset your password</h2>
              <p className="text-sm text-slate-500">
                Enter your email and we&apos;ll send you a link to set a new one.
              </p>
            </div>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-2">Email address</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                disabled={resetSending || resetSent}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
              />
            </div>
            {resetSent ? (
              <div role="status" aria-live="polite" className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-sm">
                If <strong>{email}</strong> is registered, we&apos;ve sent a password reset link. Check your inbox (and your spam folder) — the link expires in about an hour.
              </div>
            ) : (
              <button
                type="submit"
                disabled={resetSending || !email.trim()}
                className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 flex items-center justify-center gap-2"
              >
                {resetSending ? 'Sending…' : 'Send reset link'}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setForgotMode(false); setResetSent(false); setMessage(null) }}
              className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {!forgotMode && (<>
        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-gray-400">or</span>
          </div>
        </div>

        {/* Google Sign In */}
        <button
          type="button"
          onClick={async () => {
            setGoogleLoading(true)
            setMessage(null)
            const { error } = await signInWithGoogle()
            if (error) {
              setMessage({ type: 'error', text: error })
              setGoogleLoading(false)
            }
          }}
          disabled={googleLoading || loading}
          className="w-full py-3 px-4 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 focus:ring-2 focus:ring-gray-200 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {googleLoading ? (
            <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          Continue with Google
        </button>

        {/* Student Portal Link — prominent so students on the wrong page can't miss it */}
        <div className="mt-6">
          <Link
            href="/my/sign-in"
            className="group block rounded-xl border-2 border-steps-blue-300 bg-steps-blue-50/70 hover:bg-steps-blue-50 hover:border-steps-blue-500 transition-colors px-4 py-3.5 text-center"
          >
            <div className="text-xs uppercase tracking-wider text-steps-blue-700 font-semibold mb-0.5">Are you a student?</div>
            <div className="text-base font-bold text-steps-blue-800 flex items-center justify-center gap-1.5">
              Go to the Student Portal
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </Link>
        </div>

        </>)}
        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Only authorized Steps Foundation team members can access this app.
        </p>
      </div>
    </div>
  )
}
