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
  // Wrapped in a 5-second timeout so a hanging Supabase request
  // can never cause an infinite loading screen.
  const checkTeamMembership = useCallback(async (email: string | undefined): Promise<TeamMember | null> => {
    if (!email) return null
    try {
      const result = await Promise.race([
        supabase
          .from('team_members')
          .select('id, name, role, email, auth_uuid')
          .eq('email', email.toLowerCase())
          .limit(1)
          .maybeSingle(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Team membership check timed out')), 5000)
        ),
      ])
      const { data, error } = result
      if (error || !data) return null
      return data as TeamMember
    } catch {
      console.warn('[auth] checkTeamMembership failed or timed out')
      return null
    }
  }, [])

  // Handle auth state changes — runs on initial load and every sign-in/out
  const handleAuthChange = useCallback(async (newSession: Session | null) => {
    try {
      setSession(newSession)
      const newUser = newSession?.user ?? null
      setUser(newUser)

      if (newUser?.email) {
        const tm = await checkTeamMembership(newUser.email)
        setTeamMember(tm)

        // If someone signs in (Google or otherwise) and they're NOT a team member,
        // AND we're on an admin page (not /apply or /student-portal), sign them out immediately.
        // The /apply and /student-portal pages handle their own auth via OTP.
        if (!tm && typeof window !== 'undefined'
            && !window.location.pathname.startsWith('/apply')
            && !window.location.pathname.startsWith('/student-portal')) {
          await supabase.auth.signOut()
          setUser(null)
          setSession(null)
          setTeamMember(null)
        }
      } else {
        setTeamMember(null)
      }
    } catch (err) {
      console.error('[auth] handleAuthChange error:', err)
      // On any failure, clear state so the user lands on the login page
      // instead of being stuck on an infinite loading screen.
      setTeamMember(null)
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
      .then(({ data: { session } }) => handleAuthChange(session))
      .catch((err) => {
        console.warn('[auth] getSession failed:', err?.message)
        setLoading(false)
      })

    // Listen for auth changes (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          await handleAuthChange(session)
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

    // Check team_members BEFORE attempting sign-in
    const tm = await checkTeamMembership(normalizedEmail)
    if (!tm) {
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

    // Check team_members BEFORE allowing sign-up
    const tm = await checkTeamMembership(normalizedEmail)
    if (!tm) {
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
