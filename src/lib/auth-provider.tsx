'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Whitelist of allowed emails
const ALLOWED_EMAILS = [
  'favour.oluwanusin@gmail.com',
  'jandoit@hotmail.com',
  'daniyaal.anawar10@gmail.com',
  'sam@revishaan.com',
  'earlxavierfornillos@gmail.com',
  'adityamuthukumar05@gmail.com',
  'ric.serrao39@gmail.com',
]

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  isAllowedEmail: (email: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const isAllowedEmail = (email: string): boolean => {
    return ALLOWED_EMAILS.includes(email.toLowerCase())
  }

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const normalizedEmail = email.toLowerCase().trim()
    
    // Check whitelist
    if (!isAllowedEmail(normalizedEmail)) {
      return { error: 'This email is not authorized to access the task tracker.' }
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
    
    // Check whitelist
    if (!isAllowedEmail(normalizedEmail)) {
      return { error: 'This email is not authorized to access the task tracker.' }
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' 
          ? `${window.location.origin}/auth/callback`
          : undefined,
        queryParams: {
          prompt: 'select_account',  // Always show account picker
        },
      },
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut, isAllowedEmail }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    // Return safe defaults during SSR or before provider mounts
    return {
      user: null,
      session: null,
      loading: true,
      signIn: async () => ({ error: 'Auth not ready' }),
      signUp: async () => ({ error: 'Auth not ready' }),
      signInWithGoogle: async () => ({ error: 'Auth not ready' }),
      signOut: async () => {},
      isAllowedEmail: () => false,
    }
  }
  return context
}

// Helper to get user display name from email
export function getUserDisplayName(email: string | undefined): string {
  if (!email) return 'Unknown'
  
  const emailToName: Record<string, string> = {
    'favour.oluwanusin@gmail.com': "God'sFavour",
    'jandoit@hotmail.com': 'Jin',
    'daniyaal.anawar10@gmail.com': 'Daniyaal',
    'sam@revishaan.com': 'Sam',
    'earlxavierfornillos@gmail.com': 'Earl',
    'adityamuthukumar05@gmail.com': 'Aditya',
    'ric.serrao39@gmail.com': 'Ricardo',
  }
  
  return emailToName[email.toLowerCase()] || email.split('@')[0]
}
