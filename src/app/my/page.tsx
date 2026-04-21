'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SchoolPicker, { SchoolPickerValue } from '@/components/SchoolPicker'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import Link from 'next/link'
import {
  fetchProfile, updateProfile, fetchMyApplications, fetchOpenEvents,
  signOut, getAuthEmail, withdrawApplication,
  type HubApplication, type HubEvent, type ProfileUpdate,
} from '@/lib/hub-api'
import { getDisplayLocation } from '@/lib/event-display'
import { hasPasswordSet, upgradeToPassword, type StudentSelf } from '@/lib/apply-api'
import { clearAllDrafts } from '@/lib/apply-draft'
import { getStatusMeta } from '@/lib/application-status'
import { supabase } from '@/lib/supabase'
import { stripToText } from '@/lib/sanitize-html'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHOOL_TYPE_OPTIONS = [
  { value: 'state', label: 'State non-selective school' },
  { value: 'grammar', label: 'State selective / grammar school' },
  { value: 'independent', label: 'Independent (fee-paying) school' },
  { value: 'independent_bursary', label: 'Independent with 90%+ bursary' },
]

const INCOME_OPTIONS = [
  { value: 'under_40k', label: 'Yes — under £40k' },
  { value: 'over_40k', label: 'No — £40k or more' },
  { value: 'prefer_na', label: 'Prefer not to say' },
]



