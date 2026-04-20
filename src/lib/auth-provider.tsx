'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  const checkTeamMembership = useCallback(async (email: string | undefined): Promise<
    | { status: 'member'; row: TeamMember }
    | { status: 'not_member' }
    | { status: 'unknown' }
  > => {
    if (!email) return { status: 'not_member' }
    try {
      const result = await Promise.race([
        supabase
          .from('team_members')
          .select('id, name, role, email, auth_uuid')
          .eq('email', email.toLowerCase())
          .limit(1)
          .maybeSingle(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Team membership check timed out')), 8000)
        ),
      ])
      const { data, error } = result
      if (error) {
        console.warn('[auth] checkTeamMembership DB error:', error.message)
        return { status: 'unknown' }
      }
      if (!data) return { status: 'not_member' }
      return { status: 'member', row: data as TeamMember }
    } catch (err: any) {
      console.warn('[auth] checkTeamMembership failed:', err?.message)
      return { status: 'unknown' }
    }
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
      setSession(newSession)
      const newUser = newSession?.user ?? null
      setUser(newUser)

      // Signed out: clear and exit.
      if (event === 'SIGNED_OUT' || !newUser?.email) {
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

      if (result.status === 'member') {
        setTeamMember(result.row)
        return
      }

      // 'unknown' means the check failed (timeout / network). Never sign out
      // on this — keep whatever team state we already have.
      if (result.status === 'unknown') {
        console.warn('[auth] team check returned unknown — keeping existing state')
        return
      }

      // Confirmed not a team member. Only sign out if they're on an admin
      // page; /apply and /my handle their own student auth.
      setTeamMember(null)
      if (typeof window !== 'undefined'
          && !window.location.pathname.startsWith('/apply')
          && !window.location.pathname.startsWith('/my')) {
        await supabase.auth.signOut()
        setUser(null)
        setSession(null)
      }
    } catch (err) {
      console.error('[auth] handleAuthChange error:', err)
      // Do NOT clear team state on unexpected errors — same reasoning as
      // the 'unknown' branch above. Let the user keep working.
    } finally {
      setLoading(false)
    }
  }, [checkTeamMembership])

  useEffect(() => {
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
