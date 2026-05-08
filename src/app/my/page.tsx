'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import SchoolPicker, { SchoolPickerValue } from '@/components/SchoolPicker'
import QualificationsEditor, { defaultQualifications } from '@/components/QualificationsEditor'
import { TopNav } from '@/components/TopNav'
import { PressableButton } from '@/components/PressableButton'
import Link from 'next/link'
import {
  fetchProfile, updateProfile, fetchMyApplications, fetchOpenEvents,
  signOut, getAuthEmail, withdrawApplication,
  type HubApplication, type HubEvent, type ProfileUpdate,
} from '@/lib/hub-api'
import { getDisplayLocation } from '@/lib/event-display'
import { formatOpenTo } from '@/lib/events-api'
import { isEligibleForYearGroup as isEligibleForYG } from '@/lib/eligibility'
import { hasPasswordSet, upgradeToPassword, type StudentSelf } from '@/lib/apply-api'
import { clearAllDrafts } from '@/lib/apply-draft'
import { getJourneyAwareLabel } from '@/lib/application-status'
import { supabase } from '@/lib/supabase-student'
import { supabase as adminSupabase } from '@/lib/supabase'
import { stripToText } from '@/lib/sanitize-html'

// ---------------------------------------------------------------------------
// /my — student dashboard.
//
// Wave 1 redesign (Apr 2026): bigger editorial hero with a "next up"
// highlight strip surfacing the most actionable application/event,
// sticky in-page section nav, journey-timeline mini-component on
// application cards, deadline-emphasis pills on open events, and
// improved empty states. All state machinery, handlers, and API calls
// preserved from the previous version.
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

function formatShortDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function StudentHubInner() {
  const router = useRouter()
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StudentSelf | null>(null)
  const [applications, setApplications] = useState<HubApplication[]>([])
  const [openEvents, setOpenEvents] = useState<HubEvent[]>([])
  // Admin-preview mode — set when admin opens /my from the Hub Preview overlay.
  // Two flavours: a real student (?_admin_preview=<student_uuid>) or a
  // synthetic profile (?_admin_preview=synthetic&_payload=<base64>).
  // In either case, real student auth is bypassed; the page reads from the
  // admin API or from the URL payload, and Apply buttons route to test mode.
  const searchParams = useSearchParams()
  const adminPreviewParam = searchParams?.get('_admin_preview') ?? null
  const adminPreviewPayload = searchParams?.get('_payload') ?? null
  const adminPreviewKey = searchParams?.get('_key') ?? null
  const adminPreviewMode: 'real' | 'synthetic' | null = adminPreviewParam === 'synthetic' ? 'synthetic' : adminPreviewParam ? 'real' : null
  // Querystring used to preserve admin-preview through nav into /my/events/[id]
  const previewQuerystring = adminPreviewMode === 'synthetic'
    ? (adminPreviewKey
        ? `?_admin_preview=synthetic&_key=${encodeURIComponent(adminPreviewKey)}`
        : adminPreviewPayload
        ? `?_admin_preview=synthetic&_payload=${encodeURIComponent(adminPreviewPayload)}`
        : '?_admin_preview=synthetic')
    : adminPreviewMode === 'real' && adminPreviewParam
    ? `?_admin_preview=${adminPreviewParam}`
    : ''

  // Eligibility filtering
  const yg = profile?.year_group ?? null
  const isEligibleForYearGroup = (event: HubEvent): boolean => isEligibleForYG(event, yg)
  const eligibleOpenEvents = openEvents.filter(isEligibleForYearGroup)
  const ineligibleOpenEvents = openEvents.filter(e => !isEligibleForYearGroup(e))

  // Edit mode
  const [editing, setEditing] = useState(false)

  // Set-password upsell prompt (OTP-only users)
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [pwValue, setPwValue] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaved, setPwSaved] = useState(false)

  const PW_DISMISS_KEY = (email: string) => `hub_pw_prompt_dismissed_v1::${email.toLowerCase()}`

  const dismissPasswordPrompt = () => {
    setShowPasswordPrompt(false)
    if (authEmail) try { localStorage.setItem(PW_DISMISS_KEY(authEmail), '1') } catch {}
  }

  const handleSetPassword = async () => {
    if (!pwValue) return
    if (pwValue !== pwConfirm) { setPwError('Passwords do not match.'); return }
    if (pwValue.length < 8) { setPwError('Use at least 8 characters.'); return }
    setPwSaving(true); setPwError(null)
    const { error } = await upgradeToPassword(pwValue)
    setPwSaving(false)
    if (error) { setPwError(error); return }
    setPwSaved(true)
    setPwValue(''); setPwConfirm('')
  }

  // Withdraw modal
  const [withdrawTarget, setWithdrawTarget] = useState<HubApplication | null>(null)
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null)

  const handleWithdraw = async () => {
    if (!withdrawTarget) return
    setWithdrawLoading(true); setWithdrawError(null)
    const { error } = await withdrawApplication(withdrawTarget.id)
    setWithdrawLoading(false)
    if (error) { setWithdrawError(error); return }
    const eventName = withdrawTarget.event.name
    setWithdrawTarget(null)
    setWithdrawSuccess(`Your application to ${eventName} has been withdrawn.`)
    setTimeout(() => setWithdrawSuccess(null), 5000)
    const fresh = await fetchMyApplications()
    setApplications(fresh)
  }

  // Save profile state
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Form state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [school, setSchool] = useState<SchoolPickerValue>({ schoolId: null, schoolNameRaw: null })
  const [yearGroup, setYearGroup] = useState<number | ''>('')
  const [schoolType, setSchoolType] = useState('')
  const [freeSchoolMeals, setFreeSchoolMeals] = useState<boolean | null>(null)
  const [incomeBand, setIncomeBand] = useState('')
  const [firstGenerationUni, setFirstGenerationUni] = useState<'yes' | 'no' | ''>('')
  const [gcseResults, setGcseResults] = useState('')
  const [qualifications, setQualifications] = useState<import('@/lib/apply-api').QualificationEntry[]>(defaultQualifications())
  const [additionalContext, setAdditionalContext] = useState('')
  const [qualificationsError, setQualificationsError] = useState<string | null>(null)

  const populateForm = useCallback((p: StudentSelf) => {
    setFirstName(p.first_name || '')
    setLastName(p.last_name || '')
    setSchool({ schoolId: p.school_id, schoolNameRaw: p.school_name_raw })
    setYearGroup(p.year_group ?? '')
    setSchoolType(p.school_type || '')
    setFreeSchoolMeals(p.free_school_meals)
    setIncomeBand(p.parental_income_band || '')
    setFirstGenerationUni(p.first_generation_uni === true ? 'no' : p.first_generation_uni === false ? 'yes' : '')
    setGcseResults(p.gcse_results || '')
    setQualifications(Array.isArray(p.qualifications) && p.qualifications.length > 0 ? p.qualifications : defaultQualifications())
    setAdditionalContext(p.additional_context || '')
  }, [])

  useEffect(() => {
    let cancelled = false

    // Admin-preview short-circuit: skip student auth entirely. Verify admin
    // auth via the admin Supabase client (separate session), then load data
    // from the API route (real-student) or decode it from URL (synthetic).
    if (adminPreviewMode) {
      ;(async () => {
        const { data: { session } } = await adminSupabase.auth.getSession()
        const adminToken = session?.access_token
        if (!adminToken) {
          // Not signed in as admin — surface a friendly placeholder.
          setLoading(false)
          setApplications([])
          setOpenEvents([])
          setProfile(null)
          setAuthEmail('preview@thestepsfoundation.com')
          return
        }
        if (adminPreviewMode === 'synthetic' && (adminPreviewKey || adminPreviewPayload)) {
          try {
            let decoded: { profile?: Record<string, unknown>; applications?: unknown[]; openEvents?: unknown[] } = {}
            if (adminPreviewKey) {
              const raw = typeof window !== 'undefined' ? localStorage.getItem(adminPreviewKey) : null
              if (raw) decoded = JSON.parse(raw)
            } else if (adminPreviewPayload) {
              // Legacy fallback — URL-embedded base64 payload.
              try {
                decoded = JSON.parse(atob(adminPreviewPayload))
              } catch {
                // btoa/atob can't handle Unicode — try the URI-encoded form.
                try { decoded = JSON.parse(decodeURIComponent(adminPreviewPayload)) } catch {}
              }
            }
            if (cancelled) return
            const p = (decoded.profile ?? {}) as Record<string, unknown>
            const synthProfile: StudentSelf = {
              id: 'synthetic',
              first_name: typeof p.first_name === 'string' ? p.first_name : 'Sample',
              last_name: typeof p.last_name === 'string' ? p.last_name : 'Student',
              personal_email: 'preview@thestepsfoundation.com',
              school_id: null,
              school_name_raw: typeof p.school_name_raw === 'string' ? p.school_name_raw : null,
              year_group: typeof p.year_group === 'number' ? p.year_group : 12,
              school_type: typeof p.school_type === 'string' ? p.school_type : 'state',
              free_school_meals: typeof p.free_school_meals === 'boolean' ? p.free_school_meals : true,
              parental_income_band: typeof p.parental_income_band === 'string' ? p.parental_income_band : 'under_40k',
              first_generation_uni: typeof p.first_generation_uni === 'boolean' ? p.first_generation_uni : false,
              gcse_results: null,
              qualifications: null,
              additional_context: null,
            }
            setProfile(synthProfile)
            populateForm(synthProfile)
            setApplications((decoded.applications ?? []) as HubApplication[])
            setOpenEvents((decoded.openEvents ?? []) as HubEvent[])
            setAuthEmail('preview@thestepsfoundation.com')
            setLoading(false)
          } catch {
            setLoading(false)
          }
          return
        }
        // Real-student preview: hit the admin API
        try {
          const r = await fetch(`/api/admin/preview-student-data?student_id=${encodeURIComponent(adminPreviewParam!)}`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          })
          const data = await r.json()
          if (cancelled || !r.ok) { setLoading(false); return }
          setProfile(data.profile as StudentSelf)
          populateForm(data.profile as StudentSelf)
          setApplications((data.applications ?? []) as HubApplication[])
          setOpenEvents((data.openEvents ?? []) as HubEvent[])
          setAuthEmail(data.profile?.personal_email ?? 'preview@thestepsfoundation.com')
          setLoading(false)
        } catch {
          setLoading(false)
        }
      })()
      return () => { cancelled = true }
    }

    const waitForSession = async (): Promise<string | null> => {
      for (let i = 0; i < 25 && !cancelled; i++) {
        const email = await getAuthEmail()
        if (email) return email
        await new Promise(r => setTimeout(r, 200))
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
      if (prof) { setProfile(prof); populateForm(prof) }
      setApplications(apps)
      const appliedEventIds = new Set(apps.map(a => a.event_id))
      setOpenEvents(events.filter(e => !appliedEventIds.has(e.id)))
      setLoading(false)

      try {
        const dismissed = localStorage.getItem(PW_DISMISS_KEY(email)) === '1'
        if (!dismissed) {
          const has = await hasPasswordSet()
          if (!cancelled && !has) setShowPasswordPrompt(true)
        }
      } catch {}
    }

    ;(async () => {
      const email = await waitForSession()
      if (cancelled) return
      if (!email) {
        if (typeof window !== 'undefined' && window.location.pathname === '/my') {
          try {
            const allKeys = Object.keys(window.localStorage)
            const s = await supabase.auth.getSession()
            const u = await supabase.auth.getUser()
            console.log('[/my] no email after waitForSession', { storageKeys: allKeys, session: s.data.session, user: u.data.user })
          } catch {}
          router.replace('/my/sign-in')
        }
        return
      }
      await loadAll(email)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      const newEmail = session?.user?.email ?? null
      if (event === 'SIGNED_OUT' || !newEmail) {
        router.replace('/my/sign-in')
        return
      }
      if (newEmail !== authEmail) loadAll(newEmail)
    })

    return () => { cancelled = true; sub.subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [populateForm, router])

  const handleSave = async () => {
    if (!profile) return
    setSaving(true); setSaveMsg(null); setQualificationsError(null)

    const yearGroupLocked = profile.year_group != null
    if (!yearGroupLocked && yearGroup === '') {
      setSaving(false); setSaveMsg('Please select your year group.'); return
    }

    const filledQuals = qualifications.filter(q => q.subject && q.grade)
    const incompleteQuals = qualifications.filter(q => (q.subject && !q.grade) || (!q.subject && q.grade))
    const ibMissingLevel = qualifications.filter(q => q.qualType === 'ib' && q.subject && !q.level)
    if (incompleteQuals.length > 0) {
      setSaving(false)
      setQualificationsError('Each subject row needs both a subject and a grade — or remove the row.')
      return
    }
    if (ibMissingLevel.length > 0) {
      setSaving(false)
      setQualificationsError('IB subjects need a level (HL or SL).')
      return
    }

    const updates: ProfileUpdate = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      school_id: school.schoolId,
      school_name_raw: school.schoolNameRaw,
      year_group: yearGroupLocked ? profile.year_group : (yearGroup === '' ? null : Number(yearGroup)),
      school_type: schoolType || null,
      free_school_meals: freeSchoolMeals,
      parental_income_band: incomeBand || null,
      first_generation_uni: firstGenerationUni === 'yes' ? false : firstGenerationUni === 'no' ? true : null,
      gcse_results: gcseResults.trim() || null,
      qualifications: filledQuals.length > 0 ? filledQuals : null,
      additional_context: additionalContext.trim() || null,
    }

    const { error } = await updateProfile(profile.id, updates)
    setSaving(false)
    if (error) { setSaveMsg('Error: ' + error); return }
    setSaveMsg('Saved!')
    setEditing(false)
    setTimeout(() => setSaveMsg(null), 3000)
    const fresh = await fetchProfile()
    if (fresh) { setProfile(fresh); populateForm(fresh) }
  }

  const handleSignOut = async () => {
    clearAllDrafts()
    await signOut()
    router.replace('/my/sign-in')
  }

  // -------------------------------------------------------------------------
  // Derive "next up" highlight — surfaces the single most actionable thing
  // for this student. Priority order:
  //   1. An accepted event in the next 14 days (RSVP / show up)
  //   2. An application open and eligible for me with a near deadline
  //   3. Anything submitted/under-review (still gives a sense of progress)
  // -------------------------------------------------------------------------
  const nextUp = useMemo(() => {
    const upcomingAccepted = applications
      .filter(a => a.status === 'accepted' && a.event.event_date)
      .map(a => ({ a, days: daysUntil(a.event.event_date) }))
      .filter(x => x.days != null && x.days >= 0 && x.days <= 14)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0]

    if (upcomingAccepted) {
      const d = upcomingAccepted.days ?? 0
      return {
        kind: 'accepted' as const,
        href: `/my/events/${upcomingAccepted.a.event.id}`,
        eventName: upcomingAccepted.a.event.name,
        eventDate: upcomingAccepted.a.event.event_date,
        eyebrow: d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`,
        line: 'You’re in. Tap to see joining details.',
        cta: 'View details',
      }
    }

    const closingSoon = eligibleOpenEvents
      .filter(e => e.applications_close_at)
      .map(e => ({ e, days: daysUntil(e.applications_close_at) }))
      .filter(x => x.days != null && x.days >= 0 && x.days <= 14)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0]

    if (closingSoon) {
      const d = closingSoon.days ?? 0
      return {
        kind: 'closing' as const,
        href: `/my/events/${closingSoon.e.id}`,
        eventName: closingSoon.e.name,
        eventDate: closingSoon.e.event_date,
        eyebrow: d === 0 ? 'Closes today' : d === 1 ? 'Closes tomorrow' : `Closes in ${d} days`,
        line: 'Don’t miss it — applications are open now.',
        cta: 'Apply now',
      }
    }

    // No in-flight fallback. The "Next up" tile is reserved for *actionable*
    // states — accepted-with-event-soon (RSVP / show up) or
    // closing-application (apply now). For passive states like
    // "application in review" the regular application card below already
    // shows the right thing; doubling it up created visual noise and a
    // tile that linked to the same place as the card.

    return null
  }, [applications, eligibleOpenEvents])

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white" role="status" aria-live="polite" aria-label="Loading your hub">
        <div className="text-center">
          <div aria-hidden="true" className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Loading your hub…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <TopNav homeHref={adminPreviewMode ? `/my${previewQuerystring}` : undefined}>
        <span className="hidden sm:block text-sm text-slate-600 truncate max-w-[14rem]">{authEmail}</span>
        {!adminPreviewMode && (
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2"
          >
            Sign out
          </button>
        )}
      </TopNav>
      {adminPreviewMode && (
        <div className="bg-violet-600 text-white text-xs font-semibold px-4 py-1.5 text-center">
          Admin preview · Read-only · Apply (inside detail page) opens test mode
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        {/* === Hero === */}
        <header className="mb-8 animate-tsf-fade-up">
          <div className="inline-flex items-center gap-2 bg-steps-blue-100 text-steps-blue-700 text-xs font-semibold tracking-[0.15em] uppercase px-3 py-1 rounded-full mb-3">
            Student Hub
          </div>
          <h1 className="font-display-tight text-4xl sm:text-5xl font-black text-steps-dark">
            {profile?.first_name ? `Hey, ${profile.first_name}.` : 'Welcome back.'}
          </h1>
          <p className="text-slate-500 text-sm mt-3 sm:hidden">{authEmail}</p>
        </header>

        {/* === Next-up highlight === */}
        {nextUp && (
          <Link
            href={nextUp.href}
            className="group block mb-8 rounded-3xl bg-gradient-to-br from-steps-dark via-steps-blue-800 to-steps-blue-700 text-white p-6 sm:p-7 relative overflow-hidden hover:shadow-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 animate-tsf-fade-up-1"
          >
            <div aria-hidden className="absolute inset-0 bg-tsf-grain pointer-events-none" />
            <div aria-hidden className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-steps-sunrise/30 blur-3xl pointer-events-none" />
            <div className="relative flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-steps-mist font-semibold">
                  Next up · {nextUp.eyebrow}
                </p>
                <h2 className="font-display-tight text-2xl sm:text-3xl font-black mt-2">
                  {nextUp.eventName}
                </h2>
                <p className="text-sm text-white/80 mt-2">{nextUp.line}</p>
                <span className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-steps-mist group-hover:text-white transition-colors">
                  {nextUp.cta}
                  <svg aria-hidden className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
              <div className="hidden sm:flex flex-col items-center justify-center bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-3 py-2 text-center min-w-[68px]">
                <span className="text-[10px] uppercase tracking-wider text-steps-mist font-semibold">{nextUp.eventDate ? new Date(nextUp.eventDate + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) : '—'}</span>
                <span className="text-2xl font-display font-black text-white leading-none mt-0.5">{nextUp.eventDate ? new Date(nextUp.eventDate + 'T00:00:00').getDate() : '—'}</span>
              </div>
            </div>
          </Link>
        )}

        {/* Save banner */}
        {saveMsg && (
          <div
            role={saveMsg.startsWith('Error') ? 'alert' : 'status'}
            aria-live="polite"
            className={`mb-6 p-4 rounded-xl text-sm font-medium ${saveMsg.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}
          >
            {saveMsg}
          </div>
        )}

        {/* Set-password prompt */}
        {showPasswordPrompt && !pwSaved && (
          <div className="mb-8 bg-gradient-to-br from-steps-blue-50 to-white rounded-2xl border border-steps-blue-200 p-5 sm:p-6 animate-tsf-fade-up-2">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-steps-dark">Set a password</h3>
                <p className="text-sm text-slate-600 mt-1">
                  So you don’t need a code next time — sign in instantly with email + password.
                </p>
              </div>
              <button
                type="button"
                onClick={dismissPasswordPrompt}
                className="text-slate-400 hover:text-slate-600 -mr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
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
                aria-label="New password"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
              />
              <input
                type="password"
                value={pwConfirm}
                onChange={e => { setPwConfirm(e.target.value); setPwError(null) }}
                placeholder="Confirm password"
                autoComplete="new-password"
                aria-label="Confirm password"
                onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white"
              />
            </div>
            {pwError && (
              <p role="alert" className="text-sm text-steps-berry bg-steps-berry/10 rounded-lg px-3 py-2 mt-3">{pwError}</p>
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
          <div className="mb-8 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl p-4 text-sm">
            Password set — you can use it to sign in next time.
          </div>
        )}

        {/* === Section: Apply now === */}
        {eligibleOpenEvents.length > 0 && (
          <section className="mb-10 animate-tsf-fade-up-2" aria-labelledby="apply-heading">
            <div className="flex items-baseline justify-between mb-4">
              <h2 id="apply-heading" className="font-display text-xl font-bold text-steps-dark">Apply now</h2>
              <span className="text-xs text-slate-400 uppercase tracking-wider">{eligibleOpenEvents.length} open</span>
            </div>
            <div className="space-y-4">
              {eligibleOpenEvents.map(event => {
                const publicLocation = getDisplayLocation(event, false)
                const closeDays = daysUntil(event.applications_close_at)
                const closingSoon = closeDays !== null && closeDays <= 7
                return (
                  <Link
                    key={event.id}
                    href={`/my/events/${event.id}`}
                    className="relative block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg hover:border-steps-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition-all group"
                  >
                    <div className="flex items-stretch min-h-[160px] sm:min-h-[200px]">
                      <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
                        <h3 className="font-display text-lg sm:text-xl font-bold text-steps-dark group-hover:text-steps-blue-700 transition-colors">
                          {event.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-1.5">
                          {event.event_date && <span className="inline-flex items-center gap-1"><DotIcon /> {formatDate(event.event_date)}</span>}
                          {event.time_start && (
                            <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>
                          )}
                          {publicLocation && <span>{publicLocation}</span>}
                          {event.format && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                              {event.format === 'in_person' ? 'In person' : event.format === 'online' ? 'Online' : event.format}
                            </span>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-sm text-slate-500 mt-3 line-clamp-3">{stripToText(event.description)}</p>
                        )}
                        <div className="mt-auto pt-4 flex items-center justify-between gap-3 flex-wrap">
                          {event.applications_close_at ? (
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${closingSoon ? 'bg-steps-berry/10 text-steps-berry' : 'bg-steps-blue-50 text-steps-blue-700'}`}>
                              {closingSoon ? <ClockIcon /> : <CalendarIcon />}
                              {closeDays === 0 ? 'Closes today' : closeDays === 1 ? 'Closes tomorrow' : closeDays !== null && closeDays > 0 ? `Closes in ${closeDays} days` : `Closes ${formatShortDate(event.applications_close_at)}`}
                            </span>
                          ) : <span />}
                          <span className="flex-shrink-0 px-4 py-2 bg-steps-blue-600 text-white text-sm font-semibold rounded-xl border-t border-white/20 shadow-press-blue group-hover:shadow-press-blue-hover group-hover:-translate-y-0.5 transition-all">
                            View &amp; apply
                          </span>
                        </div>
                      </div>
                      {event.hub_image_url && (
                        <div className="flex-shrink-0 w-32 sm:w-60 self-stretch bg-slate-100 relative border-l border-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={event.hub_image_url}
                            alt=""
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
          </section>
        )}

        {/* === Section: Other upcoming events (greyed) === */}
        {ineligibleOpenEvents.length > 0 && (
          <section className="mb-10" aria-labelledby="other-heading">
            <div className="flex items-baseline justify-between mb-1">
              <h2 id="other-heading" className="font-display text-xl font-bold text-steps-dark">Other upcoming events</h2>
              <span className="text-xs text-slate-400 uppercase tracking-wider">Heads-up</span>
            </div>
            <p className="text-sm text-slate-500 mb-4">These aren’t open to your year group — but here’s what’s coming up.</p>
            <div className="space-y-4">
              {ineligibleOpenEvents.map(event => {
                const publicLocation = getDisplayLocation(event, false)
                const yearLabel = `Open to ${formatOpenTo(event.eligible_year_groups, !!event.open_to_gap_year).toLowerCase()}`
                return (
                  <Link
                    key={event.id}
                    href={`/my/events/${event.id}`}
                    className="relative block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden opacity-60 hover:opacity-90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 focus-visible:opacity-100 transition group"
                    title={yearLabel}
                  >
                    <div className="flex items-stretch min-h-[160px] sm:min-h-[200px]">
                      <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
                        <h3 className="font-display text-lg sm:text-xl font-bold text-steps-dark">{event.name}</h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-1.5">
                          {event.event_date && <span>{formatDate(event.event_date)}</span>}
                          {event.time_start && <span>{event.time_start}{event.time_end ? ` – ${event.time_end}` : ''}</span>}
                          {publicLocation && <span>{publicLocation}</span>}
                        </div>
                        {event.description && (
                          <p className="text-sm text-slate-500 mt-3 line-clamp-3">{stripToText(event.description)}</p>
                        )}
                        <div className="mt-auto pt-3 flex items-center justify-between gap-3">
                          <span />
                          <span className="flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            {yearLabel}
                          </span>
                        </div>
                      </div>
                      {event.hub_image_url && (
                        <div className="flex-shrink-0 w-32 sm:w-60 self-stretch bg-slate-100 relative border-l border-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={event.hub_image_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover grayscale"
                            style={{ objectPosition: `${event.hub_focal_x ?? 50}% ${event.hub_focal_y ?? 50}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* === Section: My applications === */}
        <section className="mb-10" aria-labelledby="apps-heading">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="apps-heading" className="font-display text-xl font-bold text-steps-dark">My applications</h2>
            {applications.length > 0 && (
              <span className="text-xs text-slate-400 uppercase tracking-wider">{applications.length} total</span>
            )}
          </div>

          {applications.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-steps-blue-50 text-steps-blue-600 flex items-center justify-center mb-3">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              {eligibleOpenEvents.length > 0 ? (
                <>
                  <p className="font-medium text-steps-dark">No applications yet</p>
                  <p className="text-steps-blue-600 text-sm mt-1 font-medium">There’s an open event above — check it out.</p>
                </>
              ) : ineligibleOpenEvents.length > 0 ? (
                <>
                  <p className="font-medium text-steps-dark">Nothing open for your year group yet</p>
                  <p className="text-slate-500 text-sm mt-1">We’ll email you as soon as something opens up.</p>
                </>
              ) : (
                <>
                  <p className="font-medium text-steps-dark">No new opportunities right now</p>
                  <p className="text-slate-500 text-sm mt-1">We’ll email you when the next round opens — keep an eye on your inbox.</p>
                </>
              )}
            </div>
          ) : (() => {
            const todayMs = Date.now()
            const eventTime = (a: HubApplication) => a.event.event_date
              ? new Date(a.event.event_date + 'T00:00:00').getTime()
              : Number.POSITIVE_INFINITY
            const sortedDesc = [...applications].sort((a, b) => eventTime(b) - eventTime(a))
            const active = sortedDesc.filter(a => !a.event.event_date || new Date(a.event.event_date).getTime() >= todayMs)
            const past = sortedDesc.filter(a =>  a.event.event_date && new Date(a.event.event_date).getTime() <  todayMs)

            const renderCard = (app: HubApplication) => {
                const journey = getJourneyAwareLabel(app.status, app.status_history, app.event.event_date)
                const isPast = app.event.event_date && new Date(app.event.event_date) < new Date()
                const canSeeFull = app.status === 'accepted'
                const displayLocation = getDisplayLocation(app.event, canSeeFull)
                const stopNav = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation() }
                return (
                  <Link
                    key={app.id}
                    href={`/my/events/${app.event.id}`}
                    className="relative block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg hover:border-steps-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 transition-all group"
                  >
                    <div className="flex items-stretch min-h-[140px] sm:min-h-[180px]">
                      <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display text-lg sm:text-xl font-bold text-steps-dark group-hover:text-steps-blue-700 transition-colors">{app.event.name}</h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${journey.badgeClasses}`}>
                            {journey.prefix ? (
                              <>
                                <span className="opacity-70 mr-1">{journey.prefix}</span>
                                <span aria-hidden className="opacity-50 mr-1">·</span>
                              </>
                            ) : null}
                            {journey.primary}
                          </span>
                          {isPast && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                              Past event
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-1.5">
                          {app.event.event_date && <span>{formatDate(app.event.event_date)}</span>}
                          {displayLocation && <span>{displayLocation}</span>}
                        </div>

                        {/* Journey timeline — visualises where the application is */}
                        <JourneyTimeline status={app.status} history={app.status_history} eventDate={app.event.event_date} />

                        <p className="text-xs text-slate-400 mt-3">
                          Applied {new Date(app.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>

                        {!isPast && app.status !== 'withdrew' && app.status !== 'rejected' && (
                          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                            {app.status === 'submitted' && (
                              <a
                                href={`/apply/${app.event.slug}?edit=1`}
                                onClick={e => e.stopPropagation()}
                                className="px-3 py-1.5 text-sm text-steps-blue-700 hover:text-steps-blue-900 font-medium border border-steps-blue-200 rounded-xl hover:bg-steps-blue-50 transition text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-1"
                              >
                                Edit application
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={e => { stopNav(e); setWithdrawTarget(app); setWithdrawError(null) }}
                              className="px-3 py-1.5 text-sm text-steps-berry hover:text-white font-medium border border-steps-berry/40 rounded-xl hover:bg-steps-berry transition focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-berry focus-visible:ring-offset-1"
                            >
                              Withdraw
                            </button>
                          </div>
                        )}
                      </div>
                      {app.event.hub_image_url && (
                        <div className="flex-shrink-0 w-32 sm:w-56 self-stretch bg-slate-100 relative border-l border-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={app.event.hub_image_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ objectPosition: `${app.event.hub_focal_x ?? 50}% ${app.event.hub_focal_y ?? 50}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </Link>
                )
            }

            return (
              <div className="space-y-8">
                {active.length > 0 && (
                  <div>
                    {past.length > 0 && (
                      <div className="flex items-baseline justify-between mb-3">
                        <h3 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">Current &amp; upcoming</h3>
                        <span className="text-xs text-slate-400">{active.length}</span>
                      </div>
                    )}
                    <div className="space-y-4">
                      {active.map(renderCard)}
                    </div>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="font-display text-sm font-bold text-steps-dark uppercase tracking-wider">Past events</h3>
                      <span className="text-xs text-slate-400">{past.length}</span>
                    </div>
                    <div className="space-y-4">
                      {past.map(renderCard)}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </section>

        {/* === Section: My details === */}
        <section className="mb-10" aria-labelledby="details-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="details-heading" className="font-display text-xl font-bold text-steps-dark">My details</h2>
            {!editing && profile && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-steps-blue-600 hover:text-steps-blue-800 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue-500 focus-visible:ring-offset-2 rounded px-1"
              >
                Edit
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            {!profile ? (
              <p className="text-slate-500 text-sm">No profile found. Apply to an event to create your profile.</p>
            ) : editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="hub-firstname" className="block text-sm font-medium text-slate-700 mb-1">First name</label>
                    <input id="hub-firstname" type="text" value={firstName} autoComplete="given-name" onChange={e => setFirstName(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition" />
                  </div>
                  <div>
                    <label htmlFor="hub-lastname" className="block text-sm font-medium text-slate-700 mb-1">Last name</label>
                    <input id="hub-lastname" type="text" value={lastName} autoComplete="family-name" onChange={e => setLastName(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">School</label>
                  <SchoolPicker value={school} onChange={setSchool} placeholder="Search for your school…" id="hub-school" />
                </div>

                <div>
                  <label htmlFor="hub-yeargroup" className="block text-sm font-medium text-slate-700 mb-1">Year group</label>
                  {profile.year_group != null ? (
                    <>
                      <div id="hub-yeargroup" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-700">
                        {profile.year_group === 14 ? 'Gap year' : `Year ${profile.year_group}`}
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5">
                        Wrong year? <a href="mailto:hello@thestepsfoundation.com" className="text-steps-blue-600 hover:underline">Contact hello@thestepsfoundation.com</a> to update this.
                      </p>
                    </>
                  ) : (
                    <select id="hub-yeargroup" value={yearGroup} onChange={e => setYearGroup(e.target.value ? Number(e.target.value) : '')} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white">
                      <option value="">Select…</option>
                      <option value={12}>Year 12</option>
                      <option value={13}>Year 13</option>
                      <option value={14}>Gap year</option>
                    </select>
                  )}
                </div>

                <div>
                  <label htmlFor="hub-schooltype" className="block text-sm font-medium text-slate-700 mb-1">School type</label>
                  <select id="hub-schooltype" value={schoolType} onChange={e => setSchoolType(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white">
                    <option value="">Select…</option>
                    {SCHOOL_TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </div>

                <fieldset>
                  <legend className="block text-sm font-medium text-slate-700 mb-1">Eligible for Free School Meals?</legend>
                  <div className="flex gap-4">
                    {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(opt => (
                      <label key={String(opt.v)} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="fsm" checked={freeSchoolMeals === opt.v} onChange={() => setFreeSchoolMeals(opt.v)} className="accent-steps-blue-600" />
                        <span className="text-sm text-slate-700">{opt.l}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="hub-income" className="block text-sm font-medium text-slate-700 mb-1">Household income under £40k?</label>
                  <select id="hub-income" value={incomeBand} onChange={e => setIncomeBand(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition bg-white">
                    <option value="">Select…</option>
                    {INCOME_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </div>

                <fieldset>
                  <legend className="block text-sm font-medium text-slate-700 mb-1">Did you grow up in a household where at least one parent went to university?</legend>
                  <div className="flex gap-4">
                    {[{ v: 'yes' as const, l: 'Yes' }, { v: 'no' as const, l: 'No' }].map(opt => (
                      <label key={opt.v} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="firstGenUni" checked={firstGenerationUni === opt.v} onChange={() => setFirstGenerationUni(opt.v)} className="accent-steps-blue-600" />
                        <span className="text-sm text-slate-700">{opt.l}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="gcse-hub" className="block text-sm font-medium text-slate-700 mb-1">Achieved GCSE results</label>
                  <p className="text-xs text-slate-400 mb-2">Enter your grades as numbers only, highest to lowest (e.g. 999887766).</p>
                  <input id="gcse-hub" type="text" inputMode="numeric" pattern="[0-9]*" value={gcseResults} onChange={e => setGcseResults(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 999887766" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition font-mono tracking-wider" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subjects and predicted/achieved grades</label>
                  <p className="text-xs text-slate-400 mb-3">Add each subject you study. Select your qualification type, subject, and current predicted (or achieved) grade.</p>
                  <QualificationsEditor value={qualifications} onChange={setQualifications} error={qualificationsError} onInteract={() => setQualificationsError(null)} />
                </div>

                <div>
                  <label htmlFor="addcontext-hub" className="block text-sm font-medium text-slate-700 mb-1">Any additional contextual information you’d like us to know</label>
                  <p className="text-xs text-slate-400 mb-2">E.g. young carer, care experience, extenuating circumstances, school disruption — anything you think we should know.</p>
                  <textarea id="addcontext-hub" value={additionalContext} onChange={e => setAdditionalContext(e.target.value)} rows={3} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition resize-none" />
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setEditing(false); if (profile) populateForm(profile) }} className="px-6 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition text-sm">Cancel</button>
                  <PressableButton onClick={handleSave} disabled={saving} size="sm" fullWidth>{saving ? 'Saving…' : 'Save changes'}</PressableButton>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-y-4 gap-x-8">
                <Detail label="First name" value={profile.first_name} />
                <Detail label="Last name" value={profile.last_name} />
                <Detail label="Email" value={profile.personal_email} />
                <Detail label="Year group" value={profile.year_group ? `Year ${profile.year_group}` : null} />
                <Detail label="School" value={profile.school_name_raw} className="col-span-2" />
                <Detail label="School type" value={SCHOOL_TYPE_OPTIONS.find(o => o.value === profile.school_type)?.label ?? profile.school_type} />
                <Detail label="Free School Meals" value={profile.free_school_meals === true ? 'Yes' : profile.free_school_meals === false ? 'No' : null} />
                <Detail label="Household income" value={INCOME_OPTIONS.find(o => o.value === profile.parental_income_band)?.label ?? profile.parental_income_band} />
                <Detail label="Parent went to university" value={profile.first_generation_uni === true ? 'No' : profile.first_generation_uni === false ? 'Yes' : null} />
                <Detail label="GCSE results" value={profile.gcse_results} />
                <Detail
                  label="Subjects and grades"
                  className="col-span-2"
                  value={(() => {
                    const qs = Array.isArray(profile.qualifications) ? profile.qualifications : []
                    if (qs.length === 0) return null
                    return qs.map((q) => {
                      const subj = q.subject === '__other' ? 'Other' : q.subject
                      const lvl = q.qualType === 'ib' && q.level ? ` (${q.level.split(' ')[0]})` : ''
                      return `${subj}${lvl} — ${q.grade}`
                    }).join(', ')
                  })()}
                />
                <Detail label="Additional context" className="col-span-2" value={profile.additional_context} />
              </dl>
            )}
          </div>
        </section>

        <p className="text-center text-xs text-slate-400 mt-12 tracking-[0.2em] uppercase">
          <em className="not-italic">Virtus non origo</em> &nbsp;·&nbsp; Character, not origin
        </p>
      </div>

      {/* Withdraw success toast */}
      {withdrawSuccess && (
        <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[90%] animate-tsf-fade-up">
          <div className="bg-white rounded-2xl shadow-xl border border-emerald-200 px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0" aria-hidden>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-steps-dark">Application withdrawn</p>
              <p className="text-xs text-slate-600 mt-0.5">{withdrawSuccess}</p>
            </div>
            <button type="button" onClick={() => setWithdrawSuccess(null)} className="text-slate-400 hover:text-slate-600 -mr-1" aria-label="Dismiss">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Withdraw confirmation modal */}
      {withdrawTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="hub-withdraw-title" aria-describedby="hub-withdraw-desc" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-tsf-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 max-w-md w-full animate-tsf-fade-up">
            <h3 id="hub-withdraw-title" className="font-display text-xl font-bold text-steps-dark mb-1">Withdraw your application?</h3>
            <p id="hub-withdraw-desc" className="text-sm text-slate-600 mb-4">
              You’re about to withdraw your application to <span className="font-semibold text-steps-dark">{withdrawTarget.event.name}</span>.
              You can re-apply while applications are still open — but once the deadline passes, you won’t be able to submit again.
            </p>

            {withdrawError && (
              <p role="alert" className="mb-4 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{withdrawError}</p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => { setWithdrawTarget(null); setWithdrawError(null) }} disabled={withdrawLoading} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition disabled:opacity-50">
                Keep my application
              </button>
              <button type="button" onClick={handleWithdraw} disabled={withdrawLoading} className="px-4 py-2 text-sm font-semibold text-white bg-steps-berry rounded-xl hover:bg-steps-berry/90 transition disabled:opacity-60">
                {withdrawLoading ? 'Withdrawing…' : 'Yes, withdraw'}
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
      <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  )
}

function DotIcon() {
  return <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-steps-blue-500" />
}

function ClockIcon() {
  return (
    <svg aria-hidden className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg aria-hidden className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Journey timeline — adaptive horizontal indicator. The number of steps
// matches the actual path through the application lifecycle:
//
//   Accepted (event upcoming) : Applied -> Decision: Accepted -> RSVP -> Attended
//   Accepted (event past)     : Applied -> Decision: Accepted    (terminal)
//   Rejected / withdrew /
//     ineligible / waitlist
//     after event              : Applied -> Decision: <outcome>  (terminal)
//   Submitted / shortlisted /
//     waitlist (upcoming)      : Applied -> Decision: <pending>
//
// Status codes are normalised through application-status.ts so the labels
// stay in lock-step with the journey-aware pill rendered above the bar.
// ---------------------------------------------------------------------------

import type { ApplicationStatusCode, StatusHistoryRow } from '@/lib/application-status'
import { normalizeStatus } from '@/lib/application-status'

// Tone palette — colour reflects the *highest* stage the student reached,
// not the final outcome. So a "shortlisted then rejected" journey reads
// violet (the stage they earned) with a "Not this time" label, never red.
type Tone = 'accepted' | 'waitlist' | 'shortlisted' | 'pending' | 'neutral'

const TONE_BAR: Record<Tone, string> = {
  accepted:    'bg-emerald-500',
  waitlist:    'bg-steps-sunrise',
  shortlisted: 'bg-violet-500',
  pending:     'bg-steps-blue-600',
  neutral:     'bg-slate-400',
}
const TONE_LABEL: Record<Tone, string> = {
  accepted:    'text-emerald-700',
  waitlist:    'text-steps-sunrise',
  shortlisted: 'text-violet-700',
  pending:     'text-steps-blue-700',
  neutral:     'text-slate-600',
}

function JourneyTimeline({ status, history, eventDate }: { status: string; history: StatusHistoryRow[]; eventDate: string | null }) {
  const code: ApplicationStatusCode | null = normalizeStatus(status)
  if (!code) return null

  const isPast = !!(eventDate && new Date(eventDate) < new Date())
  const everShortlisted = history?.some(h => normalizeStatus(h.status) === 'shortlisted')
  const everWaitlisted = history?.some(h => normalizeStatus(h.status) === 'waitlist')

  // Bar fill encodes how far through the funnel the student got. The
  // outcome itself is conveyed by the pill above the card (and the
  // "Applied 28 Apr" line below) — so we don't repeat it on the bar
  // labels. "Applied" is dropped from the bar entirely (it's a given,
  // and the date is right below). Multi-step accepted-upcoming keeps
  // forward-looking labels because they tell the student what's next.
  type Step = { key: string; label: string | null; tone: Tone; fill: number; active: boolean }
  let steps: Step[] = []

  if (code === 'accepted') {
    if (isPast) {
      // Past-event accepted — single segment, no label needed.
      steps = [
        { key: 'decision', label: null, tone: 'accepted', fill: 100, active: true },
      ]
    } else {
      // Forward-looking journey: students need to know what's still ahead.
      steps = [
        { key: 'decision', label: 'Decision', tone: 'accepted', fill: 100, active: false },
        { key: 'rsvp',     label: 'RSVP',     tone: 'accepted', fill: 0,   active: true  },
        { key: 'attended', label: 'Attended', tone: 'accepted', fill: 0,   active: false },
      ]
    }
  } else if (code === 'rejected') {
    if (everShortlisted) {
      steps = [{ key: 'decision', label: null, tone: 'shortlisted', fill: 50,  active: true }]
    } else if (everWaitlisted) {
      steps = [{ key: 'decision', label: null, tone: 'waitlist',    fill: 75,  active: true }]
    } else {
      steps = [{ key: 'decision', label: null, tone: 'neutral',     fill: 30,  active: true }]
    }
  } else if (code === 'waitlist') {
    steps = [{ key: 'decision', label: null, tone: 'waitlist', fill: 75, active: true }]
    // Past-event waitlist tone is the same — pill above already labels it
    // "Waitlisted · Unsuccessful", we don't need to repeat the story here.
    void isPast // keep variable referenced for future use
  } else if (code === 'shortlisted') {
    steps = [{ key: 'decision', label: null, tone: 'shortlisted', fill: 50, active: true }]
  } else if (code === 'withdrew') {
    steps = [{ key: 'decision', label: null, tone: 'neutral', fill: 50, active: true }]
  } else if (code === 'ineligible') {
    steps = [{ key: 'decision', label: null, tone: 'neutral', fill: 30, active: true }]
  } else {
    // submitted (decision pending)
    steps = [{ key: 'decision', label: null, tone: 'pending', fill: 15, active: true }]
  }

  const hasLabels = steps.some(s => s.label !== null)

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1" aria-hidden>
        {steps.map((s, i) => (
          <div key={s.key} className="flex-1 flex items-center gap-1">
            <span className="block h-2 flex-1 rounded-full bg-slate-200 overflow-hidden">
              <span
                className={`block h-full rounded-full transition-all ${TONE_BAR[s.tone]}`}
                style={{ width: `${s.fill}%` }}
              />
            </span>
            {i < steps.length - 1 && <span className="block w-1" />}
          </div>
        ))}
      </div>
      {hasLabels && (
        <div
          className="grid mt-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold gap-1"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((s, i) => {
            const align = steps.length === 1 ? 'text-center'
              : i === 0 ? 'text-left'
              : i === steps.length - 1 ? 'text-right'
              : 'text-center'
            return (
              <span key={s.key} className={`${align} ${s.active ? TONE_LABEL[s.tone] : ''}`}>
                {s.label ?? ''}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function StudentHub() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div aria-hidden className="animate-spin w-8 h-8 border-2 border-steps-blue-600 border-t-transparent rounded-full" />
      </div>
    }>
      <StudentHubInner />
    </Suspense>
  )
}
