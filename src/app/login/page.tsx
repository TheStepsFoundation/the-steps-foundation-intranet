'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/lib/auth-provider'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// /login — Team Intranet sign-in.
//
// Wave 1 redesign (Apr 2026): split-pane layout — brand panel left
// (steps-dark + sunrise + grid texture, "Virtus non origo"), form panel
// right. Mobile collapses to a stacked layout with a slim brand strip up
// top so first-gen students who arrive at the wrong URL still get a clean
// "Are you a student?" handoff.
//
// Flows preserved verbatim from the previous version:
//  - Email + password sign-in (team members only)
//  - Continue with Google
//  - Forgot password (no email-existence oracle)
//  - OAuth hash token handling on return from Google
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [checkingHash, setCheckingHash] = useState(true)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  // Email-code (OTP) flow state. mode 'email' shows the address input,
  // mode 'code' shows the 6-digit code input after we've sent it.
  const [otpMode, setOtpMode] = useState(false)
  const [otpStep, setOtpStep] = useState<'email' | 'code'>('email')
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const router = useRouter()
  const { signIn, signInWithGoogle, sendOtp, verifyOtp, user, isTeamMember, loading: authLoading } = useAuth()

  // Check for OAuth tokens in URL hash (from Google redirect)
  useEffect(() => {
    const handleHashTokens = async () => {
      if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
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

  useEffect(() => {
    if (!authLoading && user && isTeamMember) {
      router.push('/hub')
    }
  }, [user, authLoading, isTeamMember, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await signIn(email, password)
    if (error) setMessage({ type: 'error', text: error })
    else router.push('/hub')
    setLoading(false)
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setResetSending(true)
    setMessage(null)
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/reset-password`
      : undefined
    await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), { redirectTo })
    setResetSending(false)
    setResetSent(true)
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setOtpSending(true)
    setMessage(null)
    const { error } = await sendOtp(email)
    setOtpSending(false)
    if (error) {
      setMessage({ type: 'error', text: error })
      return
    }
    setOtpStep('code')
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode.trim()) return
    setOtpVerifying(true)
    setMessage(null)
    const { error } = await verifyOtp(email, otpCode.trim())
    setOtpVerifying(false)
    if (error) {
      setMessage({ type: 'error', text: error })
      return
    }
    // Successful verification — handleAuthChange will run team_members
    // check and either keep the session or sign them out. Push them
    // optimistically; if they get bounced the layout guard handles it.
    router.push('/hub')
  }

  const exitOtpMode = () => {
    setOtpMode(false)
    setOtpStep('email')
    setOtpCode('')
    setMessage(null)
  }

  if (checkingHash) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-steps-blue-50 via-white to-steps-blue-50">
        <div className="flex items-center gap-3" role="status" aria-live="polite">
          <svg aria-hidden className="animate-spin h-6 w-6 text-steps-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-slate-600">Signing you in…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      {/* --- Brand pane --- */}
      <aside className="relative bg-steps-dark text-white px-6 py-10 lg:flex-1 lg:px-14 lg:py-14 lg:flex lg:flex-col lg:justify-between overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-tsf-grain pointer-events-none" />
        <div aria-hidden className="absolute inset-0 bg-tsf-hero-grid opacity-30 pointer-events-none" />
        <div aria-hidden className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-steps-blue-700/30 blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-steps-sunrise/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 animate-tsf-fade-up">
          <Link
            href="https://thestepsfoundation.com"
            aria-label="The Steps Foundation — home"
            className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-steps-dark"
          >
            <Image
              src="/tsf-logo-white.png"
              alt="The Steps Foundation"
              width={220}
              height={55}
              priority
              className="h-12 w-auto"
            />
          </Link>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 max-w-md animate-tsf-fade-up-1">
          <p className="text-xs uppercase tracking-[0.2em] text-steps-mist/80 font-semibold">Team Intranet</p>
          <h1 className="font-display-tight text-4xl sm:text-5xl lg:text-6xl font-black mt-3 text-white">
            Build the foundation that helps students climb.
          </h1>
          <p className="mt-5 text-base lg:text-lg text-steps-mist/90 leading-relaxed">
            The internal toolkit for The Steps Foundation team — applications, events, campaigns and the daily moves that compound into mobility.
          </p>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 hidden lg:block animate-tsf-fade-up-2">
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-steps-mist/40" aria-hidden />
            <em className="not-italic text-steps-mist/80 text-sm tracking-[0.2em] uppercase">Virtus non origo</em>
          </div>
          <p className="text-steps-mist/60 text-sm mt-2">Character, not origin.</p>
        </div>
      </aside>

      {/* --- Form pane --- */}
      <main className="relative flex-1 flex items-center justify-center px-4 sm:px-6 py-10 lg:py-14 bg-gradient-to-b from-white to-slate-50">
        <div className="w-full max-w-md animate-tsf-fade-up-2">
          {!forgotMode && !otpMode && (
            <div className="text-center lg:text-left mb-8">
              <h2 className="font-display text-3xl font-black text-steps-dark tracking-tight">Sign in</h2>
              <p className="text-slate-500 mt-2 text-sm">Use your Steps Foundation team account.</p>
            </div>
          )}

          {/* Sign-in form */}
          {!forgotMode && !otpMode && (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@thestepsfoundation.com"
                  required
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  disabled={loading}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setMessage(null); setResetSent(false) }}
                    className="text-xs font-medium text-steps-blue-600 hover:text-steps-blue-700"
                  >
                    Forgot?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </div>

              {message && (
                <div
                  role={message.type === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                  className={`p-3.5 rounded-xl text-sm border ${
                    message.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 inline-flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg aria-hidden className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in…
                  </>
                ) : 'Sign in'}
              </button>

              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-gradient-to-b from-white to-slate-50 text-slate-400 uppercase tracking-wider">or</span>
                </div>
              </div>

              {/* Google sign-in */}
              <button
                type="button"
                onClick={async () => {
                  setGoogleLoading(true); setMessage(null)
                  const { error } = await signInWithGoogle()
                  if (error) { setMessage({ type: 'error', text: error }); setGoogleLoading(false) }
                }}
                disabled={googleLoading || loading}
                className="w-full py-3 px-4 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-3"
              >
                {googleLoading ? (
                  <svg aria-hidden className="animate-spin h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg aria-hidden className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                Continue with Google
              </button>

              {/* Email code (passwordless) option */}
              <button
                type="button"
                onClick={() => { setOtpMode(true); setOtpStep('email'); setMessage(null) }}
                disabled={loading || googleLoading}
                className="mt-3 w-full py-3 px-4 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-3"
              >
                <svg aria-hidden className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Sign in with an email code
              </button>
            </form>
          )}

          {/* Email-code (OTP) flow */}
          {otpMode && otpStep === 'email' && (
            <form onSubmit={handleSendOtp} className="space-y-4" noValidate>
              <div>
                <h2 className="font-display text-2xl font-black text-steps-dark tracking-tight mb-1.5">Sign in with an email code</h2>
                <p className="text-sm text-slate-500">We&apos;ll email you a 6-digit code. No password needed for this sign-in.</p>
              </div>
              <div>
                <label htmlFor="otp-email" className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
                <input
                  id="otp-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@thestepsfoundation.com"
                  required
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  disabled={otpSending}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
                />
              </div>
              {message && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="p-3.5 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200"
                >
                  {message.text}
                </div>
              )}
              <button
                type="submit"
                disabled={otpSending || !email.trim()}
                className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
              >
                {otpSending ? 'Sending code…' : 'Send code'}
              </button>
              <button
                type="button"
                onClick={exitOtpMode}
                className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
              >
                ← Back to sign in
              </button>
            </form>
          )}

          {otpMode && otpStep === 'code' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              <div>
                <h2 className="font-display text-2xl font-black text-steps-dark tracking-tight mb-1.5">Check your inbox</h2>
                <p className="text-sm text-slate-500">If <strong>{email}</strong> is on our team list, we&apos;ve sent a 6-digit code there. Enter it below to sign in. The code expires in 10 minutes.</p>
              </div>
              <div>
                <label htmlFor="otp-code" className="block text-sm font-medium text-slate-700 mb-1.5">6-digit code</label>
                <input
                  id="otp-code"
                  type="text"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  disabled={otpVerifying}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50 tracking-[0.5em] text-center font-mono text-lg"
                />
              </div>
              {message && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="p-3.5 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200"
                >
                  {message.text}
                </div>
              )}
              <button
                type="submit"
                disabled={otpVerifying || otpCode.length !== 6}
                className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
              >
                {otpVerifying ? 'Verifying…' : 'Sign in'}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setOtpStep('email'); setOtpCode(''); setMessage(null) }}
                  className="text-slate-500 hover:text-slate-700 py-1"
                >
                  ← Use a different email
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setOtpSending(true); setMessage(null)
                    const { error } = await sendOtp(email)
                    setOtpSending(false)
                    if (error) setMessage({ type: 'error', text: error })
                    else setMessage({ type: 'success', text: 'New code sent.' })
                  }}
                  disabled={otpSending}
                  className="text-steps-blue-600 hover:text-steps-blue-700 font-medium py-1 disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {/* Forgot password form */}
          {forgotMode && (
            <form onSubmit={handleForgotPassword} className="space-y-4" noValidate>
              <div>
                <h2 className="font-display text-2xl font-black text-steps-dark tracking-tight mb-1.5">Reset your password</h2>
                <p className="text-sm text-slate-500">Enter your email and we&apos;ll send a link to set a new one.</p>
              </div>
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@thestepsfoundation.com"
                  required
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  disabled={resetSending || resetSent}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition disabled:bg-slate-50"
                />
              </div>
              {resetSent ? (
                <div role="status" aria-live="polite" className="p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-sm">
                  If <strong>{email}</strong> is registered, we&apos;ve sent a password reset link. Check your inbox (and your spam folder) — the link expires in 20 minutes.
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={resetSending || !email.trim()}
                  className="w-full py-3 px-4 bg-steps-blue-600 text-white font-semibold rounded-xl border-t border-white/20 shadow-press-blue hover:-translate-y-0.5 hover:shadow-press-blue-hover active:translate-y-0.5 active:shadow-none active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-press-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
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

          {/* Student portal handoff — outside the form so it stays visible across all modes */}
          {!forgotMode && !otpMode && (
            <Link
              href="/my/sign-in"
              className="group mt-6 block rounded-2xl border-2 border-steps-blue-200 bg-gradient-to-br from-steps-blue-50 to-white px-5 py-4 hover:border-steps-blue-400 hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 animate-tsf-fade-up-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-steps-blue-700 font-semibold">Are you a student?</div>
                  <div className="text-sm font-bold text-steps-dark mt-0.5">Go to the Student Portal →</div>
                </div>
                <svg aria-hidden className="w-5 h-5 text-steps-blue-600 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          )}

          <p className="text-center text-xs text-slate-400 mt-6">
            Only authorised Steps Foundation team members can access this app.
          </p>
        </div>
      </main>
    </div>
  )
}