function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StudentHub() {
  const router = useRouter()
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StudentSelf | null>(null)
  const [applications, setApplications] = useState<HubApplication[]>([])
  const [openEvents, setOpenEvents] = useState<HubEvent[]>([])

  // Edit mode
  const [editing, setEditing] = useState(false)

  // Set-a-password prompt (shown to OTP-only users on first sign-in). Dismissal
  // is persisted per-email in localStorage so it doesn't nag after "Not now".
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [pwValue, setPwValue] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaved, setPwSaved] = useState(false)

  const PW_DISMISS_KEY = (email: string) => `hub_pw_prompt_dismissed_v1::${email.toLowerCase()}`

  const dismissPasswordPrompt = () => {
    if (authEmail) {
      try { localStorage.setItem(PW_DISMISS_KEY(authEmail), '1') } catch {}
    }
    setShowPasswordPrompt(false)
  }

  const handleSetPassword = async () => {
    setPwError(null)
    if (pwValue.length < 8) { setPwError('Use at least 8 characters.'); return }
    if (pwValue !== pwConfirm) { setPwError('Passwords do not match.'); return }
    setPwSaving(true)
    const { error } = await upgradeToPassword(pwValue)
    setPwSaving(false)
    if (error) { setPwError(error); return }
    setPwSaved(true)
    if (authEmail) {
      try { localStorage.setItem(PW_DISMISS_KEY(authEmail), '1') } catch {}
    }
    setTimeout(() => setShowPasswordPrompt(false), 1500)
  }

  // Withdraw flow
  const [withdrawTarget, setWithdrawTarget] = useState<HubApplication | null>(null)
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null)

  const handleWithdraw = async () => {
    if (!withdrawTarget) return
    setWithdrawLoading(true)
    setWithdrawError(null)
    const { error } = await withdrawApplication(withdrawTarget.id)
    setWithdrawLoading(false)
    if (error) {
      setWithdrawError(error)
      return
    }
    const eventName = withdrawTarget.event.name
    setWithdrawTarget(null)
    setWithdrawSuccess(`Your application to ${eventName} has been withdrawn.`)
    // Reload applications to reflect the new status
    const fresh = await fetchMyApplications()
    setApplications(fresh)
  }

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Editable fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [school, setSchool] = useState<SchoolPickerValue>({ schoolId: null, schoolNameRaw: null })
  const [yearGroup, setYearGroup] = useState<number | ''>('')
  const [schoolType, setSchoolType] = useState('')
  const [freeSchoolMeals, setFreeSchoolMeals] = useState<boolean | null>(null)
  const [incomeBand, setIncomeBand] = useState('')

  const populateForm = useCallback((p: StudentSelf) => {
    setFirstName(p.first_name ?? '')
    setLastName(p.last_name ?? '')
    setSchool({ schoolId: p.school_id, schoolNameRaw: p.school_name_raw })
    setYearGroup(p.year_group ?? '')
    setSchoolType(p.school_type ?? '')
    setFreeSchoolMeals(p.free_school_meals)
    setIncomeBand(p.parental_income_band ?? '')
  }, [])

  // Load everything on mount. We're deliberately patient about session
  // hydration: after a fresh sign-in or password upgrade, the auth state can
  // take a tick to land in localStorage, so we retry a few times before
  // giving up and redirecting.
  useEffect(() => {
    let cancelled = false

    const waitForSession = async (): Promise<string | null> => {
      // Up to ~5s — the session write from sign-in can be slow on
      // cold-start because Supabase boots its internal state from
      // storage and may need a tick to settle.
      for (let i = 0; i < 50; i++) {
        if (cancelled) return null
        const email = await getAuthEmail()
        if (email) return email
        await new Promise(r => setTimeout(r, 100))
      }
      return null
    }

    const loadAll = async (email: string) => {
      if (cancelled) return
      setAuthEmail(email)
      const [prof, apps, events] = await Promise.all([
        fetchProfile(),
        fetchMyApplications(),
        fetchOpenEvents(),
      ])
      if (cancelled) return
      setProfile(prof)
      if (prof) populateForm(prof)
      setApplications(apps)
      const appliedEventIds = new Set(apps.map(a => a.event_id))
      setOpenEvents(events.filter(e => !appliedEventIds.has(e.id)))
      // Decide whether to show the "set a password" prompt: only if the
      // user hasn't already set one AND they haven't dismissed the prompt.
      try {
        const dismissed = localStorage.getItem(PW_DISMISS_KEY(email)) === '1'
        if (!dismissed) {
          const has = await hasPasswordSet()
          if (!cancelled && !has) setShowPasswordPrompt(true)
        }
      } catch { /* ignore */ }
      setLoading(false)
    }

    ;(async () => {
      const email = await waitForSession()
      if (cancelled) return
      if (!email) {
        // Diagnostic: dump what we see in storage so we can tell whether
        // Supabase wrote the session at all, or whether it's there but the
        // client can't read it. Safe to leave in — only logs on failure.
        try {
          if (typeof window !== 'undefined') {
            const keys = Object.keys(window.localStorage).filter(k => k.startsWith('sb-'))
            console.warn('[hub] no session after 5s. sb-* localStorage keys:', keys)
            for (const k of keys) {
              const v = window.localStorage.getItem(k)
              console.warn('[hub]   ', k, '=', v ? v.slice(0, 80) + '...' : '(empty)')
            }
            const s = await supabase.auth.getSession()
            const u = await supabase.auth.getUser()
            console.warn('[hub] getSession:', s, 'getUser:', u)
          }
        } catch (e) { console.warn('[hub] diag failed:', e) }
        router.replace('/my/sign-in')
        return
      }
      await loadAll(email)
    })()

    // If auth changes mid-session (token refresh, re-sign-in, sign-out), react.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        router.replace('/my/sign-in')
        return
      }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        // Reload data with the fresh session — covers the "applied, then hub is empty" case.
        loadAll(session.user.email.toLowerCase())
      }
    })

    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [router, populateForm])

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setSaveMsg(null)

    const updates: ProfileUpdate = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      school_id: school.schoolId,
      school_name_raw: school.schoolNameRaw,
      year_group: yearGroup ? Number(yearGroup) : null,
      school_type: schoolType,
      free_school_meals: freeSchoolMeals,
      parental_income_band: incomeBand,
    }

    const { error } = await updateProfile(profile.id, updates)
    setSaving(false)

    if (error) {
      setSaveMsg(`Error: ${error}`)
    } else {
      setSaveMsg('Saved!')
      setProfile(prev => prev ? { ...prev, ...updates, personal_email: prev.personal_email } : prev)
      setEditing(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  const handleSignOut = async () => {
    clearAllDrafts() // wipe any apply-page drafts before we drop the session
    await signOut()
    router.replace('/my/sign-in')
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Loading your hub…</p>
        </div>
      </div>
    )
  }

  // --- Render ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <TopNav>
        <span className="hidden sm:block text-sm text-slate-600">{authEmail}</span>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
        >
          Sign out
        </button>
      </TopNav>

      <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 bg-steps-blue-100 text-steps-blue-700 text-xs font-semibold tracking-wide uppercase px-3 py-1 rounded-full mb-3">
            Student Hub
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-black text-steps-dark tracking-tight">
            {profile?.first_name ? `Hey, ${profile.first_name}!` : 'Welcome'}
          </h1>
          <p className="text-slate-500 text-sm mt-2">{authEmail}</p>
        </div>

      {/* Success banner */}
      {saveMsg && (
        <div className={`mb-6 p-4 rounded-xl text-sm font-medium ${saveMsg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {saveMsg}
        </div>
      )}

      {/* Set-a-password prompt — shown to OTP-only users who haven't dismissed it */}
      {showPasswordPrompt && !pwSaved && (
        <div className="mb-6 bg-gradient-to-br from-steps-blue-50 to-white rounded-2xl border border-steps-blue-200 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-display text-lg font-bold text-steps-dark">Set a password</h3>
              <p className="text-sm text-slate-600 mt-1">
                So you don&apos;t need a code next time — you can sign in instantly with your email and password.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissPasswordPrompt}
              className="text-slate-400 hover:text-slate-600 -mr-1"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="password"
              value={pwValue}
              onChange={e => { setPwValue(e.target.value); setPwError(null) }}
              placeholder="New password (min 8 chars)"
              autoComplete="new-password"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
            />
            <input
              type="password"
              value={pwConfirm}
              onChange={e => { setPwConfirm(e.target.value); setPwError(null) }}
              placeholder="Confirm password"
              autoComplete="new-password"
              onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
            />
          </div>
          {pwError && (
            <p className="text-sm text-steps-berry bg-steps-berry/10 rounded-lg px-3 py-2 mt-3">{pwError}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <PressableButton onClick={handleSetPassword} disabled={pwSaving || !pwValue} size="sm">
              {pwSaving ? 'Saving…' : 'Set password'}
            </PressableButton>
            <button
              type="button"
              onClick={dismissPasswordPrompt}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {showPasswordPrompt && pwSaved && (
        <div className="mb-6 bg-green-50 text-green-800 border border-green-200 rounded-2xl p-4 text-sm">
          Password set — you can use it to sign in next time.
        </div>
      )}

      {/* ================================================================ */}
      {/* SECTION 1: Open Events — Apply Now */}
      {/* ================================================================ */}
      {openEvents.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Apply now</h2>
          <div className="space-y-4">
            {openEvents.map(event => {
              const publicLocation = getDisplayLocation(event, false)
              return (
              <Link
                key={event.id}
                href={`/my/events/${event.id}`}
                className="relative block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md hover:border-steps-blue-200 transition group"
              >
                <div className="flex items-stretch min-h-[160px] sm:min-h-[200px]">
                  <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
                    <h3 className="font-semibold text-gray-900 text-lg group-hover:text-steps-blue-700 transition">
                      {event.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 mt-1.5">
                      {event.event_date && <span>{formatDate(event.event_date)}</span>}
                      {event.time_start && (
                        <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>
                      )}
                      {publicLocation && <span>{publicLocation}</span>}
                      {event.format && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          {event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : event.format}
                        </span>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-sm text-gray-500 mt-3 line-clamp-3">{stripToText(event.description)}</p>
                    )}
                    <div className="mt-auto pt-3 flex items-center justify-between gap-3">
                      {event.applications_close_at ? (
                        <p className="text-xs text-steps-blue-600 font-medium">
                          Applications close {new Date(event.applications_close_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      ) : <span />}
                      <span className="flex-shrink-0 px-4 py-2 bg-steps-blue-600 text-white text-sm font-semibold rounded-xl border-t border-white/20 shadow-press-blue group-hover:shadow-press-blue-hover group-hover:-translate-y-0.5 transition-all">
                        View &amp; apply
                      </span>
                    </div>
                  </div>
                  {event.hub_image_url && (
                    <div className="flex-shrink-0 w-32 sm:w-60 self-stretch bg-gray-100 relative border-l border-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={event.hub_image_url}
                        alt={event.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ objectPosition: `${event.hub_focal_x ?? 50}% ${event.hub_focal_y ?? 50}%` }}
                      />
                    </div>
                  )}
                </div>
              </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* SECTION 2: My Applications */}
      {/* ================================================================ */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My applications</h2>
        {applications.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            {openEvents.length > 0 ? (
              <>
                <p className="text-gray-500 text-sm">You haven&apos;t applied to any events yet.</p>
                <p className="text-steps-blue-600 text-sm mt-2 font-medium">Check out the open events above!</p>
              </>
            ) : (
              <>
                <p className="text-gray-700 text-sm font-medium">No new opportunities right now</p>
                <p className="text-gray-500 text-sm mt-1">We&apos;ll email you when the next round opens &mdash; keep an eye on your inbox.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {applications.map(app => {
              const statusMeta = getStatusMeta(app.status)
              const isPast = app.event.event_date && new Date(app.event.event_date) < new Date()
              const canSeeFull = app.status === 'accepted'
              const displayLocation = getDisplayLocation(app.event, canSeeFull)
              const stopNav = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation() }
              return (
                <Link
                  key={app.id}
                  href={`/my/events/${app.event.id}`}
                  className="relative block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md hover:border-steps-blue-200 transition group"
                >
                  <div className="flex items-stretch min-h-[140px] sm:min-h-[180px]">
                    <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 text-lg group-hover:text-steps-blue-700 transition">{app.event.name}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusMeta.badgeClasses}`}>
                          {statusMeta.studentLabel}
                        </span>
                        {isPast && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400">
                            Past event
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 mt-1.5">
                        {app.event.event_date && <span>{formatDate(app.event.event_date)}</span>}
                        {displayLocation && <span>{displayLocation}</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        Applied {new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      {!isPast && app.status !== 'withdrew' && app.status !== 'rejected' && (
                        <div className="mt-auto pt-3 flex flex-wrap gap-2">
                          {app.status === 'submitted' && (
                            <a
                              href={`/apply/${app.event.slug}?edit=1`}
                              onClick={e => e.stopPropagation()}
                              className="px-3 py-1.5 text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium border border-steps-blue-200 rounded-xl hover:bg-steps-blue-50 transition text-center"
                            >
                              Edit application
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={e => { stopNav(e); setWithdrawTarget(app); setWithdrawError(null) }}
                            className="px-3 py-1.5 text-sm text-steps-berry hover:text-white font-medium border border-steps-berry/40 rounded-xl hover:bg-steps-berry transition"
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </div>
                    {app.event.hub_image_url && (
                      <div className="flex-shrink-0 w-32 sm:w-56 self-stretch bg-gray-100 relative border-l border-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={app.event.hub_image_url}
                          alt={app.event.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ objectPosition: `${app.event.hub_focal_x ?? 50}% ${app.event.hub_focal_y ?? 50}%` }}
                        />
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* SECTION 3: My Details */}
      {/* ================================================================ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">My details</h2>
          {!editing && profile && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-steps-blue-600 hover:text-steps-blue-800 font-medium"
            >
              Edit
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {!profile ? (
            <p className="text-gray-500 text-sm">No profile found. Apply to an event to create your profile.</p>
          ) : editing ? (
            /* ---- Edit mode ---- */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                  <input
                    type="text" value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                  <input
                    type="text" value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">School</label>
                <SchoolPicker value={school} onChange={setSchool} placeholder="Search for your school…" id="hub-school" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year group</label>
                <select
                  value={yearGroup}
                  onChange={e => setYearGroup(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
                >
                  <option value="">Select…</option>
                  <option value={12}>Year 12</option>
                  <option value={13}>Year 13</option>
                  <option value={14}>Gap year</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">School type</label>
                <select
                  value={schoolType}
                  onChange={e => setSchoolType(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
                >
                  <option value="">Select…</option>
                  {SCHOOL_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Eligible for Free School Meals?</label>
                <div className="flex gap-4">
                  {[
                    { v: true, l: 'Yes' },
                    { v: false, l: 'No' },
                  ].map(opt => (
                    <label key={String(opt.v)} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio" name="fsm"
                        checked={freeSchoolMeals === opt.v}
                        onChange={() => setFreeSchoolMeals(opt.v)}
                        className="accent-steps-blue-600"
                      />
                      <span className="text-sm text-gray-700">{opt.l}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Household income under £40k?</label>
                <select
                  value={incomeBand}
                  onChange={e => setIncomeBand(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
                >
                  <option value="">Select…</option>
                  {INCOME_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setEditing(false); if (profile) populateForm(profile) }}
                  className="px-6 py-2.5 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition text-sm"
                >
                  Cancel
                </button>
                <PressableButton
                  onClick={handleSave}
                  disabled={saving}
                  size="sm"
                  fullWidth
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </PressableButton>
              </div>
            </div>
          ) : (
            /* ---- View mode ---- */
            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
              <Detail label="First name" value={profile.first_name} />
              <Detail label="Last name" value={profile.last_name} />
              <Detail label="Email" value={profile.personal_email} />
              <Detail label="Year group" value={profile.year_group ? `Year ${profile.year_group}` : null} />
              <Detail label="School" value={profile.school_name_raw} className="col-span-2" />
              <Detail
                label="School type"
                value={SCHOOL_TYPE_OPTIONS.find(o => o.value === profile.school_type)?.label ?? profile.school_type}
              />
              <Detail
                label="Free School Meals"
                value={profile.free_school_meals === true ? 'Yes' : profile.free_school_meals === false ? 'No' : null}
              />
              <Detail
                label="Household income"
                value={INCOME_OPTIONS.find(o => o.value === profile.parental_income_band)?.label ?? profile.parental_income_band}
              />
            </div>
          )}
        </div>
      </div>

        <p className="text-center text-xs text-slate-400 mt-12 tracking-wide uppercase">
          <em className="not-italic">Virtus non origo</em> &nbsp;·&nbsp; Character, not origin
        </p>
      </div>

      {/* Success toast after withdraw */}
      {withdrawSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[90%]">
          <div className="bg-white rounded-2xl shadow-xl border border-emerald-200 px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-steps-dark">Application withdrawn</p>
              <p className="text-xs text-slate-600 mt-0.5">{withdrawSuccess}</p>
            </div>
            <button
              type="button"
              onClick={() => setWithdrawSuccess(null)}
              className="text-slate-400 hover:text-slate-600 -mr-1"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Withdraw confirmation modal */}
      {withdrawTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 max-w-md w-full">
            <h3 className="font-display text-xl font-bold text-steps-dark mb-1">
              Withdraw your application?
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              You're about to withdraw your application to <span className="font-semibold text-steps-dark">{withdrawTarget.event.name}</span>.
              This can&apos;t be undone &mdash; if you change your mind, you&apos;ll need to reapply.
            </p>

            {withdrawError && (
              <p className="mb-4 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{withdrawError}</p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => { setWithdrawTarget(null); setWithdrawError(null) }}
                disabled={withdrawLoading}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition disabled:opacity-50"
              >
                Keep my application
              </button>
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={withdrawLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-steps-berry rounded-xl hover:bg-steps-berry/90 transition disabled:opacity-60"
              >
                {withdrawLoading ? 'Withdrawing\u2026' : 'Yes, withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Detail({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value || <span className="text-gray-300">—</span>}</dd>
    </div>
  )
}
