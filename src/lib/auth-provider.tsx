'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const AUTH_LOG_ENABLED = true
function alog(...args: any[]) {
  if (!AUTH_LOG_ENABLED) return
  const ts = new Date().toISOString().slice(11, 23)
  // eslint-disable-next-line no-console
  console.log(`[auth ${ts}]`, ...args)
}


type TeamMember = {
  auth_uuid: string
  id: number
  name: string
  role: string
  email: string
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  /** The team_members row for the current user, or null if not a team member. */
  teamMember: TeamMember | null
  /** True only after we've checked team_members and the user IS a team member. */
  isTeamMember: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null)

  // Refs that mirror teamMember + hold any in-flight team_members check.
  // They power the dedup + cache-hit fast paths in checkTeamMembership (below).
  // Why refs, not state: checkTeamMembership is a useCallback with a stable
  // empty dep array — we intentionally want the SAME function identity across
  // renders so handleAuthChange's deps don't churn and refire its useEffect.
  // Reading state via a ref sidesteps the stale-closure problem without
  // invalidating the callback.
  const teamMemberRef = useRef<TeamMember | null>(null)
  useEffect(() => {
    teamMemberRef.current = teamMember
  }, [teamMember])

  type TeamCheckResult =
    | { status: 'member'; row: TeamMember }
    | { status: 'not_member' }
    | { status: 'unknown' }
  const inFlightCheckRef = useRef<{ email: string; promise: Promise<TeamCheckResult> } | null>(null)

  // Check if authenticated user is in team_members table.
  // This is the single source of truth — no hardcoded allowlist.
  //
  // IMPORTANT: We distinguish three outcomes:
  //   - { status: 'member',  row: TeamMember }   → authorised team member
  //   - { status: 'not_member' }                 → confirmed NOT a team member
  //   - { status: 'unknown' }                    → check failed (timeout / network / RLS)
  //
  // A failed check MUST NOT be treated as 'not_member', or transient network
  // slowness (e.g. during a big storage upload) will silently sign the user out.
  //
  // This function is the hot path for the /students/events bounce bug. Every
  // duplicate/concurrent call here multiplies the odds that ONE of them times
  // out under load, falls into the 'unknown' retry loop, and eventually gives
  // up as 'not-member' — kicking the admin out. Two dedup layers protect it:
  //
  //   1. Cache hit — if teamMemberRef already holds a row for this email, we
  //      return it without a network call. The team_members row doesn't change
  //      mid-session, so a previously-validated email stays valid for any
  //      follow-up INITIAL_SESSION / USER_UPDATED / re-mount event.
  //   2. In-flight coalescing — if another call for the same email is already
  //      querying, every subsequent caller awaits that one promise instead of
  //      firing its own query. The race described in commit 977669a
  //      (getSession INITIAL_SESSION + listener INITIAL_SESSION + SIGNED_IN
  //      from hash parsing, all within ms of each other) collapses to one.
  const checkTeamMembership = useCallback(async (email: string | undefined): Promise<TeamCheckResult> => {
    if (!email) return { status: 'not_member' }
    const lower = email.toLowerCase()

    // 1. Cache hit — already validated this email in this session.
    const cached = teamMemberRef.current
    if (cached && cached.email.toLowerCase() === lower) {
      alog('checkTeamMembership cache hit for', lower)
      return { status: 'member', row: cached }
    }

    // 2. Coalesce — reuse any in-flight check for the same email.
    const inFlight = inFlightCheckRef.current
    if (inFlight && inFlight.email === lower) {
      alog('checkTeamMembership coalescing — awaiting in-flight for', lower)
      return inFlight.promise
    }

    const runCheck = async (): Promise<TeamCheckResult> => {
      try {
        const result = await Promise.race([
          supabase
            .from('team_members')
            .select('id, name, role, email, auth_uuid')
            .eq('email', lower)
            .limit(1)
            .maybeSingle(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Team membership check timed out')), 8000)
          ),
        ])
        const { data, error } = result
        if (error) {
          console.warn('[auth] checkTeamMembership DB error:', error.message)
          return { status: 'unknown' } as const
        }
        if (!data) return { status: 'not_member' } as const
        return { status: 'member', row: data as TeamMember } as const
      } catch (err: any) {
        console.warn('[auth] checkTeamMembership failed:', err?.message)
        return { status: 'unknown' } as const
      }
    }

    const promise: Promise<TeamCheckResult> = runCheck()
    inFlightCheckRef.current = { email: lower, promise }
    // Clear the in-flight entry once the promise settles (only if it's still
    // ours — a check for a different email may have replaced it by then).
    promise.finally(() => {
      if (inFlightCheckRef.current?.promise === promise) {
        inFlightCheckRef.current = null
      }
    })
    return promise
  }, [])

  // Handle auth state changes. Runs on initial load, sign-in, sign-out, AND
  // every background token refresh. We must be careful not to re-validate
  // team membership on every refresh — that's expensive and fragile
  // (see prior bug: transient timeout during image upload → silent logout).
  //
  // Strategy:
  //   - INITIAL_SESSION / SIGNED_IN / USER_UPDATED → full check + enforce
  //   - TOKEN_REFRESHED → just update the session object, keep cached team state
  //   - SIGNED_OUT → clear everything
  const handleAuthChange = useCallback(async (
    event: string | null,
    newSession: Session | null,
  ) => {
    try {
      alog('handleAuthChange event=', event, 'hasSession=', !!newSession, 'email=', newSession?.user?.email)
      setSession(newSession)
      const newUser = newSession?.user ?? null
      setUser(newUser)

      // Signed out: clear and exit. Synchronously invalidate the ref +
      // in-flight cache so a concurrent checkTeamMembership call can't
      // serve the stale row between now and the useEffect sync.
      if (event === 'SIGNED_OUT' || !newUser?.email) {
        teamMemberRef.current = null
        inFlightCheckRef.current = null
        setTeamMember(null)
        return
      }

      // Token refresh / silent re-auth: DO NOT re-hit team_members.
      // The team_members row does not change during a session; re-checking
      // here was the root cause of the mid-session logout bug.
      if (event === 'TOKEN_REFRESHED') {
        return
      }

      // Real auth event — validate team membership.
      const result = await checkTeamMembership(newUser.email)
      alog('team check result:', result.status, 'for', newUser.email)

      if (result.status === 'member') {
        setTeamMember(result.row)
        return
      }

      // 'unknown' means the check failed (timeout / network). Retry with
      // short backoff before giving up. Critical: we do NOT set loading=false
      // in the finally block for 'unknown' status — we want pages/layouts to
      // keep showing "Loading…" rather than see loading=false + !isTeamMember
      // and bounce to /login. Only conclusive 'member' or 'not_member' should
      // release the loading state.
      if (result.status === 'unknown') {
        const maxAttempts = 3
        let attempt = 1
        let conclusive: { status: 'member'; row: TeamMember } | { status: 'not_member' } | null = null
        while (attempt < maxAttempts) {
          console.warn(`[auth] team check unknown (attempt ${attempt}/${maxAttempts}) — retrying in ${attempt * 800}ms`)
          await new Promise(r => setTimeout(r, attempt * 800))
          const retry = await checkTeamMembership(newUser.email)
          alog('team check retry result:', retry.status)
          if (retry.status === 'member' || retry.status === 'not_member') {
            conclusive = retry
            break
          }
          attempt++
        }
        if (conclusive?.status === 'member') {
          setTeamMember(conclusive.row)
          return
        }
        if (conclusive?.status === 'not_member') {
          // fall through to the not_member branch below by reassigning result
          // (can't reassign a const — just duplicate the not-member path here)
          setTeamMember(null)
          return
        }
        // All retries returned 'unknown'. Give up: surface as not-a-member so
        // the user ends up on /login rather than stuck in an infinite loader.
        console.warn('[auth] team check still unknown after retries — treating as not-member')
        setTeamMember(null)
        return
      }

      // Confirmed not a team member.
      //
      // Historical note: we once removed the signOut() here because a shared
      // storageKey meant student sign-ins in another tab fired SIGNED_IN on
      // the admin client, and signing out clobbered the shared session for
      // both tabs. That's fixed now by using a separate Supabase client for
      // the student hub (src/lib/supabase-student.ts) with its own storageKey,
      // so admin onAuthStateChange only fires for actual admin actions or
      // stale state on the admin key.
      //
      // For INITIAL_SESSION, clear the stored admin session — it's leftover
      // from before the client split (e.g. a student who used the admin
      // client when both shared a key). Without this, the admin tab would
      // boot with a stale student session and get bounced to /login forever.
      alog('not a team member — clearing teamMember state. event=', event, 'path=', typeof window !== 'undefined' ? window.location.pathname : 'ssr')
      setTeamMember(null)
      if (event === 'INITIAL_SESSION') {
        try {
          await supabase.auth.signOut({ scope: 'local' })
          setSession(null)
          setUser(null)
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.replace('/login')
          }
        } catch (err) {
          console.warn('[auth] failed to clear stale admin session:', err)
        }
      }
    } catch (err) {
      console.error('[auth] handleAuthChange error:', err)
      // Do NOT clear team state on unexpected errors — same reasoning as
      // the 'unknown' branch above. Let the user keep working.
    } finally {
      alog('setLoading(false) from handleAuthChange')
      setLoading(false)
    }
  }, [checkTeamMembership])

  useEffect(() => {
    alog('AuthProvider useEffect init on path=', typeof window !== 'undefined' ? window.location.pathname : 'ssr')
    // AuthProvider is strictly for ADMIN routes. Student-facing routes
    // (/my, /apply) manage their own Supabase session independently. If we
    // run the admin auth flow on those routes we can race with or clobber
    // the student session — confirmed cause of the OTP bounce-back bug where
    // no sb-* key ever landed in localStorage. Short-circuit on student
    // routes: no getSession, no listener, no team_members check.
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      if (path.startsWith('/my') || path.startsWith('/apply')) {
        setLoading(false)
        return
      }
    }

    // Get initial session with a 8-second hard timeout.
    // Supabase's GoTrue lock can orphan (especially on fast navigation or
    // React Strict Mode), blocking getSession() forever. The timeout ensures
    // we always fall through to the login page.
    Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession timed out')), 8000)
      ),
    ])
      .then(({ data: { session } }) => handleAuthChange('INITIAL_SESSION', session))
      .catch((err) => {
        console.warn('[auth] getSession failed:', err?.message)
        setLoading(false)
      })

    // Listen for auth changes (sign-in, sign-out, token refresh, user updated).
    // We forward the event type so handleAuthChange can skip the team_members
    // re-check on TOKEN_REFRESHED — crucial for avoiding mid-session logouts.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        alog('onAuthStateChange listener fired event=', event, 'hasSession=', !!session)
        try {
          await handleAuthChange(event, session)
        } catch (err) {
          console.error('[auth] onAuthStateChange error:', err)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [handleAuthChange])

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const normalizedEmail = email.toLowerCase().trim()

    // Check team_members BEFORE attempting sign-in.
    // Treat 'unknown' (transient failure) as allowed — we'll re-validate after
    // sign-in succeeds. Better to let the request through than block on a flaky network.
    const tm = await checkTeamMembership(normalizedEmail)
    if (tm.status === 'not_member') {
      return { error: 'This email is not authorised to access the intranet. Contact a team admin if you should have access.' }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signUp = async (email: string, password: string): Promise<{ error: string | null }> => {
    const normalizedEmail = email.toLowerCase().trim()

    // Check team_members BEFORE allowing sign-up.
    // Treat 'unknown' (transient failure) as allowed — handleAuthChange will
    // re-validate once the session is established and sign them out if needed.
    const tm = await checkTeamMembership(normalizedEmail)
    if (tm.status === 'not_member') {
      return { error: 'This email is not authorised to access the intranet. Contact a team admin if you should have access.' }
    }

    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    // We can't pre-check team_members for OAuth because the email isn't known
    // until after the redirect. handleAuthChange will auto-sign-out non-members.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/login`
          : undefined,
      },
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    teamMemberRef.current = null
    inFlightCheckRef.current = null
    setUser(null)
    setSession(null)
    setTeamMember(null)
  }

  const isTeamMember = !!teamMember

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        teamMember,
        isTeamMember,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    // Safe defaults when used outside provider (SSR or tests)
    return {
      user: null,
      session: null,
      loading: true,
      teamMember: null,
      isTeamMember: false,
      signIn: async () => ({ error: 'Auth provider not initialised' }),
      signUp: async () => ({ error: 'Auth provider not initialised' }),
      signInWithGoogle: async () => ({ error: 'Auth provider not initialised' }),
      signOut: async () => {},
    }
  }
  return context
}
