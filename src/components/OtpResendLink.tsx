'use client'

/**
 * Resend-OTP affordance.
 *
 * UX contract:
 *   - Shows a muted "Didn't arrive? You can resend in Ns" line for the first
 *     30 seconds after the OTP was sent (the grace period so eager users
 *     don't spam-resend before the first email arrives).
 *   - After that, surfaces a clickable "Resend code" link.
 *   - After a resend, starts a 60-second cooldown where the link is disabled
 *     again with a live countdown.
 *   - Any errors from the resend callback are surfaced inline below.
 *
 * The parent passes in the async resend fn; this component owns its own
 * timers so the two consumer pages (/apply OTP step, /my/sign-in OTP step)
 * stay simple.
 */

import { useEffect, useRef, useState } from 'react'

type Props = {
  /** Fires the actual resend. Return `{ error?: string }` so we can surface failures. */
  onResend: () => Promise<{ error?: string | null }>
  /** Reset the timers when the parent remounts the OTP step. Pass a stable key (e.g. email). */
  resetKey?: string
  /** Seconds before the resend link appears for the first time. Default 30. */
  graceSeconds?: number
  /** Seconds of cooldown between resends. Default 60. */
  cooldownSeconds?: number
}

export function OtpResendLink({ onResend, resetKey, graceSeconds = 30, cooldownSeconds = 60 }: Props) {
  // `secondsLeft > 0` means: link disabled, show countdown.
  const [secondsLeft, setSecondsLeft] = useState(graceSeconds)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentOk, setSentOk] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // (Re)start the countdown whenever the parent tells us the OTP step (re)mounted.
  useEffect(() => {
    setSecondsLeft(graceSeconds)
    setError(null)
    setSentOk(false)
  }, [resetKey, graceSeconds])

  useEffect(() => {
    if (secondsLeft <= 0) return
    intervalRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1))
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [secondsLeft])

  const handleResend = async () => {
    if (sending || secondsLeft > 0) return
    setSending(true)
    setError(null)
    setSentOk(false)
    const { error: err } = await onResend()
    setSending(false)
    if (err) {
      setError(err)
      return
    }
    setSentOk(true)
    setSecondsLeft(cooldownSeconds)
  }

  return (
    <div className="mt-3 text-center text-sm">
      {secondsLeft > 0 ? (
        <p className="text-gray-500">
          Didn&apos;t arrive?{' '}
          <span className="text-gray-400">You can resend in {secondsLeft}s</span>
        </p>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={sending}
          className="text-steps-blue-600 hover:text-steps-blue-700 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Resend code'}
        </button>
      )}
      {sentOk && secondsLeft > 0 && (
        <p className="mt-1 text-xs text-emerald-600">A new code is on its way.</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
