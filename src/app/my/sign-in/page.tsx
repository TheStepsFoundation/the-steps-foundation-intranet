'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendOtp, verifyOtp, signInWithPassword, getExistingSession } from '@/lib/apply-api'
import { supabase } from '@/lib/supabase-student'
import Link from 'next/link'
import Image from 'next/image'
import { fetchOpenEvents, type HubEvent } from '@/lib/hub-api'
import { PressableButton } from '@/components/PressableButton'
import { OtpResendLink } from '@/components/OtpResendLink'

// ---------------------------------------------------------------------------
// Hub Sign-In — student-facing auth (separate from /login which is team-only).
//
// Wave 1 redesign (Apr 2026): split-pane warm hero + form. The auth-method
// switch is now a proper tab pair ("Password" / "Email code") so first-time
// students see both options without scrolling. Returning students who paid
// for password sign-in get the password tab pre-selected.
//
// Flows preserved:
//  - Email + password sign-in
//  - OTP / verification code via Supabase mailer
//  - Existing session detection (avoid double-sign-in loop)
//  - ?next=… deep-link redirect (sanitised to same-origin paths only)
//  - ?method=password — used by post-event feedback QR
//  - Hard window.location.assign on success to avoid the localStorage flush race
// ---------------------------------------------------------------------------

type Step = 'email' | 'otp' | 'redirecting'
type Method = 'password' | 'otp'

const INPUT_CLASSES =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-base bg-white ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition'

function HubSignInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Where to send the user once they're signed in. Defaults to the hub home,
  // but supports deep-link redirects from things like the post-event feedback
  // QR (e.g. ?next=/my/events/<id>/feedback). Hard guard against off-site.
  const nextPath = useMemo(() => {
    const raw = searchParams?.get('next') ?? '/my'
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/my'
  }, [searchParams])

  const preferPassword = useMemo(
    () => searchParams?.get('method') === 'password',
    [searchParams]
  )

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [method, setMethod] = useState<Method>(preferPassword ? 'password' : 'otp')
  const [error, setError] = useState<string | null>(null)
  // Events with applications currently open — drives the "applying to X?"
  // shortcut for people who land on sign-in by mistake. Replaces a hardcoded
  // Man Group banner that went stale the moment its applications closed:
  // this renders for whatever is open right now and vanishes by itself.
  const [openApplyEvents, setOpenApplyEvents] = useState<HubEvent[]>([])
  useEffect(() => {
    let cancelled = false
    fetchOpenEvents().then(evs => { if (!cancelled) setOpenApplyEvents(evs.slice(0, 2)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    getExistingSession().then(s => {
      if (!cancelled && s?.email) router.replace(nextPath)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        router.replace(nextPath)
      }
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [router, nextPath])

  // After a successful sign-in, navigate with a hard reload so /my always sees
  // the freshly-persisted session. router.replace was racing Supabase's
  // async localStorage write — the OTP succeeded but /my came up empty.
  const goToHub = () => {
    setStep('redirecting')
    setTimeout(() => { window.location.assign(nextPath) }, 200)
  }

  const handlePasswordSignIn = async () => {
    setError(null); setLoading(true)
    const { error: err } = await signInWithPassword(email, password)
    if (err) {
      setLoading(false)
      if (err.toLowerCase().includes('invalid')) {
        setError('Incorrect password. Try signing in with a verification code instead.')
      } else {
        setError(err)
      }
      return
    }
    goToHub()
  }

  const handleSendOtp = async () => {
    setError(null); setLoading(true)
    const { error: err } = await sendOtp(email)
    setLoading(false)
    if (err) { setError(err); return }
    setStep('otp')
  }

  const handleVerifyOtp = async () => {
    setError(null); setLoading(true)
    const { error: err } = await verifyOtp(email, otpCode)
    if (err) { setLoading(false); setError(err); return }
    goToHub()
  }

  if (step === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-steps-blue-50 via-white to-white">
        <div className="text-center" role="status" aria-live="polite">
          <div aria-hidden className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Signing you in…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      {/* --- Brand pane (warmer than /login: blue, not steps-dark) --- */}
      <aside className="relative bg-gradient-to-br from-steps-blue-700 via-steps-blue-600 to-steps-blue-800 text-white px-6 py-10 lg:flex-1 lg:px-14 lg:py-14 lg:flex lg:flex-col lg:justify-between overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-tsf-grain pointer-events-none" />
        <div aria-hidden className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-steps-sunrise/30 blur-3xl pointer-events-none" />
        <div aria-hidden className="absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-steps-berry/25 blur-3xl pointer-events-none" />

        <div className="relative z-10 animate-tsf-fade-up">
          <Link
            href="https://thestepsfoundation.com"
            aria-label="The Steps Foundation — home"
            className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-steps-blue-700"
          >
            <Image src="/tsf-logo-white.png" alt="The Steps Foundation" width={220} height={55} priority className="h-12 w-auto" />
          </Link>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 max-w-md animate-tsf-fade-up-1">
          <p className="text-xs uppercase tracking-[0.2em] text-steps-mist/90 font-semibold">Student Hub</p>
          <h1 className="font-display-tight text-4xl sm:text-5xl lg:text-6xl font-black mt-3 text-white">
            Your applications, in one place.
          </h1>
          <p className="mt-5 text-base lg:text-lg text-white/85 leading-relaxed">
            Sign in to see your event applications, RSVP, withdraw, edit your details, and find what&apos;s next.
          </p>
        </div>

        <div className="relative z-10 mt-10 lg:mt-0 hidden lg:block animate-tsf-fade-up-2">
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-white/40" aria-hidden />
            <em className="not-italic text-white/80 text-sm tracking-[0.2em] uppercase">Virtus non origo</em>
          </div>
          <p className="text-white/60 text-sm mt-2">Character, not origin.</p>
        </div>
      </aside>

      {/* --- Form pane --- */}
      <main className="relative flex-1 flex items-center justify-center px-4 sm:px-6 py-10 lg:py-14 bg-gradient-to-b from-white to-slate-50">
        <div className="w-full max-w-md animate-tsf-fade-up-2">
          <div className="text-center lg:text-left mb-6">
            <h2 className="font-display text-3xl font-black text-steps-dark tracking-tight">Sign in</h2>
            <p className="text-slate-500 mt-2 text-sm">First time? Use a code &mdash; no password needed.</p>
          </div>

          {/* Open-applications shortcut — for people who landed here by
              mistake. Driven by live data; renders nothing when no event has
              applications open (no more stale hardcoded banners). */}
          {openApplyEvents.map(ev => (
            <Link
              key={ev.id}
              href={`/apply/${ev.slug}`}
              className="group block mb-5 rounded-2xl border border-steps-sunrise/40 bg-gradient-to-br from-orange-50 to-white px-5 py-4 hover:border-steps-sunrise hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-sunrise focus-visible:ring-offset-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-steps-sunrise font-semibold">
                    Applying to {ev.name}?
                  </p>
                  <p className="text-sm font-semibold text-steps-dark mt-0.5">
                    Start your application — no account needed
                  </p>
                </div>
                <svg aria-hidden className="w-5 h-5 text-steps-sunrise transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 sm:p-6 space-y-4">
            {/* Method tabs — only on the email step, not OTP step */}
            {step === 'email' && (
              <div role="tablist" aria-label="Choose how to sign in" className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'password'}
                  onClick={() => { setMethod('password'); setError(null) }}
                  className={`text-sm font-semibold py-2 rounded-lg transition ${method === 'password' ? 'bg-white text-steps-dark shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Password
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'otp'}
                  onClick={() => { setMethod('otp'); setError(null) }}
                  className={`text-sm font-semibold py-2 rounded-lg transition ${method === 'otp' ? 'bg-white text-steps-dark shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Email code
                </button>
              </div>
            )}

            {/* Email field — always visible across both methods + OTP step */}
            <div>
              <label htmlFor="signin-email" className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                id="signin-email"
                type="email"
                className={INPUT_CLASSES}
                placeholder="your@email.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                disabled={step === 'otp'}
                autoFocus
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                onKeyDown={e => {
                  if (e.key === 'Enter' && email.trim()) {
                    if (method === 'otp') handleSendOtp()
                    else handlePasswordSignIn()
                  }
                }}
              />
            </div>

            {step === 'email' && method === 'password' && (
              <>
                <div>
                  <label htmlFor="signin-password" className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <input
                    id="signin-password"
                    type="password"
                    className={INPUT_CLASSES}
                    placeholder="Enter your password"
                    value={password}
                    autoComplete="current-password"
                    onChange={e => { setPassword(e.target.value); setError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handlePasswordSignIn() }}
                  />
                </div>

                <PressableButton
                  onClick={handlePasswordSignIn}
                  disabled={loading || !email.trim() || !password}
                  fullWidth
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </PressableButton>
              </>
            )}

            {step === 'email' && method === 'otp' && (
              <>
                <p className="text-xs text-slate-500 leading-relaxed">
                  We&apos;ll email you a 6-digit verification code. No password? No problem.
                </p>
                <PressableButton
                  onClick={handleSendOtp}
                  disabled={loading || !email.trim()}
                  fullWidth
                >
                  {loading ? 'Sending…' : 'Send verification code'}
                </PressableButton>
              </>
            )}

            {step === 'otp' && (
              <>
                <p className="text-sm text-slate-600">
                  We sent a 6-digit code to <span className="font-medium text-steps-dark">{email}</span>.
                </p>

                <div>
                  <label htmlFor="signin-otp" className="block text-sm font-medium text-slate-700 mb-1.5">Verification code</label>
                  <input
                    id="signin-otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    aria-label="6-digit verification code"
                    autoFocus
                    className={`${INPUT_CLASSES} tracking-[0.5em] text-center font-bold text-xl`}
                    placeholder="000000"
                    value={otpCode}
                    onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleVerifyOtp() }}
                  />
                </div>

                <PressableButton onClick={handleVerifyOtp} disabled={loading || otpCode.length < 6} fullWidth>
                  {loading ? 'Verifying…' : 'Verify & sign in'}
                </PressableButton>

                <button
                  type="button"
                  onClick={() => { setStep('email'); setOtpCode(''); setError(null) }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
                >
                  ← Back
                </button>
                <OtpResendLink
                  resetKey={email}
                  onResend={async () => {
                    const { error: err } = await sendOtp(email)
                    return { error: err }
                  }}
                />
              </>
            )}

            {error && (
              <p role="alert" aria-live="polite" className="text-sm text-steps-berry bg-steps-berry/10 border border-steps-berry/20 rounded-xl px-3.5 py-2.5">{error}</p>
            )}
          </div>

          <div className="mt-6 text-center text-sm text-slate-500">
            <Link href="https://thestepsfoundation.com" className="hover:text-steps-blue-600 transition-colors">
              ← Back to The Steps Foundation
            </Link>
          </div>

          <p className="mt-4 text-center text-xs text-slate-400 lg:hidden">
            <em className="not-italic tracking-[0.2em] uppercase">Virtus non origo</em>
            <span aria-hidden> · </span>
            Character, not origin
          </p>
        </div>
      </main>
    </div>
  )
}

export default function HubSignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 animate-pulse">Loading…</p>
      </div>
    }>
      <HubSignInInner />
    </Suspense>
  )
}
