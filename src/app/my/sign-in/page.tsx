'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { sendOtp, verifyOtp, signInWithPassword, getExistingSession } from '@/lib/apply-api'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import Image from 'next/image'
import { PressableButton } from '@/components/PressableButton'

// ---------------------------------------------------------------------------
// Hub Sign-In — lightweight auth page that redirects to /my on success.
// Supports email+password (returning students) and OTP (first-time / forgot).
// ---------------------------------------------------------------------------

type Step = 'email' | 'otp' | 'redirecting'

const INPUT_CLASSES =
  'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-steps-blue-500 focus:border-steps-blue-500 outline-none transition-shadow'

export default function HubSignInPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [useOtp, setUseOtp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // On mount: check for existing session. Also listen for future auth changes
  // so that once the session hydrates (after sign-in, after password upgrade),
  // we reactively push the user into /my instead of leaving them stuck here.
  useEffect(() => {
    let cancelled = false
    getExistingSession().then(s => {
      if (!cancelled && s?.email) router.replace('/my')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        router.replace('/my')
      }
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [router])

  const handlePasswordSignIn = async () => {
    setError(null); setLoading(true)
    const { error: err } = await signInWithPassword(email, password)
    setLoading(false)
    if (err) {
      if (err.toLowerCase().includes('invalid')) {
        setError('Incorrect password. Try signing in with a verification code instead.')
      } else {
        setError(err)
      }
      return
    }
    setStep('redirecting'); router.replace('/my')
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
    setLoading(false)
    if (err) { setError(err); return }
    setStep('redirecting'); router.replace('/my')
  }

  if (step === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500 animate-pulse">Signing you in…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-steps-blue-50 via-white to-white flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center mb-8">
            <Image
              src="/tsf-logo-dark.png"
              alt="The Steps Foundation"
              width={220}
              height={55}
              priority
              className="h-14 w-auto mb-6"
            />
            <h1 className="font-display text-3xl font-black text-steps-dark tracking-tight">
              Student Hub
            </h1>
            <p className="mt-2 text-slate-600 max-w-sm">
              Sign in to view your applications and account details.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-7 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                className={INPUT_CLASSES}
                placeholder="your@email.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                disabled={step === 'otp'}
                onKeyDown={e => {
                  if (e.key === 'Enter' && email.trim()) {
                    if (useOtp) handleSendOtp()
                    else handlePasswordSignIn()
                  }
                }}
              />
            </div>

            {step === 'email' && !useOtp && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <input
                    type="password"
                    className={INPUT_CLASSES}
                    placeholder="Enter your password"
                    value={password}
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

                <button
                  type="button"
                  onClick={() => { setUseOtp(true); setError(null) }}
                  className="w-full text-sm text-steps-blue-600 hover:text-steps-blue-800 py-1 font-medium"
                >
                  Use a verification code instead
                </button>
              </>
            )}

            {step === 'email' && useOtp && (
              <>
                <PressableButton
                  onClick={handleSendOtp}
                  disabled={loading || !email.trim()}
                  fullWidth
                >
                  {loading ? 'Sending…' : 'Send verification code'}
                </PressableButton>

                <button
                  type="button"
                  onClick={() => { setUseOtp(false); setError(null) }}
                  className="w-full text-sm text-steps-blue-600 hover:text-steps-blue-800 py-1 font-medium"
                >
                  Sign in with password instead
                </button>
              </>
            )}

            {step === 'otp' && (
              <>
                <p className="text-sm text-slate-600">
                  We sent a 6-digit code to <span className="font-medium text-steps-dark">{email}</span>.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Verification code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className={`${INPUT_CLASSES} tracking-widest text-center font-semibold`}
                    placeholder="000000"
                    value={otpCode}
                    onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleVerifyOtp() }}
                  />
                </div>

                <PressableButton
                  onClick={handleVerifyOtp}
                  disabled={loading || otpCode.length < 6}
                  fullWidth
                >
                  {loading ? 'Verifying…' : 'Verify & sign in'}
                </PressableButton>

                <button
                  type="button"
                  onClick={() => { setStep('email'); setOtpCode(''); setError(null) }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
                >
                  ← Back
                </button>
              </>
            )}

            {error && (
              <p className="text-sm text-steps-berry bg-steps-berry/10 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          <div className="mt-6 text-center text-sm text-slate-500">
            <Link href="https://thestepsfoundation.com" className="hover:text-steps-blue-600 transition-colors">
              ← Back to The Steps Foundation
            </Link>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-slate-400 tracking-wide uppercase">
        <em className="not-italic">Virtus non origo</em> &nbsp;&middot;&nbsp; Character, not origin
      </footer>
    </div>
  )
}
